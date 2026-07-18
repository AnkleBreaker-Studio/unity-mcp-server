// Protocol-level integration tests — spawn the real MCP server over stdio against a
// mock Unity bridge. These are the regression gates every behavior change must pass.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { MockBridge } from "./helpers/mock-bridge.mjs";
import { McpTestClient } from "./helpers/mcp-client.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;

/** Property schemas that count as "explicitly shaped" for strict MCP clients. */
function isStrictSchema(schema) {
  if (!schema || typeof schema !== "object") return false;
  return (
    "type" in schema || "enum" in schema || "const" in schema ||
    "anyOf" in schema || "oneOf" in schema || "allOf" in schema || "$ref" in schema
  );
}

/** Recursively validate that nested object/array property schemas stay explicitly shaped. */
function collectSchemaViolations(toolName, path, schema, violations) {
  if (!isStrictSchema(schema)) {
    violations.push(`${toolName}.${path}`);
    return;
  }
  for (const [prop, sub] of Object.entries(schema.properties || {})) {
    collectSchemaViolations(toolName, `${path}.${prop}`, sub, violations);
  }
  if (schema.items && typeof schema.items === "object" && !Array.isArray(schema.items)) {
    collectSchemaViolations(toolName, `${path}[]`, schema.items, violations);
  }
}

describe("queue-mode session (single instance)", () => {
  /** @type {MockBridge} */ let bridge;
  /** @type {McpTestClient} */ let client;
  let initResult;

  before(async () => {
    bridge = new MockBridge();
    // Plugin handlers return raw result objects; the Node bridge adds {success, data}.
    bridge.on("editor/state", () => ({ isPlaying: false, isCompiling: false, activeScene: "MockScene" }));
    bridge.on("logical/failure", () => ({ __fail: true, error: "boom: mock logical failure" }));
    bridge.on("payload/huge", () => ({ blob: "x".repeat(4_500_000) }));
    bridge.on("graphics/asset-preview", () => ({ base64: "QUJDREVG".repeat(40_000), width: 256, height: 256 }));
    bridge.on("silent/completion", () => undefined);
    bridge.on("terrain/lisr", () => ({ __fail: true, error: "Unknown route: terrain/lisr" }));
    // Old-plugin era: batch-wire route doesn't exist; single set-reference does.
    bridge.on("component/batch-wire", () => ({ __fail: true, error: "Unknown API endpoint: component/batch-wire" }));
    // Old plugins report a per-call failure as an HTTP-200 { success:true, data:{error} }
    // envelope — model that for the "propBad" entry to prove the degrade path detects it.
    bridge.on("component/set-reference", (p) =>
      p.propertyName === "propBad" ? { error: "Property not found: propBad" } : { success: true, wired: p.propertyName }
    );
    const trace = Array.from({ length: 12 }, (_, i) => `Frame${i} (at ./Library/PackageCache/pkg/File.cs:${i})`).join("\n");
    bridge.on("console/log", () => ({
      count: 2,
      entries: [
        { message: "plain info", type: "log", timestamp: "10:00:00.000", stackTrace: trace },
        { message: "kaboom", type: "error", timestamp: "10:00:01.000", stackTrace: trace },
      ],
    }));
    await bridge.start();
    client = new McpTestClient({ env: bridge.env() }).start();
    initResult = await client.initialize();
  });

  after(async () => {
    await client.close();
    await bridge.stop();
  });

  test("initialize succeeds and identifies as unity-mcp", () => {
    assert.equal(initResult.serverInfo.name, "unity-mcp");
    assert.ok(initResult.serverInfo.version, "serverInfo.version present");
  });

  test("serverInfo.version matches package.json (single source of truth)", () => {
    assert.equal(initResult.serverInfo.version, PACKAGE_VERSION);
  });

  test("tools/list exposes the two-tier surface with unique names and valid shapes", async () => {
    const { tools } = await client.listTools();
    assert.ok(tools.length >= 70 && tools.length <= 90, `expected ~79 exposed tools, got ${tools.length}`);
    const names = new Set();
    for (const tool of tools) {
      assert.ok(/^unity_[a-z0-9_]+$/.test(tool.name), `tool name convention: ${tool.name}`);
      assert.ok(!names.has(tool.name), `duplicate tool name: ${tool.name}`);
      names.add(tool.name);
      assert.ok(tool.description && tool.description.length > 0, `${tool.name} has a description`);
      assert.equal(tool.inputSchema.type, "object", `${tool.name} schema root is object`);
    }
    for (const required of [
      "unity_list_instances", "unity_select_instance", "unity_advanced_tool",
      "unity_list_advanced_tools", "unity_editor_state", "unity_get_project_context",
      "unity_hub_list_editors", "unity_execute_code", "unity_scene_hierarchy",
    ]) {
      assert.ok(names.has(required), `core surface keeps ${required}`);
    }
  });

  test("per-request port routing parameter is injected into editor tool schemas", async () => {
    const { tools } = await client.listTools();
    const editorState = tools.find((t) => t.name === "unity_editor_state");
    assert.ok(editorState.inputSchema.properties.port, "unity_editor_state has injected port param");
    const skip = tools.filter((t) => t.name.startsWith("unity_hub_") || t.name === "unity_select_instance" || t.name === "unity_list_instances");
    assert.ok(skip.length >= 3, "skip-set tools present");
  });

  test("tools/list payload size is recorded (budget gate)", async () => {
    const { tools } = await client.listTools();
    const bytes = Buffer.byteLength(JSON.stringify(tools), "utf8");
    console.error(`[gate] tools/list payload: ${(bytes / 1024).toFixed(1)} KB for ${tools.length} tools`);
    assert.ok(bytes < 120_000, `tools/list must stay under 120KB hard ceiling (got ${bytes})`);
  });

  // Diet regression lock (issue #27): baseline was 50.6KB; the compaction wave landed 42.8KB
  // with full parameter docs retained. UNITY_MCP_COMPACT_TOOLS=1 (tested below) goes further.
  test("tools/list payload stays within the rich-mode diet budget", async () => {
    const { tools } = await client.listTools();
    const bytes = Buffer.byteLength(JSON.stringify(tools), "utf8");
    assert.ok(bytes <= 44_000, `tools/list ${bytes} bytes exceeds the 44KB rich-mode budget`);
  });

  test("advanced tool category listing echoes inputSchema for on-demand parameter discovery", async () => {
    const { payload } = await client.callTool("unity_list_advanced_tools", { category: "terrain" });
    assert.ok(Array.isArray(payload) && payload.length > 10, "terrain category lists its tools");
    const withSchema = payload.filter((t) => t.inputSchema && t.inputSchema.type === "object");
    assert.equal(withSchema.length, payload.length, "every cached entry carries its schema");
  });

  test("mistyped advanced tool names get a did-you-mean suggestion", async () => {
    const { payloadText, isError } = await client.callTool("unity_advanced_tool", {
      tool: "unity_terrain_lisr",
      params: {},
    });
    assert.match(payloadText, /Did you mean/i);
    assert.match(payloadText, /unity_terrain_list/);
    assert.equal(isError, true, "unknown tool errors carry isError");
  });

  // Strict-client compatibility (issue #27): every declared property must have an explicit shape.
  test("every inputSchema property is explicitly shaped for strict clients", async () => {
    const { tools } = await client.listTools();
    const violations = [];
    for (const tool of tools) {
      for (const [prop, schema] of Object.entries(tool.inputSchema.properties || {})) {
        collectSchemaViolations(tool.name, prop, schema, violations);
      }
    }
    assert.deepEqual(violations, [], `${violations.length} loosely-shaped properties`);
  });

  test("tools/call round-trips through the queue with agent identity", async () => {
    const { payload, payloadText } = await client.callTool("unity_editor_state");
    assert.ok(payload, `tool output is JSON (got: ${payloadText.slice(0, 200)})`);
    assert.equal(payload.success, true);
    assert.equal(payload.data.activeScene, "MockScene");
    const seen = bridge.seen.find((r) => r.route === "editor/state");
    assert.ok(seen, "bridge received editor/state");
    assert.equal(seen.via, "queue");
    assert.ok(seen.headers["x-agent-id"], "X-Agent-Id header sent");
  });

  test("logical failures surface an error payload", async () => {
    const { payload, payloadText } = await client.callTool("unity_advanced_tool", {
      tool: "unity_logical_failure",
      params: {},
    });
    const text = payload ? JSON.stringify(payload) : payloadText;
    assert.match(text, /boom: mock logical failure|success.{0,4}false/i);
  });

  // MCP spec: logical failures set isError so clients don't read them as success.
  test("logical failures set the MCP isError flag", async () => {
    const { isError } = await client.callTool("unity_advanced_tool", {
      tool: "unity_logical_failure",
      params: {},
    });
    assert.equal(isError, true);
  });

  test("successful calls do NOT set isError", async () => {
    const { isError, payload } = await client.callTool("unity_editor_state");
    assert.equal(payload.success, true);
    assert.equal(isError, false);
  });

  test("responses are compact JSON by default (no pretty-print token overhead)", async () => {
    const { payloadText } = await client.callTool("unity_editor_state");
    assert.ok(!payloadText.includes("\n  "), "no 2-space indentation in default mode");
    assert.ok(JSON.parse(payloadText), "still valid JSON");
  });

  test("image tools emit an image block and never leak base64 into the text metadata", async () => {
    const result = await client.request("tools/call", {
      name: "unity_advanced_tool",
      arguments: { tool: "unity_graphics_asset_preview", params: { assetPath: "Assets/Mock.png" } },
    });
    const image = (result.content || []).find((b) => b.type === "image");
    assert.ok(image, "an image content block is present");
    assert.ok(image.data && image.data.length > 100_000, "image block carries the base64 payload");
    assert.equal(image.mimeType, "image/png");
    for (const block of result.content) {
      if (block.type === "text") {
        assert.ok(!block.text.includes("QUJDREVG"), "base64 payload must not appear in text blocks");
      }
    }
  });

  test("tickets that complete without a result don't leak queue metadata", async () => {
    const { payload } = await client.callTool("unity_advanced_tool", {
      tool: "unity_silent_completion",
      params: {},
    });
    assert.equal(payload.success, true);
    const text = JSON.stringify(payload);
    assert.ok(!text.includes("ticketId"), "no ticket metadata in tool output");
    assert.ok(!text.includes("agentId"), "no agent metadata in tool output");
  });

  test("console log strips info-entry stack traces by default and trims error traces", async () => {
    const { payload } = await client.callTool("unity_console_log", { count: 2 });
    const [info, error] = payload.data.entries;
    assert.equal(info.stackTrace, undefined, "info entries drop their trace by default");
    assert.ok(error.stackTrace.includes("Frame0"), "error entries keep the trace head");
    assert.ok(!error.stackTrace.includes("Frame7"), "error traces are frame-capped");
    assert.match(error.stackTrace, /more frames/, "truncation is marked");

    const full = await client.callTool("unity_console_log", { count: 2, includeStackTrace: "all", maxStackFrames: 50 });
    assert.ok(full.payload.data.entries[0].stackTrace.includes("Frame11"), "explicit 'all' restores full traces");
  });

  test("batch-wire degrades to single set-reference calls on plugins without the route", async () => {
    const { payload, isError } = await client.callTool("unity_component_batch_wire", {
      references: [
        { path: "Manager", componentType: "Hud", propertyName: "panelA", referenceGameObject: "PanelA" },
        { path: "Manager", componentType: "Hud", propertyName: "panelB", referenceGameObject: "PanelB" },
      ],
    });
    assert.equal(payload.success, true);
    assert.match(payload.degraded, /batch-wire unavailable/);
    assert.equal(payload.results.length, 2);
    assert.equal(isError, false);
    const singles = bridge.seen.filter((r) => r.route === "component/set-reference");
    assert.equal(singles.length, 2, "each entry executed as its own set-reference call");
    assert.deepEqual(singles.map((r) => r.params.propertyName), ["panelA", "panelB"]);
  });

  test("degraded batch-wire reports failure when an entry fails via the legacy error envelope", async () => {
    const { payload, isError } = await client.callTool("unity_component_batch_wire", {
      references: [
        { path: "Manager", componentType: "Hud", propertyName: "propOk", referenceGameObject: "X" },
        { path: "Manager", componentType: "Hud", propertyName: "propBad", referenceGameObject: "Y" },
      ],
    });
    assert.equal(payload.success, false, "a failed degraded entry must not report overall success");
    assert.equal(payload.failedCount, 1);
    assert.equal(isError, true, "the misleading-success class stays flagged");
  });

  test("instance listing surfaces the plugin version from the capability handshake", async () => {
    const { payload } = await client.callTool("unity_list_instances");
    assert.equal(payload.instances[0].pluginVersion, "9.9.9-mock");
  });

  test("unknown tool names are rejected with a helpful error", async () => {
    let outcome;
    try {
      outcome = await client.callTool("unity_totally_missing_tool");
    } catch (err) {
      assert.match(err.message, /unknown|not found|missing/i);
      return;
    }
    const text = outcome.payload ? JSON.stringify(outcome.payload) : outcome.payloadText;
    assert.match(text, /unknown|not found|unity_totally_missing_tool/i);
  });

  test("oversized responses are replaced by pagination guidance (4MB hard limit)", async () => {
    const { payloadText } = await client.callTool("unity_advanced_tool", {
      tool: "unity_payload_huge",
      params: {},
    });
    assert.ok(payloadText.length < 100_000, `hard limit must shrink the response (got ${payloadText.length} chars)`);
    assert.match(payloadText, /too large|limit|pagination|maxNodes|truncat/i);
  });

  test("stdout carried only clean JSON-RPC for the entire session", () => {
    assert.deepEqual(client.stdoutViolations, [], `stdout violations: ${client.stdoutViolations.slice(0, 3).join(" | ")}`);
  });
});

describe("compact tool registry mode (UNITY_MCP_COMPACT_TOOLS=1)", () => {
  /** @type {MockBridge} */ let bridge;
  /** @type {McpTestClient} */ let client;

  before(async () => {
    bridge = new MockBridge();
    await bridge.start();
    client = new McpTestClient({ env: { ...bridge.env(), UNITY_MCP_COMPACT_TOOLS: "1" } }).start();
    await client.initialize();
  });

  after(async () => {
    await client.close();
    await bridge.stop();
  });

  test("keeps all 79 tools but fits constrained-client budgets (issue #27)", async () => {
    const { tools } = await client.listTools();
    assert.ok(tools.length >= 70 && tools.length <= 90, `all tools still exposed (${tools.length})`);
    const bytes = Buffer.byteLength(JSON.stringify(tools), "utf8");
    console.error(`[gate] compact tools/list payload: ${(bytes / 1024).toFixed(1)} KB`);
    assert.ok(bytes <= 24_000, `compact tools/list ${bytes} bytes exceeds 24KB`);
  });

  test("schema structure stays strict (types/required survive, prose dropped)", async () => {
    const { tools } = await client.listTools();
    const setProp = tools.find((t) => t.name === "unity_component_set_property");
    assert.deepEqual(setProp.inputSchema.required, ["gameObjectPath", "componentType", "propertyName", "value"]);
    for (const [prop, schema] of Object.entries(setProp.inputSchema.properties)) {
      assert.ok("type" in schema, `${prop} keeps an explicit type`);
      assert.ok(!("description" in schema), `${prop} drops prose in compact mode`);
    }
  });
});

describe("pretty JSON opt-out (UNITY_MCP_PRETTY_JSON=1)", () => {
  /** @type {MockBridge} */ let bridge;
  /** @type {McpTestClient} */ let client;

  before(async () => {
    bridge = new MockBridge();
    bridge.on("editor/state", () => ({ isPlaying: false, activeScene: "PrettyScene" }));
    await bridge.start();
    client = new McpTestClient({ env: { ...bridge.env(), UNITY_MCP_PRETTY_JSON: "1" } }).start();
    await client.initialize();
  });

  after(async () => {
    await client.close();
    await bridge.stop();
  });

  test("restores 2-space indentation for human debugging", async () => {
    const { payloadText, payload } = await client.callTool("unity_editor_state");
    assert.ok(payloadText.includes('\n  "'), "indented output in pretty mode");
    assert.equal(payload.data.activeScene, "PrettyScene");
  });
});

describe("legacy-mode fallback (old plugin without queue endpoints)", () => {
  /** @type {MockBridge} */ let bridge;
  /** @type {McpTestClient} */ let client;

  before(async () => {
    bridge = new MockBridge({ mode: "legacy" });
    bridge.on("editor/state", () => ({ legacy: true, isCompiling: false }));
    await bridge.start();
    client = new McpTestClient({ env: bridge.env() }).start();
    await client.initialize();
  });

  after(async () => {
    await client.close();
    await bridge.stop();
  });

  test("server degrades to synchronous POSTs and still serves tools", async () => {
    const { payload } = await client.callTool("unity_editor_state");
    assert.equal(payload.success, true);
    assert.equal(payload.data.legacy, true);
    const seen = bridge.seen.find((r) => r.route === "editor/state");
    assert.equal(seen.via, "legacy");
  });

  test("stdout stayed protocol-clean through the fallback path", () => {
    assert.deepEqual(client.stdoutViolations, []);
  });
});

describe("multi-instance selection gate", () => {
  /** @type {MockBridge} */ let bridgeA;
  /** @type {MockBridge} */ let bridgeB;
  /** @type {McpTestClient} */ let client;

  before(async () => {
    bridgeA = new MockBridge({ instance: { projectName: "ProjectA", projectPath: "C:/A" } });
    bridgeB = new MockBridge({ instance: { projectName: "ProjectB", projectPath: "C:/B" } });
    await bridgeA.start();
    await bridgeB.start();
    // Registry advertises both instances; port-range scan is pinned to A only.
    const dir = mkdtempSync(join(tmpdir(), "umcp-registry-"));
    const registryPath = join(dir, "instances.json");
    const now = new Date().toISOString();
    writeFileSync(registryPath, JSON.stringify([
      { port: bridgeA.port, projectName: "ProjectA", projectPath: "C:/A", unityVersion: "6000.0.0f1", lastSeen: now },
      { port: bridgeB.port, projectName: "ProjectB", projectPath: "C:/B", unityVersion: "6000.0.0f1", lastSeen: now },
    ]));
    const env = { ...bridgeA.env(), UNITY_INSTANCE_REGISTRY: registryPath };
    client = new McpTestClient({ env }).start();
    await client.initialize();
  });

  after(async () => {
    await client.close();
    await bridgeA.stop();
    await bridgeB.stop();
  });

  test("editor tools are blocked until an instance is selected, then routed to the chosen port", async () => {
    const blocked = await client.callTool("unity_editor_state");
    const blockedText = blocked.payload ? JSON.stringify(blocked.payload) : blocked.payloadText;
    assert.match(blockedText, /select|multiple|instance/i);

    const selected = await client.callTool("unity_select_instance", { port: bridgeB.port });
    const selectedText = selected.payload ? JSON.stringify(selected.payload) : selected.payloadText;
    assert.match(selectedText, /ProjectB/);

    await client.callTool("unity_editor_state");
    assert.ok(bridgeB.seen.some((r) => r.route === "editor/state"), "selected instance B received the call");
    assert.ok(!bridgeA.seen.some((r) => r.route === "editor/state"), "instance A did not receive the call");
  });

  test("instances can be selected by stable projectName instead of dynamic port", async () => {
    const selected = await client.callTool("unity_select_instance", { projectName: "ProjectA" });
    assert.match(JSON.stringify(selected.payload), /ProjectA/);
    await client.callTool("unity_editor_state");
    assert.ok(bridgeA.seen.some((r) => r.route === "editor/state"), "name-selected instance A now receives calls");

    const missing = await client.callTool("unity_select_instance", { projectName: "NoSuchProject" });
    assert.match(missing.payloadText, /No running instance named/);
    assert.match(missing.payloadText, /ProjectA/, "error lists available instances");
    assert.equal(missing.isError, true);
  });
});
