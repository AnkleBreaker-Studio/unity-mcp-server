# Action History drawing and resource lifetime

Action History previously built every IMGUI row on every Layout and Repaint event, including rows outside the viewport. The cost grew with retained history even when the user saw the same number of rows. Its selection background also created a native texture without releasing it: sixteen test windows left sixteen textures alive after window destruction.

The window now uses fixed-height rows and prepares only the visible slice, with one additional boundary row. The scroll extent still represents the complete filtered history. Shrinking a filter clamps the scroll offset; selected actions retain their identity through the existing revision-based refresh. Status, time, agent, category, command, target links, duration and details retain their existing data sources. Selection is drawn as a rectangle, without a generated texture. Disabling the window releases its cached record/style references.

## Controlled native measurements

The [report](validation/unity66-history-window.json) compares plugin `2fc0f0e` with the corrected implementation in Unity 6000.6.2f1 on Windows/Mono. A real 720 × 520 editor window stays behind other windows. The fixture invokes the production `OnGUI` in actual editor GUI events, ignores the first four events of each kind, and reports the upper median (the middle observed value after sorting) from the next twenty. It freezes the list during sampling; record creation, filtering and notification delivery are outside this measurement.

| Retained rows | Layout allocation events before → after | Repaint allocation events before → after |
|---|---:|---:|
| 100 | 5,085 → 318 | 3,373 → 413 |
| 500 | 25,087 → 318 | 16,173 → 413 |
| 5,000 | 250,094 → 318 | 160,180 → 413 |

For the 5,000-row current-server Node 22 run, median measured Layout work changed from 191.67 to 0.24 ms and Repaint work from 72.45 to 1.80 ms. These are local measurements around this window's GUI callback, including recorder overhead. They do not measure GPU completion, the complete editor frame, network latency, gameplay FPS or another product. Other OS/DPI configurations and workloads need separate evidence. Runtime assertions use allocation-event scaling, not a fragile wall-time threshold.

Four complete runs use current/released servers on Node 18/22. Each checks the three history sizes, the sixteen-window resource probe, and eight interactions: top/middle/bottom row selection, exact native target selection, mouse-wheel scrolling, bottom access at 500 × 400 and 1200 × 900, retained selection after narrowing, and empty-filter reset. GUI errors remain empty. Window operations preserve foreground focus and the previous editor tab; cleanup restores the native selection and persistence settings, removes its target and closes the window.

The notification, Dashboard and mesh validation suites pass with the corrected measurement fields. All 77 editor sources compile against the Unity 2021.3.18f1 APIs. Actual older-editor execution remains deferred by maintainer direction.

## Correction to previous allocation reports

The review found an instrumentation error in earlier reports: some `GC.Alloc` sample `Value` fields had been labeled `allocatedBytes`. In this Unity editor, `ProfilerRecorder.UnitType` reports `TimeNanoseconds`. Controls allocating arrays of 64, 8,192 and 1,048,576 bytes each produced one event with the same raw value of 100. These values cannot establish allocated sizes. Unity also explains that GC allocation markers use artificial durations, which cannot measure allocation CPU time. [Unity profiling guidance](https://unity.com/how-to/best-practices-for-profiling-game-performance), [recorder API](https://docs.unity3d.com/2021.3/Documentation/ScriptReference/Unity.Profiling.ProfilerRecorder.html).

The Dashboard and notification fixtures now record sample **Count** as allocation events and label raw values with their unit. The mesh fixture checks the reported unit before considering byte support. Seven historical JSON reports explicitly annotate the correction and retain all 39 original numeric values under `rawRecorderValue`, with `rawRecorderUnit`. Previously recorded event counts and independent Stopwatch timings remain unchanged. The old Action History byte-reduction claim and its derived percentage are withdrawn; no event-count reduction is inferred from those historical raw values. These annotations do not claim that every historical test was rerun.

## Reproduce

Copy `tools~/HistoryWindowValidation.cs` from the plugin repository to `Assets/Editor/` in a **marked disposable Windows project**, refresh it and wait for compilation to finish. Open that editor outside Play Mode with a clean scene, then run from the server repository:

```powershell
$env:UNITY_MCP_HISTORY_WINDOW_PROJECT = 'C:/UnityMcpValidation/History66'
npm run test:history-window
```

Set `UNITY_MCP_TEST_SERVER_ENTRY` to the released server's absolute `src/index.js` path for compatibility checks. `UNITY_MCP_HISTORY_WINDOW_BASELINE=1` records the old implementation's cost/resource observations without asserting the new guarantees; a baseline report can therefore have `passed: false` even when the diagnostic runner completes normally. Results are written to `Library/UnityMcpHistoryWindow.json`. The fixture deliberately clears disposable history; remove the copied fixture after validation.
