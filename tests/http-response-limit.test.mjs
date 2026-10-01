import { test } from "node:test";
import assert from "node:assert/strict";
import { MockBridge } from "./helpers/mock-bridge.mjs";
import { McpTestClient } from "./helpers/mcp-client.mjs";

async function exercise(options, prepare, check) {
  const bridge = new MockBridge(options);
  prepare(bridge);
  await bridge.start();
  const client = new McpTestClient({ serverEntry: process.env.UNITY_MCP_TEST_SERVER_ENTRY, env: {
    ...bridge.env(), UNITY_HTTP_RESPONSE_LIMIT: "2048", UNITY_QUEUE_POLL_TIMEOUT: "1000",
    UNITY_BRIDGE_TIMEOUT: "1000",
  } }).start();
  try {
    await client.initialize();
    await check(client, bridge);
    assert.deepEqual(client.stdoutViolations, []);
    assert.doesNotMatch(client.stderr, /MaxListenersExceededWarning|unhandled/i);
  } finally { await client.close(); await bridge.stop(); }
}

const invoke = (client, port) => client.callTool("unity_advanced_tool", { tool: "unity_payload_value", params: {}, port });

for (const options of [{ mode: "legacy" }, { instance: { protocolVersion: 1 } }, { instance: { protocolVersion: 2 } }]) {
  test(`HTTP overflow after ${options.mode || `protocol ${options.instance.protocolVersion}`} execution reports uncertainty without replay`, async () => {
    await exercise(options, bridge => bridge.on("payload/value", () => ({ value: "x".repeat(8192) })), async (client, bridge) => {
      const result = await invoke(client, bridge.port);
      assert.equal(result.isError, true);
      assert.equal(result.payload.outcomeUnknown, true);
      assert.match(result.payload.error, /http_response_too_large/);
      assert.equal(bridge.seen.length, 1);
      if (!options.mode) {
        assert.equal(bridge.submissions.length, 1);
        assert.equal(bridge.polls.length, 1);
        assert.equal(result.payload.ticketId, "ticket-1");
      }
      if (options.instance?.protocolVersion === 2) {
        assert.equal(result.payload.queueSessionId, bridge.queueSessionId);
        assert.equal(result.payload.requestId, bridge.submissions[0].payload.requestId);
      }
      bridge.on("payload/value", () => ({ value: 42 }));
      assert.equal((await invoke(client, bridge.port)).payload.data.value, 42);
      assert.equal(bridge.seen.length, 2);
    });
  });
}

for (const protocolVersion of [1, 2]) {
  test(`oversized protocol ${protocolVersion} acknowledgement is not resubmitted`, async () => {
    await exercise({ instance: { protocolVersion } }, bridge => {
      const json = bridge._json.bind(bridge);
      bridge._json = (res, status, data) => json(res, status, status === 202 ? { ...data, padding: "x".repeat(8192) } : data);
    }, async (client, bridge) => {
      const result = await invoke(client, bridge.port);
      assert.equal(result.payload.outcomeUnknown, true);
      assert.match(result.payload.error, /http_response_too_large/);
      assert.equal(bridge.seen.length, 1);
      assert.equal(bridge.submissions.length, 1);
      assert.equal(bridge.polls.length, 0);
      assert.equal(result.payload.ticketId, undefined);
      if (protocolVersion === 2) assert.equal(result.payload.requestId, bridge.submissions[0].payload.requestId);
    });
  });
}

test("oversized negotiation stops before submitting a Unity command", async () => {
  let checks = 0;
  await exercise({ instance: { protocolVersion: 2 } }, bridge => {
    const json = bridge._json.bind(bridge);
    bridge._json = (res, status, data) => {
      if (Object.hasOwn(data, "totalPending")) { checks++; data = { ...data, padding: "x".repeat(8192) }; }
      return json(res, status, data);
    };
  }, async (client, bridge) => {
    const result = await invoke(client, bridge.port);
    assert.equal(result.isError, true);
    assert.equal(result.payload.queueTransportError, true);
    assert.match(result.payload.error, /http_response_too_large.*No command was submitted/);
    assert.equal(checks, 1);
    assert.equal(bridge.seen.length, 0);
    assert.equal(bridge.submissions.length, 0);
  });
});

test("oversized ping identities are excluded from instance discovery", async () => {
  await exercise({ instance: { padding: "x".repeat(8192) } }, () => {}, async (client, bridge) => {
    const result = await client.callTool("unity_list_instances", { refresh: true });
    assert.ok(!JSON.stringify(result.payload).includes("MockProject"), result.payloadText);
    assert.ok(bridge.pingCount > 0);
    assert.equal(bridge.seen.length, 0);
  });
});

test("oversized project-context resources fail explicitly and smaller follow-up reads succeed", async () => {
  await exercise({}, bridge => { bridge.contextProvider = () => ({ content: "x".repeat(8192) }); }, async (client, bridge) => {
    const params = { uri: "unity-context://Rules", _meta: { port: bridge.port } };
    await assert.rejects(client.request("resources/read", params), /http_response_too_large/);
    bridge.contextProvider = () => ({ content: "Small project rules" });
    const result = await client.request("resources/read", params);
    assert.equal(result.contents[0].text, "Small project rules");
    assert.equal(result.contents[0].uri, params.uri);
    assert.equal(bridge.seen.length, 0);
  });
});

test("oversized automatic context leaves the command intact and allows a later context injection", async () => {
  await exercise({}, bridge => {
    bridge.contextProvider = () => ({ enabled: true, categories: [{ category: "Rules", content: "x".repeat(8192) }] });
  }, async (client, bridge) => {
    const first = await invoke(client, bridge.port);
    assert.equal(first.isError, false);
    assert.ok(!first.blocks.some(block => block.text?.includes("PROJECT CONTEXT")));
    bridge.contextProvider = () => ({ enabled: true, categories: [{ category: "Rules", content: "Recovered context" }] });
    const second = await invoke(client, bridge.port);
    assert.equal(second.isError, false);
    assert.ok(second.blocks.some(block => block.text?.includes("Recovered context")));
    assert.equal(bridge.seen.length, 2);
  });
});

for (const stage of ["acknowledgement", "poll"]) {
  test(`oversized HTTP 500 during ${stage} stops observation without retrying`, async () => {
    await exercise({ instance: { protocolVersion: 2 } }, bridge => {
      const json = bridge._json.bind(bridge);
      bridge._json = (res, status, data) => {
        if ((stage === "acknowledgement" && status === 202) || (stage === "poll" && data.status === "Completed"))
          return json(res, 500, { error: "x".repeat(8192) });
        return json(res, status, data);
      };
    }, async (client, bridge) => {
      const result = await invoke(client, bridge.port);
      assert.equal(result.isError, true);
      assert.equal(result.payload.outcomeUnknown, true);
      assert.match(result.payload.error, /http_response_too_large/);
      assert.equal(bridge.seen.length, 1);
      assert.equal(bridge.submissions.length, 1);
      assert.equal(bridge.polls.length, stage === "poll" ? 1 : 0);
    });
  });
}
