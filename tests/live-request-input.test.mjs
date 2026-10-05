import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { McpTestClient } from "./helpers/mcp-client.mjs";

const project = process.env.UNITY_MCP_INPUT_PROJECT;
const canonical = path => realpathSync(path).replaceAll("\\", "/").toLowerCase();

test("live input limits reject work before execution and preserve valid requests", {
  skip: !project && "set UNITY_MCP_INPUT_PROJECT to an open marked validation project",
  timeout: 180_000,
}, async () => {
  assert.ok(isAbsolute(project));
  assert.ok(existsSync(join(project, ".unity-mcp-validation")));
  const client = new McpTestClient({ serverEntry: process.env.UNITY_MCP_INPUT_SERVER_ENTRY, timeoutMs: 60_000 }).start();
  const marker = "UnityMcpValidation.Input." + randomUUID();
  const report = { nodeVersion: process.version, passed: false, checks: [] };
  let port, fixtureStarted = false;
  const call = async (name, args = {}) => {
    const result = await client.callTool(name, { port, ...args });
    assert.equal(result.isError, false, result.payloadText);
    return result.payload.data ?? result.payload;
  };
  const code = async source => (await call("unity_execute_code", { code: source })).result;
  // unity_advanced_tool refuses core write routes such as execute-code, so the deep and oversized
  // payloads ride on an advanced write whose side effect (an EditorPrefs value) is observable.
  const textKey = marker + ".Text";
  const counter = () => code(`return EditorPrefs.GetInt("${marker}", -1);`);
  const write = (value, extra) => ({ tool: "unity_editorprefs_set", params: { key: marker, value, type: "int", extra } });
  try {
    await client.initialize();
    const instances = await call("unity_list_instances", { refresh: true });
    const instance = instances.instances.find(item => item.projectPath && canonical(item.projectPath) === canonical(project));
    assert.ok(instance);
    port = instance.port;
    const selected = await call("unity_select_instance", { port });
    assert.equal(canonical(selected.instance.projectPath), canonical(project));
    const state = await call("unity_editor_state");
    assert.equal(state.isPlaying, false);
    assert.equal(state.isCompiling, false);
    assert.equal(state.sceneDirty, false);
    report.unityVersion = state.unityVersion;
    await call("unity_list_advanced_tools", { tool: "unity_editorprefs_set" });
    fixtureStarted = true;
    await call("unity_advanced_tool", write(0));
    assert.equal(await counter(), 0);

    await call("unity_advanced_tool", { tool: "unity_editorprefs_set", params: { key: textKey, value: "\u4e2d\ud83d\ude00", extra: { nested: [true, 3, null, "\u4e2d"] } } });
    assert.equal(await code(`return EditorPrefs.GetString("${textKey}", "");`), "\u4e2d\ud83d\ude00");
    report.checks.push({ name: "Valid nested Unicode input keeps its value", passed: true });
    await call("unity_list_advanced_tools", { tool: "unity_packages_list" });
    const packages = await call("unity_advanced_tool", { tool: "unity_packages_list", params: {} });
    assert.ok(Array.isArray(packages.packages));
    report.checks.push({ name: "Validated arguments reach deferred Package Manager operations", passed: true });

    let deep = 0;
    for (let i = 0; i < 100; i++) deep = [deep];
    const depth = await client.callTool("unity_advanced_tool", { port, ...write(1, deep) });
    assert.equal(depth.isError, true);
    assert.match(depth.payloadText, /413|container levels/);
    assert.equal(await counter(), 0);
    report.checks.push({ name: "Deep input is rejected before the command executes", passed: true, error: depth.payload });

    const bytes = await client.callTool("unity_advanced_tool", { port, ...write(1, "\u4e2d".repeat(12 * 1024 * 1024)) });
    assert.equal(bytes.isError, true);
    assert.match(bytes.payloadText, /413|[Bb]ody too large|byte limit|fetch failed|Connection failed/);
    if (!process.env.UNITY_MCP_INPUT_SERVER_ENTRY) {
      assert.equal(bytes.payload.code, "request_too_large");
      assert.equal(bytes.payload.requestAccepted, false);
      assert.equal(bytes.payload.outcomeUnknown, undefined);
    }
    assert.equal(await counter(), 0);
    report.checks.push({ name: "Oversized input is rejected before the command executes", passed: true, error: bytes.payload, rejectionResponseReceived: /413|[Bb]ody too large|byte limit/.test(bytes.payloadText) });

    await call("unity_advanced_tool", write(1));
    assert.equal(await counter(), 1);
    report.checks.push({ name: "A valid follow-up write executes once", passed: true });
    const compilation = await call("unity_get_compilation_errors", { severity: "error" });
    assert.equal(compilation.count, 0);
    assert.equal(compilation.isCompiling, false);
    const after = await call("unity_editor_state");
    assert.equal(after.sceneDirty, false);
    assert.equal(after.isPlaying, false);
    assert.deepEqual(client.stdoutViolations, []);
    report.passed = true;
  } finally {
    try {
      if (fixtureStarted) { await code(`EditorPrefs.DeleteKey("${marker}"); EditorPrefs.DeleteKey("${textKey}"); return true;`); report.fixtureRemoved = true; }
    } finally {
      await client.close();
      writeFileSync(join(project, "Library/UnityMcpRequestInput.json"), JSON.stringify(report, null, 2) + "\n");
    }
  }
});
