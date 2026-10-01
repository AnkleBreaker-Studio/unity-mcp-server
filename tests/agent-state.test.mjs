import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { MockBridge } from "./helpers/mock-bridge.mjs";
import { McpTestClient } from "./helpers/mcp-client.mjs";

async function exercise(check, overrides = {}) {
  const bridge = await new MockBridge().start();
  const env = { ...bridge.env(), UNITY_MCP_AGENT_STATE_LIMIT: "2", ...overrides };
  const register = () => writeFileSync(env.UNITY_INSTANCE_REGISTRY, JSON.stringify([{ port: bridge.port, ...bridge.instance }]));
  register();
  const client = new McpTestClient({ env, serverEntry: process.env.UNITY_MCP_TEST_SERVER_ENTRY }).start();
  const gates = [];
  try {
    await client.initialize();
    const call = async (agentId, name, args = {}) => {
      const result = await client.request("tools/call", { name, arguments: args, _meta: { agentId } });
      const text = result.content.at(-1).text;
      let payload; try { payload = JSON.parse(text); } catch { payload = { error: text }; }
      return { ...result, payload };
    };
    const select = agent => call(agent, "unity_select_instance", { port: bridge.port });
    const holdPing = () => {
      const reply = bridge._json.bind(bridge);
      let send, timer;
      const observed = new Promise((done, reject) => {
        timer = setTimeout(() => reject(new Error("Identity probe never arrived")), 8000);
        bridge._json = (res, code, data) => {
          if (data !== bridge.instance) return reply(res, code, data);
          bridge._json = reply;
          send = () => { if (!res.destroyed) reply(res, code, data); };
          clearTimeout(timer); done();
        };
      });
      const gate = { observed, release() { clearTimeout(timer); send?.(); send = null; } };
      gates.push(gate); return gate;
    };
    await check({ bridge, client, call, select, register, holdPing });
    assert.deepEqual(client.stdoutViolations, []);
  } finally {
    for (const gate of gates) gate.release();
    await client.close();
    await bridge.stop();
    const directory = resolve(dirname(env.UNITY_INSTANCE_REGISTRY));
    assert.equal(dirname(directory), resolve(tmpdir()));
    assert.ok(directory.startsWith(join(resolve(tmpdir()), "umcp-test-")));
    rmSync(directory, { recursive: true, force: true });
  }
}

test("normal single-editor discovery and remembered selection remain compatible", async () => {
  await exercise(async ({ bridge, call }) => {
    assert.notEqual((await call("normal", "unity_editor_state")).isError, true);
    assert.equal((await call("normal", "unity_list_instances")).payload.selectedPort, bridge.port);
    assert.equal(bridge.seen.length, 1);
  });
});

test("evicted and previously unknown agents require an explicit target", async () => {
  await exercise(async ({ bridge, call, select }) => {
    for (const agent of ["old", "retained", "newest"]) assert.equal((await select(agent)).payload.success, true);
    for (const agent of ["old", "unseen"]) {
      const result = await call(agent, "unity_gameobject_create", { name: "MustNotDispatch" });
      assert.equal(result.isError, true);
      assert.match(result.payload.error, /select.*instance/i);
    }
    assert.equal(bridge.seen.length, 0);
    assert.notEqual((await call("old", "unity_editor_state", { port: bridge.port })).isError, true);
    assert.equal((await select("old")).payload.success, true);
    assert.notEqual((await call("old", "unity_editor_state")).isError, true);
    assert.equal(bridge.seen.length, 2);
  });
});

test("least recently used inactive state is evicted and catalog reads do not admit agents", async () => {
  await exercise(async ({ bridge, call, select }) => {
    await select("first"); await select("second");
    assert.equal((await call("first", "unity_list_instances")).payload.selectedPort, bridge.port);
    for (let index = 0; index < 5; index++)
      assert.equal((await call(`catalog-${index}`, "unity_list_instances")).payload.selectedPort, null);
    await select("third");
    assert.equal((await call("first", "unity_list_instances")).payload.selectedPort, bridge.port);
    assert.equal((await call("second", "unity_list_instances")).payload.selectedPort, null);
  });
});

test("active discovery is pinned and admission recovers after completion", async () => {
  await exercise(async ({ bridge, call, select, holdPing }) => {
    await select("busy");
    const gate = holdPing();
    const running = call("busy", "unity_editor_state");
    await gate.observed;
    try {
      const rejected = await select("other");
      assert.equal(rejected.isError, true);
      assert.match(rejected.payload.error, /agent_state_capacity/);
      assert.equal((await call("viewer", "unity_list_instances")).payload.selectedPort, null);
      assert.equal((await call("busy", "unity_list_instances")).payload.selectedPort, bridge.port);
    } finally { gate.release(); await running; }
    assert.equal((await select("other")).payload.success, true);
    assert.equal((await call("busy", "unity_editor_state")).isError, true);
  }, { UNITY_MCP_AGENT_STATE_LIMIT: "1" });
});

test("resource requests share eviction safeguards and explicit port routing", async () => {
  await exercise(async ({ bridge, client, select }) => {
    let fetches = 0;
    bridge.contextProvider = category => { fetches++; return category ? { content: "Correct project" } : { enabled: true, categories: [{ category: "guide", content: "Correct project" }] }; };
    for (const agent of ["old", "new", "last"]) await select(agent);
    await assert.rejects(client.request("resources/read", { uri: "unity-context://guide", _meta: { agent_id: "old" } }), /Select a Unity instance/);
    assert.equal(fetches, 0);
    const result = await client.request("resources/read", { uri: "unity-context://guide", _meta: { agent_id: "old", port: bridge.port } });
    assert.equal(result.contents[0].text, "Correct project");
    assert.equal(fetches, 1);
  });
});

test("oversized UTF-8 agent identifiers are rejected before bridge access", async () => {
  await exercise(async ({ bridge, call }) => {
    const result = await call("\u00e9".repeat(513), "unity_editor_state", { port: bridge.port });
    assert.equal(result.isError, true);
    assert.match(result.payload.error, /agent_id_too_large/);
    assert.equal(bridge.seen.length, 0);
    assert.notEqual((await call("\u00e9".repeat(512), "unity_editor_state", { port: bridge.port })).isError, true);
  });
});

test("oversized selection metadata preserves the prior committed project", async () => {
  await exercise(async ({ bridge, call, select, register }) => {
    await select("agent");
    const originalName = bridge.instance.projectName;
    bridge.instance.projectName = "x".repeat(65536); register();
    const result = await select("agent");
    assert.equal(result.isError, true);
    assert.match(result.payload.error, /agent_state_metadata_too_large/);
    bridge.instance.projectName = originalName; register();
    assert.equal((await call("agent", "unity_list_instances")).payload.selectedProject, originalName);
  });
});

test("context markers are bounded and old projects can receive context again", async () => {
  await exercise(async ({ bridge, call, select, register }) => {
    let fetches = 0;
    bridge.contextProvider = () => { fetches++; return { enabled: true, categories: [{ category: "guide", content: bridge.instance.projectPath }] }; };
    for (let index = 0; index < 17; index++) {
      bridge.instance.projectPath = `C:/Project-${index}`; register();
      await select("traveler");
      await call("traveler", "unity_editor_state");
    }
    assert.equal(fetches, 17);
    bridge.instance.projectPath = "C:/Project-0"; register(); await select("traveler");
    const result = await call("traveler", "unity_editor_state");
    assert.equal(fetches, 18);
    assert.ok(result.content.some(block => block.text?.includes("PROJECT CONTEXT")));
  });
});

test("serialized identity bytes enforce pressure before the agent count limit", async () => {
  await exercise(async ({ bridge, call, select, register }) => {
    bridge.instance.projectName = "n".repeat(900); register();
    assert.equal((await select("first")).payload.success, true);
    assert.equal((await select("second")).payload.success, true);
    assert.equal((await call("first", "unity_list_instances")).payload.selectedPort, null);
    assert.equal((await call("second", "unity_list_instances")).payload.selectedPort, bridge.port);
    const info = await call("second", "unity_queue_info");
    const state = info.payload.serverAgentState;
    assert.ok(state.identityBytes <= 2048);
    assert.equal(state.identityByteLimit, 2048);
    assert.equal(state.limit, 8);
    assert.equal(state.evictions, 1);
    assert.equal(state.activeAgents, 1);
    assert.equal(state.pendingSelections, 0);
  }, { UNITY_MCP_AGENT_STATE_LIMIT: "8", UNITY_MCP_AGENT_STATE_BYTES: "2048" });
});

test("failed selection and resource errors release capacity for the next agent", async () => {
  await exercise(async ({ bridge, client, call, select }) => {
    assert.equal((await call("failure", "unity_select_instance", { projectName: "Missing" })).isError, true);
    assert.equal((await select("resource")).payload.success, true);
    await assert.rejects(client.request("resources/read", { uri: "unity-context://missing", _meta: { agentId: "resource" } }), /Context request failed: HTTP 404/);
    assert.equal((await select("next")).payload.success, true);
    const state = (await call("next", "unity_queue_info", { port: bridge.port })).payload.serverAgentState;
    assert.equal(state.agents, 1);
    assert.equal(state.activeAgents, 1);
    assert.equal(state.activeLeases, 1);
    assert.equal(state.capacityRefusals, 0);
  }, { UNITY_MCP_AGENT_STATE_LIMIT: "1" });
});
