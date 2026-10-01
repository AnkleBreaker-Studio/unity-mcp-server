import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { McpTestClient } from "./helpers/mcp-client.mjs";

const configured = process.env.UNITY_MCP_AGENT_STATE_PROJECTS;
const canonical = path => realpathSync(path).replaceAll("\\", "/").toLowerCase();
const payload = response => {
  assert.notEqual(response.isError, true, JSON.stringify(response));
  return JSON.parse(response.content.filter(block => block.type === "text").at(-1).text);
};

test("live bounded agent state preserves two plugin versions and explicit routing after eviction", {
  skip: !configured && "set UNITY_MCP_AGENT_STATE_PROJECTS to two marked open validation projects", timeout: 90_000,
}, async () => {
  const projects = JSON.parse(configured);
  assert.ok(Array.isArray(projects) && projects.length === 2);
  for (const path of projects) {
    assert.ok(isAbsolute(path)); assert.ok(existsSync(join(path, ".unity-mcp-validation")));
  }
  const client = new McpTestClient({ env: { UNITY_MCP_AGENT_STATE_LIMIT: "2" }, timeoutMs: 30_000 }).start();
  const report = { nodeVersion: process.version, passed: false, projects: [], checks: [] };
  const runId = randomUUID();
  const call = (agentId, name, args = {}) => client.request("tools/call", { name, arguments: args, _meta: { agentId } });
  const state = async (target, explicit = false) => {
    const result = payload(await call(target.agentId, "unity_editor_state", explicit ? { port: target.instance.port } : {})).data;
    assert.equal(canonical(result.projectPath), canonical(target.path));
    assert.equal(result.isPlaying, false); assert.equal(result.isCompiling, false); assert.equal(result.sceneDirty, false);
    return result;
  };
  try {
    await client.initialize();
    const discovered = payload(await call(`catalog-${runId}`, "unity_list_instances", { refresh: true }));
    const targets = projects.map((path, index) => {
      const instance = discovered.instances.find(item => item.projectPath && canonical(item.projectPath) === canonical(path));
      assert.ok(instance, `Missing validation editor: ${path}`);
      return { path, instance, agentId: `retention-${runId}-${index}` };
    });
    const select = async target => {
      const result = payload(await call(target.agentId, "unity_select_instance", { port: target.instance.port }));
      assert.equal(canonical(result.instance.projectPath), canonical(target.path));
    };
    for (const target of targets) {
      await select(target); await state(target);
      report.projects.push({ projectPath: target.path, port: target.instance.port, pluginVersion: target.instance.pluginVersion, unityVersion: target.instance.unityVersion });
    }
    report.checks.push({ name: "Both plugin versions select and report the expected clean project", passed: true });
    payload(await call(`pressure-${runId}`, "unity_select_instance", { port: targets[1].instance.port }));
    const forgotten = await call(targets[0].agentId, "unity_editor_state");
    assert.equal(forgotten.isError, true); assert.match(forgotten.content.at(-1).text, /Select a Unity instance/);
    const unknown = await call(`unknown-${runId}`, "unity_editor_state");
    assert.equal(unknown.isError, true); assert.match(unknown.content.at(-1).text, /Select a Unity instance/);
    report.checks.push({ name: "Evicted and unknown agents require explicit selection after pressure", passed: true });
    await state(targets[0], true);
    for (const target of targets) await select(target);
    report.checks.push({ name: "Explicit port and reselection restore the intended project", passed: true });
    await Promise.all(Array.from({ length: 12 }, (_, index) => state(targets[index % 2])));
    report.checks.push({ name: "Twelve overlapping reads retain both targets at the two-agent capacity", passed: true });
    for (const target of targets) {
      const info = payload(await call(target.agentId, "unity_queue_info"));
      assert.equal(info.serverAgentState.agents, 2); assert.equal(info.serverAgentState.limit, 2);
      assert.equal(info.serverAgentState.activeAgents, 1); assert.equal(info.serverAgentState.activeLeases, 1);
      assert.equal(info.serverAgentState.pendingSelections, 0); assert.equal(info.serverAgentState.capacityRefusals, 0);
      assert.ok(info.serverAgentState.evictions >= 3);
      report.projects.find(item => item.projectPath === target.path).serverAgentState = info.serverAgentState;
      const compilation = payload(await call(target.agentId, "unity_get_compilation_errors", { severity: "error" })).data;
      assert.equal(compilation.isCompiling, false); assert.equal(compilation.count, 0);
      await state(target);
    }
    report.checks.push({ name: "Bounded telemetry, released request leases and clean final editor states", passed: true });
    assert.deepEqual(client.stdoutViolations, []);
    report.passed = true;
  } finally {
    await client.close();
    writeFileSync(join(projects[0], "Library", "UnityMcpAgentState.json"), JSON.stringify(report, null, 2) + "\n");
  }
});
