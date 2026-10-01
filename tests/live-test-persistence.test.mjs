import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { McpTestClient } from "./helpers/mcp-client.mjs";

const project = process.env.UNITY_MCP_TESTING_PROJECT;
const canonical = path => realpathSync(path).replaceAll("\\", "/").toLowerCase();

test("completed results and a native test job survive actual script reloads", {
  skip: !project && "set UNITY_MCP_TESTING_PROJECT to an open marked project containing tools~/TestingFixture",
  timeout: 240_000,
}, async () => {
  assert.ok(isAbsolute(project));
  assert.ok(existsSync(join(project, ".unity-mcp-validation")));
  assert.ok(existsSync(join(project, "Assets/__McpTestingFixture/EditMode/ReloadCases.cs")));
  const client = new McpTestClient({ timeoutMs: 35_000, serverEntry: process.env.UNITY_MCP_TESTING_SERVER_ENTRY }).start();
  const report = { nodeVersion: process.version, passed: false, checks: [] };
  let port;
  const discover = async () => {
    const result = await client.callTool("unity_list_instances", { refresh: true });
    const instance = result.payload.instances.find(item => item.projectPath && canonical(item.projectPath) === canonical(project));
    assert.ok(instance, "The marked project was not discovered");
    port = instance.port;
    const selected = await client.callTool("unity_select_instance", { port });
    assert.equal(selected.isError, false, selected.payloadText);
  };
  const raw = (name, args = {}) => client.callTool(name.startsWith("unity_testing_") ? "unity_advanced_tool" : name,
    name.startsWith("unity_testing_") ? { port, tool: name, params: args } : { port, ...args });
  const call = async (name, args = {}) => {
    const result = await raw(name, args);
    assert.equal(result.isError, false, result.payloadText);
    return result.payload.data;
  };
  const code = async code => (await call("unity_execute_code", { code })).result;
  const job = async id => {
    const result = await raw("unity_testing_get_job", { jobId: id, includeDetails: true });
    assert.equal(result.payload.data?.jobId, id, result.payloadText);
    return result.payload.data;
  };
  const session = async () => (await call("unity_queue_info")).queueSessionId;
  const config = () => code(`var active = typeof(UnityEditor.TestTools.TestRunner.Api.TestRunnerApi).GetMethod("IsRunActive", System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Public);
return new { enabled = EditorSettings.enterPlayModeOptionsEnabled, options = (int)EditorSettings.enterPlayModeOptions, nativeActive = (bool)active.Invoke(null, null), guard = SessionState.GetBool("MCPTestRunner_PlayModeGuard", false) };`);
  const idle = async () => {
    const deadline = Date.now() + 60_000;
    do {
      const state = await config();
      if (!state.nativeActive) return state;
      await delay(500);
    } while (Date.now() < deadline);
    throw new Error("Native Test Runner did not finish cleanup");
  };
  const terminal = async id => {
    const deadline = Date.now() + 60_000;
    do {
      const state = await job(id);
      if (state.status !== "running") { await idle(); return state; }
      await delay(500);
    } while (Date.now() < deadline);
    throw new Error(`Job ${id} stayed running`);
  };
  const afterReload = async previous => {
    const deadline = Date.now() + 90_000;
    let lastError;
    do {
      await delay(1000);
      try {
        await discover();
        const next = await session();
        if (next && next !== previous) return next;
      } catch (error) { lastError = error.message; }
    } while (Date.now() < deadline);
    throw new Error(`Script reload did not produce a new editor queue session: ${lastError ?? previous}`);
  };
  try {
    await client.initialize();
    await discover();
    for (const tool of ["unity_queue_info", "unity_testing_run_tests", "unity_testing_get_job"])
      await client.callTool("unity_list_advanced_tools", { port, tool });
    const state = await call("unity_editor_state");
    assert.equal(state.sceneDirty, false);
    assert.equal(state.isPlaying, false);
    assert.equal(state.isCompiling, false);
    report.unityVersion = state.unityVersion;
    const original = await idle();
    assert.equal(original.guard, false);
    const started = await call("unity_testing_run_tests", { mode: "EditMode", testNames: ["Pass", "Fail"].map(name => "UnityMcpValidation.EditModeCases." + name) });
    const before = await terminal(started.jobId);
    assert.equal(before.resultsComplete, true);
    assert.equal(before.tests.length, 2);
    const oldSession = await session();
    await code(`double deadline = EditorApplication.timeSinceStartup + 1; EditorApplication.CallbackFunction reload = null;
reload = () => { if (EditorApplication.timeSinceStartup < deadline) return; EditorApplication.update -= reload; EditorUtility.RequestScriptReload(); };
EditorApplication.update += reload; return true;`);
    const newSession = await afterReload(oldSession);
    const after = await job(before.jobId);
    for (const key of ["status", "summary", "progress", "tests", "resultsComplete", "startedAt", "completedAt"])
      assert.deepEqual(after[key], before[key], `Completed job changed across reload: ${key}`);
    report.checks.push({ name: "Completed results and failure diagnostics survive reload", jobId: before.jobId,
      beforeSession: oldSession, afterSession: newSession, details: after.tests.length, resultsComplete: after.resultsComplete });

    await code('SessionState.SetInt("McpValidation_ReloadRequests", 0); return true;');
    const nativeSession = await session();
    const running = await call("unity_testing_run_tests", { mode: "EditMode", groupNames: ["UnityMcpValidation.ReloadCases"] });
    assert.ok(running.jobId);
    let progress;
    const progressDeadline = Date.now() + 4000;
    do {
      progress = await job(running.jobId);
      if (progress.progress.currentTest?.endsWith(".ReloadAndPass")) break;
      await delay(100);
    } while (Date.now() < progressDeadline);
    assert.equal(progress.progress.completed, 2, JSON.stringify(progress));
    assert.equal(progress.progress.failed, 1);
    const resumedSession = await afterReload(nativeSession);
    const resumed = await terminal(running.jobId);
    assert.equal(resumed.status, "failed");
    assert.equal(resumed.error, undefined);
    assert.equal(resumed.recoveryWarning, undefined);
    assert.equal(resumed.persistenceWarning, undefined);
    assert.deepEqual([resumed.summary.total, resumed.summary.passed, resumed.summary.failed, resumed.progress.completed], [3, 2, 1, 3]);
    assert.equal(resumed.resultsComplete, true);
    assert.equal(resumed.tests.length, 3);
    assert.equal(resumed.tests.find(item => item.fullName.endsWith(".ReloadAndPass"))?.status, "Passed");
    assert.match(resumed.tests.find(item => item.fullName.endsWith(".FailBeforeReload"))?.message ?? "", /MCP failure before reload/);
    const requests = await code('return SessionState.GetInt("McpValidation_ReloadRequests", 0);');
    assert.equal(requests, 1);
    report.checks.push({ name: "Native run resumes with the original MCP job ID and no replay", jobId: running.jobId,
      beforeSession: nativeSession, afterSession: resumedSession, completedBeforeReload: progress.progress.completed,
      finalSummary: resumed.summary, details: resumed.tests.length, reloadRequests: requests });
    assert.deepEqual(await idle(), original);
    const compilation = await call("unity_get_compilation_errors", { severity: "error" });
    assert.equal(compilation.isCompiling, false);
    assert.equal(compilation.count, 0, JSON.stringify(compilation));
    assert.deepEqual(client.stdoutViolations, []);
    assert.equal((await call("unity_editor_state")).sceneDirty, false);
    report.passed = true;
  } finally {
    writeFileSync(join(project, "Library/UnityMcpTestPersistence.json"), JSON.stringify(report, null, 2));
    await client.close();
  }
});
