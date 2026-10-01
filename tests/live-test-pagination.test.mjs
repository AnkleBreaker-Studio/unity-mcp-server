import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { McpTestClient } from "./helpers/mcp-client.mjs";

const project = process.env.UNITY_MCP_TEST_PAGINATION_PROJECT;
const serverEntry = process.env.UNITY_MCP_TEST_SERVER_ENTRY;
const canonical = path => realpathSync(path).replaceAll("\\", "/").toLowerCase();

test("live result pages recover large responses and preserve native results through reload", {
  skip: !project && "set UNITY_MCP_TEST_PAGINATION_PROJECT to a marked open editor with TestPaginationValidation.cs and TestingFixture",
  timeout: 240_000,
}, async () => {
  assert.ok(isAbsolute(project) && existsSync(join(project, ".unity-mcp-validation")));
  assert.ok(existsSync(join(project, "Assets/__McpTestingFixture/EditMode/EditModeCases.cs")));
  const client = new McpTestClient({ serverEntry, timeoutMs: 60_000, env: { UNITY_RESPONSE_HARD_LIMIT: "32768", UNITY_RESPONSE_SOFT_LIMIT: "32768" } }).start();
  const report = { nodeVersion: process.version, serverEntry: serverEntry || "current", passed: false };
  let port, syntheticJob;
  const raw = (name, args = {}) => client.callTool(name.startsWith("unity_testing_") ? "unity_advanced_tool" : name,
    name.startsWith("unity_testing_") ? { port, tool: name, params: args } : { ...args, port });
  async function call(name, args = {}) { const result = await raw(name, args); assert.notEqual(result.isError, true, result.payloadText); return result.payload.data ?? result.payload; }
  const guard = `if (!UnityEngine.Application.dataPath.Replace('\\\\', '/').Equals(${JSON.stringify(join(project, "Assets").replaceAll("\\", "/"))}, System.StringComparison.OrdinalIgnoreCase) || !System.IO.File.Exists(".unity-mcp-validation")) throw new System.Exception("Unexpected validation project");\n`;
  async function code(source) { const result = await call("unity_execute_code", { code: guard + source }); assert.equal(result.success, true, JSON.stringify(result)); return result.result; }
  async function until(label, action) {
    let last;
    for (const deadline = Date.now() + 90_000; Date.now() < deadline; await delay(500)) {
      try { const result = await action(); if (result) return result; } catch (error) { last = error; }
    }
    throw new Error(`${label}: ${last?.message || "state did not converge"}`);
  }
  async function ready(previousSession) {
    return until("Editor readiness", async () => {
      const instance = (await call("unity_list_instances", { refresh: true })).instances.find(x => x.projectPath && canonical(x.projectPath) === canonical(project));
      assert.ok(instance); port = instance.port; await call("unity_select_instance");
      const state = await call("unity_editor_state"); if (state.isCompiling) return false;
      assert.equal(state.isPlaying, false); assert.equal(state.sceneDirty, false); assert.equal(canonical(state.projectPath), canonical(project));
      assert.equal((await call("unity_get_compilation_errors", { severity: "error" })).count, 0);
      const queue = await call("unity_queue_info");
      return (!previousSession || queue.queueSessionId !== previousSession) && { instance, state, queue };
    });
  }
  const options = () => code("return new { enabled = UnityEditor.EditorSettings.enterPlayModeOptionsEnabled, options = (int)UnityEditor.EditorSettings.enterPlayModeOptions, guard = UnityEditor.SessionState.GetBool(\"MCPTestRunner_PlayModeGuard\", false) };");
  const idle = () => until("Native test cleanup", async () => !(await code("var method = typeof(UnityEditor.TestTools.TestRunner.Api.TestRunnerApi).GetMethod(\"IsRunActive\", System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic); return (bool)method.Invoke(null, null);")));
  async function pages(jobId, limit, includeFailedOnly = false) {
    const tests = []; let offset = 0, count = 0, maxBytes = 0;
    for (;;) {
      const response = await raw("unity_testing_get_job", { jobId, resultOffset: offset, resultLimit: limit, includeFailedOnly });
      assert.notEqual(response.isError, true, response.payloadText);
      const result = response.payload.data; assert.equal(result.jobId, jobId);
      assert.ok(result.resultPage); assert.equal(result.resultPage.offset, offset); assert.equal(result.resultPage.stable, true);
      assert.equal(result.tests.length, result.resultPage.returned); assert.ok(result.tests.length <= limit);
      maxBytes = Math.max(maxBytes, Buffer.byteLength(response.payloadText)); tests.push(...result.tests); count++;
      if (!result.resultPage.hasMore) { assert.equal(result.resultPage.nextOffset, null); assert.equal(tests.length, result.resultPage.total); break; }
      assert.ok(result.resultPage.nextOffset > offset); offset = result.resultPage.nextOffset;
      assert.ok(count < 100, "Page traversal did not terminate");
    }
    return { tests, pages: count, maxPayloadBytes: maxBytes };
  }
  try {
    await client.initialize(); const initial = await ready(); report.project = initial.instance;
    const original = await options(); assert.equal(original.guard, false); await idle();
    report.controlled = await code("return UnityMcpTestPaginationValidation.Validate();"); assert.equal(report.controlled.passed, true);
    syntheticJob = await code("return UnityMcpTestPaginationValidation.CreateJob(1000);");
    const full = await raw("unity_testing_get_job", { jobId: syntheticJob, includeDetails: true });
    if (!serverEntry) { assert.equal(full.isError, true); assert.equal(full.payload.code, "response_too_large"); }
    const large = await pages(syntheticJob, 100); assert.equal(large.tests.length, 1000); assert.equal(large.pages, 10); assert.ok(large.maxPayloadBytes < 32768);
    assert.deepEqual(large.tests.map(x => x.fullName), Array.from({ length: 1000 }, (_, i) => `Pagination.Case${i}`));
    report.largeResponse = { records: large.tests.length, pages: large.pages, maxPayloadBytes: large.maxPayloadBytes,
      unpagedRejected: full.isError, unpagedCode: full.payload?.code ?? null, hardLimitAssertion: !serverEntry };
    await code(`UnityMcpTestPaginationValidation.RemoveJob(${JSON.stringify(syntheticJob)}); return true;`); syntheticJob = null;
    const found = await call("unity_testing_list_tests", { mode: "EditMode", nameFilter: "UnityMcpValidation.EditModeCases.", maxResults: 200 });
    const names = found.tests.map(x => x.fullName).filter(x => !x.endsWith(".Slow")); assert.equal(names.length, 6);
    const started = await call("unity_testing_run_tests", { mode: "EditMode", testNames: names }); assert.ok(started.jobId);
    const complete = await until("Native test completion", async () => {
      const job = await call("unity_testing_get_job", { jobId: started.jobId, includeDetails: true }); return job.status !== "running" && job;
    });
    await idle(); assert.equal(complete.resultsComplete, true); assert.equal(complete.tests.length, 6);
    assert.equal(complete.summary.passed, 3); assert.equal(complete.summary.failed, 1); assert.equal(complete.summary.skipped, 2);
    const nativePages = await pages(started.jobId, 2); assert.deepEqual(nativePages.tests, complete.tests);
    const failedPages = await pages(started.jobId, 1, true);
    assert.deepEqual(failedPages.tests, complete.tests.filter(x => ["Failed", "Inconclusive"].includes(x.status)));
    assert.equal(failedPages.tests.length, 2);
    report.native = { jobId: started.jobId, summary: complete.summary, resultCount: complete.tests.length, pages: nativePages.pages, failurePages: failedPages.pages, exactDetails: true };
    const previousSession = (await call("unity_queue_info")).queueSessionId;
    await code("double at = UnityEditor.EditorApplication.timeSinceStartup + 1; UnityEditor.EditorApplication.CallbackFunction reload = null; reload = () => { if (UnityEditor.EditorApplication.timeSinceStartup < at) return; UnityEditor.EditorApplication.update -= reload; UnityEditor.EditorUtility.RequestScriptReload(); }; UnityEditor.EditorApplication.update += reload; return true;");
    const reloaded = await ready(previousSession); const after = await pages(started.jobId, 2); assert.deepEqual(after.tests, complete.tests);
    assert.deepEqual(await options(), original); assert.equal(reloaded.state.activeScenePath, initial.state.activeScenePath);
    report.reload = { originalJobIdRetained: true, exactDetails: true, settingsRestored: true, scenePreserved: true }; report.passed = true;
  } catch (error) { report.error = error.stack; throw error; }
  finally {
    try { if (syntheticJob) await code(`UnityMcpTestPaginationValidation.RemoveJob(${JSON.stringify(syntheticJob)}); return true;`); assert.deepEqual(client.stdoutViolations, []); }
    finally { await client.close(); writeFileSync(join(project, "Library", "UnityMcpTestPaginationLive.json"), JSON.stringify(report, null, 2) + "\n"); }
  }
});
