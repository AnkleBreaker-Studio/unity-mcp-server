// Live smoke test — runs the MODIFIED server against a REAL Unity Editor bridge.
// Gated: only runs when UNITY_MCP_LIVE=1 (requires an open Unity editor with the
// MCP plugin). Read-only calls only. Validates the new-server ⇄ old-plugin skew
// direction that real users hit (server and plugin ship on separate trains).
//
//   UNITY_MCP_LIVE=1 npm run test:live

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { McpTestClient } from "./helpers/mcp-client.mjs";

const LIVE = process.env.UNITY_MCP_LIVE === "1";

describe("live bridge smoke (read-only)", { skip: !LIVE && "set UNITY_MCP_LIVE=1 with a running Unity editor" }, () => {
  /** @type {McpTestClient} */ let client;

  before(async () => {
    client = new McpTestClient({ env: {}, timeoutMs: 30_000 }).start();
    await client.initialize();
  });

  after(async () => {
    await client.close();
  });

  test("discovers at least one real Unity instance", async () => {
    const { payload } = await client.callTool("unity_list_instances");
    assert.ok(payload.totalCount >= 1, `instances found: ${payload.totalCount}`);
    console.error(`[live] instances: ${payload.instances.map((i) => `${i.projectName}@${i.port}`).join(", ")}`);
  });

  test("editor_state round-trips against the real plugin (old-plugin skew tolerated)", async () => {
    const { payload, isError } = await client.callTool("unity_editor_state");
    assert.equal(payload.success, true);
    assert.equal(isError, false);
    assert.ok(typeof payload.data.isCompiling === "boolean");
    console.error(`[live] scene: ${payload.data.activeScene}, unity: ${payload.data.unityVersion}`);
  });

  test("responses from the real bridge are compact by default", async () => {
    const { payloadText } = await client.callTool("unity_editor_state");
    assert.ok(!payloadText.includes("\n  "), "compact JSON against real plugin");
  });

  test("console_log round-trips", async () => {
    const { payload, isError } = await client.callTool("unity_console_log", { count: 3 });
    assert.equal(isError, false);
    assert.equal(payload.success, true);
  });

  test("stdout stayed protocol-clean against the real bridge", () => {
    assert.deepEqual(client.stdoutViolations, []);
  });
});
