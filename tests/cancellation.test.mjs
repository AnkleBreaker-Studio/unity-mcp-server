import { test } from "node:test";
import assert from "node:assert/strict";
import { MockBridge } from "./helpers/mock-bridge.mjs";
import { McpTestClient } from "./helpers/mcp-client.mjs";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, message, timeout = 3000) {
  const deadline = performance.now() + timeout;
  while (!predicate() && performance.now() < deadline) await sleep(10);
  assert.ok(predicate(), message);
}

async function exercise(check, options = {}) {
  const bridge = new MockBridge({ instance: { protocolVersion: 2 }, ...options });
  await bridge.start();
  const client = new McpTestClient({
    serverEntry: process.env.UNITY_MCP_TEST_SERVER_ENTRY,
    env: { ...bridge.env(), UNITY_QUEUE_POLL_INTERVAL: "20", UNITY_QUEUE_POLL_MAX: "50" },
  }).start();
  try {
    await client.initialize();
    await check(bridge, client);
    assert.deepEqual(client.stdoutViolations, []);
    assert.doesNotMatch(client.stderr, /MaxListenersExceededWarning|unhandled rejection/i);
  } finally {
    await client.close();
    await bridge.stop();
  }
}

function begin(client, method, params) {
  const call = { settled: false };
  call.result = client.request(method, params).then(result => {
    call.settled = true;
    return result;
  }, error => {
    call.settled = true;
    throw error;
  });
  call.result.catch(() => {});
  call.id = client._id;
  return call;
}

function command(client, bridge, name, explicitPort = true, agentId = name) {
  return begin(client, "tools/call", {
    name: "unity_gameobject_create",
    arguments: { name, ...(explicitPort ? { port: bridge.port } : {}) },
    _meta: { agentId },
  });
}

async function cancel(client, call) {
  client.notify("notifications/cancelled", { requestId: call.id, reason: "Regression test cancellation" });
  await client.listTools();
}

function gate(bridge, matches, stalledBody = false) {
  const reply = bridge._json.bind(bridge);
  const held = [];
  let active = true;
  bridge._json = (res, code, data) => {
    if (!active || !matches(code, data)) return reply(res, code, data);
    const item = { res, code, data, closed: false };
    held.push(item);
    res.on("close", () => { item.closed = !res.writableEnded; });
    if (stalledBody) {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.write("{");
    }
  };
  return {
    held,
    release() {
      active = false;
      for (const { res, code, data } of held) {
        if (res.destroyed) continue;
        if (stalledBody) res.end(JSON.stringify(data).slice(1));
        else reply(res, code, data);
      }
    },
  };
}

for (const protocolVersion of [1, 2]) {
  test(`cancellation stops protocol ${protocolVersion} ticket polling without replay or context reads`, async () => {
    await exercise(async (bridge, client) => {
      const reply = bridge._json.bind(bridge);
      let hold = true;
      let contextReads = 0;
      bridge.contextProvider = () => { contextReads++; return null; };
      bridge._json = (res, code, data) => reply(res, code,
        hold && code === 200 && data.ticketId ? { ...data, status: "Executing" } : data);
      const call = command(client, bridge, "Cancelled");
      await until(() => bridge.polls.length >= 2, "Ticket polling started");
      await cancel(client, call);
      await sleep(100);
      const before = bridge.polls.length;
      await sleep(200);
      assert.equal(bridge.polls.length, before, "Polling continued after cancellation");
      hold = false;
      await sleep(100);
      assert.equal(contextReads, 0, "Cancelled result fetched automatic context");
      assert.equal(call.settled, false, "SDK returned a cancelled response");
      assert.equal(bridge.seen.length, 1, "Accepted work was replayed");
      assert.equal(bridge._tickets.values().next().value.status, "Completed", "Cancellation undid accepted work");
      const next = await command(client, bridge, "StillWorks").result;
      assert.notEqual(next.isError, true);
    }, { instance: { protocolVersion } });
  });
}

for (const phase of ["acknowledgement", "poll", "legacy"]) {
  test(`cancellation closes a stalled ${phase} body without replaying accepted work`, async () => {
    await exercise(async (bridge, client) => {
      const held = gate(bridge, (code, data) => phase === "acknowledgement" ? code === 202
        : phase === "poll" ? code === 200 && data.ticketId : data.route === "gameobject/create", true);
      const call = command(client, bridge, "OneWrite");
      await until(() => held.held.length === 1, "Response body stalled");
      await cancel(client, call);
      await until(() => held.held[0].closed, "Cancelled HTTP body stayed open");
      held.release();
      assert.equal(bridge.seen.length, 1);
      assert.equal(call.settled, false);
      const next = await command(client, bridge, "NextWrite").result;
      assert.notEqual(next.isError, true);
      assert.equal(bridge.seen.length, 2);
    }, phase === "legacy" ? { mode: "legacy", instance: { protocolVersion: 1 } } : {});
  });
}

test("cancellation during protected retry backoff stops further submissions", async () => {
  await exercise(async (bridge, client) => {
    const reply = bridge._json.bind(bridge);
    bridge._json = (res, code, data) => code === 202 ? res.destroy() : reply(res, code, data);
    const call = command(client, bridge, "LostAck");
    await until(() => client.stderr.includes("Retrying gameobject/create"), "Protected retry backoff started");
    await cancel(client, call);
    await sleep(1000);
    assert.equal(bridge.submissions.length, 1, "Cancellation allowed another protected submission");
    assert.equal(bridge.seen.length, 1);
    assert.equal(call.settled, false);
  });
});

test("one cancelled observer cannot abort shared capability negotiation", async () => {
  await exercise(async (bridge, client) => {
    const held = gate(bridge, (_, data) => data.queueRetryWindowMs);
    const first = command(client, bridge, "CancelledAgent");
    await until(() => held.held.length === 1, "Negotiation started");
    const second = command(client, bridge, "ActiveAgent");
    await client.listTools();
    await cancel(client, first);
    await sleep(100);
    assert.equal(held.held[0].closed, false, "Another agent still needs this negotiation");
    held.release();
    assert.notEqual((await second.result).isError, true);
    await sleep(100);
    assert.deepEqual(bridge.seen.map(item => item.params.name), ["ActiveAgent"]);
    assert.equal(held.held.length, 1);
    assert.equal(first.settled, false);
  });
});

test("the last cancelled capability observer closes shared work and permits a fresh call", async () => {
  await exercise(async (bridge, client) => {
    const held = gate(bridge, (_, data) => data.queueRetryWindowMs, true);
    const call = command(client, bridge, "NeverSubmit");
    await until(() => held.held.length === 1, "Negotiation body stalled");
    await cancel(client, call);
    await until(() => held.held[0].closed, "Unused negotiation stayed open");
    assert.equal(bridge.seen.length, 0);
    held.release();
    assert.notEqual((await command(client, bridge, "FreshRequest").result).isError, true);
    assert.deepEqual(bridge.seen.map(item => item.params.name), ["FreshRequest"]);
  });
});

test("shared discovery survives one cancellation without submitting the cancelled command", async () => {
  await exercise(async (bridge, client) => {
    const held = gate(bridge, (_, data) => data.projectPath);
    const first = command(client, bridge, "CancelledDiscovery", false, "shared-agent");
    await until(() => held.held.length === 1, "Discovery started");
    const second = command(client, bridge, "ActiveDiscovery", false, "shared-agent");
    await client.listTools();
    await cancel(client, first);
    await sleep(100);
    assert.equal(held.held[0].closed, false);
    held.release();
    assert.notEqual((await second.result).isError, true);
    await sleep(100);
    assert.deepEqual(bridge.seen.map(item => item.params.name), ["ActiveDiscovery"]);
    assert.equal(held.held.length, 1);
  });
});

test("cancelled discovery closes its last ping and remains discoverable on the next call", async () => {
  await exercise(async (bridge, client) => {
    const held = gate(bridge, (_, data) => data.projectPath, true);
    const first = command(client, bridge, "NeverDispatched", false, "one-agent");
    await until(() => held.held.length === 1, "Discovery ping started");
    await cancel(client, first);
    await until(() => held.held[0].closed, "Discovery ping stayed open");
    held.release();
    assert.notEqual((await command(client, bridge, "AfterDiscovery", false, "one-agent").result).isError, true);
    assert.deepEqual(bridge.seen.map(item => item.params.name), ["AfterDiscovery"]);
    assert.ok(bridge.pingCount >= 2, "The next call did not discover again");
  });
});

test("cancelled project-context resource reads close the HTTP body", async () => {
  await exercise(async (bridge, client) => {
    bridge.contextProvider = () => ({ content: "Project instructions" });
    const held = gate(bridge, (_, data) => data.content, true);
    const params = { uri: "unity-context://Rules", _meta: { port: bridge.port } };
    const call = begin(client, "resources/read", params);
    await until(() => held.held.length === 1, "Resource read started");
    await cancel(client, call);
    await until(() => held.held[0].closed, "Cancelled resource body stayed open");
    held.release();
    assert.equal((await client.request("resources/read", params)).contents[0].text, "Project instructions");
    assert.equal(call.settled, false);
  });
});

test("cancelling selection validation preserves the selected project", async () => {
  await exercise(async (bridge, client) => {
    const meta = { agentId: "selected-agent" };
    const selected = await client.request("tools/call", {
      name: "unity_select_instance", arguments: { port: bridge.port }, _meta: meta,
    });
    assert.notEqual(selected.isError, true);
    const held = gate(bridge, (_, data) => data.projectPath, true);
    const call = command(client, bridge, "CancelledValidation", false, meta.agentId);
    await until(() => held.held.length === 1, "Selected project validation started");
    await cancel(client, call);
    await until(() => held.held[0].closed, "Selected project validation stayed open");
    held.release();
    const list = await client.request("tools/call", { name: "unity_list_instances", arguments: {}, _meta: meta });
    const payload = JSON.parse(list.content.at(-1).text);
    assert.equal(payload.selectedPort, bridge.port);
    assert.notEqual((await command(client, bridge, "AfterValidation", false, meta.agentId).result).isError, true);
    assert.deepEqual(bridge.seen.map(item => item.params.name), ["AfterValidation"]);
  });
});

test("cancelled automatic context injection remains available to the next call", async () => {
  await exercise(async (bridge, client) => {
    bridge.contextProvider = () => ({ enabled: true, categories: [{ category: "Rules", content: "Keep these rules" }] });
    const held = gate(bridge, (_, data) => data.categories, true);
    const call = command(client, bridge, "BeforeContext", true, "context-agent");
    await until(() => held.held.length === 1, "Automatic context fetch started");
    await cancel(client, call);
    await until(() => held.held[0].closed, "Cancelled context body stayed open");
    held.release();
    const next = await command(client, bridge, "AfterContext", true, "context-agent").result;
    assert.ok(next.content.some(block => block.text?.includes("Keep these rules")), "Context was marked delivered after cancellation");
  });
});

test("cancelled direct queue reads release their HTTP request", async () => {
  await exercise(async (bridge, client) => {
    const held = gate(bridge, (_, data) => data.queueRetryWindowMs, true);
    const call = begin(client, "tools/call", { name: "unity_queue_info", arguments: { port: bridge.port } });
    await until(() => held.held.length === 1, "Queue read started");
    await cancel(client, call);
    await until(() => held.held[0].closed, "Direct queue read stayed open");
  });
});

test("cancellation stops test-job follow-up polling without stopping the Unity job", async () => {
  await exercise(async (bridge, client) => {
    bridge.on("testing/get-job", () => ({ jobId: "job-1", status: "running" }));
    const call = begin(client, "tools/call", { name: "unity_advanced_tool", arguments: {
      port: bridge.port, tool: "unity_testing_get_job", params: { jobId: "job-1", waitTimeout: 10 },
    } });
    await until(() => bridge.seen.length === 1, "Test-job read started");
    await cancel(client, call);
    await sleep(2200);
    assert.equal(bridge.seen.length, 1, "Cancelled test-job observer kept polling");
    assert.equal(call.settled, false);
  });
});

test("unknown and completed cancellation IDs leave another request intact", async () => {
  await exercise(async (bridge, client) => {
    const held = gate(bridge, (_, data) => data.queueRetryWindowMs);
    const call = command(client, bridge, "StillWanted");
    await until(() => held.held.length === 1, "Negotiation started");
    client.notify("notifications/cancelled", { requestId: "unknown-request" });
    held.release();
    assert.notEqual((await call.result).isError, true);
    client.notify("notifications/cancelled", { requestId: call.id });
    assert.notEqual((await command(client, bridge, "NextWanted").result).isError, true);
    assert.equal(bridge.seen.length, 2);
  });
});
