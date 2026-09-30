# Modernization: evidence and remaining work

Working branch: `Development-Unity66-Modernization` in both repositories. Baselines: server `826af5c` (2.35.6), plugin `0b8e76f` (2.39.7). Work remains in progress; no release has been published.

The objective remains a broad improvement of the existing MCP and plugin: backwards compatibility, Unity 6.6, performance, monitoring, multiplayer/multiple projects and documentation with stronger visuals. The current architecture is retained. Improvements must follow understanding and evidence, not assumptions that existing behavior is broken.

## Verified in this iteration

| Change | Evidence | Scope / limit |
|---|---|---|
| Request-local routing, agent identity and project context | New stdio test failed on baseline with `Beta !== Alpha`; passes after isolation | Overlapping requests to two mock bridges, including polling headers |
| Queue capability per endpoint | New mixed-version test failed on baseline with `legacy !== queue`; passes after fix | Legacy plugin and queue plugin in one MCP process |
| Live discovery identity, fewer pings | Reused-port registry test; one ping for identity and liveness | Registry path and successful port probing |
| Existing MCP contracts | 65 passing Node tests on Node 18, 20, 22 and 24, Windows and Linux | Eight CI jobs; full tested surface, not every Unity route |
| Dependency refresh | SDK pinned to existing tested 1.27.1; compatible transitive upgrades; `npm audit` reports zero | Advisory database at validation time; not a security certification |
| Indexed pending-ticket lookup | Actual plugin tested with 100 and 10,000 queued tickets | O(1) ticket lookup replaces FIFO scans; output allocation remains |
| Separate wait and processing timings | Monotonic timestamps and session averages; old `executionTimeMs` retained | Dashboard includes wait/processing averages and exception/timeout counters; command-result errors are not queue exceptions |
| Synchronous waiter lifecycle | 50 normal calls plus real 30-second timeouts while work is running, batched and queued | Completed outcomes are stable; expired unstarted work is skipped; already-started work cannot be canceled |
| Deferred lifecycle and retention | Duplicate callback failed before fix; concurrent duplicates, expiration, late callback after eviction, exception and long queue wait pass | Deadlines/retention use monotonic time; reload recovery remains open |
| Dashboard state | UI Toolkit labels report running-only work, failure/timeout counts and timing breakdown | Batch-mode state checks; interactive layout review remains open |
| Unity 6.6 | Package compiled and validation runner passed on `6000.6.2f1` | Isolated project, no optional-package or real multiplayer certification |
| Minimal project installation | Second import exposed missing uGUI; declare uGUI and Test Framework in the package | Validation manifest now depends only on the plugin; Unity 6.6 resolves uGUI 2.6.0 and Test Framework 1.8.0 |
| README | New vector architecture visual, installation flow, workflow tables, detailed linked guides | Existing demo media retained; competitor claims corrected against sources |

Measured in Unity 6000.6.2f1 on this Windows workstation: 1,000 status queries took **2.96 ms** with 100 queued requests and **2.91 ms** with 10,000 queued requests in the initial minimal-dependency validation run. These are single-run microbenchmarks, affected by JIT and scheduling; they demonstrate behavior under queue depth, not a claimed speedup against another product or a baseline measurement. The [raw Unity report](validation/unity66-queue.json) preserves the result. The subsequent [lifecycle and dashboard report](validation/unity66-lifecycle.json) records the expanded checks, including real 30-second timeout races; its polling measurements are 6.24 ms and 3.87 ms respectively.

Published checkpoints: server `509979b`, plugin `bb173d6`. [All eight server CI jobs passed](https://github.com/AnkleBreaker-Studio/unity-mcp-server/actions/runs/36741080230); the [plugin route registry check passed](https://github.com/AnkleBreaker-Studio/unity-mcp-plugin/actions/runs/36741086044). The plugin CI only checks route drift; the actual Unity run was local.

The plugin lifecycle/monitoring follow-up is published as `bc947f9`, with the expanded local Unity report linked above and a [passing route registry CI check](https://github.com/AnkleBreaker-Studio/unity-mcp-plugin/actions/runs/36742844003).

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

Local evidence for this iteration lives in the sibling workspace directory `../validation/Queue66/`. Only Unity 6.6.2 has an executable installed: the folders named 6000.0.26f1 and 6000.3.3f1 are incomplete installations. Older-version tests have **not** passed yet.

## Remaining work before completion

1. Complete route-family review and real editor tests: scene/component/asset operations, screenshots, code execution, undo, packages, tests, builds and optional integrations.
2. Expand monitoring end to end: command-result error/reload counters, bounded history and interactive dashboard review. Session wait/processing aggregates and exception/timeout counts now exist. Review idle allocations and main-thread work with measurements.
3. Test old/new server-plugin combinations and older supported Unity versions, not just the new server's legacy mock transport. Add repeatable CI coverage where feasible.
4. Exercise actual simultaneous editors and MPPM/ParrelSync workflows. Verify selection, clone lifecycle, recompile, play-mode transitions and domain reload disabled.
5. Address remaining fault semantics: ambiguous write submission, retry deduplication and lost/reloaded tickets. Deferred timeouts, late callbacks and result retention now have focused Unity coverage. Never infer that a timeout means a write did not occur.
6. Review Unity 6.6 semantic changes, especially scene-only reload and Managed Code Variant build diagnostics. Compilation alone does not cover them.
7. Review long-lived caches, request cancellation, response byte accounting, discovery identity transitions and resource routing under concurrency.
8. Keep both READMEs and release notes aligned as implementation expands. Review the final cross-repository diff and refresh validation evidence before release.
9. Prepare versioning and reviewable changes with test evidence. Publish feature branches per studio workflow when the set is ready; merge/release only within authorized scope.

## Version references

The [Unity 6.6 upgrade guide](https://docs.unity.com/en-us/engine/6000.6/manual/upgrade-guides/upgrade-guide-unity66) is the current reference for version-specific behavior. The [architecture map](architecture.md) records the actual ownership of state and the execution chain. Product comparisons use [first-party sources](comparison.md), with no inferred claims of competitors lacking capabilities.
