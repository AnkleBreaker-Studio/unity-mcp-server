# Queue scheduling, sessions and measurements

Each editor owns an independent request queue. The plugin visits agents round-robin, retains FIFO order within an agent, and processes either one write or up to five eligible reads per editor update. This limits scheduling batches; an individual Unity operation can still occupy the main thread for a long time.

## Request timings and outcomes

Ticket status exposes `queueWaitMs` and `processingTimeMs` from a monotonic clock. The existing `executionTimeMs` field retains total wall-clock latency and remains `-1` until completion. Session averages use completed/expired tickets; an operation that continues after timeout does not keep extending its recorded duration.

`completedRequests` counts every terminal ticket, including failures and timeouts. `queuedRequests` counts outstanding queued and executing requests. `failedRequests` currently counts queue exceptions, while `timedOutRequests` counts queue deadlines. A command can return a logical error inside a completed ticket; these errors are surfaced by the MCP server but are not yet included in `failedRequests`. A lost result or timeout never proves that the operation made no changes.

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
