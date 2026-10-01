import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { McpTestClient } from "./helpers/mcp-client.mjs";

const argument = process.env.UNITY_MCP_COMPATIBILITY;
const canonical = path => realpathSync(path).replaceAll("\\", "/").toLowerCase();

test("released and current servers/plugins interoperate in real editors", {
  skip: !argument && "set UNITY_MCP_COMPATIBILITY to the marked project and baseline server paths",
  timeout: 300_000,
}, async () => {
  const options = JSON.parse(argument);
  const projects = [
    { role: "baseline", path: options.baselineProject },
    { role: "current", path: options.currentProject },
  ];
  for (const project of projects) {
    assert.ok(isAbsolute(project.path), "project paths must be absolute");
    assert.ok(existsSync(join(project.path, ".unity-mcp-validation")), "refusing an unmarked project");
  }
  assert.notEqual(canonical(projects[0].path), canonical(projects[1].path));
  assert.ok(isAbsolute(options.baselineServerEntry) && existsSync(options.baselineServerEntry));
  const baselinePackage = JSON.parse(readFileSync(join(dirname(options.baselineServerEntry), "../package.json"), "utf8"));
  const evidence = { nodeVersion: process.version, baselineServerVersion: baselinePackage.version, combinations: [] };
  const reportPath = join(projects[1].path, "Library/UnityMcpVersionCompatibility.json");
  const runId = randomUUID().replaceAll("-", "");
  let baselineTools;

  async function raw(client, agentId, name, args = {}) {
    const response = await client.request("tools/call", { name, arguments: args, _meta: { agentId } });
    const text = response.content.filter(block => block.type === "text").at(-1).text;
    return { isError: response.isError === true, payload: JSON.parse(text) };
  }

  async function call(client, agentId, name, args = {}, expectedError = false) {
    const response = await raw(client, agentId, name, args);
    assert.equal(response.isError, expectedError, JSON.stringify(response));
    const value = response.payload.data ?? response.payload;
    if (!expectedError) assert.notEqual(value.success, false, JSON.stringify(response));
    return value;
  }

  async function select(client, agentId, project) {
    const discovery = await call(client, agentId, "unity_list_instances", { refresh: true });
    const instance = discovery.instances.find(item => canonical(item.projectPath) === canonical(project.path));
    assert.ok(instance, `missing editor ${project.path}`);
    const selection = await call(client, agentId, "unity_select_instance", { port: instance.port });
    assert.equal(canonical(selection.instance.projectPath), canonical(project.path));
    return instance;
  }

  async function code(client, agentId, port, source) {
    const result = await call(client, agentId, "unity_execute_code", { port, code: source });
    assert.equal(result.success, true, JSON.stringify(result));
    return result.result;
  }

  try {
    for (const serverRole of ["baseline", "current"]) {
      const client = new McpTestClient({
        serverEntry: serverRole === "baseline" ? options.baselineServerEntry : undefined,
        timeoutMs: 45_000,
      }).start();
      try {
        await client.initialize();
        const tools = (await client.listTools()).tools;
        const coreCount = tools.length;
        const catalogAgent = `compat-catalog-${runId}-${serverRole}`;
        const catalogInstance = await select(client, catalogAgent, projects[1]);
        const catalog = await call(client, catalogAgent, "unity_list_advanced_tools", { port: catalogInstance.port });
        for (const category of Object.keys(catalog.categories)) {
          tools.push(...await call(client, catalogAgent, "unity_list_advanced_tools", { port: catalogInstance.port, category, includeSchemas: true }));
        }
        if (serverRole === "baseline") baselineTools = tools;
        else {
          const current = new Map(tools.map(tool => [tool.name, tool]));
          for (const previous of baselineTools) {
            assert.ok(current.has(previous.name), `removed tool ${previous.name}`);
            const addedRequired = (current.get(previous.name).inputSchema?.required ?? [])
              .filter(name => !(previous.inputSchema?.required ?? []).includes(name));
            assert.deepEqual(addedRequired, [], `new required arguments for ${previous.name}`);
          }
          evidence.toolRegistry = { baselineCount: baselineTools.length, currentCount: tools.length, currentCoreCount: coreCount,
            namesPreserved: true, noNewRequiredArgumentsInPublishedSchemas: true };
        }
        for (const project of projects) {
          const agentId = `compat-${runId}-${serverRole}-${project.role}`;
          const instance = await select(client, agentId, project);
          const port = instance.port;
          const invoke = (name, args = {}, error = false) => call(client, agentId, name, { port, ...args }, error);
          const state = await invoke("unity_editor_state");
          assert.equal(canonical(state.projectPath), canonical(project.path));
          assert.equal(state.isPlaying, false);
          assert.equal(state.isCompiling, false);
          assert.equal(state.sceneDirty, false, "save the disposable scene before running compatibility tests");
          assert.ok(state.activeScenePath, "use a saved disposable scene");
          assert.equal((await invoke("unity_scene_info")).sceneCount, 1);
          const compilation = await invoke("unity_get_compilation_errors", { severity: "error" });
          assert.equal(compilation.isCompiling, false);
          assert.equal(compilation.count, 0, JSON.stringify(compilation));
          const queue = await invoke("unity_queue_info");
          assert.ok(project.role === "baseline" ? !queue.protocolVersion : queue.protocolVersion >= 3,
            "expected a pre-handshake baseline plugin and a protocol-3+ current plugin");
          const result = { server: serverRole, plugin: project.role, unityVersion: instance.unityVersion,
            pluginVersion: instance.pluginVersion, protocolVersion: queue.protocolVersion ?? null };
          evidence.combinations.push(result);
          const objectName = `__McpCompat_${runId}_${serverRole}_${project.role}`;
          try {
            const created = await invoke("unity_gameobject_create", { name: objectName, primitiveType: "Cube", position: { x: 1, y: 2, z: 3 } });
            assert.equal(typeof created.instanceId, "string");
            const info = await invoke("unity_gameobject_info", { instanceId: created.instanceId });
            assert.equal(info.name, objectName);
            assert.deepEqual(info.position, { x: 1, y: 2, z: 3 });
            await invoke("unity_gameobject_set_transform", { instanceId: created.instanceId, position: { x: 4, y: 5, z: 6 } });
            assert.deepEqual((await invoke("unity_gameobject_info", { path: objectName })).position, { x: 4, y: 5, z: 6 });
            await invoke("unity_undo_last", { agentId });
            assert.deepEqual((await invoke("unity_gameobject_info", { path: objectName })).position, { x: 1, y: 2, z: 3 });
            result.createReadTransformUndo = true;
            const execution = await code(client, agentId, port, `return new { number = 17, project = System.IO.Directory.GetParent(Application.dataPath).FullName };`);
            assert.equal(execution.number, 17);
            assert.equal(canonical(execution.project), canonical(project.path));
            result.executionResultPreserved = true;
            await invoke("unity_gameobject_delete", { instanceId: created.instanceId });
            const missing = await invoke("unity_gameobject_info", { path: objectName }, true);
            assert.equal(missing.error, "GameObject not found");
            result.deleteAndErrorContract = true;
            const agents = await invoke("unity_agents_list");
            const session = agents.find(item => item.agentId === agentId);
            assert.ok(session && session.completedRequests > 0);
            assert.equal(session.failedRequests ?? 0, 0);
            if (project.role === "current") assert.equal(session.commandErrors, 1);
            result.agentAttribution = true;
            result.commandErrors = session.commandErrors ?? null;
            const history = await invoke("unity_undo_history", { agentId, count: 30 });
            assert.ok(history.actions.some(item => item.action === "gameobject/create"));
            result.historyAvailable = true;
            result.passed = true;
          } finally {
            await invoke("unity_scene_open", { path: state.activeScenePath, discardUnsavedChanges: true });
            const restored = await invoke("unity_editor_state");
            assert.equal(restored.activeScenePath, state.activeScenePath);
            assert.equal(restored.sceneDirty, false);
            result.sceneRestored = true;
          }
          console.error(`[compatibility] ${serverRole} server + ${project.role} plugin passed`);
        }
        assert.deepEqual(client.stdoutViolations, []);
      } finally { await client.close(); }
    }

    const client = new McpTestClient({ timeoutMs: 60_000 }).start();
    const counterKey = `McpCompatibility.${runId}`;
    const agents = projects.flatMap(project => [0, 1].map(index => ({ project, id: `compat-mixed-${runId}-${project.role}-${index}` })));
    try {
      await client.initialize();
      for (const agent of agents) agent.instance = await select(client, agent.id, agent.project);
      const requests = Array.from({ length: 12 }, (_, index) => {
        const agent = agents[index % agents.length];
        return code(client, agent.id, undefined, `
          int count = UnityEditor.SessionState.GetInt("${counterKey}", 0) + 1;
          UnityEditor.SessionState.SetInt("${counterKey}", count);
          return new { count, project = System.IO.Directory.GetParent(Application.dataPath).FullName };`)
          .then(value => ({ agent, value }));
      });
      const settled = await Promise.allSettled(requests);
      const failure = settled.find(item => item.status === "rejected");
      if (failure) throw failure.reason;
      const responses = settled.map(item => item.value);
      for (const response of responses) assert.equal(canonical(response.value.project), canonical(response.agent.project.path));
      for (const project of projects) {
        const counts = responses.filter(item => item.agent.project === project).map(item => item.value.count).sort((a, b) => a - b);
        assert.deepEqual(counts, [1, 2, 3, 4, 5, 6]);
        const projectAgents = agents.filter(agent => agent.project === project);
        const sessions = await call(client, projectAgents[0].id, "unity_agents_list", { port: projectAgents[0].instance.port });
        for (const agent of projectAgents) {
          assert.equal(sessions.find(session => session.agentId === agent.id)?.completedRequests, 3);
        }
        assert.ok(agents.filter(agent => agent.project !== project).every(agent => !sessions.some(session => session.agentId === agent.id)));
      }
      assert.deepEqual(client.stdoutViolations, []);
      evidence.mixedConcurrency = { calls: 12, agents: 4, callsPerProject: 6, callsPerAgent: 3,
        explicitPorts: false, correctRouting: true, correctAgentAttribution: true, exactlyOnceCounts: true };
    } finally {
      try {
        for (const project of projects) {
          const agent = agents.find(item => item.project === project);
          if (!agent.instance) continue;
          await code(client, agent.id, agent.instance.port, `UnityEditor.SessionState.EraseInt("${counterKey}"); return true;`);
        }
      } finally { await client.close(); }
    }
    evidence.passed = true;
  } catch (error) {
    evidence.error = error.message;
    evidence.passed = false;
    throw error;
  } finally {
    writeFileSync(reportPath, JSON.stringify(evidence, null, 2) + "\n");
  }
});
