import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { MockBridge } from "./helpers/mock-bridge.mjs";
import { McpTestClient } from "./helpers/mcp-client.mjs";

async function exercise(check, names = ["Alpha", "Beta"]) {
  const bridges = names.map(projectName => new MockBridge({ instance: { projectName, projectPath: `C:/${projectName}` } }));
  let client;
  const gates = [];
  try {
    await Promise.all(bridges.map(bridge => bridge.start()));
    const env = bridges[0].env();
    const register = (entries = bridges.map(bridge => ({ port: bridge.port, ...bridge.instance }))) =>
      writeFileSync(env.UNITY_INSTANCE_REGISTRY, JSON.stringify(entries));
    register();
    client = new McpTestClient({ env, serverEntry: process.env.UNITY_MCP_TEST_SERVER_ENTRY }).start();
    await client.initialize();
    const call = (name, args = {}, agentId = "selection-agent") => {
      const pending = client.request("tools/call", { name, arguments: args, _meta: { agentId } }).then(result => {
        const text = result.content.at(-1).text;
        let payload; try { payload = JSON.parse(text); } catch { payload = { error: text }; }
        return { ...result, payload };
      });
      pending.catch(() => {});
      return pending;
    };
    const hold = (bridge, offset = 1, replacement) => {
      const reply = bridge._json.bind(bridge), target = bridge.pingCount + offset;
      let release, resolve, timer;
      const observed = new Promise((done, reject) => {
        timer = setTimeout(() => reject(new Error("Expected held identity probe did not arrive")), 8000);
        resolve = () => { clearTimeout(timer); done(); };
      });
      bridge._json = (res, code, data) => {
        if (data !== bridge.instance || bridge.pingCount !== target) return reply(res, code, data);
        const snapshot = replacement || { ...data };
        release = () => { if (!res.destroyed) reply(res, code, snapshot); };
        resolve();
      };
      const gate = { observed, release: () => { clearTimeout(timer); const send = release; release = null; send?.(); } };
      gates.push(gate); return gate;
    };
    await check({ bridges, client, call, register, hold });
    assert.deepEqual(client.stdoutViolations, []);
  } finally {
    for (const gate of gates) gate.release();
    await client?.close();
    await Promise.all(bridges.map(bridge => bridge.stop()));
  }
}

for (const sameName of [false, true]) {
  test(`selection by name rejects identity replacement after resolution (same name: ${sameName})`, async () => {
    await exercise(async ({ bridges: [alpha], call }) => {
      const reply = alpha._json.bind(alpha);
      alpha._json = (res, code, data) => {
        const result = reply(res, code, data);
        if (data === alpha.instance && alpha.pingCount === 1)
          Object.assign(alpha.instance, { projectName: sameName ? "Alpha" : "Replacement", projectPath: "C:/Replacement" });
        return result;
      };
      const selected = await call("unity_select_instance", { projectName: "Alpha" });
      assert.equal(selected.isError, true, JSON.stringify(selected.payload));
      assert.equal((await call("unity_list_instances")).payload.selectedPort, null);
      assert.equal(alpha.seen.length, 0);
    }, ["Alpha"]);
  });
}

test("selection by name uses one discovery and a fresh identity recheck", async () => {
  await exercise(async ({ bridges: [alpha, beta], call }) => {
    const selected = await call("unity_select_instance", { projectName: "aLpHa" });
    assert.equal(selected.payload.instance.projectPath, "C:/Alpha");
    assert.deepEqual([alpha.pingCount, beta.pingCount], [2, 1]);
  });
});

for (const byName of [false, true]) {
  test(`older explicit selection cannot overwrite a newer completed choice (by name: ${byName})`, async () => {
    await exercise(async ({ bridges: [alpha, beta], call, hold }) => {
      const gate = hold(alpha, 2);
      const older = call("unity_select_instance", byName ? { projectName: "Alpha" } : { port: alpha.port });
      await gate.observed;
      assert.equal((await call("unity_select_instance", { port: beta.port })).payload.success, true);
      gate.release();
      const oldResult = await older;
      const selected = (await call("unity_list_instances")).payload;
      assert.equal(selected.selectedPort, beta.port, JSON.stringify({ selected, oldResult }));
      assert.equal(oldResult.isError, true);
      assert.match(oldResult.payload.error, /selection.*(changed|superseded)|newer.*selection/i);
    });
  });
}

for (const recovery of ["lost", "relocated", "registry"]) {
  test(`old validation cannot ${recovery === "lost" ? "clear" : "replace"} a newer selection (${recovery})`, async () => {
    await exercise(async ({ bridges: [alpha, beta, moved], call, register, hold }) => {
      register([alpha, beta].map(bridge => ({ port: bridge.port, ...bridge.instance })));
      assert.equal((await call("unity_select_instance", { port: alpha.port })).payload.success, true);
      const gate = hold(alpha, 1, { service: "replacement" });
      const older = call("unity_gameobject_create", { name: "MustNotRetarget" });
      await gate.observed;
      const reply = alpha._json.bind(alpha);
      alpha._json = (res, code, data) => data === alpha.instance ? reply(res, 200, { service: "replacement" }) : reply(res, code, data);
      if (recovery === "lost") register([{ port: beta.port, ...beta.instance }]);
      else {
        Object.assign(moved.instance, alpha.instance);
        register([beta, moved].map(bridge => ({ port: bridge.port, ...bridge.instance, lastSeen: new Date().toISOString() })));
        if (recovery === "registry") {
          const movedReply = moved._json.bind(moved);
          moved._json = (res, code, data) => movedReply(res, data === moved.instance ? 503 : code, data);
        }
      }
      assert.equal((await call("unity_select_instance", { port: beta.port })).payload.success, true);
      gate.release();
      const oldResult = await older;
      const selected = (await call("unity_list_instances")).payload;
      assert.equal(selected.selectedPort, beta.port, JSON.stringify({ selected, oldResult }));
      assert.equal(oldResult.isError, true);
      assert.equal(alpha.seen.length + beta.seen.length + moved.seen.length, 0, "A stale implicit call dispatched");
      assert.equal((await call("unity_editor_state")).isError, undefined);
      assert.equal(beta.seen.length, 1);
    }, ["Alpha", "Beta", "Moved"]);
  });
}

test("first automatic discovery cannot overwrite a concurrent explicit choice", async () => {
  await exercise(async ({ bridges: [alpha, beta], call, register, hold }) => {
    register([{ port: alpha.port, ...alpha.instance }]);
    const gate = hold(alpha);
    const older = call("unity_gameobject_create", { name: "MustNotRetarget" });
    await gate.observed;
    register([{ port: beta.port, ...beta.instance }]);
    assert.equal((await call("unity_select_instance", { port: beta.port })).payload.success, true);
    gate.release();
    const oldResult = await older;
    const selected = (await call("unity_list_instances")).payload;
    assert.equal(selected.selectedPort, beta.port, JSON.stringify({ selected, oldResult }));
    assert.equal(oldResult.isError, true);
    assert.equal(alpha.seen.length + beta.seen.length, 0);
  });
});

test("concurrent selections by different agents remain independent", async () => {
  await exercise(async ({ bridges: [alpha, beta], call, hold }) => {
    const gate = hold(alpha, 2);
    const first = call("unity_select_instance", { port: alpha.port }, "first");
    await gate.observed;
    assert.equal((await call("unity_select_instance", { port: beta.port }, "second")).payload.success, true);
    gate.release();
    assert.equal((await first).payload.success, true);
    for (const [agent, bridge] of [["first", alpha], ["second", beta]])
      assert.equal((await call("unity_list_instances", {}, agent)).payload.selectedPort, bridge.port);
  });
});

test("ambiguous names and failed explicit selection preserve the existing choice", async () => {
  await exercise(async ({ bridges: [alpha, beta], call }) => {
    assert.equal((await call("unity_select_instance", { port: beta.port, projectName: "Ignored" })).payload.success, true);
    beta.instance.projectName = "Alpha";
    assert.equal((await call("unity_select_instance", { projectName: "Alpha" })).isError, true);
    assert.equal((await call("unity_select_instance", { projectName: "Missing" })).isError, true);
    assert.equal((await call("unity_list_instances")).payload.selectedPort, beta.port);
    assert.equal(alpha.seen.length + beta.seen.length, 0);
  });
});

test("an implicit call does not switch projects while explicit selection is still pending", async () => {
  await exercise(async ({ bridges: [alpha, beta], call, hold }) => {
    assert.equal((await call("unity_select_instance", { port: beta.port })).payload.success, true);
    const gate = hold(alpha, 2);
    const selecting = call("unity_select_instance", { port: alpha.port });
    await gate.observed;
    const implicit = await call("unity_gameobject_create", { name: "MustNotDispatch" });
    assert.equal(implicit.isError, true);
    assert.equal(alpha.seen.length + beta.seen.length, 0);
    assert.notEqual((await call("unity_editor_state", { port: beta.port })).isError, true);
    gate.release();
    assert.equal((await selecting).payload.success, true);
    assert.equal((await call("unity_list_instances")).payload.selectedPort, alpha.port);
  });
});

test("a failed newer selection does not let an older selection silently take over", async () => {
  await exercise(async ({ bridges: [alpha, beta], call, hold }) => {
    assert.equal((await call("unity_select_instance", { port: beta.port })).payload.success, true);
    const gate = hold(alpha, 2);
    const older = call("unity_select_instance", { port: alpha.port });
    await gate.observed;
    assert.equal((await call("unity_select_instance", { projectName: "Missing" })).isError, true);
    gate.release();
    assert.equal((await older).isError, true);
    assert.equal((await call("unity_list_instances")).payload.selectedPort, beta.port);
  });
});

test("selection change during recovery discovery cannot restore the old project", async () => {
  await exercise(async ({ bridges: [alpha, beta, moved], call, hold, register }) => {
    assert.equal((await call("unity_select_instance", { port: alpha.port })).payload.success, true);
    const original = { ...alpha.instance };
    Object.assign(alpha.instance, { projectName: "Replacement", projectPath: "C:/Replacement" });
    Object.assign(moved.instance, original);
    register();
    const gate = hold(moved);
    const older = call("unity_gameobject_create", { name: "MustNotRetarget" });
    await gate.observed;
    assert.equal((await call("unity_select_instance", { port: beta.port })).payload.success, true);
    gate.release();
    assert.equal((await older).isError, true);
    assert.equal((await call("unity_list_instances")).payload.selectedPort, beta.port);
    assert.equal(alpha.seen.length + beta.seen.length + moved.seen.length, 0);
  }, ["Alpha", "Beta", "Moved"]);
});

test("cancelled selection releases its pending guard and preserves the prior project", async () => {
  await exercise(async ({ bridges: [alpha, beta], client, call, hold }) => {
    assert.equal((await call("unity_select_instance", { port: beta.port })).payload.success, true);
    const gate = hold(alpha, 2);
    call("unity_select_instance", { port: alpha.port });
    const requestId = client._id;
    await gate.observed;
    client.notify("notifications/cancelled", { requestId, reason: "Selection regression" });
    await client.listTools();
    gate.release();
    assert.equal((await call("unity_select_instance", { port: beta.port })).payload.success, true);
    assert.notEqual((await call("unity_editor_state")).isError, true);
    assert.equal((await call("unity_list_instances")).payload.selectedPort, beta.port);
    assert.equal(alpha.seen.length, 0);
  });
});
