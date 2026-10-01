# Mesh and renderer metadata

`unity_graphics_mesh_info` and `unity_graphics_renderer_info` now accept the documented `objectPath`. The older `gameObjectPath` remains accepted and takes precedence when nonempty. Mesh asset lookup still takes priority over scene lookup; existing source labels, material slots, bounds, skinning and blend-shape fields are preserved.

Mesh inspection reads vertex attributes and submesh index counts without copying UV, normal, tangent, color or triangle buffers into managed arrays. UV channels 0 through 7 are counted, including sparse channels. Empty meshes report no populated attributes even when their vertex layout is retained. [Unity vertex attributes](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/Mesh.HasVertexAttribute.html), [index counts](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/Mesh.GetIndexCount.html).

Triangle counts preserve the previous native result: three indices per triangle, two triangles per quad, and no triangles for lines, line strips or points. Counts accumulate in a 64-bit integer; ordinary results retain their boxed C# `int` type. The JSON field remains numeric. Shared meshes and materials are inspected without creating renderer resource instances; bone arrays are read once per inspection.

## Verified behavior

The [validation report](validation/unity66-mesh-metadata.json) records four failed checks out of fourteen against plugin `cb591aa`: both documented object paths were ignored, and upper UV channels were omitted on readable and non-readable meshes. Ten baseline controls passed. All twenty expanded checks now pass on Unity 6000.6.2f1, covering aliases, source precedence, all eight UV channels, each supported topology, cleared layouts, blend shapes, mesh/prefab assets, skinning, null materials and missing-object errors.

Non-readable meshes already allowed buffer reads in this editor test context. This is not presented as a newly fixed runtime-readability failure. Unity allows mesh data access outside the game/rendering loop in the Editor; `UploadMeshData(true)` and `isReadable: false` are verified both in batch execution and through the actual MCP queue. Player builds, game-loop callbacks and every imported model format are outside this evidence. [Unity readability rules](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/Mesh-isReadable.html).

Four live runs pass with the current and released servers on Node 18 and 22. Each checks both aliases for both tools, missing-object MCP errors and non-readable metadata. Fixtures remove their objects and additive scene and preserve the clean original scene. All 75 included editor sources compile against the installed Unity 2021.3.18f1 APIs; old-editor execution remains deferred. Server runtime routing is unchanged.

## Local measurements

The disposable batch fixture creates a 120,000-vertex mesh with normals, tangents, packed colors and four sparse UV channels. After five warmups, it records five samples of twenty calls each, excluding JSON serialization and HTTP/MCP transport.

| Twenty calls | Baseline median | Corrected medians across three runs | Allocation events, before → after |
|---|---:|---:|---:|
| Mesh metadata | 223.094 ms | 0.252–0.294 ms | 1,400 → 1,180 |
| Renderer metadata | 6.034 ms | 0.289–0.298 ms | 1,500 → 1,480 |

These are local Windows editor-command measurements, not end-to-end latency or gameplay FPS claims. The corrected UV count is four; the old result incorrectly returned two. Output dictionaries still allocate. The allocation-event recorder passes a positive control, but its raw value does not measure allocated bytes on this setup; no byte reduction is inferred from it. Very high submesh counts remain linear work.

## Reproduce

From the plugin repository:

```powershell
./tools~/validate-unity.ps1 -EditorPath 'C:/Unity/6000.6.2f1/Editor/Unity.exe' `
  -ProjectPath 'C:/UnityMcpValidation/Mesh66' -Suite MeshMetadata
```

For live checks, copy `tools~/MeshMetadataValidation.cs` into the marked project's `Assets/Editor`, open the project and save a clean initial scene. From the server repository:

```powershell
$env:UNITY_MCP_MESH_PROJECT = 'C:/UnityMcpValidation/Mesh66'
npm run test:meshes
```

`UNITY_MCP_MESH_SERVER_ENTRY` selects another server checkout. Results are written to `Library/UnityMcpMeshMetadataLive.json`. The fixture only runs in explicitly marked validation projects.
