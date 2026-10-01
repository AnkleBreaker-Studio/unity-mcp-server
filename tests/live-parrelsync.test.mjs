import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { McpTestClient } from "./helpers/mcp-client.mjs";

const project = process.env.UNITY_MCP_PARRELSYNC_PROJECT;
const editor = process.env.UNITY_MCP_EDITOR_PATH;
const canonical = path => realpathSync(path).replaceAll("\\", "/").toLowerCase();

test("native ParrelSync identity, settings, concurrent agents, play, reload and clone restart", {
  skip: !project && "set UNITY_MCP_PARRELSYNC_PROJECT and UNITY_MCP_EDITOR_PATH for marked disposable editors", timeout: 600_000,
}, async () => {
  assert.ok(isAbsolute(project) && existsSync(join(project, ".unity-mcp-validation")));
  assert.ok(editor && isAbsolute(editor) && existsSync(editor));
  const id = randomUUID().replaceAll("-", ""), script = `Assets/Editor/ParrelReload${id}.cs`;
  const main = { path: project, agentId: `parrel-main-${id}` }, clone = { path: project + "_clone_0", agentId: `parrel-clone-${id}` };
  assert.ok(existsSync(join(clone.path, ".clone")) && existsSync(join(clone.path, ".unity-mcp-validation")));
  const client = new McpTestClient({ timeoutMs: 40_000 }).start();
  const report = { nodeVersion: process.version, passed: false, checks: {}, project, clonePath: clone.path };
  let original, scriptCreated = false;
  async function raw(target, name, args = {}) {
    const response = await client.request("tools/call", { name, arguments: args, _meta: { agentId: target.agentId } });
    return { isError: response.isError === true, payload: JSON.parse(response.content.filter(x => x.type === "text").at(-1).text) };
  }
  async function call(target, name, args = {}) {
    const response = await raw(target, name, { port: target.port, ...args });
    assert.equal(response.isError, false, JSON.stringify(response)); assert.notEqual(response.payload.success, false, JSON.stringify(response));
    return response.payload.data ?? response.payload;
  }
  const guard = target => `if (!System.IO.Directory.GetParent(UnityEngine.Application.dataPath).FullName.Replace(System.IO.Path.DirectorySeparatorChar, '/').Equals(${JSON.stringify(target.path.replaceAll("\\", "/"))}, System.StringComparison.OrdinalIgnoreCase) || !System.IO.File.Exists(${JSON.stringify(join(target.path, ".unity-mcp-validation").replaceAll("\\", "/"))})) throw new System.Exception("Unexpected validation project");\n`;
  async function code(target, source) {
    const result = await call(target, "unity_execute_code", { code: guard(target) + source });
    assert.equal(result.success, true, JSON.stringify(result)); return result.result;
  }
  async function transition(target, source) {
    const result = await raw(target, "unity_execute_code", { port: target.port, code: guard(target) + source });
    assert.ok(!result.isError || result.payload.outcomeUnknown === true, JSON.stringify(result));
    if (!result.isError) assert.notEqual(result.payload.data?.success, false, JSON.stringify(result));
  }
  async function select(target) {
    const found = (await raw(target, "unity_list_instances", { refresh: true })).payload.instances;
    const instance = found.find(x => x.projectPath && canonical(x.projectPath) === canonical(target.path));
    assert.ok(instance, `Instance absent: ${target.path}`); target.port = instance.port;
    await call(target, "unity_select_instance"); return instance;
  }
  async function until(label, action, timeout = 120_000) {
    const deadline = Date.now() + timeout; let failure;
    while (Date.now() < deadline) {
      try { const value = await action(); if (value) return value; } catch (error) { failure = error; }
      await delay(1000);
    }
    throw new Error(`${label}: ${failure?.message || "state did not converge"}`);
  }
  async function ready(target, playing = false, oldSession) {
    return until(`Ready ${target.path}`, async () => {
      const instance = await select(target), state = await call(target, "unity_editor_state");
      if (state.isCompiling || state.isPlaying !== playing) return false;
      const compilation = await call(target, "unity_get_compilation_errors", { severity: "error" });
      assert.equal(compilation.count, 0, JSON.stringify(compilation)); if (compilation.isCompiling) return false;
      const session = (await call(target, "unity_queue_info")).queueSessionId;
      return (!oldSession || session !== oldSession) && { instance, state, session };
    });
  }
  async function overlap(label) {
    await select(main); await select(clone);
    const key = `ParrelMcp.${id}.${label}`;
    const replies = await Promise.all(Array.from({ length: 12 }, (_, i) => {
      const target = i % 2 ? clone : main;
      return raw(target, "unity_execute_code", { code: guard(target) + `int count = UnityEditor.SessionState.GetInt("${key}", 0) + 1; UnityEditor.SessionState.SetInt("${key}", count); return new { count, nativeClone = ParrelSync.ClonesManager.IsClone(), path = System.IO.Directory.GetParent(UnityEngine.Application.dataPath).FullName, pid = System.Diagnostics.Process.GetCurrentProcess().Id };` });
    }));
    for (let i = 0; i < replies.length; i++) {
      assert.equal(replies[i].isError, false, JSON.stringify(replies[i]));
      const value = replies[i].payload.data.result;
      assert.equal(canonical(value.path), canonical(i % 2 ? clone.path : main.path)); assert.equal(value.nativeClone, i % 2 === 1);
    }
    for (let i = 0; i < 2; i++) assert.deepEqual(replies.filter((_, n) => n % 2 === i).map(x => x.payload.data.result.count).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
    assert.equal(new Set(replies.map(x => x.payload.data.result.pid)).size, 2);
    report.checks[label] = { overlappingCalls: 12, perEditor: 6, implicitAgentRouting: true, exactCounts: true };
    console.error(`[parrelsync] ${label}: 12 correctly routed calls`);
  }
  try {
    await client.initialize();
    for (const target of [main, clone]) {
      const state = await ready(target); assert.equal(state.state.sceneDirty, false);
      const native = await code(target, "return new { nativeClone = ParrelSync.ClonesManager.IsClone(), mcpClone = UnityMCP.Editor.MCPInstanceRegistry.IsParrelSyncClone(), index = UnityMCP.Editor.MCPInstanceRegistry.GetParrelSyncCloneIndex(), nativeOriginal = ParrelSync.ClonesManager.GetOriginalProjectPath(), mainPath = UnityMCP.Editor.MCPInstanceRegistry.GetMainProjectPath(), guid = UnityEditor.PlayerSettings.productGUID.ToString(\"N\"), pid = System.Diagnostics.Process.GetCurrentProcess().Id }; ");
      assert.equal(native.nativeClone, target === clone); assert.equal(native.mcpClone, target === clone);
      assert.equal(native.index, target === clone ? 0 : -1); assert.equal(canonical(native.nativeOriginal), canonical(main.path));
      assert.equal(canonical(native.mainPath), canonical(main.path));
      target.pid = native.pid; target.name = state.instance.projectName;
      report.checks[target === main ? "mainIdentity" : "cloneIdentity"] = native;
      await code(target, "if (UnityEngine.SceneManagement.SceneManager.GetActiveScene().isDirty) throw new System.Exception(\"Dirty scene\"); UnityEditor.SceneManagement.EditorSceneManager.OpenScene(\"Assets/ParrelValidation.unity\"); return true;");
    }
    assert.equal(report.checks.mainIdentity.guid, report.checks.cloneIdentity.guid);
    assert.equal(main.name, clone.name);
    const ambiguous = await raw(main, "unity_select_instance", { projectName: main.name });
    assert.equal(ambiguous.isError, true); report.checks.ambiguousNameRejected = true;
    await select(main); await select(clone);
    const settings = "var flags = System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic; var type = typeof(UnityMCP.Editor.MCPSettingsManager); return new { port = UnityMCP.Editor.MCPSettingsManager.Port, context = UnityMCP.Editor.MCPSettingsManager.ContextEnabled, instancePrefix = (string)type.GetProperty(\"InstancePrefix\", flags).GetValue(null), projectPrefix = (string)type.GetProperty(\"ProjectPrefix\", flags).GetValue(null) };";
    original = { main: await code(main, settings), clone: await code(clone, settings) };
    assert.notEqual(original.main.instancePrefix, original.clone.instancePrefix);
    assert.equal(original.main.projectPrefix, original.clone.projectPrefix);
    try {
      await code(clone, `UnityMCP.Editor.MCPSettingsManager.Port = ${original.main.port === 7899 ? 7898 : 7899}; return true;`);
      assert.equal(await code(main, "return UnityMCP.Editor.MCPSettingsManager.Port;"), original.main.port);
      await code(main, `UnityMCP.Editor.MCPSettingsManager.ContextEnabled = ${!original.main.context}; return true;`);
      assert.equal(await code(main, "return UnityMCP.Editor.MCPSettingsManager.ContextEnabled;"), !original.main.context);
      const cloneImmediateRead = await code(clone, "return UnityMCP.Editor.MCPSettingsManager.ContextEnabled;");
      report.checks.settings = { separateInstancePort: true, sameProjectPrefix: true, immediatePolicyPropagationObserved: cloneImmediateRead === !original.main.context };
    } finally {
      await code(clone, `UnityMCP.Editor.MCPSettingsManager.Port = ${original.clone.port}; return true;`);
      await code(main, `UnityMCP.Editor.MCPSettingsManager.ContextEnabled = ${original.main.context}; return true;`);
    }
    await overlap("editMode");
    for (const target of [main, clone]) await transition(target, "UnityEditor.EditorApplication.isPlaying = true; return true;");
    await ready(main, true); await ready(clone, true); await overlap("playMode");
    for (const target of [main, clone]) await transition(target, "UnityEditor.EditorApplication.isPlaying = false; return true;");
    await ready(main); await ready(clone);
    const oldSessions = [(await call(main, "unity_queue_info")).queueSessionId, (await call(clone, "unity_queue_info")).queueSessionId];
    scriptCreated = true;
    await transition(main, `System.IO.File.WriteAllText(${JSON.stringify(script)}, ${JSON.stringify(`public static class ParrelReload${id} { public const string Marker = "${id}"; }`)}); UnityEditor.AssetDatabase.Refresh(); return true;`);
    await ready(main, false, oldSessions[0]);
    await transition(clone, "UnityEditor.AssetDatabase.Refresh(); return true;");
    await ready(clone, false, oldSessions[1]);
    for (const target of [main, clone]) assert.equal(await code(target, `return ParrelReload${id}.Marker;`), id);
    report.checks.sharedReload = { sameCompiledMarker: true, bothQueueSessionsChanged: true };
    await overlap("afterReload");
    const oldPid = clone.pid;
    await code(clone, "if (UnityEngine.SceneManagement.SceneManager.GetActiveScene().isDirty) throw new System.Exception(\"Dirty clone\"); double at = UnityEditor.EditorApplication.timeSinceStartup + 1; UnityEditor.EditorApplication.CallbackFunction close = null; close = () => { if (UnityEditor.EditorApplication.timeSinceStartup < at) return; UnityEditor.EditorApplication.update -= close; UnityEditor.EditorApplication.Exit(0); }; UnityEditor.EditorApplication.update += close; return true;");
    await until("Clone process exit", async () => { try { process.kill(oldPid, 0); return false; } catch { return true; } });
    await code(main, `UnityMCP.Editor.MCPSettingsManager.ContextEnabled = ${!original.main.context}; return true;`);
    const child = spawn(editor, ["-projectPath", clone.path, "-logFile", join(clone.path, "Library", `ParrelRestart-${id}.log`)], { detached: true, stdio: "ignore", windowsHide: true });
    await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); }); child.unref();
    const restarted = await ready(clone); clone.pid = await code(clone, "return System.Diagnostics.Process.GetCurrentProcess().Id;");
    assert.notEqual(clone.pid, oldPid); assert.equal(canonical(restarted.instance.projectPath), canonical(clone.path));
    assert.equal(await code(clone, "return UnityMCP.Editor.MCPSettingsManager.ContextEnabled;"), !original.main.context);
    assert.equal(await code(clone, "return UnityMCP.Editor.MCPSettingsManager.Port;"), original.clone.port);
    assert.equal(await code(main, "return UnityMCP.Editor.MCPSettingsManager.Port;"), original.main.port);
    report.checks.settings.persistedPolicyInheritedAfterRestart = true;
    report.checks.settings.instancePortPreservedAfterRestart = true;
    report.checks.restart = { oldPid, newPid: clone.pid, rediscoveredPort: clone.port };
    await overlap("afterRestart");
    report.passed = true;
  } catch (error) {
    report.error = error.stack || String(error); throw error;
  } finally {
    try {
      for (const target of [main, clone]) { await select(target); if ((await call(target, "unity_editor_state")).isPlaying) await transition(target, "UnityEditor.EditorApplication.isPlaying = false; return true;"); await ready(target); }
      if (original) {
        await code(clone, `UnityMCP.Editor.MCPSettingsManager.Port = ${original.clone.port}; return true;`);
        await code(main, `UnityMCP.Editor.MCPSettingsManager.ContextEnabled = ${original.main.context}; return true;`);
        await code(clone, `UnityMCP.Editor.MCPSettingsManager.ContextEnabled = ${original.clone.context}; return true;`);
      }
      if (scriptCreated) {
        await transition(main, `UnityEditor.AssetDatabase.DeleteAsset(${JSON.stringify(script)}); return true;`);
        await ready(main); await transition(clone, "UnityEditor.AssetDatabase.Refresh(); return true;"); await ready(clone);
      }
      report.cleanup = { settingsRestored: true, playStopped: true, scriptRemoved: !existsSync(join(project, script)) };
      for (const target of [main, clone]) assert.equal((await call(target, "unity_editor_state")).sceneDirty, false);
      assert.deepEqual(client.stdoutViolations, []);
    } catch (error) { report.passed = false; report.cleanupError = error.message; throw error; }
    finally { await client.close(); writeFileSync(join(project, "Library", "UnityMcpParrelSyncLive.json"), JSON.stringify(report, null, 2) + "\n"); }
  }
});

const baselineServer = process.env.UNITY_MCP_PARRELSYNC_BASELINE_SERVER;
test("released server reads the current ParrelSync main and clone", {
  skip: !(project && baselineServer) && "set UNITY_MCP_PARRELSYNC_PROJECT and UNITY_MCP_PARRELSYNC_BASELINE_SERVER", timeout: 120_000,
}, async () => {
  assert.ok(isAbsolute(baselineServer) && existsSync(baselineServer));
  const report = { nodeVersion: process.version, serverEntry: baselineServer, passed: false, editors: [] };
  const client = new McpTestClient({ serverEntry: baselineServer, timeoutMs: 40_000 }).start();
  async function call(name, args = {}) {
    const response = await client.callTool(name, args);
    assert.equal(response.isError, false, JSON.stringify(response.payload));
    assert.notEqual(response.payload.success, false, JSON.stringify(response.payload));
    return response.payload.data ?? response.payload;
  }
  try {
    await client.initialize();
    for (const [path, isClone] of [[project, false], [project + "_clone_0", true]]) {
      assert.ok(isAbsolute(path) && existsSync(join(path, ".unity-mcp-validation")));
      const instance = (await call("unity_list_instances", { refresh: true })).instances.find(x => x.projectPath && canonical(x.projectPath) === canonical(path));
      assert.ok(instance); assert.equal(instance.isClone, isClone); assert.equal(instance.cloneIndex, isClone ? 0 : -1);
      await call("unity_select_instance", { port: instance.port });
      const state = await call("unity_editor_state", { port: instance.port });
      assert.equal(canonical(state.projectPath), canonical(path)); assert.equal(state.isPlaying, false);
      assert.equal(state.isCompiling, false); assert.equal(state.sceneDirty, false);
      assert.equal((await call("unity_get_compilation_errors", { port: instance.port, severity: "error" })).count, 0);
      const value = await call("unity_execute_code", { port: instance.port, code: "return new { path = System.IO.Directory.GetParent(UnityEngine.Application.dataPath).FullName, nativeClone = ParrelSync.ClonesManager.IsClone(), mainPath = UnityMCP.Editor.MCPInstanceRegistry.GetMainProjectPath() };" });
      assert.equal(value.success, true); assert.equal(canonical(value.result.path), canonical(path));
      assert.equal(value.result.nativeClone, isClone); assert.equal(canonical(value.result.mainPath), canonical(project));
      report.editors.push({ path, port: instance.port, isClone, cloneIndex: instance.cloneIndex, identityAndReadCommandsPassed: true });
    }
    assert.deepEqual(client.stdoutViolations, []); report.passed = true;
  } catch (error) { report.error = error.message; throw error; }
  finally { await client.close(); writeFileSync(join(project, "Library", "UnityMcpParrelSyncReleased.json"), JSON.stringify(report, null, 2) + "\n"); }
});
