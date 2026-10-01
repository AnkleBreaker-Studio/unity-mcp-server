import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { McpTestClient } from "./helpers/mcp-client.mjs";

const project = process.env.UNITY_MCP_TESTING_PROJECT;
const serverEntry = process.env.UNITY_MCP_TESTING_SERVER_ENTRY;
const canonical = path => realpathSync(path).replaceAll("\\", "/").toLowerCase();

test("live Test Runner restores options after success, prebuild failure and cancellation", {
  skip: !project && "set UNITY_MCP_TESTING_PROJECT to an open marked project containing the plugin's tools~/TestingFixture",
  timeout: 300_000,
}, async () => {
  assert.ok(isAbsolute(project));
  assert.ok(existsSync(join(project, ".unity-mcp-validation")));
  assert.ok(existsSync(join(project, "Assets", "__McpTestingFixture", "PlayMode", "PlayModeCases.cs")));
  const client = new McpTestClient({ timeoutMs: 90_000, serverEntry }).start();
  const report = { nodeVersion: process.version, passed: false, checks: [] };
  let port, original;
  const raw = async (name, args = {}) => client.callTool(name.startsWith("unity_testing_") ? "unity_advanced_tool" : name,
    name.startsWith("unity_testing_") ? { port, tool: name, params: args } : { port, ...args });
  const call = async (name, args = {}) => {
    const result = await raw(name, args);
    assert.equal(result.isError, false, result.payloadText);
    return result.payload.data;
  };
  const code = async code => (await call("unity_execute_code", { code })).result;
  const config = () => code(`var native = typeof(UnityEditor.TestTools.TestRunner.Api.TestRunnerApi).GetMethod("IsRunActive", System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic);
return new { enabled = EditorSettings.enterPlayModeOptionsEnabled, options = (int)EditorSettings.enterPlayModeOptions,
guard = SessionState.GetBool("MCPTestRunner_PlayModeGuard", false), nativeActive = (bool)native.Invoke(null, null),
isPlaying = EditorApplication.isPlaying, isCompiling = EditorApplication.isCompiling };`);
  const idle = async () => {
    const deadline = Date.now() + 60_000;
    let state;
    do {
      state = await config();
      if (!state.nativeActive && !state.isPlaying && !state.isCompiling) return state;
      await delay(500);
    } while (Date.now() < deadline);
    throw new Error(`Native Test Runner did not finish cleanup: ${JSON.stringify(state)}`);
  };
  const job = async id => {
    const result = await raw("unity_testing_get_job", { jobId: id, includeDetails: true });
    assert.ok(result.payload.data?.jobId, result.payloadText);
    return result.payload.data;
  };
  const start = async (mode, name) => {
    await idle();
    const result = await raw("unity_testing_run_tests", { mode, testNames: Array.isArray(name) ? name : [name] });
    assert.ok(result.payload.data?.jobId, result.payloadText);
    return result.payload.data;
  };
  const terminal = async started => {
    let result = started;
    const deadline = Date.now() + 60_000;
    while (result.status === "running" && Date.now() < deadline) {
      await delay(500);
      result = await job(started.jobId);
    }
    assert.notEqual(result.status, "running", JSON.stringify(result));
    await idle();
    return job(started.jobId);
  };
  const expectRestored = async expected => {
    const current = await idle();
    assert.equal(current.enabled, expected.enabled);
    assert.equal(current.options, expected.options);
    assert.equal(current.guard, false);
  };
  try {
    await client.initialize();
    const instances = await client.callTool("unity_list_instances", { refresh: true });
    const instance = instances.payload.instances.find(item => item.projectPath && canonical(item.projectPath) === canonical(project));
    assert.ok(instance);
    port = instance.port;
    await client.callTool("unity_select_instance", { port });
    const state = await call("unity_editor_state");
    assert.equal(state.sceneDirty, false);
    assert.equal(state.isCompiling, false);
    assert.equal(state.isPlaying, false);
    original = await idle();
    assert.equal(original.guard, false);
    report.unityVersion = state.unityVersion;
    for (const tool of ["unity_testing_run_tests", "unity_testing_get_job", "unity_testing_list_tests"])
      await client.callTool("unity_list_advanced_tools", { tool, port });
    const available = await call("unity_testing_list_tests", { mode: "PlayMode", nameFilter: "UnityMcpValidation", maxResults: 20 });
    assert.ok(available.tests.some(item => item.fullName === "UnityMcpValidation.PlayModeCases.Pass"));
    const fixture = "UnityMcpValidation.EditModeCases.";
    const exact = await call("unity_testing_list_tests", { mode: "EditMode", nameFilter: fixture + "Pass", maxResults: 1 });
    assert.equal(exact.totalTests, 1);
    assert.equal(exact.truncated, false);
    const cases = await call("unity_testing_list_tests", { mode: "EditMode", nameFilter: fixture + "Parameterized", maxResults: 2 });
    assert.equal(cases.totalTests, 2);
    assert.equal(cases.truncated, false);
    assert.ok(cases.tests.every(item => item.fullName.includes("Parameterized(")));
    const limited = await call("unity_testing_list_tests", { mode: "EditMode", nameFilter: fixture + "Parameterized", maxResults: 1 });
    assert.equal(limited.totalTests, 1);
    assert.equal(limited.truncated, true);
    for (const maxResults of [0, -1, 1.5, 10001]) {
      const invalid = await raw("unity_testing_list_tests", { mode: "EditMode", maxResults });
      assert.equal(invalid.isError, true);
      assert.match(invalid.payloadText, /maxResults must be an integer/);
    }
    report.checks.push("Actual parameterized discovery, exact/over-limit truncation and rejected invalid limits");
    await code("EditorSettings.enterPlayModeOptions = EnterPlayModeOptions.DisableSceneReload; return true;");
    const expected = await config();

    for (const [name, status, failed] of [["Pass", "succeeded", 0], ["Fail", "failed", 1]]) {
      const result = await terminal(await start("EditMode", `UnityMcpValidation.EditModeCases.${name}`));
      assert.equal(result.status, status);
      assert.equal(result.summary.failed, failed);
      assert.ok(result.tests.some(item => item.fullName.endsWith(`.${name}`)));
      await expectRestored(expected);
    }
    report.checks.push("Real EditMode pass/failure and detailed results");

    const mixed = await terminal(await start("EditMode", ["Pass", "Fail", "Skip", "Inconclusive"].map(name => fixture + name).concat(cases.tests.map(item => item.fullName))));
    assert.equal(mixed.status, "failed");
    assert.deepEqual([mixed.summary.total, mixed.summary.passed, mixed.summary.failed, mixed.summary.skipped, mixed.progress.completed], [6, 3, 1, 2, 6]);
    assert.equal(mixed.tests.length, 6);
    assert.equal(mixed.resultsComplete, true);
    const failedOnly = await call("unity_testing_get_job", { jobId: mixed.jobId, includeFailedOnly: true });
    assert.deepEqual(failedOnly.tests.map(item => item.status).sort(), ["Failed", "Inconclusive"]);
    const setup = await terminal(await start("EditMode", ["First", "Second"].map(name => "UnityMcpValidation.SetupFailureCases." + name)));
    assert.equal(setup.status, "failed");
    assert.equal(setup.summary.failed, 2);
    assert.equal(setup.progress.completed, 2);
    assert.equal(setup.resultsComplete, true);
    assert.equal(setup.tests.length, 2);
    assert.ok(setup.tests.every(item => item.status === "Failed" && item.message.includes("MCP controlled fixture setup failure")));
    await expectRestored(expected);
    report.checks.push("Real mixed results and fixture setup failures retain authoritative counts and complete details");

    await call("unity_console_clear");
    const prebuild = await terminal(await start("PlayMode", "UnityMcpValidation.PrebuildFailure.NeverStarted"));
    assert.equal(prebuild.status, "failed");
    assert.ok(prebuild.error);
    const errors = await call("unity_console_log", { count: 20, type: "error", includeStackTrace: "none" });
    assert.match(JSON.stringify(errors), /MCP controlled prebuild failure/);
    report.prebuildError = prebuild.error;
    await expectRestored(expected);
    report.checks.push("Real prebuild failure releases the job and restores Play Mode options");

    for (let run = 0; run < 2; run++) {
      const play = await terminal(await start("PlayMode", "UnityMcpValidation.PlayModeCases.Pass"));
      assert.equal(play.status, "succeeded");
      assert.equal(play.summary.passed, 1);
      assert.equal(play.tests.length, 1);
      assert.equal(play.tests[0].fullName, "UnityMcpValidation.PlayModeCases.Pass");
      await expectRestored(expected);
    }
    report.checks.push("Two consecutive real PlayMode successes after a prebuild failure without script reload");

    for (const mode of ["EditMode", "PlayMode"]) {
      const running = await start(mode, `UnityMcpValidation.${mode}Cases.Slow`);
      assert.equal(running.status, "running", JSON.stringify(running));
      let active = running;
      const startedDeadline = Date.now() + 30_000;
      while (active.status === "running" && !active.progress?.currentTest?.endsWith(".Slow") && Date.now() < startedDeadline) {
        await delay(500);
        active = await job(running.jobId);
      }
      assert.ok(active.progress?.currentTest?.endsWith(".Slow"), JSON.stringify(active));
      let cleared;
      if (mode === "EditMode") {
        const outcome = await code(`var cleared = UnityMCP.Editor.MCPTestRunnerCommands.RunTests(new Dictionary<string,object>{{"clearStuck",true}});
var next = UnityMCP.Editor.MCPTestRunnerCommands.RunTests(new Dictionary<string,object>{{"mode","EditMode"},{"testNames",new List<object>{"UnityMcpValidation.EditModeCases.Pass"}}});
return new { cleared, next };`);
        cleared = outcome.cleared;
        assert.match(outcome.next.error, /running|cleaning up/);
      } else cleared = await call("unity_testing_run_tests", { clearStuck: true });
      assert.equal(cleared.clearedJobId, running.jobId);
      assert.equal(cleared.cancellationRequested, true);
      await expectRestored(expected);
      const result = await job(running.jobId);
      assert.equal(result.status, "failed");
      assert.equal(result.error, "Force-cleared by user");
    }
    report.checks.push("Native EditMode/PlayMode cancellation and rejection during cleanup");
    const after = await terminal(await start("EditMode", "UnityMcpValidation.EditModeCases.Pass"));
    assert.equal(after.status, "succeeded");
    assert.equal(after.summary.passed, 1);
    report.checks.push("A new job succeeds after cancelled jobs finish cleanup");
    const emptyClear = await call("unity_testing_run_tests", { clearStuck: true });
    assert.equal(emptyClear.clearedJobId, null);
    assert.equal(emptyClear.cancellationRequested, false);
    assert.equal(emptyClear.nativeRunMayContinue, false);
    assert.equal((await call("unity_testing_get_job")).jobId, after.jobId);
    report.checks.push("Clearing an absent job leaves the latest job unchanged and starts no native run");
    assert.equal((await call("unity_editor_state")).sceneDirty, false);
    const compilation = await call("unity_get_compilation_errors", { severity: "error" });
    assert.equal(compilation.isCompiling, false);
    assert.equal(compilation.count, 0);
    assert.deepEqual(client.stdoutViolations, []);
    report.passed = true;
  } finally {
    try {
      if (original) {
        await idle();
        await code(`EditorSettings.enterPlayModeOptionsEnabled = ${original.enabled}; EditorSettings.enterPlayModeOptions = (EnterPlayModeOptions)${original.options}; return true;`);
        await expectRestored(original);
        report.originalSettingsRestored = true;
      }
    } catch (error) {
      report.passed = false;
      report.cleanupError = error.message;
      throw error;
    } finally {
      await client.close();
      writeFileSync(join(project, "Library", "UnityMcpTesting.json"), JSON.stringify(report, null, 2) + "\n");
    }
  }
});
