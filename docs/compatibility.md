# Server and plugin compatibility

The server and Unity plugin can be updated separately for the workflows verified below. Both updated components are needed for protected submission retries and other negotiated features. An older server retains its original retry behavior even when connected to the new plugin; see the [queue protocol](queue-protocol.md).

Release numbers are still unchanged on the modernization branch, so this validation identifies source commits as well as versions:

| Component | Released baseline | Modernization implementation tested |
|---|---|---|
| Node server | `826af5c`, version 2.35.6 | Runtime through `279990d`, version 2.35.6 |
| Unity plugin | `0b8e76f`, version 2.39.7 | `631b5d2`, version 2.39.7 |

The baseline repositories were checked out separately and remained unmodified. Both server installations used their own lockfiles, resolving MCP SDK 1.27.1. The old plugin was imported into a separate Unity 6000.6.2f1 project with uGUI 2.6.0 and Test Framework 1.8.0 supplied by the project; it predates the plugin's explicit dependency declarations.

## Verified matrix

The [raw report](validation/unity66-version-compatibility.json) records all four combinations on Windows, using Node 18.20.8 and 22.18.0:

| Server | Plugin | Result |
|---|---|---|
| Released baseline | Released baseline | Pass |
| Released baseline | Modernization | Pass |
| Modernization | Released baseline | Pass |
| Modernization | Modernization | Pass |

Each combination uses the real MCP stdio process and an open editor. It checks project discovery/selection, clean compilation, queue information, object creation, string-ID lookup, transform changes, MCP undo, C# result serialization, deletion, missing-object errors, agent attribution, history and restoration of the original saved scene. The current plugin reports a command error through either server; the old plugin retains its original session fields. Its queue information has no protocol version field, while the current plugin advertises protocol 3.

Registry comparison checks **384 tool names**, including 80 directly exposed tools and the advanced catalog. Existing names remain available, and published schemas add no mandatory arguments. Dynamically discovered entries without schemas contribute name coverage only. This is not execution coverage for all 384 tools.

A separate mixed-plugin run uses one current server with four agents targeting two actual editors. Twelve overlapping C# calls, with no explicit command ports, return six distinct counter values per project. Each agent receives exactly three completed requests in its own project's session list. The fixture removes its temporary counters afterwards.

## Limits

The matrix covers routine successful commands and a missing-object error, not every command family or failure path. It does not establish safety for an old server's ambiguous write retries. Fault-injection tests and [actual reload tests](modernization.md) provide separate evidence for the new transport.

Both plugins ran on Unity 6000.6.2f1. This validates server/plugin version mixing, not runtime behavior on older Unity versions. Actual Unity 2021 execution remains deferred by maintainer direction; the [compiler-only API check](editor-workflows.md#minimum-version-api-check) remains separate. Pre-queue plugins, macOS/Linux editors and arbitrary third-party integrations are not covered by this live matrix.

## Reproduce

Prepare a checkout of the baseline server at `826af5c` and run `npm ci` there. Use two open, marked disposable projects on Unity 6.6: one with the unmodified baseline plugin at `0b8e76f`, the other with the current plugin. Save their scenes, load only one scene in each, and leave Play Mode. The suite requires `.unity-mcp-validation` in both project roots and refuses dirty scenes.

From the current server repository:

```powershell
$env:UNITY_MCP_COMPATIBILITY = '{"baselineProject":"C:/UnityMcpValidation/LegacyCompat66","currentProject":"C:/UnityMcpValidation/Queue66","baselineServerEntry":"C:/UnityMcpValidation/server-baseline/src/index.js"}'
npm run test:compatibility
```

The suite discovers current ports and validates canonical project paths before editing. It writes `Library/UnityMcpVersionCompatibility.json` in the current-plugin project, restores saved scenes, and closes the child MCP processes it starts. Editors remain open. Run with the desired Node executable; each child server inherits that executable. Without the environment variable, the suite skips and does not contact Unity. It remains separate from ordinary CI.
