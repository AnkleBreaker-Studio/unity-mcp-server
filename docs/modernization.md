# Modernization: evidence and remaining work

Working branch: `Development-Unity66-Modernization` in both repositories. Baselines: server `826af5c` (2.35.6), plugin `0b8e76f` (2.39.7). Work remains in progress; no release has been published.

The objective remains a broad improvement of the existing MCP and plugin: backwards compatibility, Unity 6.6, performance, monitoring, multiplayer/multiple projects and documentation with stronger visuals. The current architecture is retained. Improvements must follow understanding and evidence, not assumptions that existing behavior is broken.

## Verified in this iteration

| Change | Evidence | Scope / limit |
|---|---|---|
| Request-local routing, agent identity and project context | New stdio test failed on baseline with `Beta !== Alpha`; passes after isolation | Overlapping requests to two mock bridges, including polling headers |
| Queue capability per endpoint | New mixed-version test failed on baseline with `legacy !== queue`; passes after fix | Legacy plugin and queue plugin in one MCP process |
| Live discovery identity, fewer pings | Reused-port registry test; one ping for identity and liveness | Registry path and successful port probing |
| Existing MCP contracts | 80 tests pass locally on Node 18 and 22 and in all eight CI jobs (Node 18/20/22/24, Windows/Linux) | Full tested surface, not every Unity route; CI does not run the opt-in real-editor suites |
| Dependency refresh | SDK pinned to existing tested 1.27.1; compatible transitive upgrades; `npm audit` reports zero | Advisory database at validation time; not a security certification |
| Indexed pending-ticket lookup | Actual plugin tested with 100 and 10,000 queued tickets | O(1) ticket lookup replaces FIFO scans; output allocation remains |
| Separate wait and processing timings | Monotonic timestamps and session averages; old `executionTimeMs` retained | Dashboard includes wait/processing averages and exception/timeout counters; command-result errors are not queue exceptions |
| Synchronous waiter lifecycle | 50 normal calls plus real 30-second timeouts while work is running, batched and queued | Completed outcomes are stable; expired unstarted work is skipped; already-started work cannot be canceled |
| Deferred lifecycle and retention | Duplicate callback failed before fix; concurrent duplicates, expiration, late callback after eviction, exception and long queue wait pass | Deadlines/retention use monotonic time; tickets do not survive domain reload |
| Dashboard state | UI Toolkit labels report running-only work, failure/timeout counts and timing breakdown | Batch-mode state checks; interactive layout review remains open |
| Protected submission retries | Old transport reproduced two writes after response loss/HTTP 503; nine new fault tests pass | Protocol-2 session/deadline protection; older endpoints do not replay ambiguous writes |
| Actual plugin HTTP protocol | Repeated protected submissions create one GameObject; scoped polling and old queue/sync requests pass in Unity | Validation-owned listener invokes the real dispatcher; a separate live test now covers actual domain reload |
| Unity 6.6 build diagnostics | Baseline Development build lacked checks/instrumentation; five corrected Windows Mono builds cover all four variants | Compiled assembly constants inspected; project setting restored after success and intentional failure; other platforms/IL2CPP untested |
| Two real editors | 24 overlapping commands through one stdio server, two agent selections, no explicit command ports | Each project's counter advances exactly 12 times; independent projects, not multiplayer clones |
| Play Mode and actual reload | Four reload configurations pass; Play/Stop readback recovers lost results; script reload reports an unknown result with execution count one | Unity 6000.6.2f1; Pause is a toggle and does not infer success from a final state |
| Unity 6.6 | Package compiled and validation runner passed on `6000.6.2f1` | Isolated project, no optional-package or real multiplayer certification |
| Minimal project installation | Second import exposed missing uGUI; declare uGUI and Test Framework in the package | Validation manifest now depends only on the plugin; Unity 6.6 resolves uGUI 2.6.0 and Test Framework 1.8.0 |
| README | New vector architecture visual, installation flow, workflow tables, detailed linked guides | Existing demo media retained; competitor claims corrected against sources |

Measured in Unity 6000.6.2f1 on this Windows workstation: 1,000 status queries took **2.96 ms** with 100 queued requests and **2.91 ms** with 10,000 queued requests in the initial minimal-dependency validation run. These are single-run microbenchmarks, affected by JIT and scheduling; they demonstrate behavior under queue depth, not a claimed speedup against another product or a baseline measurement. The [raw Unity report](validation/unity66-queue.json) preserves the result. The subsequent [lifecycle and dashboard report](validation/unity66-lifecycle.json) records the expanded checks, including real 30-second timeout races; its polling measurements are 6.24 ms and 3.87 ms respectively.

Published checkpoints: server `509979b`, plugin `bb173d6`. [All eight server CI jobs passed](https://github.com/AnkleBreaker-Studio/unity-mcp-server/actions/runs/36741080230); the [plugin route registry check passed](https://github.com/AnkleBreaker-Studio/unity-mcp-plugin/actions/runs/36741086044). The plugin CI only checks route drift; the actual Unity run was local.

The plugin lifecycle/monitoring follow-up is published as `bc947f9`, with the expanded local Unity report linked above and a [passing route registry CI check](https://github.com/AnkleBreaker-Studio/unity-mcp-plugin/actions/runs/36742844003).

The [retry validation report](validation/unity66-retries.json) adds concurrent protected admission, real HTTP dispatch and bounded retry-cache checks. Its polling measurements are 2.84 ms and 5.39 ms. See the [wire contract and compatibility matrix](queue-protocol.md) for guarantees and limits.

Retry implementation checkpoints: server `0c3b7f9`, plugin `9b56fa8`. [All eight server CI jobs passed](https://github.com/AnkleBreaker-Studio/unity-mcp-server/actions/runs/36745758831), as did the [plugin route registry check](https://github.com/AnkleBreaker-Studio/unity-mcp-plugin/actions/runs/36745752296). Both README introductions were rendered and inspected after the documentation update.

The [build report](validation/unity66-builds.json) preserves the reproduced baseline and five corrected builds, including restoration after a failed build. The [live editor report](validation/unity66-editor-lifecycle.json) records two independent editors, the default/scene-only/no-reload/domain-only configurations, and actual script-reload result loss. The initial live run exposed false Play failures after session changes; the corrected run verifies success by readback without another Play command. Both reports are from Windows with Unity 6000.6.2f1.

Build and live-editor checkpoints: server `843088b`, plugin `98b6d11`. [All eight server CI jobs passed with 80 tests](https://github.com/AnkleBreaker-Studio/unity-mcp-server/actions/runs/36749833896), and the [338-route plugin registry check passed](https://github.com/AnkleBreaker-Studio/unity-mcp-plugin/actions/runs/36749793560). Both actual editors finished out of Play Mode with `isCompiling: false` and zero compilation errors. Versions remain unchanged; these are feature-branch checkpoints, not releases.

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

Local evidence for this iteration lives in the sibling workspace directory `../validation/Queue66/`. Only Unity 6.6.2 has an executable installed: the folders named 6000.0.26f1 and 6000.3.3f1 are incomplete installations. Older-version tests have **not** passed yet.

## Remaining work before completion

1. Complete route-family review and real editor tests: scene/component/asset operations, screenshots, code execution, undo, packages, tests, builds and optional integrations.
2. Expand monitoring end to end: command-result error/reload counters, bounded history and interactive dashboard review. Session wait/processing aggregates and exception/timeout counts now exist. Review idle allocations and main-thread work with measurements.
3. Test old/new server-plugin combinations and older supported Unity versions, not just the new server's legacy mock transport. Add repeatable CI coverage where feasible.
4. Exercise actual MPPM/ParrelSync workflows, clone lifecycle and recompile. Independent simultaneous editors and four Play Mode reload configurations now pass on Unity 6.6; this is not yet a multiplayer-clone validation.
5. Extend actual reload/lost-ticket recovery to other editor versions and client/plugin combinations. Unity 6.6 script reload now confirms one execution plus an unknown result, and Play/Stop recover by readback. Never infer that a timeout means a write did not occur.
6. Continue reviewing Unity 6.6 semantic changes and optional-package APIs. Managed Code Variant builds now have compiled evidence on Windows Mono; other build platforms and IL2CPP remain untested. Play Mode tests cover the four existing reload combinations, not all scene restoration semantics or new Unity 6.6 optimizations.
7. Review long-lived caches, request cancellation, response byte accounting, discovery identity transitions and resource routing under concurrency.
8. Keep both READMEs and release notes aligned as implementation expands. Review the final cross-repository diff and refresh validation evidence before release.
9. Prepare versioning and reviewable changes with test evidence. Publish feature branches per studio workflow when the set is ready; merge/release only within authorized scope.

Concrete follow-up findings from the queue review: agent sessions remain in `_sessions` after inactivity, even though each individual action log is capped; read/write classification is a route-name heuristic and currently includes all `profiler/*` and `debugger/*` routes, including state-changing enable operations and snapshot creation. Measure retention/idle cost and verify scheduling/undo behavior before changing these policies.

## Version references

The [Unity 6.6 upgrade guide](https://docs.unity.com/en-us/engine/6000.6/manual/upgrade-guides/upgrade-guide-unity66) is the current reference for version-specific behavior. The [architecture map](architecture.md) records the actual ownership of state and the execution chain. Product comparisons use [first-party sources](comparison.md), with no inferred claims of competitors lacking capabilities.
