# Editor discovery and identity

Discovery validates the response body of `/api/ping` before presenting a port as a Unity Editor. HTTP success alone is insufficient: an unrelated service can occupy an editor's former port or a port in the discovery range. [Server PR #39](https://github.com/AnkleBreaker-Studio/unity-mcp-server/pull/39) reported this problem; the [initial reproduction](validation/discovery-identity-before.json) confirmed command dispatch to isolated foreign-service stubs through both a port scan and an old registry entry.

## Recognized identities

A recognized ping is a JSON object with a nonempty string Unity version and a nonempty project name or project path. The existing `project` and `version` aliases remain accepted. If present, `status` must be `"ok"`; explicit failures are rejected. Arrays, strings, HTML success pages, malformed identity fields and generic version-only responses do not identify an editor.

Capability fields such as `protocolVersion` and `pluginVersion` remain optional. Source inspection confirms the original project/version fields in plugin [v1.0.0](https://github.com/AnkleBreaker-Studio/unity-mcp-plugin/blob/d8bf0bb/Editor/MCPBridgeServer.cs), [v2.14.5](https://github.com/AnkleBreaker-Studio/unity-mcp-plugin/blob/v2.14.5/Editor/MCPBridgeServer.cs), [v2.15.0](https://github.com/AnkleBreaker-Studio/unity-mcp-plugin/blob/v2.15.0/Editor/MCPBridgeServer.cs), [v2.21.1](https://github.com/AnkleBreaker-Studio/unity-mcp-plugin/blob/v2.21.1/Editor/MCPBridgeServer.cs) and [v2.39.7](https://github.com/AnkleBreaker-Studio/unity-mcp-plugin/blob/v2.39.7/Editor/MCPBridgeServer.cs). This source evidence does not certify every historical plugin at runtime.

When comparing an existing selection with a live identity, matching project paths take precedence. Pathless legacy responses can be compared by project name. That fallback cannot distinguish two projects with the same name. Discovery never fills a live response's missing project path from an older registry identity.

## Selection and recovery

| Observation | Result |
|---|---|
| Recognized identity | List the editor using its live identity; preserve supported clone/player metadata |
| Successful HTTP response with unrecognized identity | Exclude the port; registry metadata cannot make it a valid editor |
| Existing selection now answers with an unrecognized identity | Find the original project on another port, or require explicit reselection |
| Ping is temporarily unavailable or returns a non-success HTTP status | Retain existing fresh-registry recovery for a previously selected editor |
| Registry proposes a different recovery port | Check that port before using the registry fallback |
| Identity changes during explicit selection | Reject the selection and request fresh discovery |

Observations are reused within one discovery/validation attempt, including rejected ports, so registry validation and the fallback scan do not repeat the same probe. Later discovery calls probe again; this is not a long-lived identity cache. Cancellation still aborts an unused shared discovery without treating it as proof that a selected project disappeared.

The configured default port passes the same identity check even when it is outside the scan range. If no editor is verified, an implicit editor command fails before dispatch. A subsequent call can discover an editor that has just started. Explicit instance selection still rechecks its chosen port after discovery.

`unity_list_advanced_tools` can return cached schemas without a selected editor, without asking an unverified default service for dynamic routes or project context. `unity_editor_ping` reports unrecognized identities as disconnected. Failed tool results no longer trigger automatic context injection; the next successful call can receive the context.

## Limits

Explicit `port` routing retains its existing behavior and bypasses selection discovery for that call. Obtain the port through fresh discovery, verify the selected project path and rediscover after an editor restart. The ping diagnostic validates its response even with an explicit port.

This is identity-shape validation, not authentication. A service that deliberately copies a valid bridge response can still imitate one. Ports can also change owners after a probe. Fresh-registry recovery for unavailable endpoints preserves the existing compilation/reload behavior and is not independent proof of the endpoint's current owner.

## Evidence and reproduction

The [validation report](validation/discovery-identity.json) records **22 failing checks out of 26** against server `8b7c05982906354f7ae149d3bac132440c2ae720`. Four controls already pass. The corrected suite covers scans, default-port fallback, old/fresh registries, selected-port reuse, a changed recovery port, selection races, historical/alias formats, pathless metadata and offline diagnostics. The full ordinary suite has **163 passing tests** on Node 18.20.8 and 22.18.0.

Live read-only checks pass on Windows/Unity 6000.6.2f1 with the released plugin `0b8e76f` and current runtime `631b5d2`: both are discovered and selected, their pings are recognized, and two overlapping rounds of implicit reads keep each agent on its selected project. Both editors have clean scenes and zero project compilation errors. The temporary released-plugin editor is closed afterward. Unity 2021 runtime execution remains deferred.

Run ordinary regressions with `npm test`. To reproduce the live check, open two disposable projects with `.unity-mcp-validation` markers, one with each plugin, outside Play Mode and compilation:

```powershell
$env:UNITY_MCP_DISCOVERY_PROJECTS = '["C:/UnityMcpValidation/Queue66","C:/UnityMcpValidation/LegacyCompat66"]'
npm run test:discovery
```

The suite verifies canonical paths before selecting projects. It writes `Library/UnityMcpDiscoveryIdentity.json` in the first project. Without the variable, it skips without contacting Unity. Scene/assets/settings are unchanged; the suite itself does not open or close editors.
