import { test } from "node:test";
import assert from "node:assert/strict";
import { MockBridge } from "./helpers/mock-bridge.mjs";
import { McpTestClient } from "./helpers/mcp-client.mjs";
import { randomUUID } from "node:crypto";

async function exercise(bridge, check, env = {}) {
  let client;
  try {
    await bridge.start();
    client = new McpTestClient({ env: { ...bridge.env(), ...env } }).start();
    await client.initialize();
    const result = await client.callTool("unity_gameobject_create", { name: "OneObject", port: bridge.port });
    await check(result, client);
  } finally {
    if (client) await client.close();
    await bridge.stop();
  }
}

test("lost queue acknowledgement on an old plugin never repeats a write", async () => {
  const bridge = new MockBridge();
  let writes = 0;
  bridge.on("gameobject/create", () => ({ instanceId: String(++writes) }));
  const reply = bridge._json.bind(bridge);
  let dropped = false;
  bridge._json = (res, code, data) => {
    if (code === 202 && !dropped) { dropped = true; return res.destroy(); }
    return reply(res, code, data);
  };
  await exercise(bridge, result => {
    assert.equal(writes, 1, "the accepted write was repeated");
    assert.equal(result.isError, true);
    assert.match(result.payloadText, /outcome.*unknown|may have.*executed/i);
    assert.equal(bridge.seen.some(request => request.via === "legacy"), false);
  });
});

test("HTTP 503 after a legacy write never repeats the operation", async () => {
  const bridge = new MockBridge({ mode: "legacy" });
  let writes = 0;
  bridge.on("gameobject/create", () => ({ instanceId: String(++writes), legacyWrite: true }));
  const reply = bridge._json.bind(bridge);
  bridge._json = (res, code, data) => data.legacyWrite && writes === 1
    ? reply(res, 503, { error: "Response unavailable after execution" }) : reply(res, code, data);
  await exercise(bridge, result => {
    assert.equal(writes, 1, "the legacy operation was repeated after HTTP 503");
    assert.equal(result.isError, true);
    assert.match(result.payloadText, /outcome.*unknown|may have.*executed/i);
  });
});

function modernBridge() {
  const bridge = new MockBridge({ instance: { protocolVersion: 2 } });
  bridge.writes = 0;
  bridge.on("gameobject/create", () => ({ instanceId: String(++bridge.writes) }));
  return bridge;
}

function loseFirstAck(bridge, afterAcceptance = () => {}) {
  const reply = bridge._json.bind(bridge);
  let lost = false;
  bridge._json = (res, code, data) => {
    if (code === 202 && !lost) { lost = true; afterAcceptance(); return res.destroy(); }
    return reply(res, code, data);
  };
}

test("a protected retry recovers a lost acknowledgement without repeating the write", async () => {
  const bridge = modernBridge();
  loseFirstAck(bridge);
  await exercise(bridge, async (result, client) => {
    assert.equal(result.isError, false, result.payloadText);
    assert.equal(bridge.writes, 1);
    assert.equal(bridge.submissions.length, 2);
    assert.deepEqual(bridge.submissions[0], bridge.submissions[1]);
    assert.equal(bridge.submissions[0].path, "queue/submit-once");
    assert.equal(bridge.polls[0].queueSessionId, bridge.queueSessionId);
    const next = await client.callTool("unity_gameobject_create", { name: "OneObject", port: bridge.port });
    assert.equal(next.isError, false, next.payloadText);
    assert.equal(bridge.writes, 2, "a distinct tool call with the same parameters must still run");
    assert.notEqual(bridge.submissions[2].payload.requestId, bridge.submissions[0].payload.requestId);
  });
});

test("a reload after acceptance refuses retries from the old queue session", async () => {
  const bridge = modernBridge();
  const originalSession = bridge.queueSessionId;
  loseFirstAck(bridge, () => { bridge.queueSessionId = randomUUID().replaceAll("-", ""); });
  await exercise(bridge, result => {
    assert.equal(result.isError, true);
    assert.match(result.payloadText, /outcome unknown/i);
    assert.equal(bridge.writes, 1);
    assert.equal(bridge.submissions[1].payload.queueSessionId, originalSession);
  });
});

test("replacement with an old plugin cannot execute a protected retry", async () => {
  const bridge = modernBridge();
  loseFirstAck(bridge, () => { bridge.instance.protocolVersion = 1; });
  await exercise(bridge, result => {
    assert.equal(result.isError, true);
    assert.match(result.payloadText, /outcome unknown/i);
    assert.equal(bridge.writes, 1);
    assert.equal(bridge.seen.some(request => request.via === "legacy"), false);
  });
});

test("scoped polling cannot return a reused ticket from another editor session", async () => {
  const bridge = modernBridge();
  const reply = bridge._json.bind(bridge);
  bridge._json = (res, code, data) => {
    if (code === 202) {
      bridge.queueSessionId = randomUUID().replaceAll("-", "");
      bridge._tickets.set(data.ticketId, { ticketId: data.ticketId, status: "Completed", result: { wrongProject: true } });
    }
    return reply(res, code, data);
  };
  await exercise(bridge, result => {
    assert.equal(result.isError, true);
    assert.match(result.payloadText, /session changed/i);
    assert.doesNotMatch(result.payloadText, /wrongProject/);
    assert.equal(bridge.writes, 1);
  });
});

test("transient HTTP poll failures only retry the original ticket", async () => {
  const bridge = modernBridge();
  const reply = bridge._json.bind(bridge);
  let failed = false;
  bridge._json = (res, code, data) => {
    if (code === 200 && data.ticketId && !failed) { failed = true; return reply(res, 503, { error: "Temporarily busy" }); }
    return reply(res, code, data);
  };
  await exercise(bridge, result => {
    assert.equal(result.isError, false, result.payloadText);
    assert.equal(bridge.writes, 1);
    assert.equal(bridge.submissions.length, 1);
    assert.equal(bridge.polls.length, 2);
    assert.equal(bridge.polls[0].ticketId, bridge.polls[1].ticketId);
  });
});

test("legacy response body remains bounded by the bridge deadline", async () => {
  const bridge = new MockBridge({ mode: "legacy" });
  let writes = 0;
  bridge.on("gameobject/create", () => ({ legacyWrite: ++writes }));
  const reply = bridge._json.bind(bridge);
  bridge._json = (res, code, data) => {
    if (data.legacyWrite) { res.writeHead(200, { "Content-Type": "application/json" }); res.write("{"); return; }
    return reply(res, code, data);
  };
  await exercise(bridge, result => {
    assert.equal(result.isError, true);
    assert.match(result.payloadText, /outcome unknown/i);
    assert.equal(writes, 1);
  }, { UNITY_BRIDGE_TIMEOUT: "300" });
});

test("a stalled poll body honors the total polling deadline without resubmission", async () => {
  const bridge = modernBridge();
  const reply = bridge._json.bind(bridge);
  let firstPoll;
  bridge._json = (res, code, data) => {
    if (code === 200 && data.ticketId) {
      firstPoll ??= performance.now();
      res.writeHead(200, { "Content-Type": "application/json" }); res.write("{"); return;
    }
    return reply(res, code, data);
  };
  await exercise(bridge, result => {
    assert.equal(result.isError, true);
    assert.match(result.payloadText, /polling timed out/i);
    assert.ok(performance.now() - firstPoll < 2000, "per-request timeout exceeded the total polling budget");
    assert.equal(bridge.writes, 1);
    assert.equal(bridge.submissions.length, 1);
  }, { UNITY_QUEUE_POLL_TIMEOUT: "300" });
});

function refuseInput(bridge, { status = 503, accepted = false, after = 0 } = {}) {
  const handle = bridge._handle.bind(bridge), reply = bridge._json.bind(bridge);
  bridge.refusedInputs = 0;
  bridge._json = (res, code, data) => reply(res, code, Object.hasOwn(data, "queueRetryWindowMs")
    ? { ...data, queueRetryWindowMs: 2100 } : data);
  bridge._handle = (req, res) => {
    const target = bridge.mode === "legacy" ? req.url === "/api/gameobject/create" : /\/api\/queue\/submit(?:-once)?$/.test(req.url);
    if (req.method === "POST" && target
        && bridge.submissions.length >= after) {
      bridge.refusedInputs++;
      return reply(res, status, { error: "Body rejected before dispatch", code: status === 408 ? "request_body_timeout" : "request_body_busy", requestAccepted: accepted });
    }
    return handle(req, res);
  };
}

for (const mode of ["legacy", "queue", "protected"]) {
  test(`explicit pre-dispatch refusal remains definite in ${mode} mode`, async () => {
    const bridge = mode === "protected" ? modernBridge() : new MockBridge({ mode: mode === "legacy" ? "legacy" : "queue" });
    refuseInput(bridge);
    await exercise(bridge, result => {
      assert.equal(result.isError, true);
      assert.equal(result.payload.requestAccepted, false, result.payloadText);
      assert.equal(result.payload.code, "request_body_busy");
      assert.equal(result.payload.outcomeUnknown, undefined);
      assert.equal(bridge.seen.length, 0);
      assert.equal(bridge.refusedInputs, mode === "protected" ? 2 : 1);
    });
  });
}

for (const accepted of ["false", true]) {
  test(`non-false admission metadata cannot turn an ambiguous failure into a refusal (${accepted})`, async () => {
    const bridge = new MockBridge({ mode: "legacy" }); refuseInput(bridge, { accepted });
    await exercise(bridge, result => {
      assert.equal(result.isError, true); assert.equal(result.payload.outcomeUnknown, true);
      assert.equal(result.payload.requestAccepted, undefined); assert.equal(bridge.refusedInputs, 1);
    });
  });
}

test("a later body refusal cannot erase an earlier lost acknowledgement", async () => {
  const bridge = modernBridge(); loseFirstAck(bridge); refuseInput(bridge, { after: 1 });
  await exercise(bridge, result => {
    assert.equal(result.isError, true); assert.equal(result.payload.outcomeUnknown, true);
    assert.equal(result.payload.requestAccepted, undefined); assert.equal(bridge.writes, 1);
    assert.equal(bridge.submissions.length, 1); assert.equal(bridge.refusedInputs, 1);
    assert.equal(typeof result.payload.requestId, "string");
  });
});

test("an input deadline reports non-acceptance without resubmitting", async () => {
  const bridge = modernBridge(); refuseInput(bridge, { status: 408 });
  await exercise(bridge, result => {
    assert.equal(result.isError, true); assert.equal(result.payload.requestAccepted, false);
    assert.equal(result.payload.code, "request_body_timeout"); assert.equal(result.payload.outcomeUnknown, undefined);
    assert.equal(bridge.refusedInputs, 1); assert.equal(bridge.writes, 0);
  });
});
