# Queue scheduling, sessions and measurements

Each editor owns an independent request queue. The plugin visits agents round-robin, retains FIFO order within an agent, and processes either one write or up to five eligible reads per editor update. This limits scheduling batches; an individual Unity operation can still occupy the main thread for a long time.

## Request timings and outcomes

Ticket status exposes `queueWaitMs` and `processingTimeMs` from a monotonic clock. The existing `executionTimeMs` field retains total wall-clock latency and remains `-1` until completion. Session averages use completed/expired tickets; an operation that continues after timeout does not keep extending its recorded duration.

`completedRequests` counts every terminal ticket, including failures and timeouts. `queuedRequests` counts outstanding queued and executing requests. The separate outcome counters are:

| Session field | Meaning |
|---|---|
| `commandErrors` | A completed handler returned a recognized command error. |
| `failedRequests` | The handler threw an exception; the original meaning is unchanged. |
| `timedOutRequests` | The ticket reached a queue deadline. |

A command error keeps the original ticket status `Completed` and the original result object. Ticket status adds `commandFailed` and `commandError`; the latter contains at most 2,048 characters while the result remains intact. This preserves older polling and synchronous clients. The MCP server still marks recognized errors with `isError`.

Classification follows the server's direct-result rules for dictionaries, anonymous objects and stored DTO fields: explicit boolean `success:true` or `ok:true` wins; otherwise boolean `success:false`, `ok:false`, a nonempty string `error`, or an `error.message` string indicates failure. Arrays and arbitrary nested result data are not recursively classified. Custom computed getters are not invoked by monitoring, so custom result types without stored fields may remain unclassified. A lost result or timeout never proves that the operation made no changes.

## Action history

Undo eligibility is checked against Unity's current native stack, including native Undo/Redo, clearing and session identity. A targeted revert also accounts for newer native groups outside retained MCP history. See [Undo and multi-agent cascade protection](undo.md).

The winning terminal transition creates one history record, including deferred callbacks and queued/executing timeouts. Duplicate or late callbacks cannot create additional records or change counters. History and `undo/history` add `commandFailed` without changing the original `status`; the dashboard, details and copied text display **Command error** for recognized handler failures. Supported synchronous undo groups retain their previous behavior; a command error can still follow partial changes.

Callbacks can arrive on worker threads, so target inspection and history insertion run on the editor thread. A buffer retains at most 10,000 pending records. Each routine drain processes up to 100 records, before scheduling and again after a nonempty request batch. Explicit history queries and `undo/last` drain the bounded backlog before choosing an action, so a recently completed edit cannot be hidden behind older callbacks. Clearing history also clears pending records. If callbacks overwhelm this buffer, the oldest history records are dropped and counted; ticket results and session outcome counters remain intact. This is a record-count bound, not a byte bound on retained results.

`unity_queue_info` adds `pendingHistoryRecords`, `maxPendingHistoryRecords` and `droppedHistoryRecords`. The drop counter also includes history insertion failures and resets with the queue session. Pending history is drained before the existing domain-reload/quit save hooks; disk persistence remains optional. Old saved entries without `commandFailed` load as before. Queue tickets and session counters still reset on domain reload.

## Read policy

`Editor/MCPCommandPolicy.cs` in the plugin lists the 92 routes eligible for read batching. Unknown routes use the write path. The registry checker verifies that the list contains no duplicates or nonexistent routes; authors must review side effects before adding a new entry.

Route-name heuristics previously batched `profiler/enable`, `profiler/memory-snapshot`, `debugger/enable` and `debugger/event-details` as reads. These operations change profiler/debugger state, write a snapshot, or select a debugger event. They now run individually. `compilation/errors` can join read batches. This preserves command arguments and results while correcting scheduling and undo-group eligibility; it does not make every write undoable.

## Session retention

An agent is active when it has queued/running work or activity in the last five minutes. An old timestamp never hides outstanding work. Activity and retention deadlines use a monotonic clock; timestamps returned to clients remain UTC.

During periodic cleanup, sessions without outstanding work expire after 30 minutes of inactivity. At most 256 inactive sessions are retained, with older ones removed first when that limit is exceeded. Active and busy sessions are excluded from this limit. A returning agent starts a fresh session after eviction. Individual logs remain capped at 100 entries; the separate action history and its supported undo records retain their own configured limits.

`unity_queue_info` adds these fields without changing existing fields:

| Field | Meaning |
|---|---|
| `evictedSessions` | Sessions removed during this editor queue session; resets on domain reload. |
| `sessionRetentionSeconds` | Idle expiry, currently 1800 seconds. |
| `maxInactiveSessions` | Inactive-session capacity, currently 256. |
| `totalSessionsTracked` | Sessions currently retained, including active/busy sessions. |

The policy bounds inactive session retention, not all memory used by active requests, command results or the editor. A large active workload still needs appropriate coordination. Cleanup also releases oversized session dictionary storage after substantial eviction.

## Evidence and limits

The [Dashboard guide](dashboard.md) covers card reuse, section persistence and the meaning of **Latest request**. Its dedicated batch suite and attached-window checks supplement the earlier monitoring-label tests below; the local refresh measurements exclude panel layout and rendering. The additive [HTTP diagnostics](http-monitoring.md) describe requests refused before ticket creation, response status/bytes, handler durations and domain reloads; these counters remain separate from command outcomes.

Compilation has separate [code-execution diagnostics](code-execution.md) in `unity_editor_state.codeExecution`. These describe retained Roslyn metadata and loaded snippets for the current editor, rather than per-agent queue statistics. The image-byte counter is not total editor memory.

The [command-outcome report](validation/unity66-command-outcomes.json) reproduces seven missed errors across 15 result shapes and missing deferred/timeout history on the baseline. The corrected run preserves raw results and legacy synchronous responses, records one action for 20 concurrent duplicate callbacks, ignores late completion after timeout, and round-trips new and old history records. It also checks dashboard labels/status styling, the history endpoint, a real create/undo cycle, the 2,048-character diagnostic limit, and draining pending history through the pre-reload save hook. A 10,001-callback backlog retains 10,000 records and reports one dropped history entry while preserving all 10,001 terminal counts. An additional undo check places the newest edit behind 1,000 callbacks and verifies that only that edit is reverted; clearing pending history is also covered. These are batch-mode behavior checks, not an interactive layout review or an actual domain reload in this suite.

The opt-in live test sends a missing-object lookup through the stdio MCP server to an open editor. The client receives `isError`, the session counts one command error with zero exceptions/timeouts, and `unity_undo_history` returns one flagged record with the original `Completed` status. This verifies the complete response/monitoring path for a real command.

The [Unity 6000.6.2f1 report](validation/unity66-queue-health.json) records three stages: the original behavior, the first retention/scheduling fix before allocation cleanup, and the final result.

- A synthetic population of 5,000 hour-old sessions remained retained before the fix. Afterwards, cleanup removed all 5,000 and released about **8.5 MiB of managed memory** in the measured run, including unused session dictionary capacity. The test uses ten logged actions per session and forced managed collections for this measurement.
- Of 600 sessions inactive for 5–15 minutes, the most recent 256 remained. A fresh session and an hour-old session with outstanding work survived; the latter remained visible. A returning evicted agent started with fresh statistics.
- Real queue callbacks verified one write per update for the four affected routes and an unknown profiler route. Both existing editor-state reads and compilation-error reads used five-request batches. This checks queue behavior; it does not exercise the native profiler/debugger APIs themselves.
- After warmup, 100,000 empty queue updates produced 3,000 `GC.Alloc` events before scratch-list reuse and zero afterwards. This is a count from a current-thread `ProfilerRecorder`, with a positive allocation control, following [Unity's recorder example](https://docs.unity.com/en-us/engine/6000.6/script-reference/unity/profiling/profilerrecorderoptions/sumallsamplesinframe). It covers the empty queue processor, not the dashboard, HTTP serialization or the whole editor.

`GC.GetAllocatedBytesForCurrentThread` returned zero even for a 1 MiB control allocation on this runtime, so those byte readings are invalid as allocation evidence. CPU timings for the empty loop are only a few milliseconds over 100,000 calls; they do not establish a meaningful editor speedup or a comparison with another MCP.

## Reproduce

From the plugin repository, use a disposable project that is not already open:

```powershell
./tools~/validate-unity.ps1 -EditorPath 'C:/Program Files/Unity/Hub/Editor/6000.6.2f1/Editor/Unity.exe' -ProjectPath 'C:/UnityMcpValidation/Health66' -Suite Health
```

The report is `Library/UnityMcpQueueHealthValidation.json`. Omitting `-Suite Health` still runs the existing queue/lifecycle/HTTP validation suite. Both require the validation marker before reusing an existing project.

Use `-Suite Monitoring` for command outcomes, callback history, persistence, dashboard state and undo checks. It writes `Library/UnityMcpMonitoringValidation.json`. The default queue suite also verifies that real 30-second running, batched and queued timeouts each produce one history record.

From the server repository, set `UNITY_MCP_MONITOR_PROJECT` to the absolute path of an open, marked validation project and run `npm run test:monitoring`. It writes `Library/UnityMcpLiveMonitoring.json`; without that environment variable, it skips safely. This suite is separate from ordinary CI and does not edit the scene.
