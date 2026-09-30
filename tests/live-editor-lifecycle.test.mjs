import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { McpTestClient } from "./helpers/mcp-client.mjs";

const projectArguments = process.env.UNITY_MCP_EDITOR_PROJECTS;
const canonicalPath = path => realpathSync(path).replaceAll("\\", "/").toLowerCase();

test("two live editors, Play Mode options and lost results across reload", {
  skip: !projectArguments && "set UNITY_MCP_EDITOR_PROJECTS to a JSON array of two open disposable project paths",
  timeout: 600_000,
}, async () => {
  const paths = JSON.parse(projectArguments).map(path => resolve(path));
  assert.equal(paths.length, 2);
  assert.notEqual(canonicalPath(paths[0]), canonicalPath(paths[1]));
  for (const path of paths) assert.ok(existsSync(join(path, ".unity-mcp-validation")), `refusing unmarked project ${path}`);
  const runId = randomUUID().replaceAll("-", "");
  const projects = paths.map((path, i) => ({ path, name: basename(path), agentId: `lifecycle-${runId}-${i}` }));
  const client = new McpTestClient({ timeoutMs: 40_000 }).start();
  const evidence = { nodeVersion: process.version, projects: [], concurrency: {}, transitions: [] };
  let originalOptions;
  let reloadClient;

  async function raw(project, name, args = {}, instance = client) {
    const response = await instance.request("tools/call", { name, arguments: args, _meta: { agentId: project.agentId } });
    const text = response.content.filter(block => block.type === "text").at(-1).text;
    return { payload: JSON.parse(text), isError: response.isError === true };
  }

  async function call(project, name, args = {}) {
    const response = await raw(project, name, { port: project.port, ...args });
    assert.equal(response.isError, false, JSON.stringify(response));
    assert.equal(response.payload.success, true, JSON.stringify(response));
    return response.payload.data;
  }

  async function select(project, instance = client) {
    const response = await raw(project, "unity_select_instance", { projectName: project.name }, instance);
    assert.equal(response.isError, false, JSON.stringify(response));
    assert.equal(canonicalPath(response.payload.instance.projectPath), canonicalPath(project.path));
    project.port = response.payload.instance.port;
    project.unityVersion = response.payload.instance.unityVersion;
  }

  async function code(project, source) {
    const response = await call(project, "unity_execute_code", { code: source });
    assert.equal(response.success, true, JSON.stringify(response));
    return response.result;
  }

  async function ready(project, playing) {
    const deadline = Date.now() + 120_000;
    let lastError;
    while (Date.now() < deadline) {
      try {
        await select(project);
        const state = await call(project, "unity_editor_state");
        assert.equal(canonicalPath(state.projectPath), canonicalPath(project.path));
        if (!state.isCompiling && state.isPlaying === playing) {
          const compilation = await call(project, "unity_get_compilation_errors", { severity: "error" });
          assert.equal(compilation.count, 0, JSON.stringify(compilation));
          if (!compilation.isCompiling) return state;
        }
      } catch (error) { lastError = error; }
      await delay(1000);
    }
    throw new Error(`Editor ${project.name} did not reach isPlaying=${playing}: ${lastError?.message || "state mismatch"}`);
  }

  const target = projects[0];
  const other = projects[1];
  try {
    await client.initialize();
    for (const project of projects) {
      await select(project);
      const state = await ready(project, false);
      assert.equal(state.sceneDirty, false, "save the disposable scene before lifecycle testing");
      evidence.projects.push({ name: project.name, unityVersion: project.unityVersion, initialPort: project.port });
    }
    const counterKey = `UnityMcpValidation.Concurrent.${runId}`;
    const requests = Array.from({ length: 24 }, (_, index) => {
      const project = projects[index % 2];
      return raw(project, "unity_execute_code", { code: `
        var count = UnityEditor.SessionState.GetInt("${counterKey}", 0) + 1;
        UnityEditor.SessionState.SetInt("${counterKey}", count);
        return new { projectPath = System.IO.Directory.GetParent(UnityEngine.Application.dataPath).FullName, count };
      ` });
    });
    const responses = await Promise.all(requests);
    for (let index = 0; index < responses.length; index++) {
      assert.equal(responses[index].isError, false, JSON.stringify(responses[index]));
      assert.equal(canonicalPath(responses[index].payload.data.result.projectPath), canonicalPath(projects[index % 2].path));
    }
    for (let i = 0; i < projects.length; i++) {
      const counts = responses.filter((_, index) => index % 2 === i).map(response => response.payload.data.result.count).sort((a, b) => a - b);
      assert.deepEqual(counts, Array.from({ length: 12 }, (_, index) => index + 1));
    }
    evidence.concurrency = { calls: 24, perProject: 12, routedBy: "per-agent selection, no explicit ports", correctProjects: true, countsExactlyOnce: true };
    console.error("[lifecycle] 24 overlapping commands reached their selected projects exactly once");
    originalOptions = await code(target, `return new {
      enabled = UnityEditor.EditorSettings.enterPlayModeOptionsEnabled,
      options = (int)UnityEditor.EditorSettings.enterPlayModeOptions };`);
    const unfocused = await code(target, `
      var views = UnityEngine.Resources.FindObjectsOfTypeAll<UnityEditor.EditorWindow>().Where(w => w.GetType().Name == "GameView");
      return views.All(w => w.GetType().GetProperty("enterPlayModeBehavior", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic).GetValue(w).ToString() == "PlayUnfocused");
    `);
    assert.equal(unfocused, true, "set the validation Game view to Play Unfocused first");
    const otherSession = (await call(other, "unity_queue_info")).queueSessionId;
    const modes = [
      { name: "default", enabled: false, options: "None", domainReload: true },
      { name: "scene-only", enabled: true, options: "DisableDomainReload", domainReload: false },
      { name: "no-reload", enabled: true, options: "DisableDomainReload | UnityEditor.EnterPlayModeOptions.DisableSceneReload", domainReload: false },
      { name: "domain-only", enabled: true, options: "DisableSceneReload", domainReload: true },
    ];
    for (const mode of modes) {
      console.error(`[lifecycle] ${mode.name}`);
      await code(target, `UnityEditor.EditorSettings.enterPlayModeOptionsEnabled = ${mode.enabled};
        UnityEditor.EditorSettings.enterPlayModeOptions = UnityEditor.EnterPlayModeOptions.${mode.options}; return true;`);
      const before = (await call(target, "unity_queue_info")).queueSessionId;
      const transition = { mode: mode.name, domainReload: mode.domainReload, before };
      evidence.transitions.push(transition);
      transition.playResponse = await raw(target, "unity_play_mode", { port: target.port, action: "play" });
      assert.equal(transition.playResponse.isError, false, JSON.stringify(transition.playResponse));
      await delay(2000);
      await ready(target, true);
      transition.during = (await call(target, "unity_queue_info")).queueSessionId;
      assert.equal(transition.during !== before, mode.domainReload);
      const unaffected = await call(other, "unity_editor_state");
      assert.equal(unaffected.isPlaying, false);
      assert.equal((await call(other, "unity_queue_info")).queueSessionId, otherSession);
      transition.otherProjectUnaffected = true;
      transition.stopResponse = await raw(target, "unity_play_mode", { port: target.port, action: "stop" });
      assert.equal(transition.stopResponse.isError, false, JSON.stringify(transition.stopResponse));
      await delay(2000);
      await ready(target, false);
      transition.after = (await call(target, "unity_queue_info")).queueSessionId;
      if (!mode.domainReload) assert.equal(transition.after, before);
    }

    reloadClient = new McpTestClient({ env: { UNITY_QUEUE_POLL_INTERVAL: "1000", UNITY_QUEUE_POLL_MAX: "1000" }, timeoutMs: 40_000 }).start();
    await reloadClient.initialize();
    await select(target, reloadClient);
    const beforeReload = (await call(target, "unity_queue_info")).queueSessionId;
    const reloadKey = `UnityMcpValidation.Reload.${runId}`;
    const reloadResponse = await raw(target, "unity_execute_code", { port: target.port, code: `
      UnityEditor.SessionState.SetInt("${reloadKey}", UnityEditor.SessionState.GetInt("${reloadKey}", 0) + 1);
      UnityEditor.EditorUtility.RequestScriptReload(); return true;
    ` }, reloadClient);
    evidence.reload = { before: beforeReload, response: reloadResponse };
    await ready(target, false);
    evidence.reload.after = (await call(target, "unity_queue_info")).queueSessionId;
    evidence.reload.executionCount = await code(target, `return UnityEditor.SessionState.GetInt("${reloadKey}", 0);`);
    assert.notEqual(evidence.reload.after, beforeReload);
    assert.equal(evidence.reload.executionCount, 1);
    assert.equal(reloadResponse.isError, true, "expected reload to evict the result before the delayed poll");
    assert.equal(reloadResponse.payload.outcomeUnknown, true);
    assert.equal(reloadResponse.payload.queueSessionId, beforeReload);
    assert.deepEqual(client.stdoutViolations, []);
    assert.deepEqual(reloadClient.stdoutViolations, []);
    evidence.passed = true;
  } catch (error) {
    evidence.error = error.message;
    throw error;
  } finally {
    try {
      if (originalOptions) {
        await select(target);
        if ((await call(target, "unity_editor_state")).isPlaying) {
          await raw(target, "unity_play_mode", { port: target.port, action: "stop" });
          await ready(target, false);
        }
        evidence.restoredOptions = await code(target, `
          UnityEditor.EditorSettings.enterPlayModeOptionsEnabled = ${originalOptions.enabled};
          UnityEditor.EditorSettings.enterPlayModeOptions = (UnityEditor.EnterPlayModeOptions)${originalOptions.options};
          return new { enabled = UnityEditor.EditorSettings.enterPlayModeOptionsEnabled, options = (int)UnityEditor.EditorSettings.enterPlayModeOptions };
        `);
        assert.deepEqual(evidence.restoredOptions, originalOptions);
      }
    } finally {
      writeFileSync(join(target.path, "Library", "UnityMcpEditorLifecycle.json"), JSON.stringify(evidence, null, 2) + "\n");
      await reloadClient?.close();
      await client.close();
    }
  }
});
