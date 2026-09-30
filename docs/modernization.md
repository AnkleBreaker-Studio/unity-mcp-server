# Modernization: evidence and remaining work

Working branch: `Development-Unity66-Modernization` in both repositories. Baselines: server `826af5c` (2.35.6), plugin `0b8e76f` (2.39.7). Work remains in progress; no release has been published.

The objective remains a broad improvement of the existing MCP and plugin: backwards compatibility, Unity 6.6, performance, monitoring, multiplayer/multiple projects and documentation with stronger visuals. The current architecture is retained. Improvements must follow understanding and evidence, not assumptions that existing behavior is broken.

## Verified in this iteration

| Change | Evidence | Scope / limit |
|---|---|---|
| Request-local routing, agent identity and project context | New stdio test failed on baseline with `Beta !== Alpha`; passes after isolation | Overlapping requests to two mock bridges, including polling headers |
| Resource routing and selection loss | Reproduced cross-project resource reads; lists/reads now retain agent identity and target; lost/conflicting identities require reselection | Six stdio regressions plus live context-file reads in two Unity 6.6 editors; legacy category-relative URIs retained |
| Queue capability per endpoint | New mixed-version test failed on baseline with `legacy !== queue`; passes after fix | Legacy plugin and queue plugin in one MCP process |
| Live discovery identity, fewer pings | Reused-port registry test; one ping for identity and liveness | Registry path and successful port probing |
| Existing MCP contracts | 80 tests pass locally on Node 18 and 22 and in all eight CI jobs (Node 18/20/22/24, Windows/Linux) | Full tested surface, not every Unity route; CI does not run the opt-in real-editor suites |
| Dependency refresh | SDK pinned to existing tested 1.27.1; compatible transitive upgrades; `npm audit` reports zero | Advisory database at validation time; not a security certification |
| Indexed pending-ticket lookup | Actual plugin tested with 100 and 10,000 queued tickets | O(1) ticket lookup replaces FIFO scans; output allocation remains |
| Separate wait and processing timings | Monotonic timestamps and session averages; old `executionTimeMs` retained | Dashboard includes wait/processing averages and exception/timeout counters; command-result errors are not queue exceptions |
| Synchronous waiter lifecycle | 50 normal calls plus real 30-second timeouts while work is running, batched and queued | Completed outcomes are stable; expired unstarted work is skipped; already-started work cannot be canceled |
| Deferred lifecycle and retention | Duplicate callback failed before fix; concurrent duplicates, expiration, late callback after eviction, exception and long queue wait pass | Deadlines/retention use monotonic time; tickets do not survive domain reload |
| Dashboard state and refresh | Reused agent cards, persisted sections, single refresh schedule; changing-agent workload records 83% fewer allocation events | Batch measurements exclude rendering; live 360 px geometry and script-reload checks pass; pixel-level review remains open |
| Protected submission retries | Old transport reproduced two writes after response loss/HTTP 503; nine new fault tests pass | Protocol-2 session/deadline protection; older endpoints do not replay ambiguous writes |
| Actual plugin HTTP protocol | Repeated protected submissions create one GameObject; scoped polling and old queue/sync requests pass in Unity | Validation-owned listener invokes the real dispatcher; a separate live test now covers actual domain reload |
| Unity 6.6 build diagnostics | Baseline Development build lacked checks/instrumentation; five corrected Windows Mono builds cover all four variants | Compiled assembly constants inspected; project setting restored after success and intentional failure; other platforms/IL2CPP untested |
| Two real editors | 24 overlapping commands through one stdio server, two agent selections, no explicit command ports | Each project's counter advances exactly 12 times; independent projects, not multiplayer clones |
| Play Mode and actual reload | Four reload configurations pass; Play/Stop readback recovers lost results; script reload reports an unknown result with execution count one | Unity 6000.6.2f1; Pause is a toggle and does not infer success from a final state |
| Explicit read/write policy | Four state-changing profiler/debugger routes and an unknown route execute one per update; compilation-error and existing state reads batch five | Real queue callbacks; native profiler/debugger feature behavior is outside this scheduling test |
| Session retention and visibility | 5,000 stale sessions removed, newest 256 inactive sessions retained, busy/fresh sessions survive, returning agent starts new statistics | Monotonic idle expiry; active/busy sessions have no forced eviction; about 8.5 MiB released in the synthetic retention case |
| Empty queue allocations | Positive-control ProfilerRecorder measures 3,000 allocations before scratch reuse and zero after, over 100,000 warmed updates | Queue processor only, not the entire plugin/editor; the runtime's allocated-byte counter failed its control test |
| Command errors and terminal history | 15 result shapes, seven baseline classification failures corrected; duplicate callbacks, timeout history, persistence, history endpoint and create/undo checks pass | Additive outcome fields; original completed status/results retained. Pending history is capped and reports dropped records; custom computed getters are not evaluated |
| Live command monitoring | A real missing-object lookup reports MCP `isError`, one session command error and one flagged history record, with Node 18 and 22 | One open Unity 6000.6.2f1 editor; separate opt-in `npm run test:monitoring`, not ordinary CI |
| Unity 6.6 | Package compiled and validation runner passed on `6000.6.2f1` | Isolated projects; optional integrations need individual verification |
| Native MPPM 3.0 | Host/Client scenario, 12 overlapping commands before and after shared script recompilation, settings and player cleanup | Node 18 and 22 on Windows; older MPPM, ParrelSync lifecycle and game networking untested |
| Actual server/plugin version mixing | All four released/current combinations pass object, undo, error, history and execution workflows; current-server mixed-plugin concurrency preserves four agents across two projects | Node 18 and 22 on Windows/Unity 6.6; 384 tool names retained; not every route or historical release executed |
| Editor data workflows | Scenes, sparse enums/flags, references, materials, prefabs, asset/hierarchy limits and successful/failed captures | Real Unity 6.6 editor on Node 18 and 22; unique fixtures removed and original scene restored |
| Minimum-version API compilation | All 70 editor source files compile against installed Unity 2021.3.18f1 assemblies after a Dashboard namespace fix | Compiler-only; bundled template package DLLs; no editor execution/UPM resolution; UMA/ProBuilder excluded |
| Code execution | DLL failure cleanup, source-relative errors, reference cache invalidation/bounds and fresh execution pass; 20 calls measured 15.85 s before / 1.01 s after | Unity 6.6 Mono on Windows; local microbenchmark; CoreCLR editor and other OS execution unverified |
| Optional UMA integration | UMA V3.1f1 creation, registration, verification, race editing and rename checks pass; 16 absent-package facade errors pass | Unity 6.6; synthetic skinned model; UMA 2 execution and rendered/runtime avatars unverified |
| Minimal project installation | Second import exposed missing uGUI; declare uGUI and Test Framework in the package | Validation manifest now depends only on the plugin; Unity 6.6 resolves uGUI 2.6.0 and Test Framework 1.8.0 |
| README | New vector architecture visual, installation flow, workflow tables, detailed linked guides | Existing demo media retained; competitor claims corrected against sources |

Measured in Unity 6000.6.2f1 on this Windows workstation: 1,000 status queries took **2.96 ms** with 100 queued requests and **2.91 ms** with 10,000 queued requests in the initial minimal-dependency validation run. These are single-run microbenchmarks, affected by JIT and scheduling; they demonstrate behavior under queue depth, not a claimed speedup against another product or a baseline measurement. The [raw Unity report](validation/unity66-queue.json) preserves the result. The subsequent [lifecycle and dashboard report](validation/unity66-lifecycle.json) records the expanded checks, including real 30-second timeout races; its polling measurements are 6.24 ms and 3.87 ms respectively.

Published checkpoints: server `509979b`, plugin `bb173d6`. [All eight server CI jobs passed](https://github.com/AnkleBreaker-Studio/unity-mcp-server/actions/runs/36741080230); the [plugin route registry check passed](https://github.com/AnkleBreaker-Studio/unity-mcp-plugin/actions/runs/36741086044). The plugin CI only checks route drift; the actual Unity run was local.

The plugin lifecycle/monitoring follow-up is published as `bc947f9`, with the expanded local Unity report linked above and a [passing route registry CI check](https://github.com/AnkleBreaker-Studio/unity-mcp-plugin/actions/runs/36742844003).

The [retry validation report](validation/unity66-retries.json) adds concurrent protected admission, real HTTP dispatch and bounded retry-cache checks. Its polling measurements are 2.84 ms and 5.39 ms. See the [wire contract and compatibility matrix](queue-protocol.md) for guarantees and limits.

Retry implementation checkpoints: server `0c3b7f9`, plugin `9b56fa8`. [All eight server CI jobs passed](https://github.com/AnkleBreaker-Studio/unity-mcp-server/actions/runs/36745758831), as did the [plugin route registry check](https://github.com/AnkleBreaker-Studio/unity-mcp-plugin/actions/runs/36745752296). Both README introductions were rendered and inspected after the documentation update.

The [build report](validation/unity66-builds.json) preserves the reproduced baseline and five corrected builds, including restoration after a failed build. The [live editor report](validation/unity66-editor-lifecycle.json) records two independent editors, the default/scene-only/no-reload/domain-only configurations, and actual script-reload result loss. The initial live run exposed false Play failures after session changes; the corrected run verifies success by readback without another Play command. Both reports are from Windows with Unity 6000.6.2f1.

Build and live-editor checkpoints: server `843088b`, plugin `98b6d11`. [All eight server CI jobs passed with 80 tests](https://github.com/AnkleBreaker-Studio/unity-mcp-server/actions/runs/36749833896), and the [338-route plugin registry check passed](https://github.com/AnkleBreaker-Studio/unity-mcp-plugin/actions/runs/36749793560). Both actual editors finished out of Play Mode with `isCompiling: false` and zero compilation errors. Versions remain unchanged; these are feature-branch checkpoints, not releases.

The [queue health report](validation/unity66-queue-health.json) adds retention, visibility, scheduling and controlled allocation measurements. The [full queue regression report after these changes](validation/unity66-queue-health-regressions.json) passes all ten check groups, including actual HTTP dispatch, duplicate callbacks and real timeout races. See [queue monitoring](queue-monitoring.md) for policy semantics, measurement limits and reproduction with `-Suite Health`.

Queue health checkpoints: plugin `ca3233e`, server documentation `d4a1966`. The [plugin CI check passed](https://github.com/AnkleBreaker-Studio/unity-mcp-plugin/actions/runs/36752412519), validating 338 routes and the 92-entry read policy. Local health and full queue suites passed on Unity 6000.6.2f1; both open validation editors also compiled without errors. Server runtime code is unchanged from the 80-test checkpoint above.

## Reproduce

Server:

```sh
npm ci
npm test
npm audit
```

From the companion plugin repository, with an installed Unity editor and an empty disposable project directory:

```powershell
./tools~/validate-unity.ps1 -EditorPath 'C:/Program Files/Unity/Hub/Editor/6000.6.2f1/Editor/Unity.exe' -ProjectPath 'C:/UnityMcpValidation/Unity66'
```

The runner writes `Library/UnityMcpValidation.json` and `validation.log` in the disposable project. It refuses an existing project without its marker. It runs hidden in batch mode and does not modify a production game project.

For live build validation, follow the [build guide](builds.md). For editor lifecycle validation, open two disposable marked projects with the bridge running, save their scenes, exit Play Mode, and configure the first editor's existing Game view to **Play Unfocused**:

```powershell
$env:UNITY_MCP_EDITOR_PROJECTS = '["C:/UnityMcpValidation/Queue66","C:/UnityMcpValidation/Unity66"]'
npm run test:lifecycle
```

This opt-in suite selects by project name and verifies each actual project path. It enters/exits Play Mode in the first project, requests a script reload, checks that the second project remains unaffected, and restores the original Play Mode options. It writes `Library/UnityMcpEditorLifecycle.json` in the first project. The build and lifecycle suites are separate from `npm test` and ordinary CI because they operate real disposable editors.

Local live-editor evidence lives in the sibling workspace directory `../validation/Queue66/`. Unity 6.6.2 runs there. The official Unity 2021.3.18f1 editor was installed separately and used for a passing compiler-only API check, but its batch startup stopped at license initialization. At the maintainer's request, further older-editor execution is deferred and will be revisited for reported compatibility issues. The folders named 6000.0.26f1 and 6000.3.3f1 remain incomplete installations.

## Remaining work before completion

The [UMA guide](uma.md) and [report](validation/unity66-uma.json) add a tested optional assembly boundary and fixes for the reproduced UMA 3 compiler/API failures. Generation preserves unrelated folders and existing assets after collisions; renames cover recipe JSON v1/v2/v3 and cached names. The minimal-project health suite and minimum-version compiler check still pass.

The [execution guide](code-execution.md) and [report](validation/unity66-execution.json) distinguish Unity 6.6's actual Mono runtime from the CoreCLR analyzer warnings. The new Unity loading APIs are exercised, and reproduced temporary-file/diagnostic defects are fixed. A bounded metadata cache has measured gains and invalidation/eviction coverage; compiled user methods/results are not cached. New editor-state fields expose its counters. CoreCLR execution, other operating systems and interruption of arbitrary running code remain outside this evidence.

Execution checkpoint: plugin `f5f5bac`, with a [passing route registry CI check](https://github.com/AnkleBreaker-Studio/unity-mcp-plugin/actions/runs/36772959080). The focused batch suite passes, as do live editor workflows on Node 18.20.8 and 22.18.0. A read after the live script reload confirms empty compiler caches and reset snippet counters. The unchanged server runtime retains its previous passing CI evidence; this companion update is documentation only.

UMA implementation checkpoint: plugin `00090f6`, with a [passing 338-route registry CI check](https://github.com/AnkleBreaker-Studio/unity-mcp-plugin/actions/runs/36770864337). Both live validation editors finish with zero compilation errors. Companion server changes in this checkpoint are documentation only, which its CI intentionally skips; the unchanged runtime's [eight Node 18/20/22/24 jobs passed](https://github.com/AnkleBreaker-Studio/unity-mcp-server/actions/runs/36765496124). Versions remain unchanged and no release has been published.

1. Continue route-family review beyond the passing scene/component/reference/prefab/asset/Scene-capture workflows, execution compilation/cache checks and UMA asset workflows: execution result boundaries, undo, packages, tests, remaining screenshots, builds and other optional integrations.
2. Expand monitoring end to end: reload counters and a pixel-level dashboard review. Card refreshes now have baseline/corrected measurements, with live narrow-window geometry and section persistence checks. Measure attached-panel rendering, HTTP and active-work costs beyond these fixtures.
3. The released/current server-plugin matrix now passes in actual Unity 6.6 editors on Node 18 and 22, through opt-in `test:compatibility`. Actual older-Unity execution is deferred by maintainer direction; retain the minimum-version compiler check and revisit runtime compatibility for reported issues. Additional historical releases and editor OS combinations remain unverified.
4. Extend multiplayer validation to older MPPM versions, ParrelSync lifecycle and game networking. Unity 6.6 / MPPM 3.0 now passes native Host/Client launch, two sets of 12 overlapping commands through separate agent selections, virtual-player stop/start and shared script recompilation.
5. Extend actual reload/lost-ticket recovery to other editor versions and client/plugin combinations. Unity 6.6 script reload now confirms one execution plus an unknown result, and Play/Stop recover by readback. Never infer that a timeout means a write did not occur.
6. Continue reviewing Unity 6.6 semantic changes and optional-package APIs. Managed Code Variant builds now have compiled evidence on Windows Mono; other build platforms and IL2CPP remain untested. Play Mode tests cover the four existing reload combinations, not all scene restoration semantics or new Unity 6.6 optimizations.
7. Review long-lived caches, request cancellation and response byte accounting. Resource routing and selection-loss defects now have regression coverage; continue assessing other discovery identity transitions under concurrency.
8. Keep both READMEs and release notes aligned as implementation expands. Review the final cross-repository diff and refresh validation evidence before release.
9. Prepare versioning and reviewable changes with test evidence. Publish feature branches per studio workflow when the set is ready; merge/release only within authorized scope.

The queue review's concrete retention, route-classification and command-outcome/history findings are now fixed and tested. The [monitoring guide](queue-monitoring.md) and [outcome report](validation/unity66-command-outcomes.json) describe the additive contract and its limits. Dashboard refresh allocations now have separate evidence; HTTP allocations and other long-lived server/plugin caches remain in scope.

The command-outcome/history changes are published in plugin commit `b3dbef2`. Local validation includes the focused monitoring suite, the full queue/HTTP suite with real timeout history checks, the health regression suite and the live stdio monitoring path on Node 18 and 22. The 80 ordinary server tests pass. Interactive dashboard layout, older Unity versions and actual multiplayer clones remain outside this checkpoint's evidence.

The [MPPM guide](multiplayer.md) and [raw multiplayer report](validation/unity66-multiplayer.json) record the native Unity 6.6 findings and live verification. Scenario creation now writes the settings Unity executes, activation selects the native Play Mode scenario, and discovery preserves virtual-player identity. A registry BOM parsing regression is covered outside the fallback scan range. The ordinary server suite has 83 tests. Live MPPM runs pass on Node 18 and 22. A separate package-absent fixture reports native API availability, package installation and player initialization independently. These checks cover editor orchestration and isolation, not network connections in a game. Parent ports changed across some Play Mode reloads; identity-based rediscovery passes, while listener rebinding latency remains a review item.

## Version references

The [resource guide](resources.md) and [report](validation/resource-routing.json) add isolated resource handlers, explicit selection requirements and custom-port selection retention. Six stdio regressions reproduce the failures, including stale registry identity after port reuse. Live checks exercise actual Markdown reads in two Unity 6.6 editors with settings/fixture restoration. The ordinary suite now has 89 tests.

Resource/discovery checkpoint: server `acf10cf`; all eight Node 18/20/22/24 jobs on Windows/Linux [passed](https://github.com/AnkleBreaker-Studio/unity-mcp-server/actions/runs/36780224199). The preceding `1cc33ea` checkpoint also has [passing CI](https://github.com/AnkleBreaker-Studio/unity-mcp-server/actions/runs/36779733155) and live resource checks on Node 18/22. These are server changes; plugin runtime remains at `631b5d2`.

The [compatibility guide](compatibility.md) and [report](validation/unity66-version-compatibility.json) record four real server-plugin combinations, unchanged baseline checkouts, schema/name continuity and concurrent agents across mixed plugin versions. The existing 83 ordinary server tests also pass after making the test client's server entry configurable. Live editor validation remains opt-in and separate from ordinary CI.

Compatibility-suite checkpoint: server `9461c66`, with [eight passing CI jobs](https://github.com/AnkleBreaker-Studio/unity-mcp-server/actions/runs/36777911057). Plugin documentation checkpoint `f4fcf24` links the matrix without changing plugin runtime. Versions remain unchanged and no release has been published.

The [Dashboard guide](dashboard.md) and [report](validation/unity66-dashboard.json) add reproduced reconstruction/width defects, typed session snapshots, card lifecycle tests and measured refresh costs. Attached-window checks cover long text, foldout persistence through script reload and schedule replacement. Monitoring regressions and the 70-file minimum-version compiler check pass. Actual older-editor execution remains deferred as requested.

Dashboard checkpoint: plugin `631b5d2`, with a [passing 338-route registry CI check](https://github.com/AnkleBreaker-Studio/unity-mcp-plugin/actions/runs/36776145255). Both open validation editors compile without errors. The companion server update changes documentation only; runtime, versions and release status are unchanged.

The [editor workflow guide](editor-workflows.md) records enum compatibility, asset result limits and capture resource ownership. Its [live report](validation/unity66-features.json) preserves the reproduced failures and successful Node 18/22 runs. The [minimum-version report](validation/unity2021-api.json) distinguishes C# compilation from the deferred real-editor check. The normal server suite remains 83 passing tests on Node 18 and 22.

The [Unity 6.6 upgrade guide](https://docs.unity.com/en-us/engine/6000.6/manual/upgrade-guides/upgrade-guide-unity66) is the current reference for version-specific behavior. The [architecture map](architecture.md) records the actual ownership of state and the execution chain. Product comparisons use [first-party sources](comparison.md), with no inferred claims of competitors lacking capabilities.
