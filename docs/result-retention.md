# Completed results and history retention

Each editor now retains at most **4,096 terminal tickets** in its polling cache, with a **256 MiB accounting budget** for their results and metadata. Oldest completed entries leave first under count or cost pressure. Existing age cleanup remains: 60 seconds for completed/failed tickets and 30 seconds for timed-out tickets. These ages are upper retention targets until periodic cleanup, not guaranteed minimum availability.

Previously, the cache only had age cleanup. The baseline fixture retains 4,100 completed tickets. A separate weak-reference check shows an expired 1 MiB result payload still rooted by pending history. The corrected checks bound the cache and collect that payload while retaining its target metadata.

## Compatibility and recovery

Eviction removes the cache reference, without clearing or transforming a ticket's result. An existing synchronous waiter and a native caller holding that ticket retain their original result. Pending and executing tickets are separate and are never removed by this policy. Completion remains an exactly-once terminal transition.

Polling an evicted ticket returns the existing missing-ticket response. A protected replay whose original result is absent returns the existing HTTP 410 `result_expired` response; its identity remains in the deduplication cache for the original retry window, preventing re-execution. The current server reports an unknown outcome with recovery identifiers. Published older servers report a polling error. A missing result never proves that a write did not execute.

A single result whose measured cost exceeds the budget is not cached. It does not displace unrelated usable results; synchronous/native references remain intact. This can make a queued result unavailable even when its eventual JSON would be small. Clients should request smaller results and inspect effects before repeating mutations. Tool names, required parameters, result shapes for retained tickets, protocol number and published versions remain unchanged.

## What the budget measures

Accounting runs at terminal publication, before acquiring the queue lock. It reads stored values and fields, without calling arbitrary getters, enumerators, equality methods or conversions. Built-in lists/dictionaries are traversed through their known implementations. A reference-identity set terminates cycles. Reflection is limited to instance fields; static fields are excluded.

Weights include a ticket/metadata base, 64 units per visited value, two units per string character, scalar-array/list storage widths, list reference slots and 32 units per dictionary storage slot. Shared object graphs are traversed once within a result; repeated strings and objects shared between tickets can be charged repeatedly. Unused built-in collection capacity contributes. The visit ceiling is the cost ceiling divided by the 64-unit visit weight, so the cost ceiling always ends traversal first and large results are measured exactly instead of being charged the whole budget. Only the 64-level depth limit or unreadable storage charges the full budget conservatively, allowing that result to remain alone. Known cost above the ceiling prevents caching.

These are **accounting units, not measured heap bytes**. Results can be mutated by native owners after publication; callbacks, caller-owned tickets, in-progress response serialization, borrowed/native Unity resources and other process state have independent lifetimes. The counter does not claim a total editor memory quota or an end-to-end performance improvement. Large result graphs add bounded inspection work at completion.

## History snapshots

Pending history now stores only the action record, without the full result graph. Completion copies scalar target ID/path/name fields, preserving decimal Unity IDs and the existing path precedence. Target text is limited to 4,096 characters; exception diagnostics copied to history are limited to 2,048. Raw ticket results/errors remain unchanged.

Opaque target objects and dictionaries with custom comparers are skipped during automatic metadata capture. They cannot interrupt terminal publication. The existing public `ExtractTargetFromResult` helper remains available with its original behavior. History insertion, editor preferences, UI notifications and persistence still run on the editor thread. The existing 10,000 pending-record limit and history/Undo lifecycle remain in place. This removes result-graph retention; identities, action metadata and active sessions have separate policies.

## Monitoring and validation

`unity_queue_info.data.completedResults` exposes:

| Field | Meaning |
|---|---|
| `count`, `maxCount` | Cached terminal tickets and the 4,096-ticket ceiling |
| `costBytes`, `maxCostBytes` | Current accounting cost and the 268,435,456-unit ceiling |
| `peakCostBytes` | Highest retained accounting cost in this editor domain |
| `evictions` | Older entries removed under count/cost pressure |
| `oversizedNotCached` | Results not cached because their known cost exceeded the budget |

Counters reset on domain reload. Existing `completedCacheSize` retains its meaning. HTTP command admission and server agent-state limits remain independent.

The [validation report](validation/unity66-result-retention.json) records three baseline failures and an ordinary-result control, then fourteen passing checks: count/cost pressure, collection after expiry, cache-order cleanup, protected identity, synchronous delivery, custom objects/comparers, bounded target snapshots, cycles/depth, oversized accounting, reserved capacity and duplicate callbacks. Shared-string pressure fixtures exercise accounting without allocating the represented total heap.

Queue, admission, serialization and monitoring regressions pass. All 76 included editor sources compile against Unity 2021 APIs; actual old-editor execution remains deferred by maintainer direction. Three Node checks cover eviction during polling and protected replay after a lost acknowledgement. Four real-editor runs cover current/published servers on Node 18/22. Those runs invoke native queue pressure inside an actual MCP command and then perform successful MCP reads; they do not force a real network acknowledgement loss. No scene assets are created.

Implementation checkpoints: plugin `63afda5`, server validation `565f4af`. All eight [Node 18/20/22/24 Windows/Linux CI jobs](https://github.com/AnkleBreaker-Studio/unity-mcp-server/actions/runs/36844619880) pass 251 tests; the [plugin CI](https://github.com/AnkleBreaker-Studio/unity-mcp-plugin/actions/runs/36844555925) verifies 338 routes. Owned validation editors are closed cleanly and copied fixtures are removed. Versions remain unchanged and no release is published.

```powershell
./tools~/validate-unity.ps1 -EditorPath PATH_TO_UNITY -ProjectPath DISPOSABLE_PROJECT -Suite ResultRetention
```

```bash
node --test tests/result-retention.test.mjs
# UNITY_MCP_RESULT_RETENTION_PROJECT identifies a marked, open validation editor.
# UNITY_MCP_TEST_SERVER_ENTRY optionally selects the published server checkout.
npm run test:result-retention
```
