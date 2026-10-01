import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { McpTestClient } from "./helpers/mcp-client.mjs";

const project = process.env.UNITY_MCP_UNDO_PROJECT;
const canonical = path => realpathSync(path).replaceAll("\\", "/").toLowerCase();

test("live Undo follows native state, protects other agents and survives script reload", {
  skip: !project && "set UNITY_MCP_UNDO_PROJECT to an open marked project with an empty unsaved scene and empty Undo stack",
  timeout: 240_000,
}, async () => {
  assert.ok(isAbsolute(project));
  assert.ok(existsSync(join(project, ".unity-mcp-validation")));
  const client = new McpTestClient({ serverEntry: process.env.UNITY_MCP_UNDO_SERVER_ENTRY, timeoutMs: 35_000 }).start();
  const suffix = randomUUID().replaceAll("-", "");
  const prefix = "__McpUndoLive_" + suffix + "_";
  const agents = { control: "undo-control-" + suffix, a: "undo-a-" + suffix, b: "undo-b-" + suffix };
  const report = { nodeVersion: process.version, serverEntry: process.env.UNITY_MCP_UNDO_SERVER_ENTRY || "current", passed: false, checks: [] };
  let port, original, fixtureStarted = false;
  const raw = async (name, args = {}, agent = agents.control) => {
    const response = await client.request("tools/call", {
      name: name === "unity_undo_clear" ? "unity_advanced_tool" : name,
      arguments: name === "unity_undo_clear" ? { port, tool: name, params: args } : { port, ...args },
      _meta: { agentId: agent },
    });
    const text = response.content.filter(block => block.type === "text").at(-1).text;
    return { response, payload: JSON.parse(text), text };
  };
  const call = async (name, args = {}, agent) => {
    const result = await raw(name, args, agent);
    assert.notEqual(result.response.isError, true, result.text);
    return result.payload.data ?? result.payload;
  };
  const code = async source => (await call("unity_execute_code", { code: source })).result;
  const discover = async () => {
    const list = await call("unity_list_instances", { refresh: true });
    const instance = list.instances.find(item => item.projectPath && canonical(item.projectPath) === canonical(project));
    assert.ok(instance, "The marked project was not discovered");
    port = instance.port;
    for (const agent of Object.values(agents)) {
      const selected = await call("unity_select_instance", { port }, agent);
      assert.equal(canonical(selected.instance.projectPath), canonical(project));
    }
  };
  const create = (name, agent = agents.a) => call("unity_gameobject_create", { name: prefix + name, primitiveType: "Empty" }, agent);
  const exists = async name => {
    const result = await raw("unity_gameobject_info", { path: prefix + name });
    if (!result.response.isError) return true;
    assert.match(result.text, /GameObject not found/);
    return false;
  };
  const history = async (name, agent = agents.a) => (await call("unity_undo_history", { agentId: agent, count: 100 })).actions.find(r => r.target === prefix + name && r.action === "gameobject/create");
  const undo = (agent = agents.a, force = false) => call("unity_undo_last", { agentId: agent, force });
  try {
    await client.initialize();
    await discover();
    await call("unity_list_advanced_tools", { tool: "unity_undo_clear" });
    const state = await call("unity_editor_state");
    assert.equal(state.isPlaying, false);
    assert.equal(state.isCompiling, false);
    assert.equal(state.sceneDirty, false);
    assert.equal(state.activeScenePath, "", "Use an empty unsaved validation scene");
    original = await code('var u = new List<string>(); var r = new List<string>(); typeof(Undo).GetMethod("GetRecords", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static, null, new[] { typeof(List<string>), typeof(List<string>) }, null).Invoke(null, new object[] { u, r }); return new { roots = UnityEngine.SceneManagement.SceneManager.GetActiveScene().rootCount, undoEntries = u.Count, activeCommandOnly = u.Count == 1 && u[0] == "editor/execute-code", redoEntries = r.Count, persistence = UnityMCP.Editor.MCPSettingsManager.ActionHistoryPersistence };');
    assert.deepEqual([original.roots, original.redoEntries], [0, 0]);
    assert.ok(original.undoEntries === 0 || original.activeCommandOnly, "Use a validation editor without existing native Undo entries");
    report.unityVersion = state.unityVersion;
    fixtureStarted = true;
    await code("UnityMCP.Editor.MCPSettingsManager.ActionHistoryPersistence = true; return true;");

    const a = await create("A");
    await call("unity_gameobject_set_transform", { instanceId: String(a.instanceId), position: { x: 3, y: 4, z: 5 } }, agents.a);
    await undo();
    assert.deepEqual((await call("unity_gameobject_info", { path: prefix + "A" })).position, { x: 0, y: 0, z: 0 });
    await create("B", agents.b);
    const refused = await raw("unity_undo_last", { agentId: agents.a });
    assert.equal(refused.response.isError, true);
    assert.equal(refused.payload.data.wouldAlsoRevert[0].agentId, agents.b);
    assert.equal(await exists("A"), true); assert.equal(await exists("B"), true);
    await undo(agents.b);
    assert.equal(await exists("B"), false);
    report.checks.push({ name: "Transform rollback and cross-agent cascade guard", passed: true });

    await call("unity_undo");
    assert.equal(await exists("A"), false);
    assert.equal((await history("A")).undoable, false);
    await call("unity_redo");
    assert.equal(await exists("A"), true);
    assert.equal((await history("A")).undoable, true);
    await undo();
    assert.equal(await exists("A"), false);
    report.checks.push({ name: "Native Undo and Redo update recorded eligibility", passed: true });

    await create("BeforeNative");
    await code(`var go = new GameObject("${prefix}Native"); Undo.RegisterCreatedObjectUndo(go, "Native validation creation"); return true;`);
    const nativeRefused = await raw("unity_undo_last", { agentId: agents.a });
    assert.equal(nativeRefused.response.isError, true);
    assert.equal(nativeRefused.payload.data.wouldAlsoRevertUnity.length, 1);
    assert.equal(await exists("BeforeNative"), true); assert.equal(await exists("Native"), true);
    const forced = await undo(agents.a, true);
    assert.equal(forced.revertedGroupCount, 2);
    assert.equal(await exists("BeforeNative"), false); assert.equal(await exists("Native"), false);
    report.checks.push({ name: "Untracked native work requires explicit cascade and is reported", passed: true });

    await create("Cleared"); await call("unity_undo_clear");
    assert.equal((await history("Cleared")).undoable, false);
    assert.equal((await raw("unity_undo_last", { agentId: agents.a, force: true })).response.isError, true);
    assert.equal(await exists("Cleared"), true);
    report.checks.push({ name: "Clearing native Undo cannot claim a successful targeted revert", passed: true });

    await create("Reload");
    const before = await history("Reload");
    assert.equal(before.undoable, true);
    const oldSession = (await call("unity_queue_info")).queueSessionId;
    await code("double deadline = EditorApplication.timeSinceStartup + 1; EditorApplication.CallbackFunction reload = null; reload = () => { if (EditorApplication.timeSinceStartup < deadline) return; EditorApplication.update -= reload; EditorUtility.RequestScriptReload(); }; EditorApplication.update += reload; return true;");
    const deadline = Date.now() + 90_000;
    let newSession;
    do {
      await delay(1000);
      try { await discover(); newSession = (await call("unity_queue_info")).queueSessionId; }
      catch { continue; }
      if (newSession && newSession !== oldSession) break;
    } while (Date.now() < deadline);
    assert.ok(newSession && newSession !== oldSession, "Script reload did not complete");
    const after = await history("Reload");
    assert.equal(after.id, before.id);
    assert.equal(after.undoable, true);
    const persistence = (await call("unity_queue_info")).historyPersistence;
    if (persistence) {
      assert.equal(persistence.maxFileBytes, 32 * 1024 * 1024);
      assert.equal(persistence.saveBlocked, false);
      assert.equal(persistence.warning, "");
      assert.ok(persistence.loadedRecords > 0 && persistence.lastFileBytes > 0);
      assert.equal(persistence.loadFailures, 0);
      report.historyPersistence = persistence;
    }
    await undo();
    assert.equal(await exists("Reload"), false);
    report.checks.push({ name: "Actual script reload preserves same-session native Undo identity", beforeSession: oldSession, afterSession: newSession, actionId: after.id, passed: true });
    const compilation = await call("unity_get_compilation_errors", { severity: "error" });
    assert.equal(compilation.count, 0);
    assert.equal(compilation.isCompiling, false);
    assert.deepEqual(client.stdoutViolations, []);
    report.passed = true;
  } finally {
    try {
      if (fixtureStarted) {
        await code(`Undo.ClearAll(); foreach (var go in Resources.FindObjectsOfTypeAll<GameObject>()) if (go.name.StartsWith("${prefix}", StringComparison.Ordinal)) UnityEngine.Object.DestroyImmediate(go); UnityMCP.Editor.MCPActionHistory.Clear(); UnityEditor.SceneManagement.EditorSceneManager.NewScene(UnityEditor.SceneManagement.NewSceneSetup.EmptyScene, UnityEditor.SceneManagement.NewSceneMode.Single); UnityMCP.Editor.MCPSettingsManager.ActionHistoryPersistence = ${original.persistence ? "true" : "false"}; return true;`);
        const state = await call("unity_editor_state");
        assert.equal(state.sceneDirty, false);
        assert.equal(state.isPlaying, false);
        report.fixtureRemoved = true;
        report.persistenceRestored = original.persistence;
      }
    } finally {
      await client.close();
      writeFileSync(join(project, "Library/UnityMcpUndo.json"), JSON.stringify(report, null, 2) + "\n");
    }
  }
});
