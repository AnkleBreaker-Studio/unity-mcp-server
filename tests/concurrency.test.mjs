import { test } from "node:test";
import assert from "node:assert/strict";
import { MockBridge } from "./helpers/mock-bridge.mjs";
import { McpTestClient } from "./helpers/mcp-client.mjs";
import { writeFileSync } from "node:fs";

function payload(response) {
  assert.notEqual(response.isError, true, JSON.stringify(response));
  return JSON.parse(response.content.at(-1).text);
}

test("resources retain each agent's selected project and explicit port", async () => {
  const bridges = ["Alpha", "Beta"].map(projectName => {
    const bridge = new MockBridge({ instance: { projectName, projectPath: `C:/${projectName}` } });
    bridge.contextProvider = category => category
      ? { enabled: true, content: `${projectName} rules` }
      : { enabled: true, categories: [{ category: `${projectName} Rules` }] };
    return bridge;
  });
  let client;
  try {
    await Promise.all(bridges.map(bridge => bridge.start()));
    const env = bridges[0].env();
    writeFileSync(env.UNITY_INSTANCE_REGISTRY, JSON.stringify(bridges.map(bridge => ({ port: bridge.port }))));
    client = new McpTestClient({ env }).start();
    await client.initialize();
    for (let index = 0; index < bridges.length; index++) {
      const selected = payload(await client.request("tools/call", { name: "unity_select_instance", arguments: { port: bridges[index].port }, _meta: { agentId: `resource-${index}` } }));
      assert.equal(selected.success, true);
    }
    const responses = await Promise.all(bridges.map((bridge, index) => client.request("resources/list", { _meta: { agentId: `resource-${index}` } })));
    for (let index = 0; index < responses.length; index++) {
      assert.equal(responses[index].resources[0].uri, `unity-context://${bridges[index].instance.projectName}%20Rules`);
    }
    const reads = await Promise.all(bridges.map((bridge, index) => client.request("resources/read", {
      uri: responses[index].resources[0].uri, _meta: { agent_id: `resource-${index}` },
    })));
    for (let index = 0; index < reads.length; index++) assert.equal(reads[index].contents[0].text, `${bridges[index].instance.projectName} rules`);
    const override = await client.request("resources/read", { uri: "unity-context://Rules", _meta: { agentId: "resource-0", port: bridges[1].port } });
    assert.equal(override.contents[0].text, "Beta rules");
    const retained = await client.request("resources/read", { uri: "unity-context://Rules", _meta: { agentId: "resource-0" } });
    assert.equal(retained.contents[0].text, "Alpha rules");
    await client.callTool("unity_select_instance", { port: bridges[1].port });
    assert.equal((await client.request("resources/read", { uri: "unity-context://Rules" })).contents[0].text, "Beta rules");
    for (const method of ["resources/list", "resources/read"]) {
      await assert.rejects(client.request(method, { uri: "unity-context://Rules", _meta: { port: 65536 } }), /port must be an integer/);
      await assert.rejects(client.request(method, { uri: "unity-context://Rules", _meta: { agentId: 123 } }), /agentId must be a string/);
    }
    assert.deepEqual(client.stdoutViolations, []);
  } finally {
    await client?.close();
    await Promise.all(bridges.map(bridge => bridge.stop()));
  }
});

test("resources never choose an arbitrary project before instance selection", async () => {
  const bridges = ["Alpha", "Beta"].map(projectName => new MockBridge({ instance: { projectName, projectPath: `C:/${projectName}` } }));
  let client;
  let contextReads = 0;
  try {
    await Promise.all(bridges.map(bridge => bridge.start()));
    for (const bridge of bridges) bridge.contextProvider = () => { contextReads++; return { enabled: true, categories: [{ category: "Rules" }], content: "private rules" }; };
    const env = bridges[0].env();
    writeFileSync(env.UNITY_INSTANCE_REGISTRY, JSON.stringify(bridges.map(bridge => ({ port: bridge.port }))));
    client = new McpTestClient({ env }).start();
    await client.initialize();
    assert.deepEqual(await client.request("resources/list"), { resources: [] });
    await assert.rejects(client.request("resources/read", { uri: "unity-context://Rules" }), /select.*instance|instance.*select/i);
    assert.equal(contextReads, 0);
  } finally {
    await client?.close();
    await Promise.all(bridges.map(bridge => bridge.stop()));
  }
});

test("first discovery preserves a selected instance outside the scan range", async () => {
  const bridges = ["Alpha", "Beta"].map(projectName => {
    const bridge = new MockBridge({ instance: { projectName, projectPath: `C:/${projectName}` } });
    bridge.on("editor/state", () => ({ projectName }));
    bridge.contextProvider = () => ({ enabled: true, content: `${projectName} rules` });
    return bridge;
  });
  let client;
  try {
    await Promise.all(bridges.map(bridge => bridge.start()));
    const env = bridges[0].env();
    writeFileSync(env.UNITY_INSTANCE_REGISTRY, JSON.stringify(bridges.map(bridge => ({ port: bridge.port }))));
    client = new McpTestClient({ env }).start();
    await client.initialize();
    const selected = await client.callTool("unity_select_instance", { port: bridges[1].port });
    assert.equal(selected.isError, false, selected.payloadText);
    assert.equal(selected.payload.instance.projectName, "Beta");
    writeFileSync(env.UNITY_INSTANCE_REGISTRY, "[]");
    const result = await client.callTool("unity_editor_state");
    assert.equal(result.payload.data.projectName, "Beta");
    assert.equal((await client.request("resources/read", { uri: "unity-context://Rules" })).contents[0].text, "Beta rules");
    assert.equal(bridges[0].seen.length, 0);
  } finally {
    await client?.close();
    await Promise.all(bridges.map(bridge => bridge.stop()));
  }
});

test("a vanished selection stays blocked across repeated tool and resource calls", async () => {
  const bridges = ["Alpha", "Beta"].map(projectName => new MockBridge({ instance: { projectName, projectPath: `C:/${projectName}` } }));
  let client;
  try {
    await Promise.all(bridges.map(bridge => bridge.start()));
    const env = bridges[0].env();
    writeFileSync(env.UNITY_INSTANCE_REGISTRY, JSON.stringify(bridges.map(bridge => ({ port: bridge.port }))));
    client = new McpTestClient({ env }).start();
    await client.initialize();
    assert.equal((await client.callTool("unity_select_instance", { port: bridges[1].port })).isError, false);
    await bridges[1].stop();
    writeFileSync(env.UNITY_INSTANCE_REGISTRY, JSON.stringify([{ port: bridges[0].port }]));
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await client.callTool("unity_editor_state");
      assert.equal(response.isError, true, response.payloadText);
      assert.deepEqual(await client.request("resources/list"), { resources: [] });
      await assert.rejects(client.request("resources/read", { uri: "unity-context://Rules" }), /select.*instance|instance.*select/i);
    }
    assert.equal(bridges[0].seen.length, 0);
    assert.equal((await client.callTool("unity_select_instance", { port: bridges[0].port })).isError, false);
    assert.equal((await client.callTool("unity_editor_state")).isError, false);
  } finally {
    await client?.close();
    await Promise.all(bridges.map(bridge => bridge.stop()));
  }
});

for (const warmSelection of [false, true]) {
  test(`live port reuse overrides stale registry identity (warm selection: ${warmSelection})`, async () => {
    const bridge = await new MockBridge({ instance: { projectName: "Original", projectPath: "C:/Original" } }).start();
    const env = bridge.env();
    writeFileSync(env.UNITY_INSTANCE_REGISTRY, JSON.stringify([{ port: bridge.port, projectName: "Original",
      projectPath: "C:/Original", lastSeen: new Date().toISOString() }]));
    const client = new McpTestClient({ env }).start();
    try {
      await client.initialize();
      assert.equal((await client.callTool("unity_select_instance", { port: bridge.port })).isError, false);
      if (warmSelection) assert.equal((await client.callTool("unity_editor_state")).isError, false);
      bridge.seen.length = 0;
      bridge.instance.projectName = "Replacement";
      bridge.instance.projectPath = "C:/Replacement";
      assert.equal((await client.callTool("unity_editor_state")).isError, true);
      assert.deepEqual(await client.request("resources/list"), { resources: [] });
      await assert.rejects(client.request("resources/read", { uri: "unity-context://Rules" }), /select.*instance|instance.*select/i);
      assert.equal(bridge.seen.length, 0, "a command reached the replacement project");
      assert.equal((await client.callTool("unity_select_instance", { port: bridge.port })).payload.instance.projectName, "Replacement");
      assert.equal((await client.callTool("unity_editor_state")).isError, false);
    } finally {
      await client.close();
      await bridge.stop();
    }
  });
}

test("overlapping calls keep their project, agent and context throughout polling", async () => {
  const bridges = ["Alpha", "Beta"].map((projectName, i) => {
    const bridge = new MockBridge({ processingDelayMs: 120 + i * 40,
      instance: { projectName, projectPath: `C:/${projectName}` } });
    bridge.on("editor/state", () => ({ projectName }));
    bridge.contextProvider = () => ({ enabled: true, categories: [
      { category: "Rules", content: `${projectName} project rules` },
    ] });
    return bridge;
  });
  let client;
  try {
    await Promise.all(bridges.map(b => b.start()));
    client = new McpTestClient({ env: bridges[0].env() }).start();
    await client.initialize();
    const responses = await Promise.all(bridges.map((b, i) => client.request("tools/call", {
      name: "unity_editor_state", arguments: { port: b.port }, _meta: { agentId: `worker-${i}` },
    })));
    for (let i = 0; i < bridges.length; i++) {
      const project = bridges[i].instance.projectName;
      assert.equal(payload(responses[i]).data.projectName, project);
      assert.match(responses[i].content.map(b => b.text).join("\n"), new RegExp(`${project} project rules`));
      assert.ok(bridges[i].seen.every(r => r.headers["x-agent-id"] === `worker-${i}`));
      assert.ok(bridges[i].polls.length > 1);
      assert.ok(bridges[i].polls.every(r => r.headers["x-agent-id"] === `worker-${i}`));
    }
    assert.deepEqual(client.stdoutViolations, []);
  } finally {
    await client?.close();
    await Promise.all(bridges.map(b => b.stop()));
  }
});

test("discovery reads the live identity once when a registry port was reused", async () => {
  const bridge = await new MockBridge({ instance: { projectName: "NewProject", projectPath: "C:/NewProject" } }).start();
  const env = bridge.env();
  writeFileSync(env.UNITY_INSTANCE_REGISTRY, JSON.stringify([
    { port: bridge.port, projectName: "OldProject", projectPath: "C:/OldProject" },
  ]));
  const client = new McpTestClient({ env }).start();
  try {
    await client.initialize();
    const result = await client.callTool("unity_list_instances");
    assert.match(result.payloadText, /NewProject/);
    assert.doesNotMatch(result.payloadText, /OldProject/);
    assert.equal(result.payload.instances[0].source, "registry");
    assert.equal(bridge.pingCount, 1);
  } finally {
    await client.close();
    await bridge.stop();
  }
});

test("invalid routing ports fail without contacting Unity", async () => {
  const bridge = await new MockBridge().start();
  const client = new McpTestClient({ env: bridge.env() }).start();
  try {
    await client.initialize();
    for (const port of [0, -1, 65536, 123.5, "7890"]) {
      const result = await client.callTool("unity_editor_state", { port });
      assert.equal(result.isError, true);
      assert.match(result.payloadText, /port must be an integer/);
    }
    assert.equal(bridge.seen.length, 0);
    assert.equal(bridge.pingCount, 0);
  } finally {
    await client.close();
    await bridge.stop();
  }
});

test("discovery accepts the UTF-8 marker written by Unity outside the scan range", async () => {
  const bridge = await new MockBridge({ instance: { projectName: "CustomPort", projectPath: "C:/CustomPort" } }).start();
  const env = bridge.env();
  env.UNITY_PORT_RANGE_START = "1";
  env.UNITY_PORT_RANGE_END = "0";
  writeFileSync(env.UNITY_INSTANCE_REGISTRY, "\uFEFF" + JSON.stringify([{ port: bridge.port }]));
  const client = new McpTestClient({ env }).start();
  try {
    await client.initialize();
    const result = await client.callTool("unity_list_instances");
    assert.equal(result.payload.totalCount, 1);
    assert.equal(result.payload.instances[0].source, "registry");
    assert.equal(result.payload.instances[0].projectName, "CustomPort");
  } finally {
    await client.close();
    await bridge.stop();
  }
});

for (const source of ["registry", "portscan"]) {
  test(`MPPM identity survives ${source} discovery without changing ParrelSync fields`, async () => {
    const instance = { projectName: "SharedGame", projectPath: "C:/SharedGame/Library/VP/mppm1234",
      isVirtualPlayer: true, mainProjectPath: "C:/SharedGame", virtualPlayerId: "mppm1234", isClone: false, cloneIndex: -1 };
    const bridge = await new MockBridge({ instance }).start();
    const env = bridge.env();
    writeFileSync(env.UNITY_INSTANCE_REGISTRY, JSON.stringify([{ port: bridge.port }]));
    if (source === "portscan") {
      writeFileSync(env.UNITY_INSTANCE_REGISTRY, "[]");
      env.UNITY_PORT_RANGE_START = String(bridge.port);
      env.UNITY_PORT_RANGE_END = String(bridge.port);
    }
    const client = new McpTestClient({ env }).start();
    try {
      await client.initialize();
      const result = await client.callTool("unity_list_instances");
      const discovered = result.payload.instances[0];
      assert.equal(discovered.source, source);
      for (const key of ["isVirtualPlayer", "mainProjectPath", "virtualPlayerId", "isClone", "cloneIndex"])
        assert.equal(discovered[key], instance[key], key);
      const selected = await client.callTool("unity_select_instance", { port: bridge.port });
      assert.equal(selected.payload.instance.virtualPlayerId, instance.virtualPlayerId);
    } finally {
      await client.close();
      await bridge.stop();
    }
  });
}

test("concurrent first calls wait for discovery and require a selection", async () => {
  const bridges = [await new MockBridge().start(), await new MockBridge().start()];
  const env = bridges[0].env();
  writeFileSync(env.UNITY_INSTANCE_REGISTRY, JSON.stringify(bridges.map(b => ({ port: b.port }))));
  const client = new McpTestClient({ env }).start();
  try {
    await client.initialize();
    const results = await Promise.all([
      client.callTool("unity_editor_state"), client.callTool("unity_editor_state"),
    ]);
    assert.ok(results.every(r => r.isError));
    assert.ok(results.every(r => /select|multiple/i.test(r.payloadText)));
    assert.equal(bridges.reduce((n, b) => n + b.seen.length, 0), 0);
  } finally {
    await client.close();
    await Promise.all(bridges.map(b => b.stop()));
  }
});

test("a legacy project does not disable the queue on another project", async () => {
  const legacy = new MockBridge({ mode: "legacy" });
  const modern = new MockBridge();
  let client;
  try {
    await Promise.all([legacy.start(), modern.start()]);
    client = new McpTestClient({ env: legacy.env() }).start();
    await client.initialize();
    await client.callTool("unity_editor_state", { port: legacy.port });
    await client.callTool("unity_editor_state", { port: modern.port });
    assert.equal(legacy.seen.find(r => r.route === "editor/state").via, "legacy");
    assert.equal(modern.seen.find(r => r.route === "editor/state").via, "queue");
  } finally {
    await client?.close();
    await Promise.all([legacy.stop(), modern.stop()]);
  }
});
