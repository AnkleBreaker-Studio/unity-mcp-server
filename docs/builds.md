# Builds and Unity 6.6 diagnostics

`unity_build` retains its existing target, output path, scenes and `developmentBuild` arguments. The modernization branch adds optional `managedCodeVariant` for Unity 6.6 or newer with a protocol-3 plugin. It applies to one build; the plugin restores the project's previous setting in `finally`, including when the build fails.

Unity 6.6 separates managed diagnostics from the Development Build flag. With Unity's default Release variant, a Development build no longer enables the new checks and instrumentation defines. The plugin selects Checked for Development builds and Release for other builds unless an explicit variant is supplied. This follows the compatibility guidance in the [Unity 6.6 upgrade guide](https://docs.unity.com/en-us/engine/6000.6/manual/upgrade-guides/upgrade-guide-unity66).

| `managedCodeVariant` | `UNITY_ENABLE_CHECKS` | `UNITY_INCLUDE_INSTRUMENTATION` |
|---|---|---|
| Release | No | No |
| Instrumented | No | Yes |
| Checked | Yes | Yes |
| Debug | Yes | Yes |

These combinations were also checked in the compiled player assembly on Unity 6000.6.2f1, Windows x64, Mono. Debug additionally produced `DEBUG`; the native Development flag can also affect that symbol. The test records the actual values rather than inferring the variant from `DEBUG` alone.

```json
{
  "target": "StandaloneWindows64",
  "outputPath": "Builds/Current/Game.exe",
  "scenes": ["Assets/Scenes/Main.unity"],
  "developmentBuild": false,
  "managedCodeVariant": "Instrumented"
}
```

Use the port returned by instance selection when several editors are open. The variant is independent of the native Development flag. Existing calls without the new argument remain accepted on older plugins. An explicit variant requires protocol 3; the server refuses it before building on older plugins, which would otherwise ignore the unknown parameter. A protocol-3 plugin running an older Unity version explicitly rejects the new option and keeps the original build path for existing arguments.

## Reproduce the live validation

First create a disposable project with the plugin's `tools~/validate-unity.ps1`, then open it in Unity 6.6 with the bridge running. Save its scene, exit Play Mode, and use the Mono Windows x64 target. The test requires the project's `.unity-mcp-validation` marker and verifies the discovered project path before writing fixtures or building.

```powershell
$env:UNITY_MCP_BUILD_PROJECT = 'C:/UnityMcpValidation/Queue66'
npm run test:builds
```

The test creates its fixtures under `Assets/__McpValidation`, writes players to fixed `Builds/Dev` and `Builds/Dist` folders, and inspects the assemblies without launching the players. It checks five builds covering all four variants, then deliberately fails a build to check restoration. Its report is `Library/UnityMcpBuildVariants.json`. The [before/after report](validation/unity66-builds.json) records the reproduced missing diagnostics and the corrected builds. Other platforms and IL2CPP remain outside this test's coverage.
