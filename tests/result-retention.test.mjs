import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { MockBridge } from "./helpers/mock-bridge.mjs";
import { McpTestClient } from "./helpers/mcp-client.mjs";

async function exercise(protocolVersion, check) {
  const bridge = new MockBridge({ instance: { protocolVersion } });
  await bridge.start();
  const env = bridge.env(), client = new McpTestClient({ env }).start();
  try {
    await client.initialize();
    await check(bridge, client);
    assert.deepEqual(client.stdoutViolations, []);
  } finally {
    await client.close(); await bridge.stop();
    const directory = resolve(dirname(env.UNITY_INSTANCE_REGISTRY));
    assert.equal(dirname(directory), resolve(tmpdir()));
    assert.ok(directory.startsWith(join(resolve(tmpdir()), "umcp-test-")));
    rmSync(directory, { recursive: true, force: true });
  }
}

for (const protocolVersion of [1, 3]) test(`evicted polling result stays unknown without repeating a write (protocol ${protocolVersion})`, async () => {
  await exercise(protocolVersion, async (bridge, client) => {
    bridge.on("gameobject/create", () => ({ __evict: true }));
    const result = await client.callTool("unity_gameobject_create", { name: "RetainedEffect", port: bridge.port });
    assert.equal(result.isError, true); assert.equal(result.payload.outcomeUnknown, true);
    assert.ok(result.payload.ticketId); assert.equal(result.payload.requestAccepted, undefined);
    assert.equal(bridge.seen.length, 1); assert.equal(bridge.submissions.length, 1); assert.equal(bridge.polls.length, 5);
  });
});

test("protected replay of an evicted result remains unknown after a lost acknowledgement", async () => {
  await exercise(3, async (bridge, client) => {
    const receive = bridge._handle.bind(bridge), reply = bridge._json.bind(bridge);
    const bodies = [];
    bridge._handle = (req, res) => {
      if (!req.url.endsWith("/queue/submit-once")) return receive(req, res);
      let body = ""; const first = bodies.length === 0;
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        bodies.push(JSON.parse(body));
        if (!first) reply(res, 410, { code: "result_expired", error: "Original result expired; the request will not execute again" });
      });
      if (first) receive(req, res);
    };
    bridge._json = (res, status, data) => status === 202 ? res.destroy() : reply(res, status, data);
    const result = await client.callTool("unity_gameobject_create", { name: "RetainedEffect", port: bridge.port });
    assert.equal(result.isError, true); assert.equal(result.payload.outcomeUnknown, true);
    assert.equal(result.payload.requestAccepted, undefined);
    assert.equal(bodies.length, 2); assert.deepEqual(bodies[0], bodies[1]);
    assert.equal(bridge.seen.length, 1); assert.equal(bridge.submissions.length, 1);
  });
});
