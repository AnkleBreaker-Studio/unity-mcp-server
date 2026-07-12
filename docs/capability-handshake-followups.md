# Capability Handshake — Follow-up TODOs

Captured 2026-07-12 alongside the server↔plugin capability-negotiation work
(branch `feat/capability-handshake`). These are deliberately **not built now**.
Rationale + evidence: `knowledge/research/2026-07-12-vet-unity-ml-agents.md`
(in the DevCrow workspace) and the evidence-over-agreement gate that scoped the
handshake down to its right-sized form.

## 1. WIN K — derive routes from the switch (`[MCPCommand]` + assembly scan)
The durable fix for capability drift. Today `_meta/routes` (plugin
`MCPBridgeServer.GetRegisteredRoutes`) is a hand-maintained list already stale
versus the actual `RouteRequest` switch. Verified mismatches: it advertises
`script/execute-code` (real case `editor/execute-code`), `material/create`
(real `asset/create-material`), `build/build` (real `build/start`), `navmesh/*`
(real `navigation/*`), plus missing families (`prefab-asset/*`, `editorprefs/*`,
`scenario/*`, `uma/*`, …). A `[MCPCommand("cat/action")]` attribute + one
assembly scan that builds the route table from the switch deletes the drift
class entirely — and is the cleanest on-ramp to official Unity MCP's `[McpTool]`.
Do this before any official-MCP migration. (Already parked as "WIN K" in the
2026-06-29 AnkleBreaker transferable-wins plan.)

## 2. Statics-reset factory for the plugin's static bridge
Ref: ml-agents `CommunicatorFactory.cs` —
`[RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]`
resets static state on load. The plugin's `MCPBridgeServer` is a static
singleton; static state can survive enter-play-mode and leak stale server/socket
state (the footgun that bites any Unity tool with a static singleton bridge).
Add a statics-reset hook so entering play mode starts clean.

## 3. Pin publish-workflow GitHub Actions to commit SHAs + OIDC
Both repos (`AnkleBreaker-Studio/unity-mcp-server` +
`AnkleBreaker-Studio/unity-mcp-plugin`). The ml-agents vet flagged unpinned
actions (`@main` / `@master`) + token-based publish as the anti-pattern. Pin
every action to a commit SHA and move publish to OIDC trusted publishing (no
long-lived registry token).
