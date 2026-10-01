import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { MockBridge } from "./helpers/mock-bridge.mjs";
import { McpTestClient } from "./helpers/mcp-client.mjs";

async function exercise(mode, protocolVersion, check) {
  const bridge = new MockBridge({ mode, instance: { protocolVersion } });
  const receive = bridge._handle.bind(bridge), reply = bridge._json.bind(bridge);
  const attempts = [];
  let refuse = () => true;
  bridge._handle = (req, res) => {
    const submission = /\/api\/(queue\/submit(?:-once)?|gameobject\/create)$/.test(req.url);
    const rejected = submission && refuse();
    if (submission) {
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        attempts.push({ url: req.url, payload: JSON.parse(body), rejected });
        if (rejected) reply(res, 503, { error: "Command queue admission is full", code: "command_queue_busy", requestAccepted: false });
      });
    }
    if (!rejected) receive(req, res);
  };
  await bridge.start();
  const env = bridge.env();
  const client = new McpTestClient({ env }).start();
  const command = () => client.callTool("unity_gameobject_create", { name: "OneWrite", port: bridge.port });
  try {
    await client.initialize();
    await check({ bridge, client, command, attempts, refuse: fn => { refuse = fn; } });
    assert.deepEqual(client.stdoutViolations, []);
  } finally {
    await client.close(); await bridge.stop();
    const directory = resolve(dirname(env.UNITY_INSTANCE_REGISTRY));
    assert.equal(dirname(directory), resolve(tmpdir()));
    assert.ok(directory.startsWith(join(resolve(tmpdir()), "umcp-test-")));
    rmSync(directory, { recursive: true, force: true });
  }
}

test("an unguarded admission refusal stays known and does not execute a command", async () => {
  await exercise("queue", 1, async ({ bridge, command, attempts, refuse }) => {
    const result = await command();
    assert.equal(result.isError, true); assert.equal(result.payload.requestAccepted, false);
    assert.equal(result.payload.code, "command_queue_busy"); assert.equal(result.payload.outcomeUnknown, undefined);
    assert.equal(attempts.length, 1); assert.equal(bridge.seen.length, 0);
    refuse(() => false);
    assert.equal((await command()).isError, false); assert.equal(bridge.seen.length, 1);
  });
});

test("legacy admission refusal is not retried and recovery executes once", async () => {
  await exercise("legacy", 1, async ({ bridge, command, attempts, refuse }) => {
    refuse(() => attempts.length > 0);
    const result = await command();
    assert.equal(result.isError, true); assert.equal(result.payload.requestAccepted, false);
    assert.equal(result.payload.code, "command_queue_busy"); assert.equal(result.payload.outcomeUnknown, undefined);
    assert.equal(attempts.length, 2); assert.equal(bridge.seen.length, 0);
    refuse(() => false);
    assert.equal((await command()).isError, false); assert.equal(bridge.seen.length, 1);
  });
});

test("protected retries reuse the refused identity and execute once when capacity returns", async () => {
  await exercise("queue", 2, async ({ bridge, command, attempts, refuse }) => {
    refuse(() => attempts.length === 0);
    const result = await command();
    assert.equal(result.isError, false); assert.equal(attempts.length, 2);
    assert.deepEqual(attempts[0].payload, attempts[1].payload);
    assert.equal(bridge.seen.length, 1); assert.equal(bridge.submissions.length, 1);
  });
});

test("exhausted protected admission retries remain explicitly unaccepted", async () => {
  await exercise("queue", 2, async ({ bridge, command, attempts }) => {
    const result = await command();
    assert.equal(result.isError, true); assert.equal(result.payload.requestAccepted, false, result.payloadText);
    assert.equal(result.payload.code, "command_queue_busy"); assert.equal(result.payload.outcomeUnknown, undefined);
    assert.equal(attempts.length, 5); assert.equal(bridge.seen.length, 0);
    assert.ok(attempts.every(item => item.payload.requestId === attempts[0].payload.requestId));
  });
});

test("a later admission refusal cannot erase an earlier uncertain acknowledgement", async () => {
  await exercise("queue", 2, async ({ bridge, command, attempts, refuse }) => {
    refuse(() => attempts.length > 0);
    const reply = bridge._json.bind(bridge);
    bridge._json = (res, code, data) => code === 202 ? res.destroy() : reply(res, code, data);
    const result = await command();
    assert.equal(result.isError, true); assert.equal(result.payload.outcomeUnknown, true);
    assert.equal(result.payload.requestAccepted, undefined); assert.equal(bridge.seen.length, 1);
    assert.equal(attempts.length, 5);
    assert.ok(attempts.every(item => item.payload.requestId === attempts[0].payload.requestId));
  });
});
