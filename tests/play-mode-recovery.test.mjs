import { test } from "node:test";
import assert from "node:assert/strict";
import { MockBridge } from "./helpers/mock-bridge.mjs";
import { McpTestClient } from "./helpers/mcp-client.mjs";

for (const scenario of [
  { action: "play", isPlaying: true, recovered: true },
  { action: "stop", isPlaying: false, recovered: true },
  { action: "play", isPlaying: false, recovered: false },
  { action: "pause", isPlaying: true, recovered: false },
]) {
  test(`reload recovery: ${scenario.action}, isPlaying=${scenario.isPlaying}, recovered=${scenario.recovered}`, async () => {
    const bridge = new MockBridge({ processingDelayMs: 15, instance: { protocolVersion: 3 } });
    bridge.on("editor/play-mode", () => {
      bridge.queueSessionId = "b".repeat(32);
      return { success: true };
    });
    bridge.on("editor/state", () => ({ isPlaying: scenario.isPlaying, isPaused: true }));
    let client;
    try {
      await bridge.start();
      client = new McpTestClient({ env: bridge.env() }).start();
      await client.initialize();
      const response = await client.callTool("unity_play_mode", { action: scenario.action, port: bridge.port });
      assert.equal(response.isError, !scenario.recovered, response.payloadText);
      if (scenario.recovered) assert.equal(response.payload.data.verifiedViaEditorState, true);
      else assert.equal(response.payload.outcomeUnknown, true);
      assert.equal(bridge.seen.filter(call => call.route === "editor/play-mode").length, 1);
      assert.equal(bridge.seen.filter(call => call.route === "editor/state").length, scenario.action === "pause" ? 0 : 1);
    } finally {
      await client?.close();
      await bridge.stop();
    }
  });
}
