import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { McpTestClient } from "./helpers/mcp-client.mjs";

const configured = process.env.UNITY_MCP_SELECTION_PROJECTS;
const canonical = path => realpathSync(path).replaceAll("\\", "/").toLowerCase();
const payload = response => {
  assert.notEqual(response.isError, true, JSON.stringify(response));
  return JSON.parse(response.content.filter(block => block.type === "text").at(-1).text);
};

test("live named selection and overlapping choices preserve each agent's intended editor", {
  skip: !configured && "set UNITY_MCP_SELECTION_PROJECTS to two marked open validation projects",
  timeout: 90_000,
}, async () => {
  const projects = JSON.parse(configured);
  assert.ok(Array.isArray(projects) && projects.length === 2);
  for (const path of projects) {
    assert.ok(isAbsolute(path));
    assert.ok(existsSync(join(path, ".unity-mcp-validation")));
  }
  const client = new McpTestClient({ timeoutMs: 30_000 }).start();
  const report = { nodeVersion: process.version, passed: false, projects: [], checks: [] };
  const runId = randomUUID(), switchingAgent = `selection-switch-${runId}`;
  const call = (name, args, agentId) => client.request("tools/call", { name, arguments: args, _meta: { agentId } });
  const state = async (target, agentId, explicit = false) => {
    const result = payload(await call("unity_editor_state", explicit ? { port: target.instance.port } : {}, agentId)).data;
    assert.equal(canonical(result.projectPath), canonical(target.path));
    assert.equal(result.isPlaying, false); assert.equal(result.isCompiling, false); assert.equal(result.sceneDirty, false);
    return result;
  };
  try {
    await client.initialize();
    const discovered = payload(await call("unity_list_instances", { refresh: true }, `selection-list-${runId}`));
    const targets = projects.map((path, index) => {
      const instance = discovered.instances.find(item => item.projectPath && canonical(item.projectPath) === canonical(path));
      assert.ok(instance, `Missing validation editor: ${path}`);
      assert.equal(discovered.instances.filter(item => item.projectName.toLowerCase() === instance.projectName.toLowerCase()).length, 1);
      return { path, instance, agentId: `selection-owner-${runId}-${index}` };
    });
    for (const target of targets) {
      const selected = payload(await call("unity_select_instance", { projectName: target.instance.projectName }, target.agentId));
      assert.equal(canonical(selected.instance.projectPath), canonical(target.path));
      await state(target, target.agentId);
      const ping = payload(await call("unity_editor_ping", { port: target.instance.port }, target.agentId));
      assert.equal(ping.connected, true); assert.equal(canonical(ping.projectPath), canonical(target.path));
      report.projects.push({ projectPath: target.path, port: target.instance.port, pluginVersion: target.instance.pluginVersion,
        unityVersion: target.instance.unityVersion, protocolVersion: ping.protocolVersion });
    }
    report.checks.push({ name: "Names select the expected canonical paths and implicit reads remain clean", passed: true });
    let superseded = 0;
    for (let round = 0; round < 6; round++) {
      const older = targets[round % 2], newer = targets[(round + 1) % 2];
      const responses = await Promise.all([
        call("unity_select_instance", { projectName: older.instance.projectName }, switchingAgent),
        call("unity_select_instance", { port: newer.instance.port }, switchingAgent),
        ...targets.map(target => state(target, target.agentId)),
      ]);
      assert.equal(canonical(payload(responses[1]).instance.projectPath), canonical(newer.path));
      if (responses[0].isError) {
        assert.match(responses[0].content.at(-1).text, /selection.*(changed|superseded)/i); superseded++;
      } else assert.equal(canonical(payload(responses[0]).instance.projectPath), canonical(older.path));
      await state(newer, switchingAgent);
    }
    report.checks.push({ name: "Six overlapping choices retain the newer target and independent agent selections", passed: true, superseded });
    for (const target of targets) {
      await state(target, target.agentId, true);
      const compilation = payload(await call("unity_get_compilation_errors", { port: target.instance.port, severity: "error" }, target.agentId)).data;
      assert.equal(compilation.isCompiling, false); assert.equal(compilation.count, 0);
    }
    report.checks.push({ name: "Final explicit reads and compilation checks preserve both editors", passed: true });
    assert.deepEqual(client.stdoutViolations, []);
    report.passed = true;
  } finally {
    await client.close();
    writeFileSync(join(projects[0], "Library", "UnityMcpSelectionConcurrency.json"), JSON.stringify(report, null, 2) + "\n");
  }
});
