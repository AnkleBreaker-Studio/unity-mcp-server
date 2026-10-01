# Editor workflows and data preservation

The live workflow suite exercises the server and plugin together in a disposable Unity 6000.6.2f1 editor. It covers scene creation and reopening, serialized component values, object references, material and prefab assets, result limits and Scene view captures. [Recorded results](validation/unity66-features.json).

## Enum properties

`unity_component_set_property` preserves the existing numeric contract: a plain number is a **zero-based index into the enum names**, not its stored integer. For `First = 0, Second = 4, Third = 9`, both `"Third"` and `2` select `Third`, whose stored value is `9`.

Use `{ "enumValue": 5 }` to write a stored integer explicitly, including combined flags. This additive form requires the updated companion plugin. It accepts signed 32-bit integers. Invalid names, indices and raw values return an error before applying the property; they no longer report success without changing the enum.

`unity_component_get_properties` adds `enumValue`, `enumIndex` and `enumNames` for enum properties. Named values retain their existing string representation in `value`. Combined flags and unknown serialized values return their stored integer instead of throwing on a negative `enumValueIndex`.

```json
{
  "gameObjectPath": "Player",
  "componentType": "PlayerSettings",
  "propertyName": "allowedActions",
  "value": { "enumValue": 5 }
}
```

## Asset result limits

`unity_asset_list` now applies its existing `maxResults` option. The default is 500; explicit values must be integers from 1 to 10,000. Existing `count` remains the number of returned assets. New `totalCount`, `maxResults` and `truncated` fields make omitted results visible.

The plugin avoids type lookups and result dictionaries for omitted assets. Unity's GUID search still enumerates matches, so this bounds returned metadata, not the entire search cost. Narrow `folder`, `type` or `search` when a result is truncated.

## Scene view captures

Inline `unity_graphics_scene_capture` and `unity_graphics_game_capture` have separate [camera/pixel validation](graphics-capture.md). The file-based Scene workflow below predates those checks.

For editor UI rather than camera images, see [editor-window capture](editor-capture.md). Its Windows fixture covers native pixels, resource cleanup, ambiguity and tab selection separately from this Scene-view workflow.

`unity_screenshot_scene`, available through `unity_advanced_tool`, accepts dimensions from 1 to 8,192 pixels per side, with at most 33,554,432 pixels in total. The existing Scene view must be available.

The plugin restores the camera target and active render target and destroys its capture textures in `finally`, including when rendering, encoding or file writing fails. The regression test forces an actual filesystem failure by targeting an existing directory, then verifies a successful capture. It warms Unity's temporary rendering cache before comparing live texture objects; that cache belongs to Unity and is not destroyed by the test. The check does not establish total editor GPU memory usage or cover Game view capture.

## Reproduce the live workflow

Use an open disposable project created by the companion plugin's `tools~/validate-unity.ps1`. It must contain the `.unity-mcp-validation` marker, have one saved clean scene, be out of Play Mode, and have an existing Scene view. The suite refuses an unmarked project, selects its discovered canonical project path and checks compilation before running.

```powershell
$env:UNITY_MCP_FEATURE_PROJECT = 'C:/UnityMcpValidation/Queue66'
npm run test:features
```

The suite creates a uniquely named fixture folder, imports a temporary component, verifies real serialized values, saves and reopens a scene, then restores the initial scene and deletes its fixtures. Its report is written to `Library/UnityMcpFeatures.json`. It is opt-in and separate from ordinary mock-based CI.

## Minimum-version API check

The package declares Unity **2021.3.18f1** as its minimum. Compiling all 66 editor source files against that editor's installed assemblies exposed a Dashboard `IntegerField` namespace mismatch. A conditional alias now selects `UnityEditor.UIElements.IntegerField` on older editors and leaves the newer API unchanged.

The [compiler report](validation/unity2021-api.json) records a passing C# check using the official editor's compiler, framework assemblies and bundled template uGUI/Test Framework assemblies. It excludes conditional UMA and ProBuilder integrations. This is **not an editor run or a package-resolution test**. The actual 2021 editor stopped at license initialization; additional old-editor execution is deferred, with follow-up driven by reported compatibility issues.

From the companion plugin repository:

```powershell
./tools~/check-unity2021-api.ps1 `
  -EditorPath 'C:/UnityEditors/2021.3.18f1/Editor/Unity.exe' `
  -PackageAssemblyPath 'C:/UnityEditors/2021.3.18f1/Editor/Data/Resources/PackageManager/ProjectTemplates/libcache/com.unity.template.universal-2d-1.1.4/ScriptAssemblies' `
  -OutputPath 'C:/UnityMcpValidation/Unity2021Api'
```

The script reports source/reference counts and package DLL hashes so its narrower validation can be reproduced without implying that a Unity project imported or executed successfully.
