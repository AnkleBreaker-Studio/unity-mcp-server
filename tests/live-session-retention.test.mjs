import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { McpTestClient } from "./helpers/mcp-client.mjs";

const project = process.env.UNITY_MCP_SESSION_RETENTION_PROJECT;
const canonical = path => realpathSync(path).replaceAll("\\", "/").toLowerCase();

test("live plugin session pressure preserves MCP routing, results and reload", {
  skip: !project && "set UNITY_MCP_SESSION_RETENTION_PROJECT to an open marked editor with SessionRetentionValidation.cs",
  timeout: 180_000,
}, async () => {
  assert.ok(isAbsolute(project) && existsSync(join(project, ".unity-mcp-validation")));
  const client = new McpTestClient({ serverEntry: process.env.UNITY_MCP_TEST_SERVER_ENTRY, timeoutMs: 60_000 }).start();
  const report = { nodeVersion: process.version, serverEntry: process.env.UNITY_MCP_TEST_SERVER_ENTRY || "current", passed: false };
  let port;
  async function call(name, args = {}) {
    const result = await client.callTool(name, { ...args, port });
    assert.notEqual(result.isError, true, result.payloadText);
    return result.payload.data ?? result.payload;
  }
  const guard = `if (!UnityEngine.Application.dataPath.Replace('\\\\', '/').Equals(${JSON.stringify(join(project, "Assets").replaceAll("\\", "/"))}, System.StringComparison.OrdinalIgnoreCase) || !System.IO.File.Exists(".unity-mcp-validation")) throw new System.Exception("Unexpected validation project");\n`;
  async function code(source) {
    const result = await call("unity_execute_code", { code: guard + source });
    assert.equal(result.success, true, JSON.stringify(result)); return result.result;
  }
  async function ready(previousSession) {
    let lastError;
    for (const deadline = Date.now() + 90_000; Date.now() < deadline; await delay(500)) {
      try {
        const instance = (await call("unity_list_instances", { refresh: true })).instances.find(item => item.projectPath && canonical(item.projectPath) === canonical(project));
        assert.ok(instance); port = instance.port; await call("unity_select_instance");
        const state = await call("unity_editor_state");
        if (state.isCompiling) continue;
        assert.equal(canonical(state.projectPath), canonical(project));
        assert.equal(state.isPlaying, false); assert.equal(state.sceneDirty, false);
        assert.equal((await call("unity_get_compilation_errors", { severity: "error" })).count, 0);
        const queue = await call("unity_queue_info");
        if (!previousSession || queue.queueSessionId !== previousSession) return { instance, state, queue };
      } catch (error) { lastError = error; }
    }
    throw new Error(`Editor did not become ready: ${lastError?.message || "queue session did not change"}`);
  }
  try {
    await client.initialize(); const initial = await ready(); report.project = initial.instance;
    report.native = await code("return UnityMcpSessionRetentionValidation.Validate();");
    assert.equal(report.native.passed, true, JSON.stringify(report.native));
    assert.equal(report.native.checks.length, 9);
    const queue = await call("unity_queue_info");
    assert.equal(queue.totalQueued, 0); assert.equal(queue.executingCount, 0);
    assert.equal(queue.pendingHistoryRecords, 0); assert.equal(queue.httpCommands.activeCount, 0);
    assert.equal(queue.maxIdleSessions, 1024); assert.ok(queue.idleSessionsTracked < 20);
    assert.ok(queue.pressureEvictedSessions > 3976);
    report.afterPressure = { totalSessionsTracked: queue.totalSessionsTracked, idleSessionsTracked: queue.idleSessionsTracked, pressureEvictedSessions: queue.pressureEvictedSessions };
    await code("double at = UnityEditor.EditorApplication.timeSinceStartup + 1; UnityEditor.EditorApplication.CallbackFunction reload = null; reload = () => { if (UnityEditor.EditorApplication.timeSinceStartup < at) return; UnityEditor.EditorApplication.update -= reload; UnityEditor.EditorUtility.RequestScriptReload(); }; UnityEditor.EditorApplication.update += reload; return true;");
    const reloaded = await ready(queue.queueSessionId);
    assert.equal(reloaded.queue.pressureEvictedSessions, 0);
    assert.ok(reloaded.queue.idleSessionsTracked < 20);
    assert.equal(reloaded.state.activeScenePath, initial.state.activeScenePath);
    report.reload = { sessionChanged: true, pressureCounterReset: true, idleSessionsTracked: reloaded.queue.idleSessionsTracked };
    assert.deepEqual(client.stdoutViolations, []); report.passed = true;
  } catch (error) { report.error = error.stack; throw error; }
  finally {
    await client.close();
    writeFileSync(join(project, "Library", "UnityMcpSessionRetentionLive.json"), JSON.stringify(report, null, 2) + "\n");
  }
});
