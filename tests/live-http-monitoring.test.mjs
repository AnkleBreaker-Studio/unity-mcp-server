import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { McpTestClient } from "./helpers/mcp-client.mjs";

const project = process.env.UNITY_MCP_HTTP_MONITOR_PROJECT;
const canonical = path => realpathSync(path).replaceAll("\\", "/").toLowerCase();

test("HTTP monitoring covers concurrent commands, input rejection and actual domain reload", {
  skip: !project && "set UNITY_MCP_HTTP_MONITOR_PROJECT to an open marked validation project",
  timeout: 180_000,
}, async () => {
  assert.ok(isAbsolute(project));
  assert.ok(existsSync(join(project, ".unity-mcp-validation")));
  const client = new McpTestClient({ serverEntry: process.env.UNITY_MCP_HTTP_MONITOR_SERVER_ENTRY, timeoutMs: 45_000 }).start();
  const report = { nodeVersion: process.version, passed: false, checks: [] };
  let port;
  const call = async (name, args = {}) => {
    const result = await client.callTool(name, { port, ...args });
    assert.equal(result.isError, false, result.payloadText);
    return result.payload.data ?? result.payload;
  };
  const discover = async () => {
    const instances = await call("unity_list_instances", { refresh: true });
    const instance = instances.instances.find(item => item.projectPath && canonical(item.projectPath) === canonical(project));
    assert.ok(instance, "Marked project is not running"); port = instance.port;
    const selected = await call("unity_select_instance", { port });
    assert.equal(canonical(selected.instance.projectPath), canonical(project));
  };
  const invariant = http => {
    assert.equal(http.receivedRequests, http.completedRequests + http.activeRequests);
    assert.equal(http.completedRequests, http.responses2xx + http.responses4xx + http.responses5xx + http.otherResponses + http.incompleteRequests);
    assert.ok(http.peakActiveRequests >= http.activeRequests);
    assert.ok(http.maxDurationMs >= http.averageDurationMs);
  };
  try {
    await client.initialize(); await discover();
    const state = await call("unity_editor_state");
    assert.equal(state.isPlaying, false); assert.equal(state.isCompiling, false); assert.equal(state.sceneDirty, false);
    report.unityVersion = state.unityVersion;
    const initial = await call("unity_queue_info"); invariant(initial.http);
    const concurrent = await Promise.all(Array.from({ length: 12 }, () => call("unity_editor_state")));
    assert.ok(concurrent.every(result => !result.isPlaying && !result.isCompiling));
    const afterConcurrent = await call("unity_queue_info"); invariant(afterConcurrent.http);
    assert.ok(afterConcurrent.http.completedRequests >= initial.http.completedRequests + 12);
    report.checks.push({ name: "Twelve overlapping MCP calls preserve aggregate invariants", passed: true, before: initial.http, after: afterConcurrent.http });

    const missing = await client.callTool("unity_gameobject_info", { port, path: "__HttpMonitoringMissingObject" });
    assert.equal(missing.isError, true);
    const afterError = await call("unity_queue_info"); invariant(afterError.http);
    assert.equal(afterError.http.responses4xx, afterConcurrent.http.responses4xx);
    assert.equal(afterError.http.responses5xx, afterConcurrent.http.responses5xx);
    assert.ok(afterError.http.responses2xx > afterConcurrent.http.responses2xx);
    report.checks.push({ name: "Command failure is not mislabeled as an HTTP failure", passed: true });

    await call("unity_list_advanced_tools", { tool: "unity_execute_code" });
    let nested = 0; for (let i = 0; i < 100; i++) nested = [nested];
    const rejection = await client.callTool("unity_advanced_tool", { port, tool: "unity_execute_code", params: { code: "return true;", unused: nested } });
    assert.equal(rejection.isError, true); assert.match(rejection.payloadText, /413|container levels/);
    const beforeReload = await call("unity_queue_info"); invariant(beforeReload.http);
    assert.ok(beforeReload.http.inputRejectedRequests > afterError.http.inputRejectedRequests);
    assert.ok(beforeReload.http.responses4xx > afterError.http.responses4xx);
    report.checks.push({ name: "Input refused before ticket creation is visible through MCP", passed: true, counters: beforeReload.http });

    await call("unity_execute_code", { code: "double deadline = EditorApplication.timeSinceStartup + 1; EditorApplication.CallbackFunction reload = null; reload = () => { if (EditorApplication.timeSinceStartup < deadline) return; EditorApplication.update -= reload; EditorUtility.RequestScriptReload(); }; EditorApplication.update += reload; return true;" });
    const deadline = Date.now() + 90_000;
    let afterReload;
    do {
      await delay(1000);
      try { await discover(); afterReload = await call("unity_queue_info"); } catch { continue; }
      if (afterReload.queueSessionId !== beforeReload.queueSessionId) break;
    } while (Date.now() < deadline);
    assert.ok(afterReload && afterReload.queueSessionId !== beforeReload.queueSessionId, "Reload did not complete");
    invariant(afterReload.http);
    assert.equal(afterReload.http.domainReloadCount, beforeReload.http.domainReloadCount + 1);
    assert.notEqual(afterReload.http.startedAtUtc, beforeReload.http.startedAtUtc);
    assert.equal(afterReload.http.inputRejectedRequests, 0);
    assert.ok(afterReload.http.lastDomainReloadMs > 0);
    report.checks.push({ name: "Actual reload persists reload count and resets HTTP totals", passed: true, before: beforeReload.http, after: afterReload.http });
    const compilation = await call("unity_get_compilation_errors", { severity: "error" });
    assert.equal(compilation.count, 0); assert.equal(compilation.isCompiling, false);
    const final = await call("unity_editor_state");
    assert.equal(final.sceneDirty, false); assert.equal(final.isPlaying, false);
    assert.deepEqual(client.stdoutViolations, []);
    report.passed = true;
  } finally {
    await client.close();
    writeFileSync(join(project, "Library/UnityMcpHttpMonitoring.json"), JSON.stringify(report, null, 2) + "\n");
  }
});
