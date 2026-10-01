# Plugin agent-session retention

An editor tracks per-agent counters and two short logs. Previously, the five-minute activity window excluded every recently completed identity from eviction. A sequential burst of 5,000 identities retained all 5,000 sessions, even with no work left. The older 256-inactive-session limit only applied once those identities became inactive.

The plugin now retains at most **1,024 sessions without outstanding work**, including recently active ones. Completing the last request adds a session to the end of an eviction list; submitting new work removes it immediately. At capacity, the oldest completed session is removed. Existing session reuse moves that session to the newest position without resetting its counters. List operations avoid scanning all tracked agents on each completion.

Queued and executing work remains protected. Native C# callers can therefore have more than 1,024 tracked busy agents; the limit applies as their work finishes. HTTP work has its separate [admission budget](command-admission.md). This is a session-count bound, not a byte limit or a whole-editor memory guarantee.

## Monitoring and compatibility

The five-minute `isActive` definition is unchanged for retained sessions. Periodic cleanup still expires sessions idle for 30 minutes and keeps at most 256 inactive sessions. Under pressure, a recently active session with no outstanding work can now disappear from the Dashboard before five minutes. An evicted identity starts fresh statistics when it returns.

`unity_queue_info` adds:

| Field | Meaning |
|---|---|
| `maxIdleSessions` | Maximum retained sessions without queued/executing work: 1,024. |
| `idleSessionsTracked` | Currently retained sessions without outstanding work. |
| `pressureEvictedSessions` | Sessions removed by this new count limit; included in `evictedSessions`. |

Counters and session storage reset on domain reload. Existing fields, ticket IDs/results and protected submission identities retain their contracts. Session eviction does not remove a polling result or authorize replay of a protected command.

Global action history keeps its independent retention and Undo rules. Pending records carry a scalar session generation: an old completion cannot attach to a replacement session that uses the same agent ID. Pending history does not hold an old session object alive. This also covers an identity returning after normal time-based expiry.

## Evidence

The [native and live report](validation/unity66-session-retention.json) records the baseline at plugin `bbe6da1` and the corrected implementation on Windows, Unity 6000.6.2f1/Mono:

- The original seven checks include five failures and two passing controls. The burst retained 5,000 completed sessions before the change; afterwards it retains 1,024 and reports 3,976 pressure evictions.
- Nine final native checks cover queued/deferred protection, partial completion, reuse order, 1,300 simultaneously busy native agents, returning identities, weak-reference collection, global history, protected replay, twenty racing duplicate completions and timeout release.
- Current and released servers on Node 18/22 each execute those checks through stdio MCP, perform a subsequent queue read and reload scripts. The queue session changes and pressure counters reset; project identity and the clean scene remain unchanged.
- Existing queue, health and command-monitoring regressions pass. The health fixture still records zero allocation events across 100,000 warmed-up empty updates, with a positive allocation control. This does not measure busy-work allocation bytes or a whole-frame speedup.
- All 77 production editor sources compile against the installed Unity 2021.3.18f1 API. Running that older editor remains deferred at the user's request.

## Reproduce

In the plugin checkout, with a closed disposable project:

```powershell
./tools~/validate-unity.ps1 -EditorPath 'C:/Program Files/Unity/Hub/Editor/6000.6.2f1/Editor/Unity.exe' -ProjectPath 'C:/UnityMcpValidation/Queue66' -Suite SessionRetention
```

It writes `Library/UnityMcpSessionRetentionValidation.json`. The existing `Health`, `Monitoring` and default `Queue` suites cover related behavior.

For a live editor, copy `tools~/SessionRetentionValidation.cs` into `Assets/Editor` of a marked disposable project, wait for compilation, and run from the server checkout:

```powershell
$env:UNITY_MCP_SESSION_RETENTION_PROJECT = 'C:/UnityMcpValidation/Health66'
npm run test:session-retention
```

The live suite requests an actual script reload. It writes `Library/UnityMcpSessionRetentionLive.json`; `UNITY_MCP_TEST_SERVER_ENTRY` optionally selects an older server entry point. The native fixture restores history/settings and removes its own retained tickets/sessions. Live validation is separate from ordinary CI and skips without the project variable.
