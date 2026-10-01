# Inline camera and asset captures

`unity_graphics_game_capture` renders one camera to a PNG image block. It uses `Camera.main` when `cameraName` is omitted or empty. A nonempty name identifies an active GameObject by name or hierarchy path; a missing object or missing Camera now returns `camera_not_found` instead of silently capturing a different camera. Duplicate names still follow Unity's `GameObject.Find` behavior: use a hierarchy path to disambiguate.

`unity_graphics_scene_capture` renders the last active Scene View camera. The existing view must be available. Both tools default to 512 × 512 and accept whole-pixel sizes from 1 to 8,192 per side, within `SystemInfo.maxTextureSize`, with at most 33,554,432 pixels total. Invalid dimensions return `invalid_capture_dimensions` before camera lookup or texture allocation. Whole-number numeric strings remain accepted by the plugin. Existing successful result fields and direct MCP image blocks are preserved.

These tools render camera output. They do not reproduce composed Game View output, screen-space overlay UI or editor-window chrome. The file-based `unity_screenshot_game` path remains separate; see [editor-window capture](editor-capture.md) for window pixels and [editor workflows](editor-workflows.md#scene-view-captures) for file-based Scene captures. The pixel limit is an allocation guard, not a promise that the resulting image fits the separate [HTTP/MCP response budgets](response-limits.md).

## Render state and CPU work

Game and Scene captures restore the borrowed camera target and active render target in `finally`. Asset previews restore the previous active render target as well. Owned temporary textures are released or destroyed; Unity's preview cache is retained.

PNG encoding uses the CPU pixel copy. These paths now omit `Texture2D.Apply()` and disable mipmap recalculation during `ReadPixels`, avoiding an unnecessary GPU upload. `ReadPixels` itself still synchronizes with the GPU. Unity documents the CPU readback and upload behavior in [ReadPixels](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/Texture2D.ReadPixels.html) and [Apply](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/Texture2D.Apply.html).

## Validation and limits

The [recorded report](validation/unity66-graphics-capture.json) contains nine failed baseline checks and four passing controls, followed by seventeen passing expanded checks on Unity 6000.6.2f1, Windows, Built-in rendering and Direct3D12. It verifies decoded PNG dimensions and controlled camera colors, dimension refusals, render-target restoration, asset pixels and stable live texture counts across twenty warmed captures. The maximum pixel boundary is checked before a missing-camera refusal; the test does not allocate a maximum-size image.

Five samples of ten 1024-square captures had a baseline median of 192.25 ms and corrected medians of 178.39 ms, 181.84 ms and 209.62 ms in separate runs. Samples include PNG encoding and fixture JSON validation. The variability does not establish a latency improvement; removing the redundant upload is the verified optimization. These samples do not establish whole-editor CPU/GPU gains or rendering performance in other projects.

Four live MCP runs pass with the current and released servers on Node 18/22. They use the direct core capture tools, validate returned PNGs and errors, and restore the original clean scene with no surviving fixture objects. The released server's advanced proxy returns these core captures as JSON; its direct tools preserve image blocks. This pre-existing proxy difference is not changed by the plugin update.

All 74 included editor sources compile against installed Unity 2021.3.18f1 assemblies; actual old-editor execution remains deferred. URP/HDRP, other graphics APIs, composed Game View capture, and duplicate/inactive camera selection need separate validation. Asset-preview loading still uses its existing synchronous retry path and native preview dimensions; this change does not implement requested thumbnail resizing.

## Reproduce

From the plugin repository, run the controlled suite in a disposable marked project. This suite requires a graphics device and omits `-nographics`:

```powershell
./tools~/validate-unity.ps1 `
  -EditorPath 'C:/Program Files/Unity/Hub/Editor/6000.6.2f1/Editor/Unity.exe' `
  -ProjectPath 'C:/UnityMcpValidation/Graphics66' -Suite GraphicsCapture
```

For live validation, open that project with `GraphicsCaptureValidation.cs` in `Assets/Editor`, save a clean initial scene and retain an existing Scene View. From the server repository:

```powershell
$env:UNITY_MCP_GRAPHICS_PROJECT = 'C:/UnityMcpValidation/Graphics66'
npm run test:graphics
```

`UNITY_MCP_GRAPHICS_SERVER_ENTRY` optionally selects a released server's `src/index.js`. Reports go to `Library/UnityMcpGraphicsCaptureValidation.json` and `Library/UnityMcpGraphicsLive.json`. The live fixture owns an additive scene and explicitly destroys its hidden objects on completion or assembly reload.
