import { test } from "node:test";
import assert from "node:assert/strict";
import { MockBridge } from "./helpers/mock-bridge.mjs";
import { McpTestClient } from "./helpers/mcp-client.mjs";

const bytes = value => Buffer.byteLength(JSON.stringify(value), "utf8");
const lastPayload = response => JSON.parse(response.content.filter(block => block.type === "text").at(-1).text);

async function exercise(data, env, check, tool = "unity_advanced_tool") {
  const bridge = new MockBridge();
  bridge.on("payload/value", () => data);
  bridge.on("graphics/asset-preview", () => data);
  await bridge.start();
  const client = new McpTestClient({ serverEntry: process.env.UNITY_MCP_TEST_SERVER_ENTRY, env: { ...bridge.env(), ...env } }).start();
  try {
    await client.initialize();
    const response = await client.request("tools/call", {
      name: "unity_advanced_tool",
      arguments: tool === "unity_advanced_tool"
        ? { tool: "unity_payload_value", params: {}, port: bridge.port }
        : { tool, params: { assetPath: "Assets/Preview.asset" }, port: bridge.port },
    });
    await check(response, client, bridge);
    assert.deepEqual(client.stdoutViolations, []);
  } finally {
    await client.close();
    await bridge.stop();
  }
}

for (const [name, value] of [["UTF-8", "\u754c".repeat(2000)], ["emoji", "\u{1f680}".repeat(1400)], ["JSON escaping", "\\".repeat(1400)]]) {
  test(`response limit counts ${name} bytes`, async () => {
    await exercise({ value }, { UNITY_RESPONSE_HARD_LIMIT: "4096", UNITY_RESPONSE_SOFT_LIMIT: "4096" }, response => {
      assert.ok(bytes(response) <= 4096, `response exceeded its byte budget: ${bytes(response)}`);
      assert.equal(response.isError, true);
      assert.equal(lastPayload(response).code, "response_too_large");
    });
  });
}

test("hard limit reports missing results as an MCP error without repeating the command", async () => {
  await exercise({ value: "x".repeat(5000) }, { UNITY_RESPONSE_HARD_LIMIT: "4096" }, (response, client, bridge) => {
    assert.equal(response.isError, true);
    const payload = lastPayload(response);
    assert.equal(payload.code, "response_too_large");
    assert.equal(payload.limitBytes, 4096);
    assert.ok(payload.responseBytes > 5000);
    assert.match(payload.error, /before repeating|before retrying/i);
    assert.equal(bridge.seen.filter(item => item.route === "payload/value").length, 1);
  });
});

test("soft-limit warning preserves the last text block as the tool result", async () => {
  await exercise({ value: "x".repeat(1200) }, { UNITY_RESPONSE_SOFT_LIMIT: "1024", UNITY_RESPONSE_HARD_LIMIT: "4096" }, response => {
    assert.equal(lastPayload(response).data.value.length, 1200);
    assert.ok(response.content.length >= 2);
    assert.match(response.content[0].text, /large response/i);
    assert.notEqual(response.isError, true);
  });
});

test("a soft-limit warning cannot push an otherwise valid result over the hard limit", async () => {
  await exercise({ value: "x".repeat(850) }, { UNITY_RESPONSE_SOFT_LIMIT: "512", UNITY_RESPONSE_HARD_LIMIT: "1024" }, response => {
    assert.ok(bytes(response) <= 1024, `warning exceeded the budget: ${bytes(response)}`);
    assert.equal(lastPayload(response).data.value.length, 850);
    assert.notEqual(response.isError, true);
  });
});

test("image blocks and metadata overhead count toward the response limit", async () => {
  await exercise({ base64: "A".repeat(896), width: 64, height: 64 },
    { UNITY_RESPONSE_SOFT_LIMIT: "1024", UNITY_RESPONSE_HARD_LIMIT: "1024" }, response => {
      assert.ok(bytes(response) <= 1024, `image response exceeded its budget: ${bytes(response)}`);
      assert.equal(response.isError, true);
      assert.equal(lastPayload(response).code, "response_too_large");
    }, "unity_graphics_asset_preview");
});

test("oversized failures retain bounded error details and recovery identifiers", async () => {
  await exercise({ success: false, error: "Original request may have executed. " + "x".repeat(5000), outcomeUnknown: true, ticketId: "ticket-42", requestId: "request-42", queueSessionId: "session-42" },
    { UNITY_RESPONSE_HARD_LIMIT: "4096" }, response => {
      assert.equal(response.isError, true);
      const payload = lastPayload(response);
      assert.equal(payload.originalIsError, true);
      assert.equal(payload.originalError.outcomeUnknown, true);
      assert.equal(payload.originalError.ticketId, "ticket-42");
      assert.equal(payload.originalError.requestId, "request-42");
      assert.equal(payload.originalError.queueSessionId, "session-42");
      assert.match(payload.originalError.message, /may have executed/);
      assert.ok(bytes(response) <= 4096);
    });
});

test("an invalid hard-limit setting cannot disable the default protection", async () => {
  await exercise({ value: "x".repeat(4_500_000) }, { UNITY_RESPONSE_HARD_LIMIT: "invalid" }, response => {
    assert.ok(bytes(response) < 10000, `invalid configuration disabled protection: ${bytes(response)}`);
    assert.equal(lastPayload(response).code, "response_too_large");
    assert.equal(lastPayload(response).limitBytes, 4 * 1024 * 1024);
  });
});

test("an image tool reporting no image is an MCP error", async () => {
  await exercise({ width: 64, height: 64 }, {}, response => {
    assert.equal(response.isError, true);
    assert.match(lastPayload(response).error, /no image data/);
  }, "unity_graphics_asset_preview");
});

test("logical errors in image metadata retain the MCP error flag", async () => {
  await exercise({ success: false, error: "Partial preview failed", base64: "QUJD", width: 1, height: 1 }, {}, response => {
    assert.equal(response.isError, true);
    assert.equal(response.content.some(block => block.type === "image"), true);
    assert.match(lastPayload(response).data.error, /Partial preview failed/);
  }, "unity_graphics_asset_preview");
});

test("oversized unknown-tool errors are bounded before dispatch", async () => {
  await exercise({}, { UNITY_RESPONSE_HARD_LIMIT: "1024" }, async (response, client) => {
    const unknown = await client.request("tools/call", { name: "\u754c".repeat(2000), arguments: {} });
    assert.ok(bytes(unknown) <= 1024);
    assert.equal(unknown.isError, true);
    assert.equal(lastPayload(unknown).code, "response_too_large");
  });
});

test("oversized project resources fail explicitly while smaller reads remain intact", async () => {
  await exercise({}, { UNITY_RESPONSE_HARD_LIMIT: "1024" }, async (response, client, bridge) => {
    bridge.contextProvider = () => ({ content: "\u754c".repeat(1000) });
    const params = { uri: "unity-context://Rules", _meta: { port: bridge.port } };
    await assert.rejects(client.request("resources/read", params), /resource response too large/i);
    bridge.contextProvider = () => ({ content: "Small project rules" });
    const resource = await client.request("resources/read", params);
    assert.equal(resource.contents[0].text, "Small project rules");
    assert.equal(resource.contents[0].uri, params.uri);
  });
});

test("core capture proxies retain image blocks and pass future parameters unchanged", async () => {
  await exercise({}, {}, async (response, client, bridge) => {
    for (const [name, route] of [["unity_graphics_scene_capture", "graphics/scene-capture"], ["unity_graphics_game_capture", "graphics/game-capture"]]) {
      bridge.on(route, params => ({ base64: "QUJD", width: 1, height: 1, futureOption: params.futureOption }));
      const params = { width: 1, height: 1, futureOption: "forward-this" };
      const direct = await client.request("tools/call", { name, arguments: { ...params, port: bridge.port } });
      const proxy = await client.request("tools/call", { name: "unity_advanced_tool", arguments: { tool: name, params, port: bridge.port } });
      assert.deepEqual(proxy.content, direct.content, name);
      assert.equal(proxy.content[0].type, "image");
      assert.equal(lastPayload(proxy).data.futureOption, "forward-this");
      assert.equal(bridge.seen.filter(item => item.route === route).length, 2);
    }
  });
});
