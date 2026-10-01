# Action history notifications

Recording an action previously scheduled one Unity `delayCall` closure per record, even without subscribers. A controlled burst retained 2,000 callbacks while the history itself held only eight entries. Clearing history left a 1 MiB record reachable through its callback. With Action History open, each notification also rebuilt the window's filters and result list.

The plugin now schedules no observer work when nobody subscribes. With subscribers, a single editor-update callback drains an ordered queue, up to 100 records per update. Delivery remains deferred and uses the existing public `Action<MCPActionRecord>` event and record objects. Exceptions from one subscriber are logged without suppressing later subscribers or records. Reentrant additions join the queue; clearing during a callback cancels the old batch, and any newly recorded actions resume on a later update.

The queue retains at most 10,000 undelivered notifications; pressure discards the oldest and increments `dropped`. This is an observational stream, not a durable event journal. Clearing history cancels pending notifications. Removing the final subscriber releases the queue on its next update; reload/quit cancels it immediately. Subscribing after an action was recorded without observers does not replay that action. Inspect the history APIs for a current snapshot.

Unity documents `delayCall` as running after inspector updates, whereas [`EditorApplication.update`](https://docs.unity3d.com/2021.3/Documentation/ScriptReference/EditorApplication-update.html) follows editor updates at a variable rate. The new dispatcher progresses in the hidden-editor live checks independently of inspector refresh; 100 records is a count allowance, not a frame-time guarantee for arbitrary subscriber code. [Unity's delayCall reference](https://docs.unity3d.com/ja/6000.0/ScriptReference/EditorApplication-delayCall.html).

## Window behavior and monitoring

Action History observes a revision changed by recording, clearing and loading history. It rebuilds filters/lists only when that revision changes, using its existing 0.5-second inspector-refresh interval. Idle list instances are reused. Filter/search interactions still refresh immediately, and periodic repaint remains available for native Undo and target-state changes. Filters keep their selected values when earlier options expire. Selection follows the same record as new rows arrive and releases it when filtered out or evicted.

`unity_queue_info.data.historyNotifications` adds:

| Field | Meaning |
|---|---|
| `pendingCount`, `maxPendingCount` | Current backlog and the 10,000-record ceiling |
| `maxPerUpdate` | At most 100 records attempted per dispatch |
| `delivered` | Records dispatched to the then-current subscriber list; subscriber exceptions are logged separately |
| `dropped` | Oldest notifications discarded by capacity pressure; intentional clear/unsubscribe/shutdown cancellation is excluded |

Counters reset on domain reload. These limits do not bound user-held records, arbitrary subscriber work, record text sizes, per-agent logs, or total process memory. [Persisted files](history-persistence.md) have separate byte/validation limits. The [completed-result policy](result-retention.md) and [queue retention policy](queue-monitoring.md) remain separate.

## Evidence and reproduction

The [report](validation/unity66-history-notifications.json) records the baseline failures and thirteen passing corrected checks. These cover callback count, weak-reference collection after clear, ordered deferred delivery, update allowance, reentrant clear, unsubscribe, failing observers, pressure, idle list reuse, filters and selection.

The local 500-record window fixture, including notification drainage and one final window refresh, measured 136.74 ms and 449,400 recorded allocation bytes before the change, versus 1.39 ms and 67,500 bytes afterward. Both allocation recorders passed a positive control. This measures a controlled unshown window on Windows/Mono, not rendered-frame cost, network latency, gameplay FPS or a competitor benchmark.

Four real Unity 6000.6.2f1 runs use current/released servers on Node 18/22. Each verifies twelve concurrent MCP reads with ordered, exactly-once observer delivery on the editor thread; synthetic 10,032-record notification pressure with 32 observed drops; clear without stale delivery; and actual script reload with observer release and counter reset. The pressure phase uses the native history API inside an MCP command, not 10,032 HTTP requests. Existing monitoring, completed-result, Dashboard and queue regressions pass. All 76 editor sources also compile against Unity 2021.3 APIs; actual older-editor execution remains deferred.

From the plugin checkout, use a closed disposable project:

```powershell
./tools~/validate-unity.ps1 -EditorPath 'C:/Program Files/Unity/Hub/Editor/6000.6.2f1/Editor/Unity.exe' -ProjectPath 'C:/UnityMcpValidation/History66' -Suite HistoryNotifications
```

For the live server suite, open a marked disposable project with the modified plugin, outside Play Mode, with a clean scene:

```powershell
$env:UNITY_MCP_HISTORY_PROJECT = 'C:/UnityMcpValidation/History66'
npm run test:history
```

This fixture clears disposable action history and reloads scripts. It removes its observer and SessionState counters, and writes `Library/UnityMcpHistoryNotificationsLive.json`. Set `UNITY_MCP_TEST_SERVER_ENTRY` to a released server's absolute `src/index.js` path to repeat the same checks against that server.
