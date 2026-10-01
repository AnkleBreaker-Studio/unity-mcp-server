# Dashboard behavior and measurements

The [HTTP monitoring update](http-monitoring.md) adds a collapsed **HTTP Activity** section and typed queue snapshots. Its newer report measures the complete idle refresh at 30,400 allocation events per 100 iterations, with zero events in the unchanged queue and HTTP sections. The earlier measurements below remain the baseline evidence for agent-card reuse.

The uploads line shows active body readers, reserved input MiB, busy refusals and expired deadlines. Its tooltip explains the [input limits](request-input.md), including the distinction between reservations and queued/native memory. The [body report](validation/unity66-request-body.json) verifies wrapping in actual 360 px views and retains the existing refresh-allocation results.

The [attached rendering report](validation/unity66-editor-render.json) adds real Windows pixel review at 360 × 500, 360 × 800 and 640 × 800. Long agent/request text, wrapped HTTP counters, scrolling, context actions, category controls and settings remain readable in the reviewed views. It also exposed context help measuring 294 px inside a 282 px label: the explanatory messages now wrap, with the empty-state label growing from 13 to 25 px high. These captures measure no rendering performance and do not cover other OS/DPI settings. See [reproduction](editor-capture.md#attached-unity-rendering).

Open **Window → AB Unity MCP → Dashboard** in the editor you want to inspect. The header identifies the project directory and Unity version. Bridge controls, the request queue, agent sessions and recent actions come before project context, feature categories, news and settings. News starts collapsed; each section remembers its open/closed state for that project path on the current machine.

Each agent keeps its own card while its displayed metrics change. Completed, outstanding, command-error, exception and timeout counts remain separate, with average queue wait and processing time. **Latest request** means the most recently submitted request; it can be waiting or already finished. It does not identify the operation currently executing. The queue section provides the pending/running totals. See [monitoring semantics](queue-monitoring.md) for the underlying fields.

Long agent names and request text use ellipses with their full values in tooltips. Context actions occupy a separate row so **Open Folder** remains inside the window at its 360 px minimum width. Recreating the visual tree replaces its refresh schedule and controls; it does not add a second dashboard or another news subscription. Foldout preferences ignore changes from toggles nested inside them.

## Verified behavior

The [raw report](validation/unity66-dashboard.json) records the baseline defects and corrected checks on Windows with Unity 6000.6.2f1:

- Recreating the interface previously left two scroll roots. The corrected fixture retains one.
- Changing an undisplayed activity timestamp previously rebuilt the agent section. Cards now survive timestamp and metric changes, including cards for other agents.
- Busy sessions remain visible beyond five minutes; idle sessions disappear, returning sessions reappear, and the empty state is replaced when an agent arrives.
- The attached editor window preserves section choices through interface reconstruction and an actual script recompilation. The previous refresh schedule is paused when replaced.
- UI Toolkit geometry reports no horizontal text overflow at 360 px, including an agent ID of 223 characters and a request string of 300 characters. Full values remain in tooltips. This is a geometry check, not a pixel-level visual review.
- The existing monitoring suite still passes command errors, exceptions, callback history, legacy persistence and create/undo checks. All 70 editor sources compile against the declared Unity 2021.3.18f1 API; actual older-editor execution remains deferred.

## Local refresh measurements

The fixture warms up each case and invokes `RefreshAll` 100 times on an unattached editor window. A current-thread `GC.Alloc` recorder includes a positive allocation control. The changing case updates one of twenty agents before every refresh.

| Workload, 100 refreshes | Allocation events before | Allocation events after | Elapsed before | Elapsed after |
|---|---:|---:|---:|---:|
| No agents | 33,700 | 33,400 | 38.48 ms | 44.68 ms |
| Twenty unchanged agents | 96,000 | 33,400 | 75.12 ms | 36.76 ms |
| One changing agent among twenty | 210,000 | 34,800 | 274.86 ms | 47.78 ms |

The changing workload records about **83% fewer allocation events**. Typed snapshots avoid creating the transport dictionaries and timestamp strings for each UI update; unchanged cards keep their controls and text. The public session response stays unchanged.

These local measurements exclude panel layout and rendering. Other Dashboard sections still allocate; idle CPU time did not improve in this recorded run. Timing and allocated-byte readings vary with warmup and scheduling. The results are neither whole-editor performance guarantees nor comparisons with another product.

## Reproduce

From the plugin repository, use a closed disposable project:

```powershell
./tools~/validate-unity.ps1 -EditorPath 'C:/Program Files/Unity/Hub/Editor/6000.6.2f1/Editor/Unity.exe' -ProjectPath 'C:/UnityMcpValidation/Dashboard66' -Suite Dashboard
```

The launcher creates a marked minimal project or requires an existing validation marker. It writes `Library/UnityMcpDashboardValidation.json` and `validation.log`. The fixture removes its sessions and restores the foldout preferences it changes. `-Suite Monitoring` runs the separate monitoring regression suite.

The batch fixture reads saved foldout preferences but has no attached panel for user-input events. The original attached-window checks in the report were performed separately through the MCP: resize the existing validation Dashboard, exercise long values and nested toggles, recreate its interface, request script recompilation, read back state, then remove fixtures and restore preferences and size. The newer rendering suite adds pixel review for the views listed above; other OS layouts, DPI settings and older Unity execution remain outside this evidence.
