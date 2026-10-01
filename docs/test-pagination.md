# Reading large Test Runner results

`unity_testing_get_job` accepts optional `resultOffset` and `resultLimit` fields on updated plugins. They limit detailed result construction before JSON serialization, allowing a large job to be read in smaller responses. Existing callers that omit both fields retain the original summary/full-detail behavior.

Discover the schema with `unity_list_advanced_tools`, then use `unity_advanced_tool`:

```json
{
  "tool": "unity_testing_get_job",
  "params": {
    "jobId": "the-original-job-id",
    "resultOffset": 0,
    "resultLimit": 100
  },
  "port": 7890
}
```

Use the selected editor's actual port. Retain the returned `jobId` when the first call omitted it; subsequent calls must target that job, since the latest job can change.

## Contract

| Input | Behavior |
|---|---|
| `resultOffset` | Integer from 0 to 2,147,483,647; default 0. Offsets apply after failure filtering. |
| `resultLimit` | Integer from 1 to 10,000; default 200 when only an offset is supplied. |
| Either pagination field | Requests details even without `includeDetails`. |
| `includeFailedOnly: true` | Returns only Failed/Inconclusive records, then applies offset/limit. |
| Both pagination fields omitted | Preserves the previous response and does not add page metadata. |

A paged response retains the original job/progress/summary fields and the original fields in every returned test. Its additional `resultPage` object contains `offset`, `limit`, `returned`, `total`, `hasMore`, `nextOffset` and `stable`. `total` counts available matching details, not the job's expected test count. Follow `nextOffset` until `hasMore` is false; the final offset is `null`. Empty jobs and offsets at/beyond the end return an empty page. Exact-limit pages do not claim another page.

`stable` is false while the job is running: callbacks append results, and Unity's final tree may reorder or reconcile them. Wait for terminal status before enumerating a stable list. `resultsComplete` keeps its original meaning: whether available native details account for completed tests. It does not mean the current page contains the whole job, and an empty page does not prove the run has finished.

Unfiltered pages use direct indexing. Filtered pages scan available results to count matches, while constructing dictionaries only for the requested page. The limit bounds records, not diagnostic text bytes: one large message/stack, progress failure diagnostics or another job field can still exceed a [response limit](response-limits.md). This change does not bound Unity's native test tree, retained result memory or snapshot serialization.

## Older components and polling

Updated plugins accept pages through both current and released MCP servers. Updated servers detect an older plugin's missing page metadata and return `test_result_pagination_unsupported` with the job ID, instead of presenting an unpaged list as the requested page. Legacy calls remain available by omitting the new fields. If an old plugin's entire response exceeds transport limits before metadata can be inspected, the existing response-size error can arrive first.

Server-side `waitTimeout` polling now stops immediately on native command errors or unsupported pagination. It preserves the original diagnostic and does not keep issuing reads until the wait expires. Normal running jobs continue polling; request cancellation retains its existing behavior.

## Evidence

The [report](validation/unity66-test-pagination.json) records Windows/Unity 6000.6.2f1/Mono measurements at plugin baseline `4981f6a`. The controlled fixture requests 20 results and measures `GetTestJob` after five warmups, reporting the median of eleven calls. It excludes JSON serialization, network traffic, native discovery and the whole editor frame. Allocation figures are `GC.Alloc` sample **Count**, with a positive allocation control; they are events, not bytes.

| Stored results | Returned before / after | Allocation events before / after |
|---|---:|---:|
| 100 | 100 / 20 | 659 / 191 |
| 1,000 | 1,000 / 20 | 6,059 / 191 |
| 10,000 | 10,000 / 20 | 60,059 / 191 |

For the 10,000-result fixture, median result-construction time changes from 14.21 ms to 0.036 ms. This is a local measurement of this operation, not a general editor speedup or product comparison.

Eight native checks cover legacy behavior, complete page enumeration, filtered offsets, empty/end/extreme offsets, defaults, eighteen invalid inputs and running/incomplete results. Eight stdio regressions cover schema discovery, forwarding, polling and old-plugin behavior. Existing result/discovery, lifecycle and persistence suites also pass. All 77 production editor sources compile against the Unity 2021.3.18f1 API; execution of that older editor remains deferred.

Four current/released-server runs on Node 18/22 each recover 1,000 synthetic results in ten pages and execute six real EditMode tests: three passing, one failed, one ignored and one inconclusive. Paged details match the full native results exactly, including diagnostics, before and after script reload. The current-server runs explicitly verify recovery from a 32 KiB response limit; released-server runs establish page compatibility without assuming identical legacy size-error semantics. Two additional current-server runs against the released plugin verify full-result compatibility and explicit refusal of pagination.

## Reproduce

From the plugin checkout, with a closed marked disposable project:

```powershell
./tools~/validate-unity.ps1 -EditorPath 'C:/Program Files/Unity/Hub/Editor/6000.6.2f1/Editor/Unity.exe' -ProjectPath 'C:/UnityMcpValidation/Queue66' -Suite TestPagination
```

It writes `Library/UnityMcpTestPaginationValidation.json`. Use `TestResults`, `Testing` and `TestPersistence` for related regressions.

For live validation, copy `tools~/TestPaginationValidation.cs` to the marked project's `Assets/Editor` and install the existing `tools~/TestingFixture` as described in the [testing guide](testing.md). From the server checkout:

```powershell
$env:UNITY_MCP_TEST_PAGINATION_PROJECT = 'C:/UnityMcpValidation/Health66'
npm run test:test-pagination
```

`UNITY_MCP_TEST_SERVER_ENTRY` optionally selects an older server. The suite runs intentional test failures and requests a real script reload, so it belongs in a disposable project. It writes `Library/UnityMcpTestPaginationLive.json` and removes its synthetic job. To check the released plugin, set `UNITY_MCP_TEST_PAGINATION_LEGACY_PROJECT` and run `npm run test:test-pagination-legacy`; that read-path fixture injects/removes a synthetic job without executing tests. Ordinary `npm test` includes the eight isolated stdio regressions and never opens Unity.
