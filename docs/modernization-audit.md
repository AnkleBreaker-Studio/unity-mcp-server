# Modernization review — 2026-10-01

The modernization remains in progress. This review checks the original product goals against the current server and plugin, refreshes broad compatibility evidence and identifies concrete remaining work. It does not treat the passing test count as complete command coverage.

## Goal coverage

| Original objective | Evidence in the current work | Remaining limits or work |
|---|---|---|
| Understand and retain the existing architecture | [Request lifecycle and state ownership](architecture.md), reviewed against request contexts, discovery, queued transport and the plugin dispatcher. Versions remain independent. | Long-lived Node state has reproduced retention issues, detailed below. |
| Preserve backward compatibility | The [four server/plugin pairs](compatibility.md) were rerun after the mesh changes on Node 18 and 22. All eight runs pass; 384 tool names remain and published schemas add no mandatory arguments. | This exercises routine commands and errors. Older Unity execution is deferred by maintainer direction; pre-queue releases and every optional integration are not covered. |
| Adapt to Unity 6.6 | Actual Unity 6000.6.2f1 workflows cover IDs, compilation, queues, reloads, builds, test jobs, assets, graphics and package operations. All 75 included editor sources also compile against the minimum-version APIs. | Unity Editor tests use Windows/Mono. CoreCLR, IL2CPP and other editor operating systems need their own evidence. |
| Improve performance | Measured improvements cover queue idle work, status construction, Dashboard allocations, compiler metadata reuse, deferred previews and mesh inspection. Each guide distinguishes command costs from transport latency or gameplay FPS. | Total transport overhead, retained queued arguments and long-running process lifetimes remain separate work. |
| Monitor the whole workflow | Queue depth, agent history, outcome categories, wait/processing times, HTTP activity, body admission and reload counts have controlled and live tests. Attached Dashboard layouts have pixel evidence. | Additional DPI/platform layouts and active-work rendering costs remain unmeasured. Debug-log rotation is defective in a long-running process. |
| Support multiple projects and agents | The refreshed matrix includes twelve overlapping calls from four agents across two real editors, with correct routing, per-project counters and agent attribution on both Node versions. Discovery also has identity-replacement and stale-selection regressions. | Expiration of server-side agent state must preserve project-selection safeguards. |
| Support multiplayer projects | [MPPM 3.0 evidence](multiplayer.md) covers native Host/Client launch, virtual-player identity, overlapping agents, stop/start and shared script recompilation. | ParrelSync lifecycle, older MPPM APIs and actual game networking remain unverified. |
| Improve README presentation and substantiate comparisons | Both current READMEs were rendered locally and on GitHub at 390 and 1280 px; images load and articles do not overflow. All 92 checked local/branch links pass. Shared SVGs match. Primary comparison sources were rechecked. | The comparison concerns documented behavior, with no unsupported universal speed claim. Implementation changes must continue to update these claims. |
| Deliver reviewable changes | Changes and evidence are pushed to the modernization branches in both repositories, with passing server and plugin CI at the latest implementation checkpoint. | Final cross-repository review and versioning remain open. No release or merge has been performed. |

The [audit report](validation/modernization-audit.json) records the exact scope of the refreshed checks. Historical reports remain useful for individual changes; their older source commits must not be mistaken for a full execution of today's implementation.

## Reproduced lifetime findings

The [state audit](validation/state-retention-audit.json) exercises an instrumented copy of the checked-in discovery module against an isolated mock bridge. Only import locations and read-only state exports differ. After 1,024, 2,048, 3,072 and 4,096 completed distinct agents, both selection maps retain exactly that many entries. Pending selections return to zero, and reusing an existing agent does not grow the maps. This demonstrates retention with changing identities; it is not a measured process-memory leak rate.

Clearing selections indiscriminately would change routing semantics. A returning agent whose previous project was forgotten must not silently inherit whichever editor is now available. A bounded lifecycle needs coordinated admission, active-request preservation and explicit reselection behavior, including discovery and automatic-context state.

The same audit calls the unmodified opt-in debug logger. Ninety-six messages of 65,536 characters produce a 6,295,296-byte `mcp-debug.log`, with no rotated file. The source only checks its advertised 5 MiB threshold once per process. Sustained appends therefore exceed the stated limit. Fixing this also requires deciding how oversized individual entries and multiple processes sharing the log are handled; logging remains disabled by default.

Reproduce the diagnostic without touching a real editor:

```bash
node tests/diagnostics/state-retention-audit.mjs /absolute/path/to/report.json
```

The script cleans its isolated temporary directory and reports observations. It is deliberately separate from the passing regression gate while these findings remain open. The next implementation review should address these lifetime issues, then extend the remaining transport and multiplayer coverage listed in the [work record](modernization.md#remaining-work-before-completion).
