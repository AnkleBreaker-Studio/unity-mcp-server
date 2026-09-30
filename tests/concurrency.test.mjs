import { test } from "node:test";
import assert from "node:assert/strict";
import { MockBridge } from "./helpers/mock-bridge.mjs";
import { McpTestClient } from "./helpers/mcp-client.mjs";
import { writeFileSync } from "node:fs";

function payload(response) {
  assert.notEqual(response.isError, true, JSON.stringify(response));
  return JSON.parse(response.content.at(-1).text);
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
