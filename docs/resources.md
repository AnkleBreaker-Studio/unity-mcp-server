# Project-context resources and routing

The MCP server exposes the plugin's Markdown context files through `resources/list` and `resources/read`. Resource URIs keep the existing form, such as `unity-context://Architecture` or `unity-context://Custom%2FCombat`. The category is relative to the selected editor; the URI does not itself contain a project identity.

Resource requests now use the same request-local identity and port validation as tools. `_meta.agentId` and `_meta.agent_id` select an agent's editor selection. `_meta.port` overrides the target for that request without changing its saved selection. Clients that omit this metadata continue to use the server process's default agent and its selected editor. These fields provide routing, not authentication.

For example, after selecting a project through `unity_select_instance` with the same agent metadata:

```json
{
  "jsonrpc": "2.0",
  "id": 12,
  "method": "resources/read",
  "params": {
    "uri": "unity-context://Architecture",
    "_meta": { "agentId": "scene-worker" }
  }
}
```

When multiple editors are available and no editor has been selected, listing returns no resources and reading requests a selection. The server does not read the default port's documents as a substitute. A sole discovered editor can still be selected automatically. If a selected project disappears, later tool/resource calls keep requiring an explicit selection; they cannot gradually fall back to another open project. A responsive selection also survives loss of its registry entry, including custom ports outside the fallback scan range.

Because legacy URIs are relative, reading the same URI after deliberately changing the selection reads the newly selected project's category. Consumers that need to pin a particular read should pass the freshly discovered port in `_meta.port` and verify project identity during selection. The plugin still applies its existing context enablement, category validation and file-reading rules.

## Evidence

The [routing report](validation/resource-routing.json) preserves a reproduction against server commit `9461c66`: with successful selections for Alpha and Beta, both agents received Alpha's resource list and text. Resources could also read Alpha before any selection, and first discovery could replace an explicit Beta selection when its registry entry disappeared. The corrected server preserves the intended project.

The stdio regression suite covers concurrent lists/reads, encoded category names, both agent metadata spellings, explicit-port overrides, default-client selection and invalid identity/port inputs. It also verifies that three repeated tool/resource attempts after a selected editor disappears remain blocked until an explicit new selection. The ordinary server suite contains 87 passing tests on Node 18 and 22 at this checkpoint.

An opt-in live test uses two marked Unity 6.6 projects. It temporarily points each context configuration at its own uniquely named `Library` directory, verifies different Markdown contents through concurrent MCP resource requests, and restores both original context settings and removes the fixture directories. This verifies the actual plugin read path without changing scene assets. The [cross-version matrix](compatibility.md) is separate evidence for routine tool workflows.

## Reproduce

From the server repository, with two open, marked disposable projects outside Play Mode:

```powershell
$env:UNITY_MCP_EDITOR_PROJECTS = '["C:/UnityMcpValidation/Queue66","C:/UnityMcpValidation/Unity66"]'
npm run test:resources
```

The report is `Library/UnityMcpResourceRouting.json` in the first project. Without the environment variable the suite skips without contacting Unity. Regular routing regressions run with `npm test`. This does not change the resource URI contract, add per-agent permissions, or make a port permanently identify a project.
