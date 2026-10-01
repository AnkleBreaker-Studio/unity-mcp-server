# HTTP command admission

The Unity plugin bounds commands retained after HTTP input has been decoded. Each editor admits at most **256 outstanding HTTP commands** and **256 MiB of accounted argument cost**. Queued and legacy synchronous requests use the same admission path, including deferred package/test/preview operations. Accepted work keeps its FIFO and round-robin scheduling.

Previously, completing a body read released its input reservation while decoded arguments remained in the queue. The baseline fixture accepts a 257th command through both queued and legacy entry points. The new command budget is separate from the existing body-reader limits.

## Refusal and retries

A full budget returns HTTP 503 with `code: "command_queue_busy"` and `requestAccepted: false`, before creating a ticket or starting the command. Accepted tickets are not evicted. Completion, failure or timeout releases admission exactly once. Deferred work retains admission after dequeue until its ticket becomes terminal.

Protected submission checks the existing request identity before acquiring another slot. An exact replay can retrieve its original ticket even at capacity. A refusal does not consume an unused retry identity. Queue information and ticket polling remain available while admission is full.

The current server can retry protected refusals with the original identity. It returns a known refusal when every attempt was unaccepted; an earlier lost acknowledgement keeps its unknown-outcome semantics. Unguarded queued and legacy refusals are not replayed by the current server. Older servers can report a less structured error; successful response shapes remain unchanged.

## Accounting and scope

The existing JSON parser computes argument cost without another tree traversal:

```text
128 + 2 × command JSON characters + 64 × parsed values/property names
    + 2 × (agent ID characters + route characters)
```

The fixed base also covers empty bodies. Repeated object names count even when compatible last-value behavior replaces an earlier value. Weighting decoded nodes means a dense array of small values is not charged solely by its short JSON representation. Admission and release share the queue lock.

These are accounting units, **not measured managed-heap bytes** or a total editor memory quota. Parsing before admission, HTTP workers/buffers, completed results/history and native API-owned payloads are outside this budget. A terminal timeout removes the ticket's work closure; it does not interrupt an already-running method or dispose objects held independently by native callbacks. Trusted in-process calls to the existing public C# submission APIs retain their original behavior; these limits apply to HTTP dispatch.

No tool names, mandatory parameters, queue protocol number or package versions change. Body/depth/value limits remain independent. Servers and plugins can still be updated separately.

## Monitoring

`unity_queue_info` exposes the plugin's `data.httpCommands` object:

| Field | Meaning |
|---|---|
| `activeCount`, `maxCount` | Nonterminal admitted HTTP tickets and the 256-ticket limit |
| `argumentCostBytes`, `maxArgumentCostBytes` | Current accounting cost and the 268,435,456-unit limit |
| `peakCount`, `peakArgumentCostBytes` | High-water marks for this editor domain |
| `admissionRefusals` | Attempts refused by command admission, including protected retries |

Counters reset on domain reload. HTTP response/rejection counters also reflect these refusals. This object is separate from HTTP body reservations and the Node server's `serverAgentState` metrics.

## Validation

The [report](validation/unity66-command-admission.json) preserves baseline and final results. Four initial checks fail before the correction while an ordinary queued/legacy control passes. Fifteen final Unity checks cover both entry paths, deferred dispatch, count/byte pressure, concurrent reservations, protected replay, failure/timeout release and diagnostics at capacity. Byte-boundary/race tests use synthetic accounting charges; they do not allocate a 256 MiB heap or measure process memory.

The existing queue, input and package suites pass 52 further checks. Package validation now passes decoded dictionaries to the dispatcher after the earlier input-parser change; its category and missing-argument assertions are preserved. All 75 editor sources in the minimum-version compiler check pass against Unity 2021 APIs. Actual older-editor execution remains deferred.

Five additional Node checks cover refusal/retry interpretation; the full ordinary suite passes 248 tests locally and in all eight [Node 18/20/22/24 Windows/Linux CI jobs](https://github.com/AnkleBreaker-Studio/unity-mcp-server/actions/runs/36841683235). The initial CI exposed a fixture deadline race; the corrected tests exhaust all five attempts within the normal retry window and preserve unknown outcomes after lost acknowledgements. Four live runs cover current/released servers on Node 18/22 against Unity 6000.6.2f1. The opt-in fixture fills actual command-admission slots through MCP, attempts a named GameObject write, waits for automatic cleanup, and verifies that the refused object was never created. Scenes remain clean.

Implementation checkpoints: plugin `0e35f3f`, server validation `443da41` with fixture correction `45ecece`. The [plugin CI](https://github.com/AnkleBreaker-Studio/unity-mcp-plugin/actions/runs/36840673790) verifies 338 routes. Owned validation editors are closed, temporary copied fixtures are removed, and versions remain unchanged. No release is published.

```powershell
./tools~/validate-unity.ps1 -EditorPath PATH_TO_UNITY -ProjectPath DISPOSABLE_PROJECT -Suite QueueAdmission
```

```bash
node --test tests/queue-admission.test.mjs
# UNITY_MCP_QUEUE_ADMISSION_PROJECT identifies one marked, open validation editor.
# UNITY_MCP_TEST_SERVER_ENTRY optionally selects the released server checkout.
npm run test:queue-admission
```
