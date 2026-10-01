import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { MockBridge } from "./helpers/mock-bridge.mjs";
import { McpTestClient } from "./helpers/mcp-client.mjs";

const original = { status: "ok", projectName: "Original", projectPath: "C:/Original", unityVersion: "6000.6.2f1" };
async function exercise(check, { registry = false, scan = true } = {}) {
  const bridge = await new MockBridge({ instance: original }).start();
  const env = bridge.env();
  if (!scan) { env.UNITY_PORT_RANGE_START = "1"; env.UNITY_PORT_RANGE_END = "0"; }
  const register = (entries = [{ port: bridge.port, ...original }]) => writeFileSync(env.UNITY_INSTANCE_REGISTRY, JSON.stringify(entries));
  if (registry) register();
  const client = new McpTestClient({ serverEntry: process.env.UNITY_MCP_TEST_SERVER_ENTRY, env }).start();
  try {
    await client.initialize();
    await check(bridge, client, register);
    assert.deepEqual(client.stdoutViolations, []);
  } finally {
    await client.close();
    await bridge.stop();
  }
}

function pingAs(bridge, value, status = 200, raw = false) {
  const reply = bridge._json.bind(bridge);
  bridge._json = (res, code, data) => {
    if (data !== bridge.instance) return reply(res, code, data);
    if (!raw) return reply(res, status, value);
    res.writeHead(status, { "Content-Type": "text/html" });
    res.end(value);
  };
}

for (const [label, value, raw] of [
  ["empty JSON object", {}],
  ["generic service version", { status: "ok", version: "1.2.3" }],
  ["malformed identity fields", { status: "ok", projectName: {}, projectPath: [], unityVersion: 6000 }],
  ["array body", []],
  ["string body", "ok"],
  ["HTML success page", "<html>Another local service</html>", true],
  ["failed identity payload", { ...original, status: "error", success: false, error: "Unavailable" }],
]) {
  test(`unrecognized ping (${label}) is neither listed nor used for implicit commands`, async () => {
    await exercise(async (bridge, client) => {
      pingAs(bridge, value, 200, raw);
      const list = await client.callTool("unity_list_instances");
      assert.equal(list.payload.totalCount, 0, "Foreign service was listed as Unity");
      for (let attempt = 0; attempt < 2; attempt++) {
        const call = await client.callTool("unity_gameobject_create", { name: "MustNotDispatch" });
        assert.equal(call.isError, true, "No editor was verified before dispatch");
      }
      assert.equal((await client.callTool("unity_select_instance", { port: bridge.port })).isError, true);
      assert.equal(bridge.seen.length, 0, "Foreign service received a command");
    });
  });
}

for (const fresh of [false, true]) {
  test(`registry metadata cannot legitimize an unrelated responder (fresh: ${fresh})`, async () => {
    await exercise(async (bridge, client, register) => {
      register([{ port: bridge.port, ...original, lastSeen: fresh ? new Date().toISOString() : "2020-01-01T00:00:00Z" }]);
      pingAs(bridge, { status: "ok", service: "foreign" });
      const list = await client.callTool("unity_list_instances");
      assert.equal(list.payload.totalCount, 0);
      assert.equal(bridge.pingCount, 1, "One discovery repeated an already rejected port probe");
      assert.equal((await client.callTool("unity_gameobject_create", { name: "MustNotDispatch" })).isError, true);
      assert.equal(bridge.seen.length, 0);
    }, { registry: true });
  });
}

test("the configured default port cannot bypass identity validation outside the scan range", async () => {
  await exercise(async (bridge, client) => {
    pingAs(bridge, { service: "foreign" });
    const response = await client.callTool("unity_gameobject_create", { name: "MustNotDispatch" });
    assert.equal(response.isError, true);
    assert.equal(bridge.seen.length, 0);
  }, { scan: false });
});

test("offline schemas remain available without fetching a foreign service's route catalog or context", async () => {
  await exercise(async (bridge, client) => {
    pingAs(bridge, { service: "foreign" });
    let contextReads = 0;
    bridge.contextProvider = () => { contextReads++; return null; };
    const schema = await client.callTool("unity_list_advanced_tools", { tool: "unity_asset_list" });
    assert.equal(schema.isError, false, schema.payloadText);
    assert.equal(schema.payload.name, "unity_asset_list");
    assert.equal(bridge.seen.length, 0);
    assert.equal(contextReads, 0);
  });
});

test("explicit ping reports a foreign endpoint as disconnected", async () => {
  await exercise(async (bridge, client) => {
    pingAs(bridge, { status: "ok", service: "foreign" });
    let contextReads = 0;
    bridge.contextProvider = () => { contextReads++; return null; };
    const response = await client.callTool("unity_editor_ping", { port: bridge.port });
    assert.equal(response.payload.connected, false);
    assert.match(response.payload.error, /Unity Editor bridge/i);
    assert.equal(contextReads, 0);
  });
});

test("a failed editor result leaves automatic context for the next successful call", async () => {
  await exercise(async (bridge, client) => {
    let contextReads = 0;
    bridge.contextProvider = () => {
      contextReads++;
      return { enabled: true, categories: [{ category: "Rules", content: "Expected project rules" }] };
    };
    bridge.on("editor/state", () => ({ success: false, error: "Temporary query failure" }));
    assert.equal((await client.callTool("unity_editor_state", { port: bridge.port })).isError, true);
    assert.equal(contextReads, 0);
    bridge.on("editor/state", () => ({ success: true, state: "ready" }));
    const next = await client.callTool("unity_editor_state", { port: bridge.port });
    assert.equal(next.isError, false);
    assert.equal(contextReads, 1);
    assert.ok(next.blocks.some(block => block.text?.includes("Expected project rules")));
  });
});

test("an editor that appears after a failed discovery can be found by the next call", async () => {
  await exercise(async (bridge, client) => {
    const reply = bridge._json.bind(bridge);
    pingAs(bridge, { service: "foreign" });
    const first = await client.callTool("unity_gameobject_create", { name: "MustNotDispatch" });
    assert.equal(first.isError, true);
    bridge._json = reply;
    assert.equal((await client.callTool("unity_gameobject_create", { name: "RealEditor" })).isError, false);
    assert.deepEqual(bridge.seen.map(item => item.params.name), ["RealEditor"]);
  });
});

for (const warm of [false, true]) {
  test(`foreign service on a selected port overrides a fresh registry entry (warm: ${warm})`, async () => {
    await exercise(async (bridge, client, register) => {
      register([{ port: bridge.port, ...original, lastSeen: new Date().toISOString() }]);
      assert.equal((await client.callTool("unity_select_instance", { port: bridge.port })).isError, false);
      if (warm) assert.equal((await client.callTool("unity_editor_state")).isError, false);
      bridge.seen.length = 0;
      pingAs(bridge, { status: "ok", service: "foreign" });
      for (let attempt = 0; attempt < 2; attempt++) {
        assert.equal((await client.callTool("unity_gameobject_create", { name: "MustNotDispatch" })).isError, true);
        assert.deepEqual(await client.request("resources/list"), { resources: [] });
        await assert.rejects(client.request("resources/read", { uri: "unity-context://Rules" }), /select.*instance|instance.*select/i);
      }
      assert.equal(bridge.seen.length, 0);
    }, { registry: true });
  });
}

for (const replacement of [{ service: "foreign" }, { ...original, projectName: "Other", projectPath: "C:/Other" }]) {
  test(`selection rejects replacement during verification: ${replacement.service || replacement.projectName}`, async () => {
    await exercise(async (bridge, client) => {
      const reply = bridge._json.bind(bridge);
      bridge._json = (res, code, data) => reply(res, code,
        data === bridge.instance && bridge.pingCount >= 2 ? replacement : data);
      assert.equal((await client.callTool("unity_select_instance", { port: bridge.port })).isError, true);
      assert.equal(bridge.seen.length, 0);
    });
  });
}

for (const foreign of [false, true]) {
  test(`registry fallback checks the new port's identity (foreign: ${foreign})`, async () => {
    await exercise(async (bridge, client, register) => {
      assert.equal((await client.callTool("unity_select_instance", { port: bridge.port })).isError, false);
      const replacement = await new MockBridge({ instance: original }).start();
      try {
        register([{ port: replacement.port, ...original, lastSeen: new Date().toISOString() }]);
        pingAs(bridge, { error: "Old port unavailable" }, 503);
        if (foreign) pingAs(replacement, { service: "foreign" });
        const result = await client.callTool("unity_gameobject_create", { name: "RelocatedProject" });
        assert.equal(result.isError, foreign);
        assert.equal(replacement.seen.length, foreign ? 0 : 1);
        assert.equal(bridge.seen.length, 0);
      } finally {
        await replacement.stop();
      }
    }, { registry: true });
  });
}

test("an unreachable selected editor keeps fresh registry recovery behavior", async () => {
  await exercise(async (bridge, client, register) => {
    register([{ port: bridge.port, ...original, lastSeen: new Date().toISOString() }]);
    assert.equal((await client.callTool("unity_select_instance", { port: bridge.port })).isError, false);
    pingAs(bridge, { error: "Editor temporarily busy" }, 503);
    assert.equal((await client.callTool("unity_editor_state")).isError, false);
    assert.equal(bridge.seen.length, 1);
  }, { registry: true });
});

for (const [label, body] of [
  ["original plugin contract without capability fields", original],
  ["pre-path bridge", { status: "ok", projectName: "Original", unityVersion: "2021.3.18f1" }],
  ["existing project/version aliases", { project: "Original", version: "2019.4.40f1" }],
  ["empty product name with a project path", { ...original, projectName: "" }],
]) {
  test(`recognized identity retains compatibility: ${label}`, async () => {
    await exercise(async (bridge, client) => {
      pingAs(bridge, body);
      const list = await client.callTool("unity_list_instances");
      assert.equal(list.payload.totalCount, 1);
      assert.equal((await client.callTool("unity_select_instance", { port: bridge.port })).isError, false);
      for (let i = 0; i < 2; i++) assert.equal((await client.callTool("unity_editor_state")).isError, false);
      assert.equal(bridge.seen.length, 2);
    });
  });
}

test("a live pathless identity does not inherit another project's stale path", async () => {
  await exercise(async (bridge, client, register) => {
    register([{ port: bridge.port, ...original, lastSeen: new Date().toISOString() }]);
    pingAs(bridge, { status: "ok", projectName: "Replacement", unityVersion: "2021.3.18f1" });
    const list = await client.callTool("unity_list_instances");
    assert.equal(list.payload.instances[0].projectName, "Replacement");
    assert.equal(list.payload.instances[0].projectPath, "");
  }, { registry: true });
});
