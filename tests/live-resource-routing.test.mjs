import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { McpTestClient } from "./helpers/mcp-client.mjs";

const argument = process.env.UNITY_MCP_EDITOR_PROJECTS;
const canonical = path => realpathSync(path).replaceAll("\\", "/").toLowerCase();

test("live project resources follow agent selection and restore context settings", {
  skip: !argument && "set UNITY_MCP_EDITOR_PROJECTS to two open marked project paths",
  timeout: 120_000,
}, async () => {
  const paths = JSON.parse(argument);
  assert.equal(paths.length, 2);
  for (const path of paths) {
    assert.ok(isAbsolute(path));
    assert.ok(existsSync(join(path, ".unity-mcp-validation")), "refusing an unmarked project");
  }
  assert.notEqual(canonical(paths[0]), canonical(paths[1]));
  const runId = randomUUID().replaceAll("-", "");
  const projects = paths.map((path, index) => ({ path, agentId: `resources-${runId}-${index}`, content: `Project ${index}: ${runId}` }));
  const client = new McpTestClient({ timeoutMs: 30_000 }).start();
  const evidence = { nodeVersion: process.version, projects: [], passed: false };
  const uri = "unity-context://Rules";

  async function call(project, name, args = {}) {
    const response = await client.request("tools/call", { name, arguments: { port: project.port, ...args }, _meta: { agentId: project.agentId } });
    assert.notEqual(response.isError, true, JSON.stringify(response));
    const payload = JSON.parse(response.content.filter(block => block.type === "text").at(-1).text);
    return payload.data ?? payload;
  }
  async function code(project, source) {
    const result = await call(project, "unity_execute_code", { code: source });
    assert.equal(result.success, true, JSON.stringify(result));
    return result.result;
  }

  try {
    await client.initialize();
    for (const project of projects) {
      const discovered = await call(project, "unity_list_instances", { refresh: true });
      const instance = discovered.instances.find(item => canonical(item.projectPath) === canonical(project.path));
      assert.ok(instance);
      project.port = instance.port;
      const selected = await call(project, "unity_select_instance", { port: project.port });
      assert.equal(canonical(selected.instance.projectPath), canonical(project.path));
      const state = await call(project, "unity_editor_state");
      assert.equal(state.isCompiling, false);
      assert.equal(state.isPlaying, false);
      project.original = await code(project, "return new { enabled = UnityMCP.Editor.MCPSettingsManager.ContextEnabled, path = UnityMCP.Editor.MCPSettingsManager.ContextPath };");
      project.relative = `Library/McpResourceValidation${runId}`;
      project.folder = resolve(project.path, project.relative);
      assert.ok(project.folder.startsWith(resolve(project.path) + "/") || project.folder.startsWith(resolve(project.path) + "\\"));
      assert.equal(existsSync(project.folder), false);
      mkdirSync(project.folder);
      project.owned = true;
      assert.ok(canonical(project.folder).startsWith(canonical(project.path) + "/library/"));
      writeFileSync(join(project.folder, "Rules.md"), project.content);
      await code(project, `UnityMCP.Editor.MCPSettingsManager.ContextPath = ${JSON.stringify(project.relative)}; UnityMCP.Editor.MCPSettingsManager.ContextEnabled = true; return true;`);
      evidence.projects.push({ unityVersion: instance.unityVersion, pluginVersion: instance.pluginVersion });
    }
    const lists = await Promise.all(projects.map(project => client.request("resources/list", { _meta: { agentId: project.agentId } })));
    for (const list of lists) assert.ok(list.resources.some(resource => resource.uri === uri));
    const reads = await Promise.all(projects.map(project => client.request("resources/read", { uri, _meta: { agentId: project.agentId } })));
    for (let index = 0; index < projects.length; index++) assert.equal(reads[index].contents[0].text, projects[index].content);
    const override = await client.request("resources/read", { uri, _meta: { agentId: projects[0].agentId, port: projects[1].port } });
    assert.equal(override.contents[0].text, projects[1].content);
    const retained = await client.request("resources/read", { uri, _meta: { agentId: projects[0].agentId } });
    assert.equal(retained.contents[0].text, projects[0].content);
    assert.equal((await client.callTool("unity_select_instance", { port: projects[1].port })).isError, false);
    assert.equal((await client.request("resources/read", { uri })).contents[0].text, projects[1].content);
    assert.deepEqual(client.stdoutViolations, []);
    Object.assign(evidence, { concurrentLists: true, concurrentReads: true, explicitPortOverride: true, selectionRetained: true, defaultClientSelection: true, legacyUriPreserved: true, passed: true });
  } catch (error) {
    evidence.error = error.message;
    throw error;
  } finally {
    const cleanupErrors = [];
    for (const project of projects) {
      try {
        if (project.original) {
          const restored = await code(project, `UnityMCP.Editor.MCPSettingsManager.ContextPath = ${JSON.stringify(project.original.path)};
            UnityMCP.Editor.MCPSettingsManager.ContextEnabled = ${project.original.enabled};
            return new { enabled = UnityMCP.Editor.MCPSettingsManager.ContextEnabled, path = UnityMCP.Editor.MCPSettingsManager.ContextPath };`);
          assert.deepEqual(restored, project.original);
        }
        if (project.owned) {
          assert.ok(canonical(project.folder).startsWith(canonical(project.path) + "/library/"));
          rmSync(project.folder, { recursive: true });
        }
      } catch (error) { cleanupErrors.push(error.message); }
    }
    evidence.restored = cleanupErrors.length === 0;
    if (cleanupErrors.length) { evidence.cleanupErrors = cleanupErrors; evidence.passed = false; }
    writeFileSync(join(paths[0], "Library/UnityMcpResourceRouting.json"), JSON.stringify(evidence, null, 2) + "\n");
    await client.close();
    assert.deepEqual(cleanupErrors, []);
  }
});
