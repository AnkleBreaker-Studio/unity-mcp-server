import { test } from "node:test";
import assert from "node:assert/strict";
import { MockBridge } from "./helpers/mock-bridge.mjs";
import { McpTestClient } from "./helpers/mcp-client.mjs";

async function exercise(check) {
  const bridge = new MockBridge({ instance: { protocolVersion: 2 } });
  let limit;
  const json = bridge._json.bind(bridge);
  bridge._json = (res, status, data) => json(res, status, Object.hasOwn(data, "totalPending")
    ? { ...data, queueSessionTimeMs: 1000, ...(limit === undefined ? {} : { maxRequestBodyBytes: limit }) } : data);
  bridge.on("payload/value", params => ({ accepted: true, length: params.value?.length }));
  await bridge.start();
  const client = new McpTestClient({ env: bridge.env() }).start();
  const invoke = value => client.callTool("unity_advanced_tool", { port: bridge.port, tool: "unity_payload_value", params: { value } });
  try {
    await client.initialize();
    await check({ bridge, client, invoke, limit: value => { limit = value; } });
    assert.deepEqual(client.stdoutViolations, []);
  } finally { await client.close(); await bridge.stop(); }
}

test("advertised input limit rejects UTF-8 bytes before submitting a command", async () => {
  await exercise(async ({ bridge, invoke, limit }) => {
    limit(8192);
    const result = await invoke("\u4e2d".repeat(4000));
    assert.equal(result.isError, true);
    assert.equal(result.payload.code, "request_too_large");
    assert.equal(result.payload.requestAccepted, false);
    assert.equal(result.payload.limitBytes, 8192);
    assert.ok(result.payload.requestBytes > 12000);
    assert.equal(result.payload.outcomeUnknown, undefined);
    assert.equal(bridge.submissions.length, 0);
    assert.equal(bridge.seen.length, 0);
    assert.equal((await invoke("small")).payload.data.accepted, true);
    assert.equal(bridge.submissions.length, 1);
  });
});

test("the exact envelope byte limit passes and one fewer byte refuses the same input", async () => {
  await exercise(async ({ bridge, invoke, limit }) => {
    const value = '"\\\n\u4e2d\ud83d\ude00'.repeat(100);
    assert.equal((await invoke(value)).isError, false);
    const bytes = Buffer.byteLength(JSON.stringify(bridge.submissions[0].payload));
    limit(bytes);
    assert.equal((await invoke(value)).isError, false);
    limit(bytes - 1);
    const result = await invoke(value);
    assert.equal(result.isError, true);
    assert.equal(result.payload.requestBytes, bytes);
    assert.equal(bridge.submissions.length, 2);
  });
});

for (const limitValue of [undefined, "1024", null, -1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
  test(`missing or invalid input-limit metadata preserves compatibility (${String(limitValue)})`, async () => {
    await exercise(async ({ bridge, invoke, limit }) => {
      limit(limitValue);
      assert.equal((await invoke("x".repeat(2048))).isError, false);
      assert.equal(bridge.seen.length, 1);
    });
  });
}

test("limits remain attached to their negotiated endpoint", async () => {
  const a = new MockBridge({ instance: { protocolVersion: 2, projectName: "InputA" } });
  const b = new MockBridge({ instance: { protocolVersion: 2, projectName: "InputB" } });
  for (const [bridge, maxRequestBodyBytes] of [[a, 1024], [b, 8192]]) {
    const json = bridge._json.bind(bridge);
    bridge._json = (res, status, data) => json(res, status, Object.hasOwn(data, "totalPending") ? { ...data, maxRequestBodyBytes } : data);
    bridge.on("payload/value", () => ({ accepted: true }));
    await bridge.start();
  }
  const client = new McpTestClient({ env: a.env() }).start();
  try {
    await client.initialize();
    const invoke = port => client.callTool("unity_advanced_tool", { port, tool: "unity_payload_value", params: { value: "x".repeat(2048) } });
    const [ra, rb] = await Promise.all([invoke(a.port), invoke(b.port)]);
    assert.equal(ra.isError, true);
    assert.equal(rb.isError, false);
    assert.equal(a.submissions.length, 0);
    assert.equal(b.submissions.length, 1);
  } finally { await client.close(); await a.stop(); await b.stop(); }
});
