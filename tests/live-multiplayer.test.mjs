import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { McpTestClient } from "./helpers/mcp-client.mjs";

const argument = process.env.UNITY_MCP_MULTIPLAYER_PROJECT;
const canonical = path => realpathSync(path).replaceAll("\\", "/").toLowerCase();
const managerType = 'System.Type.GetType("Unity.PlayMode.Editor.PlayModeScenarioManager, UnityEditor.PlayModeModule")';
const flags = "System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static";

test("Unity 6.6 native MPPM scenario, isolated agents and shared script recompilation", {
  skip: !argument && "set UNITY_MCP_MULTIPLAYER_PROJECT to an open disposable Unity 6.6 project with MPPM installed",
  timeout: 600_000,
}, async () => {
  assert.ok(isAbsolute(argument), "use an absolute project path");
  const path = resolve(argument);
  assert.ok(existsSync(join(path, ".unity-mcp-validation")), "refusing an unmarked project");
  const id = randomUUID().replaceAll("-", "");
  const asset = `Assets/__McpValidation/Mppm${id}.asset`;
  const script = `Assets/__McpValidation/Editor/MppmReload${id}.cs`;
  const parent = { agentId: `mppm-main-${id}`, path };
  const clone = { agentId: `mppm-clone-${id}` };
  const client = new McpTestClient({ timeoutMs: 40_000 }).start();
  const evidence = { nodeVersion: process.version, scenario: asset, checks: {} };
  let original;
  let ownsPlayer = false;

  async function raw(target, name, args = {}) {
    const response = await client.request("tools/call", { name, arguments: args, _meta: { agentId: target.agentId } });
    return { isError: response.isError === true, payload: JSON.parse(response.content.filter(x => x.type === "text").at(-1).text) };
  }
  async function call(target, name, args = {}) {
    const response = await raw(target, name, { port: target.port, ...args });
    assert.equal(response.isError, false, JSON.stringify(response));
    assert.notEqual(response.payload.success, false, JSON.stringify(response));
    return response.payload.data ?? response.payload;
  }
  const mppm = (name, params = {}) => call(parent, "unity_advanced_tool", { tool: `unity_mppm_${name}`, params });
  async function code(target, source) {
    const value = await call(target, "unity_execute_code", { code: source });
    assert.equal(value.success, true, JSON.stringify(value));
    return value.result;
  }
  async function select(target) {
    const list = (await raw(target, "unity_list_instances", { refresh: true })).payload.instances;
    const instance = list.find(value => target === parent
      ? canonical(value.projectPath) === canonical(path)
      : value.isVirtualPlayer === true && value.virtualPlayerId === target.virtualPlayerId
        && canonical(value.mainProjectPath) === canonical(path));
    assert.ok(instance, `instance absent: ${target.agentId}`);
    target.port = instance.port;
    target.path = instance.projectPath;
    const selected = await raw(target, "unity_select_instance", { port: target.port });
    assert.equal(selected.isError, false, JSON.stringify(selected));
    assert.equal(canonical(selected.payload.instance.projectPath), canonical(target.path));
    return instance;
  }
  async function until(label, action, timeout = 120_000) {
    const deadline = Date.now() + timeout;
    let error;
    while (Date.now() < deadline) {
      try { const value = await action(); if (value) return value; } catch (failure) { error = failure; }
      await delay(1000);
    }
    throw new Error(`${label}: ${error?.message || "state did not converge"}`);
  }
  async function ready(target, playing, oldSession) {
    return until(`ready ${target.agentId}`, async () => {
      await select(target);
      const state = await call(target, "unity_editor_state");
      if (state.isCompiling || state.isPlaying !== playing) return false;
      const compilation = await call(target, "unity_get_compilation_errors", { severity: "error" });
      assert.equal(compilation.count, 0, JSON.stringify(compilation));
      if (compilation.isCompiling) return false;
      const session = (await call(target, "unity_queue_info")).queueSessionId;
      return session !== oldSession && { state, session };
    });
  }
  async function transition(name) {
    const response = await raw(parent, "unity_advanced_tool", { port: parent.port, tool: `unity_mppm_${name}`, params: {} });
    assert.ok(!response.isError || response.payload.outcomeUnknown === true, JSON.stringify(response));
    // A lost result can accompany a reload; verify the state without replaying the transition.
    return response;
  }
  async function concurrency(label) {
    const targets = [parent, clone];
    for (const target of targets) await select(target);
    const key = `UnityMcpValidation.Mppm.${id}.${label}`;
    const responses = await Promise.all(Array.from({ length: 12 }, (_, i) => raw(targets[i % 2], "unity_execute_code", { code: `
      var count = UnityEditor.SessionState.GetInt("${key}", 0) + 1;
      UnityEditor.SessionState.SetInt("${key}", count);
      return new { count, isMain = Unity.Multiplayer.PlayMode.CurrentPlayer.IsMainEditor,
        processId = System.Diagnostics.Process.GetCurrentProcess().Id,
        projectPath = System.IO.Directory.GetParent(UnityEngine.Application.dataPath).FullName };` })));
    const pids = new Set();
    for (let i = 0; i < responses.length; i++) {
      assert.equal(responses[i].isError, false, JSON.stringify(responses[i]));
      const result = responses[i].payload.data.result;
      assert.equal(canonical(result.projectPath), canonical(targets[i % 2].path));
      assert.equal(result.isMain, i % 2 === 0);
      pids.add(result.processId);
    }
    assert.equal(pids.size, 2);
    for (let i = 0; i < 2; i++) assert.deepEqual(responses.filter((_, n) => n % 2 === i)
      .map(r => r.payload.data.result.count).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
    evidence.checks[label] = { overlappingCalls: 12, perEditor: 6, distinctProcesses: true, exactCounts: true, explicitCommandPorts: false };
    console.error(`[multiplayer] ${label}: 12 commands isolated between two processes`);
  }

  try {
    await client.initialize();
    evidence.main = await select(parent);
    const state = await call(parent, "unity_editor_state");
    assert.equal(state.isPlaying, false);
    assert.equal(state.sceneDirty, false);
    assert.ok(state.activeScenePath, "save the disposable scene first");
    evidence.info = await mppm("info");
    assert.equal(evidence.info.packageInstalled, true);
    assert.equal(evidence.info.isMainEditor, true);
    const players = (await mppm("list_players")).players;
    assert.ok(players.filter(p => p.index > 1).every(p => p.state === "NotLaunched"), "stop existing virtual players first");
    original = await code(parent, `var t = ${managerType}; var f = ${flags};
      var active = (UnityEngine.Object)t.GetProperty("ActiveScenario", f).GetValue(null);
      return new { rolesEnabled = Unity.Multiplayer.Editor.EditorMultiplayerRolesManager.EnableMultiplayerRoles,
        scenarioPath = UnityEditor.AssetDatabase.GetAssetPath(active) };`);
    await code(parent, "Unity.Multiplayer.Editor.EditorMultiplayerRolesManager.EnableMultiplayerRoles = true; return true;");
    const name = `Mppm${id}`;
    await mppm("create_scenario", { name, path: asset, mainRole: "Host", virtualEditors: 1, virtualRole: "Client", description: "Owned multiplayer MCP validation" });
    const scenario = (await mppm("list_scenarios")).scenarios.find(s => s.path === asset);
    assert.equal(scenario.virtualInstanceCount, 1);
    assert.deepEqual(scenario.instances.map(x => x.role), ["ClientAndServer", "Client"]);
    evidence.checks.scenario = scenario;
    const native = await code(parent, `var obj = UnityEditor.AssetDatabase.LoadMainAssetAtPath("${asset}");
      var f = System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic;
      var items = (System.Collections.IEnumerable)obj.GetType().GetMethod("GetAllInstances", f).Invoke(obj, null);
      var values = new System.Collections.Generic.List<string>(); foreach(var item in items) values.Add(UnityEngine.JsonUtility.ToJson(item)); return values;`);
    assert.equal(native.length, 2);
    assert.equal(JSON.parse(native[0]).m_Settings.RoleMask, 3);
    assert.equal(JSON.parse(native[1]).m_Settings.RoleMask, 1);
    evidence.checks.nativeInstanceSettings = native.map(JSON.parse);
    for (const params of [{ name, path: asset }, { name, path: "Assets/../invalid.asset" }, { name, path: asset + ".invalid" }, { name, virtualEditors: 4 }, { name, mainRole: "invalid" }]) {
      const response = await raw(parent, "unity_advanced_tool", { port: parent.port, tool: "unity_mppm_create_scenario", params });
      assert.equal(response.isError, true, JSON.stringify(response));
    }
    evidence.checks.invalidCreatesRejected = 5;
    await mppm("activate_scenario", { path: asset });
    ownsPlayer = true;
    evidence.start = await transition("start");
    await ready(parent, true);
    const slot = await until("Player 2 launch", async () => {
      const player = (await mppm("list_players")).players.find(p => p.index === 2);
      return player.state === "Launched" && player.virtualPlayerId && player;
    });
    clone.virtualPlayerId = slot.virtualPlayerId;
    await ready(clone, true);
    evidence.clone = await select(clone);
    evidence.checks.runtimeRoles = [];
    for (const target of [parent, clone]) evidence.checks.runtimeRoles.push(await code(target,
      "return new { isMain = Unity.Multiplayer.PlayMode.CurrentPlayer.IsMainEditor, role = Unity.Multiplayer.MultiplayerRolesManager.ActiveMultiplayerRoleMask.ToString() };"));
    assert.deepEqual(evidence.checks.runtimeRoles, [{ isMain: true, role: "ClientAndServer" }, { isMain: false, role: "Client" }]);
    await concurrency("playModeRouting");
    evidence.stop = await transition("stop");
    await ready(parent, false);
    const stopped = (await mppm("list_players")).players.find(p => p.index === 2);
    if (stopped.state !== "NotLaunched") await mppm("deactivate_player", { index: 2 });
    await mppm("activate_player", { index: 2 });
    await ready(clone, false);
    const before = [];
    for (const target of [parent, clone]) before.push((await call(target, "unity_queue_info")).queueSessionId);
    mkdirSync(join(path, "Assets/__McpValidation/Editor"), { recursive: true });
    writeFileSync(join(path, script), `public static class MppmReload${id} { public static string Value => "${id}"; }\n`);
    await call(parent, "unity_execute_menu_item", { menuPath: "Assets/Refresh" });
    const after = [];
    for (let i = 0; i < 2; i++) after.push((await ready([parent, clone][i], false, before[i])).session);
    for (const target of [parent, clone]) assert.equal(await code(target, `return MppmReload${id}.Value;`), id);
    evidence.checks.sharedRecompile = { before, after, bothReloaded: true, compiledValueVisibleInBoth: true };
    await concurrency("afterRecompileRouting");
    assert.deepEqual(client.stdoutViolations, []);
    evidence.passed = true;
  } catch (error) {
    evidence.error = error.message;
    throw error;
  } finally {
    try {
      if (original) {
        await select(parent);
        if ((await call(parent, "unity_editor_state")).isPlaying) {
          await transition("stop");
          await ready(parent, false);
        }
        if (ownsPlayer && (await mppm("list_players")).players.find(p => p.index === 2).state !== "NotLaunched")
          await mppm("deactivate_player", { index: 2 });
        if (original.scenarioPath) await mppm("activate_scenario", { path: original.scenarioPath });
        else await code(parent, `${managerType}.GetProperty("ActiveScenario", ${flags}).SetValue(null, null); return true;`);
        await code(parent, `Unity.Multiplayer.Editor.EditorMultiplayerRolesManager.EnableMultiplayerRoles = ${original.rolesEnabled};
          UnityEditor.AssetDatabase.DeleteAsset("${asset}"); UnityEditor.AssetDatabase.DeleteAsset("${script}"); return true;`);
        await call(parent, "unity_execute_menu_item", { menuPath: "Assets/Refresh" });
        await ready(parent, false);
        evidence.restoredSettings = await code(parent, `var t = ${managerType}; var f = ${flags};
          var active = (UnityEngine.Object)t.GetProperty("ActiveScenario", f).GetValue(null);
          return new { rolesEnabled = Unity.Multiplayer.Editor.EditorMultiplayerRolesManager.EnableMultiplayerRoles,
            scenarioPath = UnityEditor.AssetDatabase.GetAssetPath(active) };`);
        assert.deepEqual(evidence.restoredSettings, original);
        assert.equal(existsSync(join(path, asset)), false);
        assert.equal(existsSync(join(path, script)), false);
        if (ownsPlayer) assert.equal((await mppm("list_players")).players.find(p => p.index === 2).state, "NotLaunched");
        evidence.restored = true;
      }
    } catch (error) {
      evidence.cleanupError = error.message;
      evidence.passed = false;
      throw error;
    } finally {
      writeFileSync(join(path, "Library/UnityMcpMultiplayer.json"), JSON.stringify(evidence, null, 2) + "\n");
      await client.close();
    }
  }
});
