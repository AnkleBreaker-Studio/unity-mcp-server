# Undo, agents and the native editor stack

Unity has one global, linear Undo stack per editor. Agents share it with Inspector edits, editor scripts and other plugins. Selecting an agent identifies an MCP action; it does not create an independent Undo stack.

## Choose the operation

| Tool | Behavior |
|---|---|
| `unity_undo` | Perform the newest native Undo step, including non-MCP work |
| `unity_redo` | Redo a native step when Unity still retains it |
| `unity_undo_last` | Revert the newest verified MCP group, optionally filtered by `agentId`; refuse newer groups unless `force: true` |
| `unity_undo_history` | List recorded MCP actions with current native eligibility and agent/target information |
| `unity_undo_clear` | Clear native Undo records for the named GameObject, or the whole stack; discover/run this advanced tool through `unity_advanced_tool` |

**A targeted group revert does not create a Redo step.** This retains the existing `Undo.RevertAllDownToGroup` behavior. Use ordinary Undo/Redo when you need that navigation. [Unity's API contract](https://docs.unity3d.com/ScriptReference/Undo.RevertAllDownToGroup.html).

Only changes actually recorded in Unity Undo can be restored. File writes, package operations, builds and arbitrary code can have effects outside that stack. Reads and `editor/execute-code` are not targeted MCP Undo actions; code can still register native groups that a later revert must account for. A write or code execution between native Undo and Redo can discard the redo branch; use read tools to inspect it.

## Group ownership and cascade protection

Synchronous writes receive an isolated named group. Pending object diffs are flushed and the group is collapsed and closed before later editor work can join it. Empty groups do not hide the previous real edit. Deferred operations retain their existing separate lifecycle and do not collapse interleaved groups.

Before a targeted revert, the plugin inspects the native stack, verifies that the recorded group still exists and checks its editor-session identity and native entry signature. Native Undo, Redo, clearing, scene replacement and changes to a group's entries are reflected in eligibility. The signature covers native entry names/counts; it is not a snapshot of every object or a guarantee against arbitrary third-party manipulation.

If newer groups exist, `force: false` leaves the scene unchanged and returns:

- `target`: the requested MCP action;
- `wouldAlsoRevert`: newer verified MCP actions;
- `wouldAlsoRevertUnity`: other native groups, with group ID, name and native operation count.

Review both lists before explicitly requesting `force: true`. Groups from native edits, excluded code execution, failed commands, or MCP records no longer retained in history can appear in the second list. Unity cannot remove a group from the middle while retaining every newer change.

Successful responses retain `revertedCount` and `reverted` for MCP records. Additive `revertedGroupCount` counts all affected native groups; `revertedUnityGroups` identifies the additional groups. The plugin verifies the resulting stack before reporting success. If that inspection fails after invoking Unity Undo, it returns `outcomeUnknown: true`; inspect the editor before retrying.

The Action History window uses the same validation. Its confirmation describes the full cascade and the lack of Redo. If the stack changes after the preview, the confirmation is rejected and the user must review again. These changes do not open or focus that window during background calls.

## History and compatibility

Existing tool names, arguments and ordinary result fields remain. `undo/history` adds `undoStateAvailable`, and each action adds `undoState`:

| State | Meaning |
|---|---|
| `available` | The current native group matches the recorded session and signature; `undoable: true` |
| `not_on_stack` | The group is absent from the current Undo side, for example after native Undo or clearing |
| `changed` | The group's native entries differ from the recorded action, for example after an external collapse or partial clear |
| `unverified` | Session/signature information is missing, belongs to another editor session, or native inspection is unavailable |
| `unavailable` | The record has no supported group, or has already been explicitly reverted |

`undoableCount` remains a count across the full retained history; the `agentId` filter selects returned actions. Native Redo can make a previously undone record available again. Historical group numbers remain diagnostic metadata and are not sufficient authorization to revert.

When action-history persistence is enabled, the new identity/signature fields survive script reload. The session identity uses `SessionState`, which survives assembly reload and is cleared when Unity exits. Old history files remain readable, but records without the new identity are not trusted for a targeted revert. Native Undo/Redo remains available. [SessionState lifetime](https://docs.unity3d.com/2021.3/Documentation/ScriptReference/SessionState.html).

Stack inspection uses cached delegates for Unity's internal `GetRecords` and `GetGroupFromStack` APIs, isolated in `MCPUndoState`. Their declarations exist in the [Unity 2021.3 reference](https://github.com/Unity-Technologies/UnityCsReference/blob/2021.3/Editor/Mono/Undo/Undo.bindings.cs); the current checks execute them in Unity 6.6. If inspection fails, targeted rollback is refused instead of assuming that a historical group is still valid. This does not certify every historical/future Unity implementation.

## Validation

The [validation report](validation/unity66-undo.json) separates controlled reproductions, native regressions, minimum-version compilation and actual MCP runs. The controlled suite owns and clears its disposable project's Undo/history state. It exercises native group IDs, multiple agents, partial/group clearing, group merges, session persistence, unavailable inspection and stale window confirmations. Window behavior is tested through its shared preview/revert path; this is not a pixel review.

Run the plugin's controlled suite in a marked disposable project:

```powershell
./tools~/validate-unity.ps1 -EditorPath 'C:/Program Files/Unity/Hub/Editor/6000.6.2f1/Editor/Unity.exe' -ProjectPath 'C:/UnityMcpValidation/Undo' -Suite Undo
```

For the server's opt-in live suite, use an open marked project with an empty unsaved scene and no existing Undo/Redo entries:

```powershell
$env:UNITY_MCP_UNDO_PROJECT = 'C:/UnityMcpValidation/Undo'
npm run test:undo
```

The suite discovers and verifies the canonical project, selects it for two agents, and passes its port explicitly. It creates temporary GameObjects, verifies native Undo/Redo and cascade refusal, enables history persistence for a real script reload, then removes fixtures, clears its temporary stack/history and restores the setting and empty scene. It writes `Library/UnityMcpUndo.json`. `UNITY_MCP_UNDO_SERVER_ENTRY` can point to another server checkout for compatibility checks. It skips without contacting Unity when the project variable is absent.
