import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { McpTestClient } from "./helpers/mcp-client.mjs";

const configured = process.env.UNITY_MCP_DISCOVERY_PROJECTS;
const canonical = path => realpathSync(path).replaceAll("\\", "/").toLowerCase();
const payload = response => {
  assert.notEqual(response.isError, true, JSON.stringify(response));
  return JSON.parse(response.content.filter(block => block.type === "text").at(-1).text);
};

test("live discovery and repeated selection work across current and released plugins", {
  skip: !configured && "set UNITY_MCP_DISCOVERY_PROJECTS to marked open projects using current/released plugins",
  timeout: 90_000,
}, async () => {
  const projects = JSON.parse(configured);
  assert.ok(Array.isArray(projects) && projects.length >= 2);
  for (const path of projects) {
    assert.ok(isAbsolute(path));
    assert.ok(existsSync(join(path, ".unity-mcp-validation")));
  }
  const client = new McpTestClient({ timeoutMs: 30_000 }).start();
  const report = { nodeVersion: process.version, passed: false, projects: [] };
  const runId = randomUUID();
  const call = (name, args, agentId) => client.request("tools/call", { name, arguments: args, _meta: { agentId } });
  try {
    await client.initialize();
    const discovered = payload(await call("unity_list_instances", { refresh: true }, `discovery-list-${runId}`));
    const targets = projects.map((path, i) => {
      const instance = discovered.instances.find(item => item.projectPath && canonical(item.projectPath) === canonical(path));
      assert.ok(instance, `Missing validation editor: ${path}`);
      return { path, instance, agentId: `discovery-${runId}-${i}` };
    });
    for (const target of targets) {
      const selected = payload(await call("unity_select_instance", { port: target.instance.port }, target.agentId));
      assert.equal(canonical(selected.instance.projectPath), canonical(target.path));
      const ping = payload(await call("unity_editor_ping", { port: target.instance.port }, target.agentId));
      assert.equal(ping.connected, true);
      assert.equal(canonical(ping.projectPath), canonical(target.path));
      target.ping = ping;
    }
    assert.ok(targets.some(target => target.ping.protocolVersion >= 3), "Include a current plugin editor");
    assert.ok(targets.some(target => target.ping.protocolVersion === 1), "Include the released plugin editor");
    for (let round = 0; round < 2; round++) {
      await Promise.all(targets.map(async target => {
        const state = payload(await call("unity_editor_state", {}, target.agentId)).data;
        assert.equal(canonical(state.projectPath), canonical(target.path));
        assert.equal(state.isPlaying, false);
        assert.equal(state.isCompiling, false);
        assert.equal(state.sceneDirty, false);
      }));
    }
    for (const target of targets) {
      const compilation = payload(await call("unity_get_compilation_errors", { port: target.instance.port, severity: "error" }, target.agentId)).data;
      assert.equal(compilation.isCompiling, false);
      assert.equal(compilation.count, 0);
      report.projects.push({ projectPath: target.path, port: target.instance.port, unityVersion: target.ping.unityVersion,
        pluginVersion: target.ping.pluginVersion, protocolVersion: target.ping.protocolVersion,
        pingRecognized: true, repeatedImplicitReads: 2, compilationErrors: compilation.count, sceneDirty: false });
    }
    assert.deepEqual(client.stdoutViolations, []);
    report.passed = true;
  } finally {
    await client.close();
    writeFileSync(join(projects[0], "Library", "UnityMcpDiscoveryIdentity.json"), JSON.stringify(report, null, 2) + "\n");
  }
});
