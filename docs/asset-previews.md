# Asset previews without blocking editor updates

The four preview routes now wait for Unity across editor updates: `unity_graphics_asset_preview`, `unity_graphics_prefab_render`, `unity_graphics_material_info` and `unity_graphics_texture_info`. Queue clients retain their ticket and polling contract; legacy requests use the existing deferred dispatcher, whose HTTP worker waits while the editor remains available.

Unity generates large previews asynchronously and may return null until rendering finishes. The plugin polls at intervals of at least 50 ms, then uses Unity's mini thumbnail when loading stops or the wait expires: three seconds for asset/prefab previews, two for optional metadata previews. The native preview cache remains owned by Unity. [Unity GetAssetPreview](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/AssetPreview.GetAssetPreview.html), [GetMiniThumbnail](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/AssetPreview.GetMiniThumbnail.html).

The scheduler retains at most 64 pending operations, polls at most four per update and stops starting additional work after a soft 5 ms allowance. Native rendering/readback calls cannot be interrupted. Deadlines are observed at the next eligible poll. Inactive tickets stop producing results; reload/quit clears callbacks and detaches the update handler. A full scheduler returns an error for required previews; optional metadata can still return without an image. Existing queue monitoring continues to report the pending execution and its duration.

## Options and compatibility

| Tool or option | Behavior |
|---|---|
| Asset/prefab `width`, `height` | Explicit sizes are honored; each omitted side retains the native preview size. Whole pixels, 1-8192 within the graphics-device limit, at most 33,554,432 total. |
| Material `includePreview: false` | Return metadata without requesting or encoding a preview. |
| Material `objectPath` | Resolve the documented renderer path; the older `gameObjectPath` alias remains accepted and takes precedence if both are supplied. |
| Material `materialIndex` | A nonnegative integer; invalid indices return an error. Shared materials are read without creating renderer material instances. |
| Texture `previewSize` | `0` omits the preview. A positive whole number up to 8192 bounds its longest edge, preserves aspect ratio and avoids upscaling. Omission retains native size. |
| Prefab rotation and padding | Existing parameters remain accepted; Unity's native preview still controls framing. The descriptions now reflect that existing limitation. |

The old schema descriptions advertised fixed default sizes that the plugin never applied. Omitted sizes retain the actual native-size behavior. Supplied options that were previously ignored now take effect. Tool names, routes and existing successful metadata/image fields are preserved.

All preview copies share one encoder, which restores the active render target and releases its own textures in `finally`. PNG encoding uses CPU pixels without uploading the temporary copy to the GPU. Optional preview failures preserve material/texture metadata. Metadata is read at dispatch; a later cached preview is not an atomic snapshot of a concurrently edited asset.

The synchronous C# helper signatures remain available, but now perform one cached-preview/thumbnail lookup instead of sleeping. Their first result can therefore be a smaller icon. MCP routes use the callback overloads and retain the bounded wait for the full preview. Callers requiring that wait should use those overloads.

## Evidence

The [report](validation/unity66-asset-previews.json) records eleven failed baseline checks, followed by 26 passing functional/scheduler checks and all 17 camera-capture regressions. It covers resizing and decoded colors, preview suppression, both material path names, invalid input, render-state restoration, expiry, fallback, failure cleanup, admission limits and polling cadence. All 75 included editor sources compile against the installed Unity 2021.3.18f1 APIs; actual old-editor execution remains deferred.

Three live baseline requests occupied the main-thread dispatch for 114-125 ms, with no intervening editor-update callbacks or independent queued read. The corrected current-server run returned from dispatch in 0.04-1.44 ms; the final image arrived after 87-156 ms, with another agent's read completing first. All decoded pixels of the 128-square cyan-material preview match the baseline SHA-256. These measurements concern editor responsiveness, not total rendering speed or gameplay FPS. Update callback counts are not rendered-frame counts.

Four live runs pass on Node 18/22 with current and released servers. The batch-only synchronous helper additionally showed 2.8 s of baseline waiting, but its corrected immediate thumbnail differs in resolution; those two timings are deliberately not treated as equivalent-output performance measurements. Evidence uses Unity 6000.6.2f1 on Windows, Built-in rendering and Direct3D12. Other pipelines, graphics APIs, unusual asset types and actual in-flight script reload remain separate validation work.

## Reproduce

From the plugin repository:

```powershell
./tools~/validate-unity.ps1 -EditorPath 'C:/Unity/6000.6.2f1/Editor/Unity.exe' `
  -ProjectPath 'C:/UnityMcpValidation/Previews66' -Suite AssetPreview
```

This suite requires a graphics device. For live tests, copy `tools~/AssetPreviewLiveValidation.cs` into the marked project's `Assets/Editor`, open it and save a clean initial scene. From the server repository:

```powershell
$env:UNITY_MCP_PREVIEW_PROJECT = 'C:/UnityMcpValidation/Previews66'
npm run test:previews
```

`UNITY_MCP_PREVIEW_SERVER_ENTRY` selects another server checkout. `UNITY_MCP_PREVIEW_BASELINE=1` runs only the native timing/PNG probes against the preceding plugin. Reports are written under `Library`; the live fixture removes its assets and additive scene and restores the original scene.
