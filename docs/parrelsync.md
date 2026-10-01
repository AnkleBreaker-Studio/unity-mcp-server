# ParrelSync editors

The bridge identifies a ParrelSync clone by its native `.clone` file. A project whose name ends in `_clone_7` without that marker remains an ordinary project. This requires no ParrelSync assembly reference in the plugin, so projects without the optional package still compile.

`isClone` reports the marker; `cloneIndex` reports a numeric `_clone_<index>` suffix or `-1` when unknown. Unknown indices display as “ParrelSync clone” without an invented number. `mainProjectPath` resolves the source using ParrelSync's final `_clone` suffix convention, provided the sibling contains `Assets` and `ProjectSettings/ProjectVersion.txt`. Renamed or orphaned clones can therefore have an empty parent path. These fields describe editor identity, not authentication or a game's network role.

Parent and clone can have the same project name. Use `unity_list_instances`, match the full project path, and select its freshly discovered port. An ambiguous name is rejected. Rediscover after reloads and restarts; do not assume the port remains constant. Separate `_meta.agentId` values retain separate selections, and explicit `port` arguments also work.

## Files and settings

In the tested ParrelSync 1.5.2 implementation, native clone creation copies `Packages` and `Library`, and links `Assets` and `ProjectSettings`. On Windows those links are junctions. Editing a shared script affects both editors; a package-manifest edit does not automatically update the clone's copied manifest. The pinned [native clone implementation](https://github.com/VeriorPies/ParrelSync/blob/a122dc90cbe2d4cc2669ddad00b12b3917ef934b/ParrelSync/Editor/ClonesManager.cs) defines that behavior.

Bridge port preferences use each instance's project path. Project policies use the shared `PlayerSettings.productGUID`. Shared persistence does **not** guarantee immediate propagation to another running editor: in the recorded Windows run, changing `ContextEnabled` in the parent left the clone's in-memory preference unchanged. Closing the clone, changing the policy in the parent and reopening the clone loads the saved value. Configure policies before launching clones, or apply the intended value in each running editor. No private Unity synchronization API is used.

## Validation and reproduction

The [recorded evidence](validation/unity66-parrelsync.json) covers Unity 6000.6.2f1 on Windows/Mono with ParrelSync 1.5.2. The original plugin misclassified a normal project named `Parrel66_clone_7` and reported its native clone as its own main project. Twelve controlled identity checks now pass, including missing markers, renamed/orphaned clones, oversized indices, trailing separators and a parent whose own name contains `_clone`.

Current-server live runs on Node 18 and 22 each verify 48 overlapping calls: twelve in Edit Mode, twelve in Play Mode, twelve after shared script compilation, and twelve after restarting the clone. Each pair of agent selections routes exactly six calls to each editor without explicit command ports. Both queue sessions change after recompilation, the recompiled marker is visible in both processes, settings persist, and clean scenes/settings are restored. Separate released-server read checks pass against the same current plugin on both Node versions.

Run the plugin's optional-dependency-free identity suite in a closed disposable project:

```powershell
./tools~/validate-unity.ps1 -EditorPath 'C:/Program Files/Unity/Hub/Editor/6000.6.2f1/Editor/Unity.exe' -ProjectPath 'C:/UnityMcpValidation/Identity66' -Suite ParrelSync
```

For the live suite, prepare a separate disposable Unity 6.6 project, install this plugin and ParrelSync, and create a clone with ParrelSync's native command. The fixture expects the first clone at `<main>_clone_0`. Put `.unity-mcp-validation` markers in both project roots, save a clean `Assets/ParrelValidation.unity` scene, open both editors outside Play Mode, and select Play Unfocused for their Game views. Then run from the server repository:

```powershell
$env:UNITY_MCP_PARRELSYNC_PROJECT = 'C:/UnityMcpValidation/Main'
$env:UNITY_MCP_EDITOR_PATH = 'C:/Program Files/Unity/Hub/Editor/6000.6.2f1/Editor/Unity.exe'
npm run test:parrelsync
```

The suite changes and restores bridge preferences, enters/exits Play Mode, creates/removes one shared script, closes and reopens the marked clone, and leaves both editors running. Reports are `Library/UnityMcpParrelSyncLive.json` in the main project. Set `UNITY_MCP_PARRELSYNC_BASELINE_SERVER` to an existing released server's absolute `src/index.js` path to include the separate read-only compatibility check; its report is `Library/UnityMcpParrelSyncReleased.json`.

These checks validate editor orchestration. They do not establish gameplay connections, certify older ParrelSync versions or other platforms, or test native clone deletion. MPPM has [separate scenario/player evidence](multiplayer.md).
