import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { McpTestClient } from "./helpers/mcp-client.mjs";

const project = process.env.UNITY_MCP_HISTORY_PROJECT;
const canonical = path => realpathSync(path).replaceAll("\\", "/").toLowerCase();

test("live history notifications drain on editor updates, preserve MCP calls and reset on reload", {
  skip: !project && "set UNITY_MCP_HISTORY_PROJECT to a marked disposable editor", timeout: 180_000,
}, async () => {
  assert.ok(isAbsolute(project) && existsSync(join(project, ".unity-mcp-validation")));
  const id = `history-${randomUUID()}`, key = `UnityMcp.${id}`;
  const report = { nodeVersion: process.version, serverEntry: process.env.UNITY_MCP_TEST_SERVER_ENTRY || "current", passed: false };
  const client = new McpTestClient({ serverEntry: process.env.UNITY_MCP_TEST_SERVER_ENTRY, timeoutMs: 45_000 }).start();
  let port;
  async function call(name, args = {}) {
    const response = await client.request("tools/call", { name, arguments: { port, ...args }, _meta: { agentId: id } });
    const payload = JSON.parse(response.content.filter(x => x.type === "text").at(-1).text);
    assert.notEqual(response.isError, true, JSON.stringify(payload)); assert.notEqual(payload.success, false, JSON.stringify(payload));
    return payload.data ?? payload;
  }
  const guard = `if (!UnityEngine.Application.dataPath.Replace('\\\\', '/').Equals(${JSON.stringify(join(project, "Assets").replaceAll("\\", "/"))}, System.StringComparison.OrdinalIgnoreCase) || !System.IO.File.Exists(".unity-mcp-validation")) throw new System.Exception("Unexpected validation project");\n`;
  async function code(source) {
    const result = await call("unity_execute_code", { code: guard + source });
    assert.equal(result.success, true, JSON.stringify(result)); return result.result;
  }
  async function until(label, action) {
    let failure; const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      try { const value = await action(); if (value) return value; } catch (error) { failure = error; }
      await delay(500);
    }
    throw new Error(`${label}: ${failure?.message || "state did not converge"}`);
  }
  async function ready(oldSession) {
    return until("Editor readiness", async () => {
      const instance = (await call("unity_list_instances", { refresh: true })).instances.find(x => x.projectPath && canonical(x.projectPath) === canonical(project));
      assert.ok(instance); port = instance.port; await call("unity_select_instance");
      const state = await call("unity_editor_state");
      if (state.isCompiling) return false;
      assert.equal(state.isPlaying, false); assert.equal(state.sceneDirty, false);
      const errors = await call("unity_get_compilation_errors", { severity: "error" }); assert.equal(errors.count, 0);
      const queue = await call("unity_queue_info");
      return (!oldSession || queue.queueSessionId !== oldSession) && { instance, queue };
    });
  }
  try {
    await client.initialize(); const initial = await ready(); report.project = initial.instance;
    const mainThread = await code(`string key = "${key}"; UnityEditor.SessionState.SetInt(key, 0); UnityEditor.SessionState.SetString(key + ".ids", ""); int thread = System.Threading.Thread.CurrentThread.ManagedThreadId; System.Action<UnityMCP.Editor.MCPActionRecord> observer = record => { if (record.AgentId != "${id}" || record.ActionName != "editor/state") return; if (System.Threading.Thread.CurrentThread.ManagedThreadId != thread) throw new System.Exception("Observer left the editor thread"); UnityEditor.SessionState.SetInt(key, UnityEditor.SessionState.GetInt(key, 0) + 1); UnityEditor.SessionState.SetString(key + ".ids", UnityEditor.SessionState.GetString(key + ".ids", "") + record.Id + ","); }; System.AppDomain.CurrentDomain.SetData(key, observer); UnityMCP.Editor.MCPActionHistory.OnActionRecorded += observer; return thread;`);
    const settled = await Promise.allSettled(Array.from({ length: 12 }, () => call("unity_editor_state")));
    for (const result of settled) { assert.equal(result.status, "fulfilled", result.reason?.message); assert.equal(canonical(result.value.projectPath), canonical(project)); }
    await until("Deferred observer delivery", async () => await code(`return UnityEditor.SessionState.GetInt("${key}", 0);`) === 12);
    const ids = (await code(`return UnityEditor.SessionState.GetString("${key}.ids", "");`)).split(",").filter(Boolean);
    assert.equal(new Set(ids).size, 12); assert.deepEqual(ids, [...ids].sort((a, b) => Number(a) - Number(b)));
    const drained = await until("Notification queue drained", async () => { const q = await call("unity_queue_info"); return q.historyNotifications.pendingCount === 0 && q.historyNotifications; });
    assert.equal(drained.maxPerUpdate, 100); assert.equal(drained.maxPendingCount, 10000);
    report.delivery = { concurrentMcpCalls: 12, exactlyOnce: true, ordered: true, mainThread, metrics: drained };
    const pressure = await code(`long before = (long)((System.Collections.Generic.Dictionary<string, object>)UnityMCP.Editor.MCPRequestQueue.GetQueueInfo()["historyNotifications"])["dropped"]; for (int i = 0; i < 10032; i++) UnityMCP.Editor.MCPActionHistory.RecordAction(new UnityMCP.Editor.MCPActionRecord { AgentId = "${id}", ActionName = "editor/state", Category = "editor", Timestamp = System.DateTime.UtcNow }); var info = (System.Collections.Generic.Dictionary<string, object>)UnityMCP.Editor.MCPRequestQueue.GetQueueInfo()["historyNotifications"]; UnityMCP.Editor.MCPActionHistory.Clear(); return new { before, pressure = info, cleared = UnityMCP.Editor.MCPRequestQueue.GetQueueInfo()["historyNotifications"] };`);
    assert.equal(pressure.pressure.pendingCount, 10000); assert.equal(pressure.pressure.dropped - pressure.before, 32);
    assert.equal(pressure.cleared.pendingCount, 0);
    assert.equal(await code(`return UnityEditor.SessionState.GetInt("${key}", 0);`), 12);
    report.pressure = pressure;
    const oldSession = (await call("unity_queue_info")).queueSessionId;
    await code("double at = UnityEditor.EditorApplication.timeSinceStartup + 1; UnityEditor.EditorApplication.CallbackFunction reload = null; reload = () => { if (UnityEditor.EditorApplication.timeSinceStartup < at) return; UnityEditor.EditorApplication.update -= reload; UnityEditor.EditorUtility.RequestScriptReload(); }; UnityEditor.EditorApplication.update += reload; return true;");
    const reloaded = await ready(oldSession);
    assert.equal(reloaded.queue.historyNotifications.pendingCount, 0); assert.equal(reloaded.queue.historyNotifications.delivered, 0);
    assert.equal(reloaded.queue.historyNotifications.dropped, 0);
    assert.equal(await code(`return System.AppDomain.CurrentDomain.GetData("${key}") == null;`), true);
    report.reload = { queueSessionChanged: true, observerReleased: true, metrics: reloaded.queue.historyNotifications };
    report.passed = true;
  } catch (error) { report.error = error.stack; throw error; }
  finally {
    try {
      await ready();
      await code(`var observer = System.AppDomain.CurrentDomain.GetData("${key}") as System.Action<UnityMCP.Editor.MCPActionRecord>; if (observer != null) UnityMCP.Editor.MCPActionHistory.OnActionRecorded -= observer; System.AppDomain.CurrentDomain.SetData("${key}", null); UnityEditor.SessionState.EraseInt("${key}"); UnityEditor.SessionState.EraseString("${key}.ids"); UnityMCP.Editor.MCPActionHistory.Clear(); return true;`);
      assert.deepEqual(client.stdoutViolations, []); report.cleanup = { observerRemoved: true, counterRemoved: true, cleanScene: true };
    } catch (error) { report.passed = false; report.cleanupError = error.message; throw error; }
    finally { await client.close(); writeFileSync(join(project, "Library", "UnityMcpHistoryNotificationsLive.json"), JSON.stringify(report, null, 2) + "\n"); }
  }
});
