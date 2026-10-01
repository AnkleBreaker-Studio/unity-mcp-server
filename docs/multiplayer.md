# Multiplayer editors

MPPM gives each virtual player a separate Unity process. The MCP server discovers and routes commands to those processes independently, using the same per-agent selection and queue contract as ordinary projects. It does not establish a game's network connections.

## Identity and routing

`unity_list_instances` includes these additive fields when the plugin supplies them:

| Field | Meaning |
|---|---|
| `isVirtualPlayer` | Whether Unity identifies this editor as an MPPM virtual player. |
| `mainProjectPath` | Parent project for Unity's `Library/VP/<id>` layout or a verified ParrelSync source; the current project for a normal editor. Empty if the parent cannot be identified. |
| `virtualPlayerId` | Virtual project directory ID, matched to the player's ID from `unity_mppm_list_players`. Empty for the main editor. |
| `isClone`, `cloneIndex` | ParrelSync's `.clone` marker and numeric suffix; `-1` for an unknown/absent index. See [native clone identity and lifecycle](parrelsync.md). |

Older plugins may omit the new fields. Omission means unknown. MPPM children can share their parent's project name: match the project path and virtual ID, then select the freshly discovered port. Selection by an ambiguous name fails. Explicit command ports remain useful when multiple agents share one MCP connection; independent agent identities also retain separate selections.

Rediscover after starting or stopping a player and after a domain reload. Ports can change. A timeout or a lost ticket does not justify repeating a state-changing command: inspect the editor/player state first.

The registry reader accepts the UTF-8 BOM emitted by older Unity plugins. New plugins write UTF-8 without a BOM so older servers can read their registry. This matters for custom ports outside the fallback scan range.

## Scenario workflow

Discover advanced tool schemas with `unity_list_advanced_tools`. Use `unity_advanced_tool` to call:

1. `unity_mppm_info` to inspect package version, package installation, player workflow and main/virtual identity. `mppmAvailable` retains its existing API-availability meaning: native classes can exist while `packageInstalled` and `playerWorkflowInitialized` are false. On supported Unity versions, it also reports whether multiplayer roles are enabled and the active role.
2. `unity_mppm_create_scenario` with a unique asset path, a main role and zero to three virtual editors. Existing assets are preserved; invalid roles, counts and paths fail explicitly.
3. `unity_mppm_list_scenarios` to inspect the configured instances and roles.
4. `unity_mppm_activate_scenario`, then `unity_mppm_start`.
5. `unity_mppm_list_players` and fresh instance discovery to find the child editor.
6. `unity_mppm_stop` and state readback. Unity's Keep Active setting can leave a virtual editor open; `unity_mppm_deactivate_player` closes an owned player when needed.

Unity 6.6 uses native instance settings and the Play Mode scenario manager. Writing only its retained legacy instance fields does not configure the instances Unity runs; loading only the graph can leave the Default scenario selected. The plugin handles both native settings and native selection, while retaining its older reflection path for earlier MPPM layouts.

Multiplayer role assignment requires **Enable Multiplayer Roles** in the project. Scenario creation does not change this global project setting. A Host or Client role also does not start a Netcode host/client connection; game code is responsible for that.

Unity's [MPPM package reference](https://docs.unity.com/en-us/engine/6000.6/manual/packages-list/packages-all/pack-core/com-unity-multiplayer-playmode) and [scenario window reference](https://docs-multiplayer.unity3d.com/mppm/current/mppm-reference/play-mode-scenario-window-reference/) explain the editor workflow. Use the installed package's documentation for the exact Unity version.

## Reproduce live validation

Open a disposable project marked by the plugin's validation runner, install MPPM, save a clean scene, stop Play Mode and deactivate virtual players. Configure its Game view to Play Unfocused. Then run:

```powershell
$env:UNITY_MCP_MULTIPLAYER_PROJECT = 'C:/UnityMcpValidation/Unity66'
npm run test:multiplayer
```

The suite creates a unique owned scenario, verifies native instance settings, rejects overwrites and invalid inputs, launches Host/Client roles, and sends 12 overlapping commands through two agent selections without command ports. It then recompiles a shared script and repeats the routing check in Edit Mode. It restores the role setting and previous scenario, removes its assets and deactivates its virtual player. Evidence is written to `Library/UnityMcpMultiplayer.json`.

This opt-in suite operates actual editors and is separate from ordinary CI. It targets Unity 6.6 with MPPM 3.0. It does not certify older MPPM versions, remote players, or any game's networking implementation. ParrelSync has a [separate lifecycle suite and report](parrelsync.md). See the [MPPM validation report](validation/unity66-multiplayer.json) for the recorded run and the [remaining modernization work](modernization.md#remaining-work-before-completion).
