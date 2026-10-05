import { test } from "node:test";
import assert from "node:assert/strict";
import { MockBridge } from "./helpers/mock-bridge.mjs";
import { McpTestClient } from "./helpers/mcp-client.mjs";

// Commands lasting a few seconds (imports, script writes, Play Mode switches) must be observed soon after they finish.
test("default ticket polling waits at most about 500 ms between status checks", async () => {
  const bridge = await new MockBridge({ processingDelayMs: 3500 }).start();
  // Undefined drops both the mock's fast polling and any inherited override, so the server uses its defaults.
  const env = { ...bridge.env(), UNITY_QUEUE_POLL_INTERVAL: undefined, UNITY_QUEUE_POLL_MAX: undefined };
  const times = [];
  const record = bridge.polls.push.bind(bridge.polls);
  bridge.polls.push = (...items) => { times.push(performance.now()); return record(...items); };
  const client = new McpTestClient({ env, serverEntry: process.env.UNITY_MCP_TEST_SERVER_ENTRY }).start();
  try {
    await client.initialize();
    const result = await client.callTool("unity_editor_state", { port: bridge.port });
    assert.equal(result.isError, false, result.payloadText);
    const gaps = times.slice(1).map((time, index) => Math.round(time - times[index]));
    assert.ok(gaps.length >= 5, `Expected a polled ticket, saw gaps: ${gaps.join(", ")}`);
    assert.ok(Math.max(...gaps) < 1000, `Poll gaps (ms): ${gaps.join(", ")}`);
    assert.deepEqual(client.stdoutViolations, []);
  } finally {
    await client.close();
    await bridge.stop();
  }
});
