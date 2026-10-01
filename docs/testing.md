# Test Runner jobs

Discover `unity_testing_list_tests`, `unity_testing_run_tests` and `unity_testing_get_job` through `unity_list_advanced_tools`, then call them through `unity_advanced_tool`. Select the editor explicitly and retain its discovered port. Test jobs belong to that editor, with one active MCP test job at a time.

Start with an EditMode or PlayMode filter, retain the returned `jobId`, and poll that ID until its status is `succeeded` or `failed`. `includeDetails` returns individual test results; `includeFailedOnly` limits them to failed/inconclusive results. Existing tool names, arguments, job IDs and status values remain compatible.

For large jobs, optional `resultOffset` and `resultLimit` request bounded detail pages on updated plugins. `resultPage` provides the matching count and next offset; wait for terminal status before stable enumeration. Omitting both fields preserves full legacy responses. See [pagination, compatibility and measured construction costs](test-pagination.md). Native command errors and unsupported paging stop server-side `waitTimeout` polling immediately.

## Discovery and result counts

Discovery returns test cases, including individual parameterized cases. Empty suites and fixture containers are not tests. `maxResults` defaults to 200 and accepts integers from 1 to 10,000; invalid values return a command error before starting native discovery. The existing `totalTests` field remains the number returned, and `truncated` is true only when another matching test exists. Collection stops at the first matching overflow without constructing its result dictionary. Unity still builds its native test tree before this collection step.

Progress while running comes from callbacks. At completion, Unity's aggregate counts and final result tree replace that provisional data, correcting missed or duplicated intermediate callbacks. Existing result records are reused where possible. The legacy `skipped` count still includes inconclusive cases, while individual entries retain their actual status. A suite-level failure remains a failed job even when no leaf failure exists.

The additive `resultsComplete` field tells whether the detailed list accounts for every completed test. It does not indicate that the job has finished; use `status` for that. Missing native details, legacy summaries or a damaged snapshot can make it false. Current jobs retain complete available details through script reload; older summary-only records remain readable.

Repeated PlayMode runs exposed a Test Framework 1.8 cache defect: its subsystem reset clears the assembly list, while the loader only populates a null list. With domain reload disabled, a later run can therefore execute zero tests even though discovery lists them. A controlled cache reset restored the requested test. Before starting a PlayMode job, the plugin now invalidates that cache when the inspected private reset hook and list field exist. The inspected 1.1.31 implementation has no such hook and is left alone. This is a compatibility workaround for native framework state, not a replay of an empty run.

## Failure and cleanup

PlayMode jobs temporarily disable domain reload to keep callbacks alive. The plugin now restores the original Play Mode settings and releases its callbacks after normal completion, a synchronous startup exception, a framework error or an explicit clear. Callbacks are bound to their job ID, so a retained callback from an older job cannot change its replacement.

Unity reports build/prebuild failures through `IErrorCallbacks.OnError`. A job can therefore fail before any individual test executes; its failed-test count may still be zero. Some Test Framework failures provide only a generic message in that callback. Read the Unity console for the original exception. [Unity's error callback contract](https://docs.unity3d.com/Packages/com.unity.test-framework@1.1/api/UnityEditor.TestTools.TestRunner.Api.IErrorCallbacks.html).

Use `unity_testing_run_tests` with `clearStuck: true` to fail and release the current MCP job. Start a replacement in a separate call after native cleanup finishes. Clearing when no MCP job is active now returns success with `clearedJobId: null` and starts nothing; the previous handler could fall through to an unfiltered EditMode run.

The clear response retains its existing fields and adds:

| Field | Meaning |
|---|---|
| `cancellationRequested` | Unity accepted a native cancellation request for the stored run ID. This is not proof cleanup has finished. |
| `cancellationError` | An exception from requesting native cancellation, or `null`. |
| `nativeRunMayContinue` | Unity still reports an active native run, or its state could not be checked. |

Cancellation is cooperative. Older Test Framework versions without the public `CancelTestRun` API release the MCP job but may continue running the native tests. A blocking test still blocks the editor. This operation is separate from cancelling an MCP request, which stops server observation without cancelling Unity work.

Unity broadcasts test callbacks globally. Before starting a new job, the plugin checks native run activity, including cleanup and runs started outside MCP. The state check uses the internal `IsRunActive` method found in the inspected Test Framework 1.1.31 and 1.8.0 implementations. If it becomes unavailable, starting tests reports an explicit error instead of admitting overlapping jobs. The public callback registration contract also documents that registrations are global. [Unity TestRunnerApi](https://docs.unity3d.com/Packages/com.unity.test-framework@1.1/api/UnityEditor.TestTools.TestRunner.Api.TestRunnerApi.html).

## Script reload and retained history

Before assembly reload, the plugin saves changed job snapshots, unregisters its callbacks and destroys its owned API instance. Snapshots retain detailed results, failure messages/stacks, all four filter families, current-test identity and its timer. Unchanged snapshots are reused; individual test callbacks only mark their job dirty. UTC timestamps preserve elapsed time and latest-job ordering. Unity's SessionState survives assembly reload and is cleared when the editor exits, so this is session history rather than durable storage across restarts. [Unity SessionState](https://docs.unity3d.com/2021.3/Documentation/ScriptReference/SessionState.html).

After reconnecting to the same editor, poll the original `jobId`. An active job is matched to the native run ID in Test Framework's serialized job holder before its runner dictionary is rebuilt. A matching active native run remains running regardless of its age; a definitely absent native run becomes a failed job without restarting tests. The former five-minute heuristic has been removed. The private holder shape was inspected in Test Framework 1.1.31 and 1.8.0; real reload execution is validated on 1.8.0. Missing legacy identity or an unsupported holder produces `recoveryWarning`, retaining the job for explicit inspection/clear rather than guessing its outcome.

Individual damaged summary records do not prevent later valid jobs from restoring. Missing, damaged or unsupported snapshots preserve the summary and expose `persistenceWarning`; `resultsComplete` still compares available details with completed tests. A damaged entire history index cannot reconstruct independent snapshots. Old summary-only records stay readable, but their missing details cannot be recovered retroactively.

History expires completed jobs after 30 minutes, keeps at most 128 jobs, and evicts oldest completed history when serialized snapshot data exceeds a 32 MiB UTF-8 budget. The active job and newest job are protected from size eviction; oversized results are retained intact and reported as `overBudget`. This budget is a retention target, not a hard bound on native/managed memory, response size or temporary serialization allocations. Expiry is checked on reads as well as admission, save and reload; removed snapshots are erased from SessionState.

The additive `historyRetention` object reports `retainedJobs`, `maxJobs`, `expiryMinutes`, `snapshotBytes`, `snapshotBudgetBytes`, `evictions` and `overBudget`. Byte counts describe the last saved snapshots; a running job's latest callbacks may not yet be serialized. Server response limits still apply when retrieving large detailed results.

A real native reload also exposed normal HTTP worker interruption being logged as an error. The bridge now lets `ThreadAbortException` propagate without logging or attempting a 500 response. Other request exceptions retain their existing diagnostics. This prevents the bridge's shutdown message from failing an otherwise valid Unity test.

## Evidence and limits

The [validation report](validation/unity66-testing.json) separates controlled failures from real test execution on Windows/Unity 6000.6.2f1 with Test Framework 1.8.0. The baseline left Play Mode options changed after startup failure, a framework error and a forced clear; normal completion was the passing control. A controlled empty-clear probe also scheduled an unexpected run. A subsequent live check exposed restored local timestamps sorting ahead of newer UTC jobs.

All 19 controlled checks pass, covering four Play Mode option masks, late callbacks, API cleanup, session restoration, empty clear and UTC ordering. Live tests cover EditMode success/assertion failure, an actual prebuild exception, PlayMode success, cancellation in both modes, rejection during native cleanup and a successful next run. The current server and released server `826af5c` each pass this sequential workflow on Node 18 and 22; the marked project's original Play Mode settings are restored. All 163 ordinary server tests also pass locally on both Node versions.

The subsequent [discovery and result report](validation/unity66-test-results.json) records empty-suite and final-count failures, exact-limit truncation and rejected limits. Its controlled suite covers final-tree reconciliation with missing/duplicate callbacks, suite-level failure, bounded discovery traversal and incomplete native details. The expanded live suite includes parameterized tests, ignored/inconclusive results and actual fixture setup failures.

The earlier live suite checked the PlayMode passed count, which could hide an empty suite miscounted as a passing test. The expanded suite requires the exact test name in two consecutive PlayMode results without script reload, then waits for each slow test to actually start before requesting cancellation. Use this newer report for those execution guarantees.

All ten result/discovery checks and the nineteen lifecycle regressions pass. The expanded current/released-server suites pass on Node 18 and 22, consecutively in one Unity editor. That checkpoint also reproduced loss of completed-job details after a real reload; the subsequent persistence change below repairs it.

The [persistence report](validation/unity66-test-persistence.json) adds five reproduced restoration failures plus a passing legacy control, then twelve passing checks including corruption, current-test progress, native identity, all filters, count/age/byte retention and oversized newest results. The nineteen lifecycle checks and ten discovery/result checks remain green. A separate owned HTTP-worker fixture reproduces and fixes the shutdown error log.

Actual completed-job reload preserves the two results, failure diagnostics, counts and timestamps. A native three-test suite completes two tests before reload and resumes the third with the same MCP job ID; it finishes with all three details, the intended failure and a single reload request. The current server and released server `826af5c` both pass these checks on Node 18 and 22, sequentially in the same editor. The fixture verifies a supported EditMode reload instruction, not arbitrary script changes or every PlayMode/player-build transition.

All 71 editor sources pass the Unity 2021.3.18f1 API compiler check. Actual older-editor execution remains deferred by maintainer direction. Other operating systems, player-build test runs, arbitrary reload failures, future private Test Framework API changes and large-project native discovery/serialization costs need further coverage.

## Reproduce

In an open disposable project containing `.unity-mcp-validation`, copy the companion plugin's `tools~/TestingFixture` directory to `Assets/__McpTestingFixture`. Let Unity finish compiling, save the scene and exit Play Mode. The fixture contains intentional failures and must stay out of production projects.

From the server repository:

```powershell
$env:UNITY_MCP_TESTING_PROJECT = 'C:/validation/Health66'
npm run test:testing
```

The suite selects by canonical project path and writes `Library/UnityMcpTesting.json`. Set `UNITY_MCP_TESTING_SERVER_ENTRY` to a released server's absolute `src/index.js` path for the same sequential workflow with that server. Run suites one at a time, without changing scripts during execution.

From the plugin repository, in a closed disposable project:

```powershell
./tools~/validate-unity.ps1 -EditorPath 'C:/Unity/Editor/Unity.exe' `
  -ProjectPath 'C:/validation/Testing66' -Suite Testing
```

This controlled suite replaces the native scheduling delegate; it launches no native tests. It writes `Library/UnityMcpTestRunnerValidation.json` and restores the fixture settings before exiting.

Use `-Suite TestResults` for controlled test-tree/result checks, which write `Library/UnityMcpTestResultsValidation.json`. These use synthetic Unity adaptors and the actual plugin callbacks; they also launch no native tests. To reproduce the empty-project check, discover tests in a marked project without any test assemblies: it should return `totalTests: 0`, `truncated: false` and an empty list.

Use `-Suite TestPersistence` for the twelve controlled session/history checks and `-Suite RequestShutdown` for an owned HTTP worker aborted during its main-thread wait. Their reports are `Library/UnityMcpTestPersistenceValidation.json` and `Library/UnityMcpRequestShutdownValidation.json`. Run `npm run test:test-persistence` with the same marked open project for completed-job and in-flight native script reloads; this writes `Library/UnityMcpTestPersistence.json` and also accepts `UNITY_MCP_TESTING_SERVER_ENTRY`.
