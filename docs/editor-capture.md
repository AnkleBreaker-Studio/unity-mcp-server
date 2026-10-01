# Editor-window capture

`unity_screenshot_editor_window` captures an existing Unity editor window to PNG on Windows. Use it when the user explicitly requests an editor-window capture. Game and Scene camera captures remain separate cross-platform tools.

Captures no longer call `EditorWindow.Focus()` or restore keyboard focus to a different window. A selected tab can be captured while another application has keyboard focus. An inactive tab returns `code: "window_not_visible"` by default. With `activateTab: true`, the plugin temporarily selects that existing tab using `ShowTab()`, then restores its previous host tab in `finally`, including after a native capture failure. This option does not create or show an absent window and does not request OS keyboard focus.

Unity's `hasFocus` property identifies the selected view within its host, independently of `EditorWindow.focusedWindow`. The [Unity 2021.3 reference implementation](https://github.com/Unity-Technologies/UnityCsReference/blob/2021.3/Editor/Mono/EditorWindow.cs) distinguishes that property, tab selection and keyboard focus; the current behavior was also checked in Unity 6000.6.2f1. Resolving a previous tab uses guarded internal reflection. If that lookup is unavailable, the plugin refuses to activate the tab.

## Choosing a window

The existing selector priority remains full type name, simple type name, exact title, then title substring. Every priority now checks ambiguity; a full type name no longer silently chooses the first of several Inspectors or custom windows.

An ambiguous result contains `code: "ambiguous_window"` and `candidates` with `window`, `type` and `title`. Pass a candidate's `window` value, such as `id:576460752303000123`, to select that exact loaded editor object. IDs remain strings throughout MCP transport. A missing or expired ID returns `window_not_found` without falling back to another window. IDs are not durable references across editor sessions/reloads. Native floating-window handle resolution can still refuse ambiguous OS titles even after the Unity object is identified.

Existing `window`, `path`, `maxDimension` and success-result fields remain supported. `activateTab` is optional and defaults to false. Released servers can carry the updated plugin's identity selectors and error details through the advanced-tool proxy; an old plugin does not gain these fixes merely by updating the server.

## Bounds and native limitations

Both the entire native backing bitmap and the final crop are limited to **33,554,432 pixels**, checked before GDI allocation. Previously only the crop was bounded, so a small requested panel could still allocate a large full-window bitmap. The final image also respects `maxDimension` and the GPU texture-side limit. These per-image bounds are not a limit on total process memory: several buffers/textures coexist while encoding.

The existing cleanup releases DCs, bitmaps and temporary textures on success and failure. Windows [PrintWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-printwindow) is synchronous and depends on the target renderer. Minimized, all-black, unsupported or unresolved native windows return errors. Occlusion support is not a guarantee for every GPU/window configuration. Mixed-DPI positioning, multiple monitors, attached floating/docked Unity rendering and all-black detection's false negatives remain separate validation areas.

## Evidence and reproduction

The [report](validation/unity66-editor-capture.json) records **17 passing controlled checks** on Windows/Unity 6000.6.2f1. Against the preceding plugin, the same fixture records six unmet selection/visibility/size requirements and eleven passing controls. The unconditional focus call was identified by source review; the baseline fixture does not activate real user windows to demonstrate that defect.

The fixture creates two unshown Unity windows and an unshown dock to verify default refusal, explicit tab selection and restoration after native-handle failure. It also creates a 64×48 native white window behind existing windows with activation disabled. After painting and synchronizing that fixture with the compositor, it checks full/cropped PNG pixels, twenty repeated captures, GDI counts with a positive allocation control, texture cleanup and filesystem-error cleanup. The initial offscreen fixture had no reliable rendered backing pixels; it was replaced with this deterministic painted target before the final before/after comparison. Native fixture pixels do not establish that every attached Unity editor window renders correctly.

Four live MCP runs—current/released server, Node 18.20.8/22.18.0—verify exact string identities, ambiguous errors and refusal to display unshown fixtures. Each removes its two temporary windows and leaves the scene clean. These live runs do not capture user-window pixels. All 74 package editor sources compile against the declared Unity 2021.3.18f1 API; actual older-editor execution remains deferred by maintainer direction.

Run the controlled suite from the plugin repository with a closed disposable project:

```powershell
./tools~/validate-unity.ps1 -EditorPath 'C:/Program Files/Unity/Hub/Editor/6000.6.2f1/Editor/Unity.exe' -ProjectPath 'C:/UnityMcpValidation/Capture66' -Suite EditorCapture
```

It writes `Library/UnityMcpEditorCaptureValidation.json` and fixture PNGs under `Library/UnityMcpEditorCapture/`. For the opt-in live suite, copy `tools~/EditorCaptureValidation.cs` into `Assets/Editor/` of a marked disposable project, open that editor and set `UNITY_MCP_CAPTURE_PROJECT` to its absolute path. Run `npm run test:editor-capture` in the server repository. `UNITY_MCP_CAPTURE_SERVER_ENTRY` optionally selects a historical server checkout. The suite writes `Library/UnityMcpEditorCapture.json` and does not run in ordinary CI. Remove the copied fixture after closing the disposable editor.
