// AnkleBreaker Unity MCP â€” Tool definitions for Unity Editor operations (via HTTP bridge)
import * as bridge from "../unity-editor-bridge.js";
import { formatResult, looksLikeErrorObject } from "../response-format.js";
import { isUnknownRouteResult } from "../capabilities.js";

// Shared shaping for image-returning graphics tools.
// The bridge wraps plugin payloads as { success, data: { ..., base64 } } (queue mode)
// but legacy mode and some code paths surface { ..., base64 } at the top level, so the
// image is looked up at both depths. The base64 payload must NEVER remain inside the
// metadata text block: a single leaked PNG is a multi-hundred-KB token bomb.
function imageResultBlocks(result, noImageError) {
  if (result.error) return formatResult(result);
  const imageData = result.data?.base64 || result.base64;
  if (!imageData || typeof imageData !== "string") {
    // noImageError last so an empty-string result.error can't clobber the message.
    return formatResult({ ...result, error: noImageError });
  }
  const metadata = { ...result };
  delete metadata.base64;
  if (metadata.data && typeof metadata.data === "object") {
    metadata.data = { ...metadata.data };
    delete metadata.data.base64;
  }
  const b64 = imageData.replace(/^data:image\/\w+;base64,/, "");
  return [
    { type: "image", data: b64, mimeType: "image/png" },
    { type: "text", text: formatResult(metadata) },
  ];
}

// Console entries ship a full multi-frame stack trace on EVERY entry — measured at
// ~80% of a typical console payload, almost all of it noise for plain info logs.
// Server-side stripping works against every plugin version. Policy: "errors" (default)
// keeps a trimmed trace on error-like entries only; "all"/"none" override; frame cap
// applies wherever a trace is kept. The plugin data is untouched — full traces remain
// one explicit parameter away, so no capability is lost.
const ERROR_LIKE_LOG_TYPES = new Set(["error", "exception", "assert"]);

function shapeConsoleLogResult(result, includeStackTrace, maxStackFrames) {
  const mode = includeStackTrace === "all" || includeStackTrace === "none" ? includeStackTrace : "errors";
  const frameCap = Number.isInteger(maxStackFrames) && maxStackFrames > 0 ? maxStackFrames : 6;
  const entries = result?.data?.entries;
  if (!Array.isArray(entries)) return result;

  const shaped = entries.map((entry) => {
    if (!entry || typeof entry.stackTrace !== "string" || entry.stackTrace.length === 0) return entry;
    const keep = mode === "all" || (mode === "errors" && ERROR_LIKE_LOG_TYPES.has(String(entry.type).toLowerCase()));
    if (!keep) {
      const { stackTrace, ...rest } = entry;
      return rest;
    }
    const frames = entry.stackTrace.split("\n").filter((line) => line.trim().length > 0);
    if (frames.length <= frameCap) return entry;
    return {
      ...entry,
      stackTrace: `${frames.slice(0, frameCap).join("\n")}\n... (+${frames.length - frameCap} more frames; use includeStackTrace:"all" + maxStackFrames for the full trace)`,
    };
  });

  return { ...result, data: { ...result.data, entries: shaped } };
}

export const editorTools = [
  // â”€â”€â”€ Connection â”€â”€â”€
  {
    name: "unity_editor_ping",
    description: "Check if the Unity Editor bridge is running and responsive. Returns editor version, project name, and connection status.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => formatResult(await bridge.ping()),
  },
  {
    name: "unity_editor_state",
    description: "Get the current Unity Editor state: play mode, compilation status, active scene, project path.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => formatResult(await bridge.getEditorState()),
  },

  // â”€â”€â”€ Scene Management â”€â”€â”€
  {
    name: "unity_scene_info",
    description: "Get information about the currently open scene(s), including name, path, dirty state, and root game objects.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => formatResult(await bridge.getSceneInfo()),
  },
  {
    name: "unity_scene_open",
    description:
      "Open a scene by its asset path (relative to Assets/). Refuses if any loaded scene has " +
      "unsaved changes — pass saveFirst or discardUnsavedChanges.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Scene asset path, e.g. 'Assets/Scenes/MainScene.unity'" },
        saveFirst: { type: "boolean", description: "Save all modified scenes before switching." },
        discardUnsavedChanges: { type: "boolean", description: "Proceed and LOSE unsaved changes." },
      },
      required: ["path"],
    },
    handler: async (params) => formatResult(await bridge.openScene(params)),
  },
  {
    name: "unity_scene_save",
    description:
      "Save the current scene. A never-saved scene requires `path` (saving without one would " +
      "open Unity's interactive Save dialog).",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path to save to, e.g. 'Assets/Scenes/MyScene.unity'. Required for a scene that has never been saved; also acts as Save-As." },
      },
    },
    handler: async (params) => formatResult(await bridge.saveScene(params)),
  },
  {
    name: "unity_scene_new",
    description:
      "Create a new empty scene (REPLACES the current one). Refuses if any loaded scene has " +
      "unsaved changes — pass saveFirst or discardUnsavedChanges.",
    inputSchema: {
      type: "object",
      properties: {
        saveFirst: { type: "boolean", description: "Save all modified scenes first." },
        discardUnsavedChanges: { type: "boolean", description: "Proceed and LOSE unsaved changes." },
      },
    },
    handler: async (params) => formatResult(await bridge.newScene(params)),
  },
  {
    name: "unity_scene_hierarchy",
    description:
      "Get the hierarchy tree of all GameObjects in the active scene, including their components and children. " +
      "Dense by default: per-node fields at their default value (active=true, tag=Untagged, layer=Default, origin position, Transform) are omitted — an absent field means the default.",
    inputSchema: {
      type: "object",
      properties: {
        maxDepth: { type: "number", description: "Maximum depth to traverse (default: 10)" },
        maxNodes: { type: "number", description: "Maximum total nodes to return (default: 5000). Use lower values for very large scenes to avoid timeouts." },
        parentPath: { type: "string", description: "Only return hierarchy under this GameObject path (e.g. 'Canvas/Panel'). Useful for exploring specific subtrees in large scenes." },
        verbose: { type: "boolean", description: "Emit every per-node field even at default values (the pre-2.37 shape)." },
      },
    },
    handler: async (params) => formatResult(await bridge.getHierarchy(params)),
  },

  // â”€â”€â”€ GameObject Operations â”€â”€â”€
  {
    name: "unity_gameobject_create",
    description: "Create a new GameObject in the scene. Can specify primitive type (Cube, Sphere, Capsule, Cylinder, Plane, Quad), parent, and initial transform.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name for the new GameObject" },
        primitiveType: {
          type: "string",
          description: "Optional primitive: Cube, Sphere, Capsule, Cylinder, Plane, Quad, Empty",
          enum: ["Cube", "Sphere", "Capsule", "Cylinder", "Plane", "Quad", "Empty"],
        },
        parent: { type: "string", description: "Path or name of parent GameObject (optional)" },
        position: {
          type: "object",
          properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } },
        },
        rotation: {
          type: "object",
          properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } },
        },
        scale: {
          type: "object",
          properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } },
        },
      },
      required: ["name"],
    },
    handler: async (params) => formatResult(await bridge.createGameObject(params)),
  },
  {
    name: "unity_gameobject_delete",
    description:
      "Delete a GameObject by path or name. Refuses if its runtime mesh is shared by other " +
      "objects (ProBuilder clones) — reports sharedWith; pass force:true to override.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Hierarchy path or name of the GameObject to delete" },
        instanceId: { type: "string", description: "Instance ID (alternative to path)" },
        force: { type: "boolean", description: "Delete even when the runtime mesh is shared by other objects (ProBuilder clones). Default false." },
      },
    },
    handler: async (params) => formatResult(await bridge.deleteGameObject(params)),
  },
  {
    name: "unity_gameobject_info",
    description: "Get detailed info about a specific GameObject: transform, components, children, active state, tags, layer.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Hierarchy path or name" },
        instanceId: { type: "string", description: "Instance ID (alternative to path)" },
      },
    },
    handler: async (params) => formatResult(await bridge.getGameObjectInfo(params)),
  },
  {
    name: "unity_gameobject_set_transform",
    description: "Set the transform (position, rotation, scale) of a GameObject.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Hierarchy path or name" },
        instanceId: { type: "string", description: "Instance ID (alternative)" },
        position: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } } },
        rotation: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } } },
        scale: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } } },
        local: { type: "boolean", description: "If true, set local transform instead of world (default: false)" },
      },
    },
    handler: async (params) => formatResult(await bridge.setTransform(params)),
  },

  // â”€â”€â”€ Component Operations â”€â”€â”€
  {
    name: "unity_component_add",
    description: "Add a component to a GameObject. Supports built-in types (Rigidbody, BoxCollider, AudioSource, Light, Camera, etc.) and custom scripts.",
    inputSchema: {
      type: "object",
      properties: {
        gameObjectPath: { type: "string", description: "Path or name of the target GameObject" },
        componentType: { type: "string", description: "Full type name, e.g. 'Rigidbody', 'BoxCollider', 'MyNamespace.MyScript'" },
      },
      required: ["gameObjectPath", "componentType"],
    },
    handler: async (params) => formatResult(await bridge.addComponent(params)),
  },
  {
    name: "unity_component_remove",
    description: "Remove a component from a GameObject.",
    inputSchema: {
      type: "object",
      properties: {
        gameObjectPath: { type: "string", description: "Path or name of the target GameObject" },
        componentType: { type: "string", description: "Type name of the component to remove" },
        index: { type: "number", description: "Index if multiple components of same type (default: 0)" },
      },
      required: ["gameObjectPath", "componentType"],
    },
    handler: async (params) => formatResult(await bridge.removeComponent(params)),
  },
  {
    name: "unity_component_get_properties",
    description: "Get all serialized properties of a component on a GameObject.",
    inputSchema: {
      type: "object",
      properties: {
        gameObjectPath: { type: "string", description: "Path or name of the target GameObject" },
        componentType: { type: "string", description: "Component type name" },
      },
      required: ["gameObjectPath", "componentType"],
    },
    handler: async (params) => formatResult(await bridge.getComponentProperties(params)),
  },
  {
    name: "unity_component_set_property",
    description: "Set a property value on a component. Supports floats, ints, strings, bools, vectors, colors, and object references. For ObjectReference properties, pass value as: an asset path string, a scene object name string, null to clear, or an object with {assetPath}, {instanceId}, or {gameObject, componentType}.",
    inputSchema: {
      type: "object",
      properties: {
        gameObjectPath: { type: "string", description: "Path or name of target GameObject" },
        componentType: { type: "string", description: "Component type name" },
        propertyName: { type: "string", description: "Name of the property to set" },
        value: { type: ["string", "number", "boolean", "object", "array", "null"], description: "Value to set. ObjectReference accepts: asset path, scene object name, null, or {assetPath?, instanceId?, gameObject?, componentType?}" },
      },
      required: ["gameObjectPath", "componentType", "propertyName", "value"],
    },
    handler: async (params) => {
      // Type coercion: MCP clients may send numeric values as strings (e.g. "5.0" instead of 5).
      // The C# plugin's SetSerializedValue uses Convert.ToSingle/ToInt32 which can fail
      // with locale-dependent parsing. Coerce string values that look like numbers here.
      if (params.value !== undefined && params.value !== null && typeof params.value === "string") {
        const trimmed = params.value.trim();
        // Check if it's a numeric string (int or float)
        if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
          params.value = Number(trimmed);
        }
        // Check for boolean strings
        else if (trimmed.toLowerCase() === "true") {
          params.value = true;
        } else if (trimmed.toLowerCase() === "false") {
          params.value = false;
        }
      }
      return formatResult(await bridge.setComponentProperty(params));
    },
  },
  {
    name: "unity_component_set_reference",
    description: "Wire an object reference on a component property. Resolves by asset path, scene GameObject name, component type, or instance ID (richer than set_property for ObjectReference fields).",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Hierarchy path or name of the target GameObject" },
        instanceId: { type: "string", description: "Instance ID of the target GameObject (alternative to path)" },
        componentType: { type: "string", description: "Component type containing the property (optional â€” will auto-search all components)" },
        propertyName: { type: "string", description: "Name of the ObjectReference property to set" },
        assetPath: { type: "string", description: "Asset path to assign (e.g. 'Assets/Materials/MyMat.mat', 'Assets/Prefabs/Enemy.prefab')" },
        referenceGameObject: { type: "string", description: "Name or hierarchy path of a scene GameObject to assign" },
        referenceComponentType: { type: "string", description: "When referencing a scene object, get a specific component instead of the GameObject itself (e.g. 'Camera', 'AudioSource')" },
        referenceInstanceId: { type: "string", description: "Instance ID of the object to assign (64-bit-safe string)" },
        clear: { type: "boolean", description: "Set to true to clear/null the reference" },
      },
      required: ["propertyName"],
    },
    handler: async (params) => formatResult(await bridge.setComponentReference(params)),
  },
  {
    name: "unity_component_batch_wire",
    description: "Wire multiple object references in one call (e.g. a manager to all its panels). Each entry: target GameObject, property, reference to assign.",
    inputSchema: {
      type: "object",
      properties: {
        references: {
          type: "array",
          description: "Array of reference assignments to perform",
          items: {
            type: "object",
            properties: {
              path: { type: "string", description: "Target GameObject path or name" },
              instanceId: { type: "string", description: "Target GameObject instance ID" },
              componentType: { type: "string", description: "Component type (optional)" },
              propertyName: { type: "string", description: "Property name to set" },
              assetPath: { type: "string", description: "Asset path to assign" },
              referenceGameObject: { type: "string", description: "Scene GameObject to assign" },
              referenceComponentType: { type: "string", description: "Component type on the referenced GameObject" },
              referenceInstanceId: { type: "string", description: "Instance ID to assign (64-bit-safe string)" },
              clear: { type: "boolean", description: "Clear the reference" },
            },
            required: ["propertyName"],
          },
        },
      },
      required: ["references"],
    },
    handler: async (params) => {
      const result = await bridge.batchWireReferences(params);
      // Graceful degrade for plugins that predate component/batch-wire: run the
      // entries as single set-reference calls instead of failing the whole batch.
      if (isUnknownRouteResult(result)) {
        console.error("[MCP] Plugin lacks component/batch-wire - degrading to single set-reference calls");
        // Pipeline the round-trips instead of awaiting each in turn — the plugin queue still
        // serializes the actual writes, but this bounds wall-clock by the slowest single call
        // rather than their sum (the batch tool's whole point is many refs at once). Promise.all
        // preserves order, so results[i] still matches references[i].
        const results = await Promise.all(
          (params.references || []).map((entry) => bridge.setComponentReference(entry))
        );
        // Old plugins report per-call failures as an HTTP 200 { success:true, data:{error} }
        // envelope, so a plain success!==false check would mask every degraded failure —
        // the exact misleading-success class this project set out to kill. Inspect the
        // inner payload too.
        const isOk = (r) => r && r.success !== false && !looksLikeErrorObject(r.data);
        const allOk = results.every(isOk);
        return formatResult({
          success: allOk,
          degraded: "batch-wire unavailable on this plugin version; executed as single set-reference calls",
          failedCount: results.filter((r) => !isOk(r)).length,
          results,
        });
      }
      return formatResult(result);
    },
  },
  {
    name: "unity_component_get_referenceable",
    description: "Discover what objects can be assigned to an ObjectReference property. Returns matching scene objects and project assets filtered by the expected type. Useful before wiring references to know what's available.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Target GameObject path or name" },
        instanceId: { type: "string", description: "Target GameObject instance ID" },
        componentType: { type: "string", description: "Component type containing the property" },
        propertyName: { type: "string", description: "ObjectReference property name to inspect" },
        maxResults: { type: "number", description: "Maximum results to return (default: 50)" },
      },
      required: ["propertyName"],
    },
    handler: async (params) => formatResult(await bridge.getReferenceableObjects(params)),
  },

  // â”€â”€â”€ Asset Management â”€â”€â”€
  {
    name: "unity_asset_list",
    description: "List assets in the project. Can filter by path, type, and search term.",
    inputSchema: {
      type: "object",
      properties: {
        folder: { type: "string", description: "Folder path relative to Assets/ (default: 'Assets')" },
        type: { type: "string", description: "Asset type filter: Script, Scene, Prefab, Material, Texture, AudioClip, AnimationClip, Shader, Font, Mesh, Model" },
        search: { type: "string", description: "Search query string" },
        recursive: { type: "boolean", description: "Search recursively in subfolders (default: true)" },
        maxResults: { type: "number", description: "Maximum assets to return (default: 500). Use lower values for large projects." },
      },
    },
    handler: async (params) => formatResult(await bridge.getAssetList(params)),
  },
  {
    name: "unity_asset_import",
    description: "Import an external file into the Unity project as an asset.",
    inputSchema: {
      type: "object",
      properties: {
        sourcePath: { type: "string", description: "Absolute path to the source file on disk" },
        destinationPath: { type: "string", description: "Destination path inside Assets/ folder" },
        overwrite: { type: "boolean", description: "Replace an existing asset at the destination (default false)." },
      },
      required: ["sourcePath", "destinationPath"],
    },
    handler: async (params) => formatResult(await bridge.importAsset(params)),
  },
  {
    name: "unity_asset_delete",
    description:
      "Delete an asset — to the OS trash by default (NOT undoable via unity_undo_last). " +
      "Deleting a FOLDER is recursive and refuses without recursive:true.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path relative to project root (e.g. 'Assets/Scripts/MyScript.cs')" },
        recursive: { type: "boolean", description: "Required to delete a FOLDER and its contents. Default false refuses, reporting the asset count." },
        permanent: { type: "boolean", description: "Hard-delete instead of OS trash. Default false." },
      },
      required: ["path"],
    },
    handler: async (params) => formatResult(await bridge.deleteAsset(params)),
  },
  {
    name: "unity_asset_create_prefab",
    description: "Create a prefab from an existing GameObject in the scene.",
    inputSchema: {
      type: "object",
      properties: {
        gameObjectPath: { type: "string", description: "Path of the source GameObject in the hierarchy" },
        savePath: { type: "string", description: "Where to save the prefab (e.g. 'Assets/Prefabs/MyPrefab.prefab')" },
      },
      required: ["gameObjectPath", "savePath"],
    },
    handler: async (params) => formatResult(await bridge.createPrefab(params)),
  },
  {
    name: "unity_asset_instantiate_prefab",
    description: "Instantiate a prefab into the current scene.",
    inputSchema: {
      type: "object",
      properties: {
        prefabPath: { type: "string", description: "Path to the prefab asset (e.g. 'Assets/Prefabs/Enemy.prefab')" },
        name: { type: "string", description: "Name for the instantiated object" },
        position: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } } },
        rotation: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } } },
        parent: { type: "string", description: "Parent GameObject path (optional)" },
      },
      required: ["prefabPath"],
    },
    handler: async (params) => formatResult(await bridge.instantiatePrefab(params)),
  },

  // â”€â”€â”€ Script / Code Operations â”€â”€â”€
  {
    name: "unity_script_create",
    description: "Create a new C# script file in the project with the given content.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path for the script (e.g. 'Assets/Scripts/PlayerController.cs')" },
        content: { type: "string", description: "Full C# source code content" },
        className: { type: "string", description: "Class name (defaults to filename without extension)" },
        overwrite: { type: "boolean", description: "Replace an existing script (default false). Use unity_script_update to edit." },
      },
      required: ["path", "content"],
    },
    handler: async (params) => formatResult(await bridge.createScript(params)),
  },
  {
    name: "unity_script_read",
    description: "Read the contents of a C# script file from the project.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path of the script" },
      },
      required: ["path"],
    },
    handler: async (params) => formatResult(await bridge.readScript(params)),
  },
  {
    name: "unity_script_update",
    description: "Update the contents of an existing C# script file.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path of the script" },
        content: { type: "string", description: "New full C# source code content" },
      },
      required: ["path", "content"],
    },
    handler: async (params) => formatResult(await bridge.updateScript(params)),
  },
  {
    name: "unity_execute_code",
    description: "Execute arbitrary C# code inside the Unity Editor. The code runs in the editor context with access to all Unity APIs. Useful for one-off operations, queries, and automation. Return values are serialized to JSON.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "C# code to execute. Must be a valid method body. Access UnityEngine and UnityEditor namespaces. Use 'return' to send data back." },
      },
      required: ["code"],
    },
    handler: async ({ code }) => formatResult(await bridge.executeCode(code)),
  },

  // â”€â”€â”€ Material / Rendering â”€â”€â”€
  {
    name: "unity_material_create",
    description: "Create a new material asset with a specified shader and properties.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Save path (e.g. 'Assets/Materials/MyMat.mat')" },
        shader: { type: "string", description: "Shader name (e.g. 'Standard', 'Universal Render Pipeline/Lit')" },
        color: { type: "object", properties: { r: { type: "number" }, g: { type: "number" }, b: { type: "number" }, a: { type: "number" } } },
        properties: { type: "object", description: "Additional shader properties as key-value pairs" },
        overwrite: { type: "boolean", description: "Replace an existing material (default false)." },
      },
      required: ["path"],
    },
    handler: async (params) => formatResult(await bridge.createMaterial(params)),
  },
  {
    name: "unity_renderer_set_material",
    description: "Assign a material to a GameObject's renderer.",
    inputSchema: {
      type: "object",
      properties: {
        gameObjectPath: { type: "string", description: "Path to the target GameObject" },
        materialPath: { type: "string", description: "Path to the material asset" },
        materialIndex: { type: "number", description: "Material slot index (default: 0)" },
      },
      required: ["gameObjectPath", "materialPath"],
    },
    handler: async (params) => formatResult(await bridge.setMaterial(params)),
  },

  // â”€â”€â”€ Build â”€â”€â”€
  {
    name: "unity_build",
    description: "Start a build of the Unity project for a target platform.",
    inputSchema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "Build target platform",
          enum: ["StandaloneWindows64", "StandaloneOSX", "StandaloneLinux64", "Android", "iOS", "WebGL"],
        },
        outputPath: { type: "string", description: "Output path for the build" },
        scenes: {
          type: "array",
          items: { type: "string" },
          description: "Scene paths to include (default: scenes in build settings)",
        },
        developmentBuild: { type: "boolean", description: "Enable development build (default: false)" },
      },
      required: ["target", "outputPath"],
    },
    handler: async (params) => formatResult(await bridge.buildProject(params)),
  },

  // â”€â”€â”€ Console / Logging â”€â”€â”€
  {
    name: "unity_console_log",
    description: "Get recent Unity console log messages (errors, warnings, info).",
    inputSchema: {
      type: "object",
      properties: {
        count: { type: "number", description: "Number of recent messages to retrieve (default: 50)" },
        type: { type: "string", description: "Filter: 'error', 'warning', 'info', or 'all' (default: 'all')" },
        includeStackTrace: {
          type: "string",
          enum: ["errors", "all", "none"],
          description: "Traces to keep: 'errors' (default, error-like entries only, trimmed), 'all', 'none'.",
        },
        maxStackFrames: { type: "number", description: "Frames kept per retained trace (default: 6)" },
      },
    },
    handler: async (params) => {
      const { includeStackTrace, maxStackFrames, ...bridgeParams } = params || {};
      const result = await bridge.getConsoleLog(bridgeParams);
      return formatResult(shapeConsoleLogResult(result, includeStackTrace, maxStackFrames));
    },
  },
  {
    name: "unity_console_clear",
    description: "Clear the Unity console log.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => formatResult(await bridge.clearConsoleLog()),
  },

  // â”€â”€â”€ Play Mode â”€â”€â”€
  // ─── Compilation ───
  {
    name: "unity_get_compilation_errors",
    description:
      "Get C# compilation errors/warnings via CompilationPipeline — independent of the console buffer " +
      "(survives console clear and log flooding). Prefer this over unity_console_log for compile issues.",
    inputSchema: {
      type: "object",
      properties: {
        count: { type: "number", description: "Max number of entries to retrieve (default: 50)" },
        severity: { type: "string", description: "Filter: 'error', 'warning', or 'all' (default: 'all')" },
      },
    },
    handler: async (params) => formatResult(await bridge.getCompilationErrors(params)),
  },

  // ─── Play Mode ───
  {
    name: "unity_play_mode",
    description: "Control Unity Editor play mode: enter play, pause, or stop.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["play", "pause", "stop"], description: "Play mode action" },
      },
      required: ["action"],
    },
    handler: async ({ action }) => {
      const result = await bridge.playMode(action);
      // Entering/exiting play mode triggers a domain reload that evicts queue tickets —
      // the status poll then 404s while the mode switch actually happened (a false
      // negative). Before propagating that specific failure, verify the editor state:
      // if it matches the requested action, the operation succeeded.
      const ticketLost =
        result && result.success === false &&
        /HTTP 404|not found or expired/i.test(result.error || "");
      if (ticketLost) {
        try {
          const state = await bridge.getEditorState();
          const s = state && state.data !== undefined ? state.data : state;
          const confirmed =
            (action === "play" && s.isPlaying === true) ||
            (action === "stop" && s.isPlaying === false) ||
            (action === "pause" && s.isPaused === true);
          if (confirmed) {
            return formatResult({
              success: true,
              data: {
                action,
                isPlaying: s.isPlaying,
                isPaused: s.isPaused,
                verifiedViaEditorState: true,
                note: "The play-mode domain reload evicted the queue ticket; the editor state confirms the switch happened.",
              },
            });
          }
        } catch (_) {
          // State check unavailable — fall through to the original error.
        }
      }
      return formatResult(result);
    },
  },

  // â”€â”€â”€ Editor Menu â”€â”€â”€
  {
    name: "unity_execute_menu_item",
    description: "Execute a Unity Editor menu command by its path (e.g. 'File/Save', 'GameObject/3D Object/Cube', 'Window/General/Console').",
    inputSchema: {
      type: "object",
      properties: {
        menuPath: { type: "string", description: "Full menu path (e.g. 'Edit/Project Settings...')" },
      },
      required: ["menuPath"],
    },
    handler: async ({ menuPath }) => formatResult(await bridge.executeMenuItem(menuPath)),
  },

  // â”€â”€â”€ Project Info â”€â”€â”€
  {
    name: "unity_project_info",
    description: "Get project information: name, path, Unity version, render pipeline, packages, build settings.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => formatResult(await bridge.getProjectInfo()),
  },

  // â”€â”€â”€ Animation â”€â”€â”€
  {
    name: "unity_animation_create_controller",
    description: "Create a new Animator Controller asset at the specified path.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path for the controller (e.g. 'Assets/Animations/PlayerController.controller')" },
        overwrite: { type: "boolean", description: "Replace an existing controller at this path (default false: refuse, to avoid losing its states/transitions)." },
      },
      required: ["path"],
    },
    handler: async (params) => formatResult(await bridge.createAnimatorController(params)),
  },
  {
    name: "unity_animation_controller_info",
    description: "Get detailed information about an Animator Controller: layers, states, transitions, parameters.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path of the Animator Controller" },
      },
      required: ["path"],
    },
    handler: async (params) => formatResult(await bridge.getAnimatorControllerInfo(params)),
  },
  {
    name: "unity_animation_add_parameter",
    description: "Add a parameter to an Animator Controller (Float, Int, Bool, or Trigger).",
    inputSchema: {
      type: "object",
      properties: {
        controllerPath: { type: "string", description: "Asset path of the Animator Controller" },
        parameterName: { type: "string", description: "Name of the parameter to add" },
        parameterType: { type: "string", enum: ["Float", "Int", "Bool", "Trigger"], description: "Type of the parameter" },
        defaultValue: { type: ["string", "number", "boolean", "null"], description: "Default value for the parameter (not applicable to Trigger)" },
      },
      required: ["controllerPath", "parameterName", "parameterType"],
    },
    handler: async (params) => formatResult(await bridge.addAnimationParameter(params)),
  },
  {
    name: "unity_animation_remove_parameter",
    description: "Remove a parameter from an Animator Controller by name.",
    inputSchema: {
      type: "object",
      properties: {
        controllerPath: { type: "string", description: "Asset path of the Animator Controller" },
        parameterName: { type: "string", description: "Name of the parameter to remove" },
      },
      required: ["controllerPath", "parameterName"],
    },
    handler: async (params) => formatResult(await bridge.removeAnimationParameter(params)),
  },
  {
    name: "unity_animation_add_state",
    description: "Add a state to an Animator Controller layer. Can optionally assign an animation clip and set as default state.",
    inputSchema: {
      type: "object",
      properties: {
        controllerPath: { type: "string", description: "Asset path of the Animator Controller" },
        stateName: { type: "string", description: "Name for the new state" },
        layerIndex: { type: "number", description: "Layer index (default: 0)" },
        clipPath: { type: "string", description: "Optional asset path of an AnimationClip to assign" },
        speed: { type: "number", description: "Playback speed (default: 1)" },
        isDefault: { type: "boolean", description: "Set as the default state for this layer" },
      },
      required: ["controllerPath", "stateName"],
    },
    handler: async (params) => formatResult(await bridge.addAnimationState(params)),
  },
  {
    name: "unity_animation_remove_state",
    description: "Remove a state from an Animator Controller layer.",
    inputSchema: {
      type: "object",
      properties: {
        controllerPath: { type: "string", description: "Asset path of the Animator Controller" },
        stateName: { type: "string", description: "Name of the state to remove" },
        layerIndex: { type: "number", description: "Layer index (default: 0)" },
      },
      required: ["controllerPath", "stateName"],
    },
    handler: async (params) => formatResult(await bridge.removeAnimationState(params)),
  },
  {
    name: "unity_animation_add_transition",
    description: "Add a transition between states in an Animator Controller. Supports conditions, exit time, and AnyState transitions.",
    inputSchema: {
      type: "object",
      properties: {
        controllerPath: { type: "string", description: "Asset path of the Animator Controller" },
        sourceState: { type: "string", description: "Name of the source state (not needed if fromAnyState is true)" },
        destinationState: { type: "string", description: "Name of the destination state" },
        layerIndex: { type: "number", description: "Layer index (default: 0)" },
        fromAnyState: { type: "boolean", description: "Create transition from Any State (default: false)" },
        hasExitTime: { type: "boolean", description: "Whether the transition uses exit time" },
        exitTime: { type: "number", description: "Normalized exit time (0-1)" },
        duration: { type: "number", description: "Transition duration in seconds" },
        offset: { type: "number", description: "Transition offset" },
        hasFixedDuration: { type: "boolean", description: "Whether duration is in fixed time" },
        conditions: {
          type: "array",
          description: "Array of transition conditions",
          items: {
            type: "object",
            properties: {
              parameter: { type: "string", description: "Parameter name" },
              mode: { type: "string", enum: ["If", "IfNot", "Greater", "Less", "Equals", "NotEqual"], description: "Condition mode" },
              threshold: { type: "number", description: "Threshold value for comparison" },
            },
          },
        },
      },
      required: ["controllerPath", "destinationState"],
    },
    handler: async (params) => formatResult(await bridge.addAnimationTransition(params)),
  },
  {
    name: "unity_animation_create_clip",
    description: "Create a new empty Animation Clip asset.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path for the clip (e.g. 'Assets/Animations/Walk.anim')" },
        loop: { type: "boolean", description: "Whether the clip should loop (default: false)" },
        frameRate: { type: "number", description: "Frame rate (default: 60)" },
        overwrite: { type: "boolean", description: "Replace an existing clip at this path (default false: refuse, to avoid wiping its curves)." },
      },
      required: ["path"],
    },
    handler: async (params) => formatResult(await bridge.createAnimationClip(params)),
  },
  {
    name: "unity_animation_clip_info",
    description: "Get detailed information about an Animation Clip: curves, length, events, loop settings.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path of the Animation Clip" },
      },
      required: ["path"],
    },
    handler: async (params) => formatResult(await bridge.getAnimationClipInfo(params)),
  },
  {
    name: "unity_animation_set_clip_curve",
    description: "Set an animation curve on a clip. Define keyframes to animate any property (position, rotation, scale, custom).",
    inputSchema: {
      type: "object",
      properties: {
        clipPath: { type: "string", description: "Asset path of the Animation Clip" },
        relativePath: { type: "string", description: "Relative path to the animated object (empty for root)" },
        propertyName: { type: "string", description: "Property to animate (e.g. 'localPosition.x', 'm_LocalScale.y')" },
        type: { type: "string", description: "Component type (default: 'Transform')" },
        keyframes: {
          type: "array",
          description: "Array of keyframes with time and value",
          items: {
            type: "object",
            properties: {
              time: { type: "number", description: "Time in seconds" },
              value: { type: "number", description: "Value at this keyframe" },
            },
          },
        },
      },
      required: ["clipPath", "propertyName", "keyframes"],
    },
    handler: async (params) => formatResult(await bridge.setAnimationClipCurve(params)),
  },
  {
    name: "unity_animation_set_object_reference_curve",
    description:
      "Set an OBJECT-REFERENCE (PPtr) animation curve — the curve type Unity uses for 2D sprite-frame " +
      "animation (SpriteRenderer.m_Sprite). unity_animation_set_clip_curve only handles float curves. " +
      "Each keyframe names an asset path; for a sliced sprite sheet add `name` to pick a specific sprite " +
      "sub-asset. Fails closed if any keyframe can't be resolved, so a clip is never half-wired.",
    inputSchema: {
      type: "object",
      properties: {
        clipPath: { type: "string", description: "Asset path of the Animation Clip" },
        relativePath: { type: "string", description: "Path to the animated child object (empty for the root)" },
        propertyName: { type: "string", description: "Property to animate (default 'm_Sprite')" },
        type: { type: "string", description: "Component type (default 'SpriteRenderer')" },
        keyframes: {
          type: "array",
          description: "Ordered keyframes; each { time, assetPath, name? }",
          items: {
            type: "object",
            properties: {
              time: { type: "number", description: "Time in seconds" },
              assetPath: { type: "string", description: "Asset path of the referenced object (e.g. the sprite sheet)" },
              name: { type: "string", description: "Sub-asset name — required to pick one sprite out of a sliced sheet" },
            },
          },
        },
      },
      required: ["clipPath", "keyframes"],
    },
    handler: async (params) => formatResult(await bridge.setAnimationObjectReferenceCurve(params)),
  },
  {
    name: "unity_animation_add_layer",
    description: "Add a new layer to an Animator Controller.",
    inputSchema: {
      type: "object",
      properties: {
        controllerPath: { type: "string", description: "Asset path of the Animator Controller" },
        layerName: { type: "string", description: "Name for the new layer" },
        weight: { type: "number", description: "Layer weight (0-1, default: 1)" },
      },
      required: ["controllerPath", "layerName"],
    },
    handler: async (params) => formatResult(await bridge.addAnimationLayer(params)),
  },
  {
    name: "unity_animation_assign_controller",
    description: "Assign an Animator Controller to a GameObject (adds Animator component if needed).",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Hierarchy path or name of the target GameObject" },
        instanceId: { type: "string", description: "Instance ID (alternative to path)" },
        controllerPath: { type: "string", description: "Asset path of the Animator Controller to assign" },
      },
      required: ["controllerPath"],
    },
    handler: async (params) => formatResult(await bridge.assignAnimatorController(params)),
  },
  {
    name: "unity_animation_get_curve_keyframes",
    description: "Get all keyframes from an animation curve binding with full tangent data (inTangent, outTangent, inWeight, outWeight, weightedMode). Essential for precise animation editing.",
    inputSchema: {
      type: "object",
      properties: {
        clipPath: { type: "string", description: "Asset path of the AnimationClip" },
        relativePath: { type: "string", description: "Relative path of the animated object (empty for root)" },
        propertyName: { type: "string", description: "Property name (e.g., 'localPosition.x', 'm_LocalRotation.x')" },
        typeName: { type: "string", description: "Component type name (e.g., 'Transform', 'SpriteRenderer')" },
      },
      required: ["clipPath", "propertyName", "typeName"],
    },
    handler: async (params) => formatResult(await bridge.getCurveKeyframes(params)),
  },
  {
    name: "unity_animation_remove_curve",
    description: "Remove an entire animation curve binding from a clip. Useful for cleaning up or restructuring animations.",
    inputSchema: {
      type: "object",
      properties: {
        clipPath: { type: "string", description: "Asset path of the AnimationClip" },
        relativePath: { type: "string", description: "Relative path of the animated object (empty for root)" },
        propertyName: { type: "string", description: "Property name to remove" },
        typeName: { type: "string", description: "Component type name" },
      },
      required: ["clipPath", "propertyName", "typeName"],
    },
    handler: async (params) => formatResult(await bridge.removeCurve(params)),
  },
  {
    name: "unity_animation_add_keyframe",
    description: "Add a keyframe to an animation curve with full tangent and weight control. Creates the curve if it doesn't exist yet. Supports all weighted tangent modes.",
    inputSchema: {
      type: "object",
      properties: {
        clipPath: { type: "string", description: "Asset path of the AnimationClip" },
        relativePath: { type: "string", description: "Relative path of the animated object (empty for root)" },
        propertyName: { type: "string", description: "Property name (e.g., 'localPosition.x')" },
        typeName: { type: "string", description: "Component type name (e.g., 'Transform')" },
        time: { type: "number", description: "Time in seconds for the keyframe" },
        value: { type: "number", description: "Value at this keyframe" },
        inTangent: { type: "number", description: "Incoming tangent slope (optional, default 0)" },
        outTangent: { type: "number", description: "Outgoing tangent slope (optional, default 0)" },
        inWeight: { type: "number", description: "Incoming tangent weight 0-1 (optional)" },
        outWeight: { type: "number", description: "Outgoing tangent weight 0-1 (optional)" },
        weightedMode: { type: "string", description: "Weighted mode: None, In, Out, Both (optional)" },
      },
      required: ["clipPath", "propertyName", "typeName", "time", "value"],
    },
    handler: async (params) => formatResult(await bridge.addKeyframe(params)),
  },
  {
    name: "unity_animation_remove_keyframe",
    description: "Remove a keyframe from an animation curve by its index. Use get_curve_keyframes first to find the index.",
    inputSchema: {
      type: "object",
      properties: {
        clipPath: { type: "string", description: "Asset path of the AnimationClip" },
        relativePath: { type: "string", description: "Relative path of the animated object" },
        propertyName: { type: "string", description: "Property name" },
        typeName: { type: "string", description: "Component type name" },
        keyframeIndex: { type: "number", description: "Zero-based index of the keyframe to remove" },
      },
      required: ["clipPath", "propertyName", "typeName", "keyframeIndex"],
    },
    handler: async (params) => formatResult(await bridge.removeKeyframe(params)),
  },
  {
    name: "unity_animation_add_event",
    description: "Add an animation event that calls a function at a specific time during playback. Can pass string, int, or float parameters.",
    inputSchema: {
      type: "object",
      properties: {
        clipPath: { type: "string", description: "Asset path of the AnimationClip" },
        functionName: { type: "string", description: "Name of the function to call on the animated GameObject" },
        time: { type: "number", description: "Time in seconds when the event fires" },
        stringParameter: { type: "string", description: "String parameter to pass (optional)" },
        intParameter: { type: "number", description: "Integer parameter to pass (optional)" },
        floatParameter: { type: "number", description: "Float parameter to pass (optional)" },
      },
      required: ["clipPath", "functionName", "time"],
    },
    handler: async (params) => formatResult(await bridge.addAnimationEvent(params)),
  },
  {
    name: "unity_animation_remove_event",
    description: "Remove an animation event by its index. Use get_animation_events first to find the index.",
    inputSchema: {
      type: "object",
      properties: {
        clipPath: { type: "string", description: "Asset path of the AnimationClip" },
        eventIndex: { type: "number", description: "Zero-based index of the event to remove" },
      },
      required: ["clipPath", "eventIndex"],
    },
    handler: async (params) => formatResult(await bridge.removeAnimationEvent(params)),
  },
  {
    name: "unity_animation_get_events",
    description: "List all animation events on a clip with their function names, times, and parameters.",
    inputSchema: {
      type: "object",
      properties: {
        clipPath: { type: "string", description: "Asset path of the AnimationClip" },
      },
      required: ["clipPath"],
    },
    handler: async (params) => formatResult(await bridge.getAnimationEvents(params)),
  },
  {
    name: "unity_animation_set_clip_settings",
    description: "Set animation clip settings: looping, root motion, mirroring, speed, frame rate, and more.",
    inputSchema: {
      type: "object",
      properties: {
        clipPath: { type: "string", description: "Asset path of the AnimationClip" },
        loopTime: { type: "boolean", description: "Whether the animation loops" },
        loopBlend: { type: "boolean", description: "Loop blend for seamless looping" },
        loopBlendOrientation: { type: "boolean", description: "Loop blend orientation" },
        keepOriginalOrientation: { type: "boolean", description: "Keep original orientation" },
        keepOriginalPositionY: { type: "boolean", description: "Keep original Y position" },
        keepOriginalPositionXZ: { type: "boolean", description: "Keep original XZ position" },
        mirror: { type: "boolean", description: "Mirror the animation" },
        startTime: { type: "number", description: "Clip start time" },
        stopTime: { type: "number", description: "Clip stop time" },
        level: { type: "number", description: "Height offset level" },
        frameRate: { type: "number", description: "Frame rate (e.g., 30, 60)" },
      },
      required: ["clipPath"],
    },
    handler: async (params) => formatResult(await bridge.setClipSettings(params)),
  },
  {
    name: "unity_animation_remove_transition",
    description: "Remove a transition from an Animator Controller state. Can target by source/destination names or by index.",
    inputSchema: {
      type: "object",
      properties: {
        controllerPath: { type: "string", description: "Asset path of the Animator Controller" },
        layerIndex: { type: "number", description: "Layer index (default 0)" },
        sourceState: { type: "string", description: "Name of the source state (use 'AnyState' for any-state transitions)" },
        destinationState: { type: "string", description: "Name of the destination state (helps identify which transition)" },
        transitionIndex: { type: "number", description: "Index of the transition on the source state (alternative to destinationState)" },
      },
      required: ["controllerPath", "sourceState"],
    },
    handler: async (params) => formatResult(await bridge.removeAnimationTransition(params)),
  },
  {
    name: "unity_animation_remove_layer",
    description: "Remove a layer from an Animator Controller by index. Cannot remove the base layer (index 0).",
    inputSchema: {
      type: "object",
      properties: {
        controllerPath: { type: "string", description: "Asset path of the Animator Controller" },
        layerIndex: { type: "number", description: "Index of the layer to remove (must be > 0)" },
      },
      required: ["controllerPath", "layerIndex"],
    },
    handler: async (params) => formatResult(await bridge.removeAnimationLayer(params)),
  },
  {
    name: "unity_animation_create_blend_tree",
    description: "Create a blend tree in an Animator Controller for smooth blending between animations. Supports 1D, 2D (FreeformDirectional, FreeformCartesian, SimpleDirectional), and Direct blend types.",
    inputSchema: {
      type: "object",
      properties: {
        controllerPath: { type: "string", description: "Asset path of the Animator Controller" },
        layerIndex: { type: "number", description: "Layer index (default 0)" },
        blendTreeName: { type: "string", description: "Name for the blend tree state" },
        blendType: { type: "string", description: "Blend type: Simple1D, FreeformDirectional2D, FreeformCartesian2D, SimpleDirectional2D, Direct (default Simple1D)" },
        blendParameter: { type: "string", description: "Name of the blend parameter" },
        blendParameterY: { type: "string", description: "Y-axis blend parameter for 2D types" },
        motions: {
          type: "array",
          description: "Array of motion entries with clipPath, threshold (1D), position (2D {x,y}), timeScale",
          items: {
            type: "object",
            properties: {
              clipPath: { type: "string" },
              threshold: { type: "number" },
              position: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } } },
              timeScale: { type: "number" },
            },
          },
        },
      },
      required: ["controllerPath", "blendTreeName", "blendParameter"],
    },
    handler: async (params) => formatResult(await bridge.createBlendTree(params)),
  },
  {
    name: "unity_animation_get_blend_tree",
    description: "Get the structure and configuration of a blend tree including all child motions, thresholds, positions, and time scales.",
    inputSchema: {
      type: "object",
      properties: {
        controllerPath: { type: "string", description: "Asset path of the Animator Controller" },
        layerIndex: { type: "number", description: "Layer index (default 0)" },
        stateName: { type: "string", description: "Name of the blend tree state" },
      },
      required: ["controllerPath", "stateName"],
    },
    handler: async (params) => formatResult(await bridge.getBlendTreeInfo(params)),
  },

  // â”€â”€â”€ Prefab (Advanced) â”€â”€â”€
  {
    name: "unity_prefab_info",
    description: "Get detailed prefab information: overrides, variant status, added/removed components. Works on both prefab assets and scene instances.",
    inputSchema: {
      type: "object",
      properties: {
        assetPath: { type: "string", description: "Asset path of the prefab (e.g. 'Assets/Prefabs/Player.prefab')" },
        path: { type: "string", description: "Hierarchy path of a prefab instance in the scene" },
        instanceId: { type: "string", description: "Instance ID of a prefab instance" },
      },
    },
    handler: async (params) => formatResult(await bridge.getPrefabInfo(params)),
  },
  {
    name: "unity_prefab_create_variant",
    description: "Create a prefab variant from an existing base prefab. Variants inherit from the base and can override specific properties.",
    inputSchema: {
      type: "object",
      properties: {
        basePrefabPath: { type: "string", description: "Asset path of the base prefab" },
        variantPath: { type: "string", description: "Asset path for the new variant" },
      },
      required: ["basePrefabPath", "variantPath"],
    },
    handler: async (params) => formatResult(await bridge.createPrefabVariant(params)),
  },
  {
    name: "unity_prefab_apply_overrides",
    description: "Apply all overrides from a prefab instance in the scene back to the source prefab asset.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Hierarchy path of the prefab instance" },
        instanceId: { type: "string", description: "Instance ID (alternative to path)" },
      },
    },
    handler: async (params) => formatResult(await bridge.applyPrefabOverrides(params)),
  },
  {
    name: "unity_prefab_revert_overrides",
    description: "Revert all overrides on a prefab instance, restoring it to match the source prefab.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Hierarchy path of the prefab instance" },
        instanceId: { type: "string", description: "Instance ID (alternative to path)" },
      },
    },
    handler: async (params) => formatResult(await bridge.revertPrefabOverrides(params)),
  },
  {
    name: "unity_prefab_unpack",
    description: "Unpack a prefab instance, converting it to regular GameObjects.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Hierarchy path of the prefab instance" },
        instanceId: { type: "string", description: "Instance ID (alternative to path)" },
        completely: { type: "boolean", description: "If true, unpack completely including nested prefabs (default: false)" },
      },
    },
    handler: async (params) => formatResult(await bridge.unpackPrefab(params)),
  },
  {
    name: "unity_set_object_reference",
    description: "[LEGACY] Set an object reference on a component. Prefer unity_component_set_reference (richer resolution).",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Hierarchy path of the target GameObject" },
        instanceId: { type: "string", description: "Instance ID (alternative to path)" },
        componentType: { type: "string", description: "Component type name (optional - will search all components)" },
        propertyName: { type: "string", description: "Name of the ObjectReference property to set" },
        referencePath: { type: "string", description: "Asset path of the reference (for assets like prefabs, materials, textures)" },
        referenceGameObject: { type: "string", description: "Name/path of a GameObject in the scene (for scene references)" },
      },
      required: ["propertyName"],
    },
    handler: async (params) => formatResult(await bridge.setObjectReference(params)),
  },
  {
    name: "unity_gameobject_duplicate",
    description: "Duplicate a GameObject with all its children and components.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Hierarchy path or name of the GameObject to duplicate" },
        instanceId: { type: "string", description: "Instance ID (alternative to path)" },
        newName: { type: "string", description: "Name for the duplicate (default: original name + ' (Copy)')" },
      },
    },
    handler: async (params) => formatResult(await bridge.duplicateGameObject(params)),
  },
  {
    name: "unity_gameobject_set_active",
    description: "Set a GameObject active or inactive.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Hierarchy path or name of the GameObject" },
        instanceId: { type: "string", description: "Instance ID (alternative to path)" },
        active: { type: "boolean", description: "Whether the GameObject should be active" },
      },
      required: ["active"],
    },
    handler: async (params) => formatResult(await bridge.setGameObjectActive(params)),
  },
  {
    name: "unity_gameobject_reparent",
    description: "Move a GameObject under a new parent in the hierarchy.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Hierarchy path or name of the GameObject to move" },
        instanceId: { type: "string", description: "Instance ID (alternative to path)" },
        newParent: { type: "string", description: "Path of the new parent (empty string for scene root)" },
        worldPositionStays: { type: "boolean", description: "Maintain world position after reparenting (default: true)" },
      },
    },
    handler: async (params) => formatResult(await bridge.reparentGameObject(params)),
  },

  // â”€â”€â”€ Prefab Asset (Direct Editing) â”€â”€â”€
  {
    name: "unity_prefab_get_hierarchy",
    description: "Get the full hierarchy tree of a prefab asset directly from disk â€” no scene instance needed. Shows all GameObjects, components, and nested children inside the prefab.",
    inputSchema: {
      type: "object",
      properties: {
        assetPath: { type: "string", description: "Asset path of the prefab (e.g. 'Assets/Prefabs/Player.prefab')" },
        maxDepth: { type: "number", description: "Maximum hierarchy depth to traverse (default: 10)" },
      },
      required: ["assetPath"],
    },
    handler: async (params) => formatResult(await bridge.getPrefabAssetHierarchy(params)),
  },
  {
    name: "unity_prefab_get_properties",
    description: "Read all serialized properties of a component on a GameObject inside a prefab asset â€” no scene instance needed. Use prefabPath to target nested children (e.g. 'Body/Head').",
    inputSchema: {
      type: "object",
      properties: {
        assetPath: { type: "string", description: "Asset path of the prefab (e.g. 'Assets/Prefabs/Player.prefab')" },
        prefabPath: { type: "string", description: "Path within the prefab hierarchy to the target GameObject (e.g. 'Body/Head'). Empty or omitted = prefab root." },
        componentType: { type: "string", description: "Component type name (e.g. 'MeshRenderer', 'PlayerController')" },
      },
      required: ["assetPath", "componentType"],
    },
    handler: async (params) => formatResult(await bridge.getPrefabAssetProperties(params)),
  },
  {
    name: "unity_prefab_set_property",
    description: "Set a serialized property value on a component inside a prefab asset â€” no scene instance needed. Supports floats, ints, strings, bools, vectors, colors, enums.",
    inputSchema: {
      type: "object",
      properties: {
        assetPath: { type: "string", description: "Asset path of the prefab (e.g. 'Assets/Prefabs/Player.prefab')" },
        prefabPath: { type: "string", description: "Path within the prefab hierarchy (e.g. 'Body/Head'). Empty = root." },
        componentType: { type: "string", description: "Component type name" },
        propertyName: { type: "string", description: "Name of the property to set" },
        value: { type: ["string", "number", "boolean", "object", "array", "null"], description: "Value to set (type depends on property)" },
      },
      required: ["assetPath", "componentType", "propertyName"],
    },
    handler: async (params) => formatResult(await bridge.setPrefabAssetProperty(params)),
  },
  {
    name: "unity_prefab_add_component",
    description: "Add a component to a GameObject inside a prefab asset â€” no scene instance needed. Supports built-in types (Rigidbody, BoxCollider, etc.) and custom scripts.",
    inputSchema: {
      type: "object",
      properties: {
        assetPath: { type: "string", description: "Asset path of the prefab" },
        prefabPath: { type: "string", description: "Path within the prefab hierarchy. Empty = root." },
        componentType: { type: "string", description: "Full type name (e.g. 'Rigidbody', 'BoxCollider', 'MyNamespace.MyScript')" },
      },
      required: ["assetPath", "componentType"],
    },
    handler: async (params) => formatResult(await bridge.addPrefabAssetComponent(params)),
  },
  {
    name: "unity_prefab_remove_component",
    description: "Remove a component from a GameObject inside a prefab asset â€” no scene instance needed.",
    inputSchema: {
      type: "object",
      properties: {
        assetPath: { type: "string", description: "Asset path of the prefab" },
        prefabPath: { type: "string", description: "Path within the prefab hierarchy. Empty = root." },
        componentType: { type: "string", description: "Component type name to remove" },
        index: { type: "number", description: "Index if multiple components of same type (default: 0)" },
      },
      required: ["assetPath", "componentType"],
    },
    handler: async (params) => formatResult(await bridge.removePrefabAssetComponent(params)),
  },
  {
    name: "unity_prefab_set_reference",
    description: "Wire an ObjectReference property on a component inside a prefab asset â€” no scene instance needed. Can reference project assets (materials, textures, prefabs, ScriptableObjects) or other GameObjects within the same prefab.",
    inputSchema: {
      type: "object",
      properties: {
        assetPath: { type: "string", description: "Asset path of the prefab" },
        prefabPath: { type: "string", description: "Path within the prefab hierarchy. Empty = root." },
        componentType: { type: "string", description: "Component type (optional â€” searches all if omitted)" },
        propertyName: { type: "string", description: "Name of the ObjectReference property to set" },
        referenceAssetPath: { type: "string", description: "Asset path of the reference target (e.g. 'Assets/Materials/Red.mat')" },
        referencePrefabPath: { type: "string", description: "Path to another GameObject within the same prefab (e.g. 'Body/Head')" },
        referenceComponentType: { type: "string", description: "Get a specific component on the referenced prefab GameObject" },
        clear: { type: "boolean", description: "Set to true to null out the reference" },
      },
      required: ["assetPath", "propertyName"],
    },
    handler: async (params) => formatResult(await bridge.setPrefabAssetReference(params)),
  },
  {
    name: "unity_prefab_add_gameobject",
    description: "Create a new child GameObject inside a prefab asset â€” no scene instance needed. Optionally create as a primitive (Cube, Sphere, etc.) with position/rotation/scale.",
    inputSchema: {
      type: "object",
      properties: {
        assetPath: { type: "string", description: "Asset path of the prefab" },
        prefabPath: { type: "string", description: "Parent path within the prefab hierarchy. Empty = add under root." },
        name: { type: "string", description: "Name for the new GameObject" },
        primitiveType: { type: "string", enum: ["Cube", "Sphere", "Capsule", "Cylinder", "Plane", "Quad"], description: "Optional primitive mesh type" },
        position: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } }, description: "Local position" },
        rotation: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } }, description: "Local rotation (Euler angles)" },
        scale: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } }, description: "Local scale" },
      },
      required: ["assetPath", "name"],
    },
    handler: async (params) => formatResult(await bridge.addPrefabAssetGameObject(params)),
  },
  {
    name: "unity_prefab_remove_gameobject",
    description: "Delete a child GameObject from inside a prefab asset â€” no scene instance needed. Cannot remove the prefab root.",
    inputSchema: {
      type: "object",
      properties: {
        assetPath: { type: "string", description: "Asset path of the prefab" },
        prefabPath: { type: "string", description: "Path to the child GameObject to remove (e.g. 'Body/OldPart'). Cannot be empty (can't delete root)." },
      },
      required: ["assetPath", "prefabPath"],
    },
    handler: async (params) => formatResult(await bridge.removePrefabAssetGameObject(params)),
  },

  // â”€â”€â”€ Prefab Variant Management â”€â”€â”€
  {
    name: "unity_prefab_variant_info",
    description: "Get variant information for a prefab asset: whether it's a variant, its base prefab path, and list all variants derived from a base prefab. Works on both base prefabs and variants.",
    inputSchema: {
      type: "object",
      properties: {
        assetPath: { type: "string", description: "Asset path of the prefab (base or variant), e.g. 'Assets/Prefabs/Player.prefab'" },
      },
      required: ["assetPath"],
    },
    handler: async (params) => formatResult(await bridge.getPrefabVariantInfo(params)),
  },
  {
    name: "unity_prefab_compare_variant",
    description: "Compare a prefab variant to its base prefab. Returns all overrides: modified properties, added/removed components, and added/removed GameObjects. The variant must be a Prefab Variant asset.",
    inputSchema: {
      type: "object",
      properties: {
        assetPath: { type: "string", description: "Asset path of the prefab variant to compare, e.g. 'Assets/Prefabs/PlayerVariant.prefab'" },
      },
      required: ["assetPath"],
    },
    handler: async (params) => formatResult(await bridge.comparePrefabVariantToBase(params)),
  },
  {
    name: "unity_prefab_apply_variant_override",
    description: "Apply overrides from a prefab variant back to its base prefab. Can apply all overrides or filter by componentType and/or gameObject path. This pushes the variant's changes into the base so all variants see them.",
    inputSchema: {
      type: "object",
      properties: {
        assetPath: { type: "string", description: "Asset path of the prefab variant whose overrides to apply" },
        componentType: { type: "string", description: "Optional: only apply overrides for this component type (e.g. 'MeshRenderer')" },
        gameObject: { type: "string", description: "Optional: only apply overrides on this GameObject path within the prefab (e.g. 'Body/Head')" },
        applyAll: { type: "boolean", description: "If true, apply ALL overrides to the base. Default false." },
      },
      required: ["assetPath"],
    },
    handler: async (params) => formatResult(await bridge.applyPrefabVariantOverride(params)),
  },
  {
    name: "unity_prefab_revert_variant_override",
    description: "Revert overrides on a prefab variant so it matches its base prefab again. Can revert all overrides or filter by componentType and/or gameObject path.",
    inputSchema: {
      type: "object",
      properties: {
        assetPath: { type: "string", description: "Asset path of the prefab variant to revert" },
        componentType: { type: "string", description: "Optional: only revert overrides for this component type" },
        gameObject: { type: "string", description: "Optional: only revert overrides on this GameObject path within the prefab" },
        revertAll: { type: "boolean", description: "If true, revert ALL overrides. Default false." },
      },
      required: ["assetPath"],
    },
    handler: async (params) => formatResult(await bridge.revertPrefabVariantOverride(params)),
  },
  {
    name: "unity_prefab_transfer_variant_overrides",
    description: "Transfer (copy) overrides from one prefab variant to another variant of the same base. Reads the property modifications from the source variant and applies them to the target variant.",
    inputSchema: {
      type: "object",
      properties: {
        sourceAssetPath: { type: "string", description: "Asset path of the source prefab variant to copy overrides from" },
        targetAssetPath: { type: "string", description: "Asset path of the target prefab variant to apply overrides to" },
      },
      required: ["sourceAssetPath", "targetAssetPath"],
    },
    handler: async (params) => formatResult(await bridge.transferPrefabVariantOverrides(params)),
  },

  // â”€â”€â”€ Physics â”€â”€â”€
  {
    name: "unity_physics_raycast",
    description: "Cast a ray in the physics world and return hit information. Supports single or all-hits mode.",
    inputSchema: {
      type: "object",
      properties: {
        origin: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } }, description: "Ray origin point" },
        direction: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } }, description: "Ray direction" },
        maxDistance: { type: "number", description: "Maximum ray distance (default: Infinity)" },
        layerMask: { type: "number", description: "Layer mask for filtering (default: all layers)" },
        all: { type: "boolean", description: "If true, return all hits instead of just the first" },
      },
      required: ["origin", "direction"],
    },
    handler: async (params) => formatResult(await bridge.physicsRaycast(params)),
  },
  {
    name: "unity_physics_overlap_sphere",
    description: "Find all colliders within a sphere. Useful for area-of-effect queries.",
    inputSchema: {
      type: "object",
      properties: {
        center: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } }, description: "Sphere center" },
        radius: { type: "number", description: "Sphere radius (default: 1)" },
        layerMask: { type: "number", description: "Layer mask for filtering" },
      },
      required: ["center", "radius"],
    },
    handler: async (params) => formatResult(await bridge.physicsOverlapSphere(params)),
  },
  {
    name: "unity_physics_overlap_box",
    description: "Find all colliders within a box volume.",
    inputSchema: {
      type: "object",
      properties: {
        center: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } }, description: "Box center" },
        halfExtents: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } }, description: "Box half extents" },
        layerMask: { type: "number", description: "Layer mask for filtering" },
      },
      required: ["center", "halfExtents"],
    },
    handler: async (params) => formatResult(await bridge.physicsOverlapBox(params)),
  },
  {
    name: "unity_physics_collision_matrix",
    description: "Get the physics collision matrix showing which layers collide with each other.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => formatResult(await bridge.getCollisionMatrix(params)),
  },
  {
    name: "unity_physics_set_collision_layer",
    description: "Set whether two physics layers should collide or ignore each other.",
    inputSchema: {
      type: "object",
      properties: {
        layer1: { type: "number", description: "First layer index" },
        layer2: { type: "number", description: "Second layer index" },
        layer1Name: { type: "string", description: "First layer name (alternative to index)" },
        layer2Name: { type: "string", description: "Second layer name (alternative to index)" },
        ignore: { type: "boolean", description: "If true, layers will ignore each other (default: true)" },
      },
    },
    handler: async (params) => formatResult(await bridge.setCollisionLayer(params)),
  },
  {
    name: "unity_physics_set_gravity",
    description: "Get or set the global physics gravity vector.",
    inputSchema: {
      type: "object",
      properties: {
        gravity: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } }, description: "New gravity vector (omit to just read current)" },
      },
    },
    handler: async (params) => formatResult(await bridge.setGravity(params)),
  },

  // â”€â”€â”€ Lighting â”€â”€â”€
  {
    name: "unity_lighting_info",
    description: "Get info about all lights in the scene plus environment/fog settings.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => formatResult(await bridge.getLightingInfo(params)),
  },
  {
    name: "unity_lighting_create",
    description: "Create a new light in the scene (Point, Directional, Spot, or Area).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Light name" },
        lightType: { type: "string", enum: ["Point", "Directional", "Spot", "Area"], description: "Light type" },
        color: { type: "object", properties: { r: { type: "number" }, g: { type: "number" }, b: { type: "number" }, a: { type: "number" } }, description: "Light color (0-1)" },
        intensity: { type: "number", description: "Light intensity" },
        range: { type: "number", description: "Light range (Point/Spot)" },
        spotAngle: { type: "number", description: "Spot angle in degrees (Spot only)" },
        shadows: { type: "string", enum: ["None", "Hard", "Soft"], description: "Shadow type" },
        position: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } } },
        rotation: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } } },
      },
    },
    handler: async (params) => formatResult(await bridge.createLight(params)),
  },
  {
    name: "unity_lighting_set_environment",
    description: "Set environment lighting: ambient mode/color, fog, skybox material.",
    inputSchema: {
      type: "object",
      properties: {
        ambientMode: { type: "string", enum: ["Skybox", "Trilight", "Flat", "Custom"], description: "Ambient lighting mode" },
        ambientColor: { type: "object", properties: { r: { type: "number" }, g: { type: "number" }, b: { type: "number" }, a: { type: "number" } }, description: "Ambient light color" },
        ambientIntensity: { type: "number", description: "Ambient intensity multiplier" },
        fogEnabled: { type: "boolean", description: "Enable/disable fog" },
        fogColor: { type: "object", properties: { r: { type: "number" }, g: { type: "number" }, b: { type: "number" }, a: { type: "number" } }, description: "Fog color" },
        fogDensity: { type: "number", description: "Fog density (Exponential mode)" },
        fogMode: { type: "string", enum: ["Linear", "Exponential", "ExponentialSquared"], description: "Fog mode" },
        skyboxMaterialPath: { type: "string", description: "Asset path to skybox material" },
      },
    },
    handler: async (params) => formatResult(await bridge.setEnvironment(params)),
  },
  {
    name: "unity_lighting_create_reflection_probe",
    description: "Create a reflection probe in the scene.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Probe name" },
        position: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } } },
        size: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } }, description: "Probe bounds size" },
        resolution: { type: "integer", description: "Cubemap resolution (128, 256, 512, 1024)" },
        mode: { type: "string", enum: ["Baked", "Realtime", "Custom"], description: "Probe mode" },
      },
    },
    handler: async (params) => formatResult(await bridge.createReflectionProbe(params)),
  },
  {
    name: "unity_lighting_create_light_probe_group",
    description: "Create a light probe group in the scene.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Probe group name" },
        position: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } } },
      },
    },
    handler: async (params) => formatResult(await bridge.createLightProbeGroup(params)),
  },

  // â”€â”€â”€ Audio â”€â”€â”€
  {
    name: "unity_audio_info",
    description: "Get info about all AudioSources and AudioListeners in the scene.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => formatResult(await bridge.getAudioInfo(params)),
  },
  {
    name: "unity_audio_create_source",
    description: "Create or configure an AudioSource on a GameObject. Can attach to existing object or create new one.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name for new GameObject (if not attaching to existing)" },
        path: { type: "string", description: "Path of existing GameObject to attach AudioSource to" },
        instanceId: { type: "string", description: "Instance ID of existing GameObject" },
        clipPath: { type: "string", description: "Asset path to AudioClip (e.g. 'Assets/Audio/music.wav')" },
        volume: { type: "number", description: "Volume (0-1)" },
        pitch: { type: "number", description: "Pitch multiplier" },
        loop: { type: "boolean", description: "Loop playback" },
        playOnAwake: { type: "boolean", description: "Play when scene starts" },
        spatialBlend: { type: "number", description: "0=2D, 1=3D" },
        minDistance: { type: "number", description: "Min distance for 3D sound" },
        maxDistance: { type: "number", description: "Max distance for 3D sound" },
        position: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } } },
      },
    },
    handler: async (params) => formatResult(await bridge.createAudioSource(params)),
  },
  {
    name: "unity_audio_set_global",
    description: "Set global audio settings (master volume, pause).",
    inputSchema: {
      type: "object",
      properties: {
        volume: { type: "number", description: "Global volume (0-1)" },
        pause: { type: "boolean", description: "Pause/unpause all audio" },
      },
    },
    handler: async (params) => formatResult(await bridge.setGlobalAudio(params)),
  },

  // â”€â”€â”€ Tags & Layers â”€â”€â”€
  {
    name: "unity_taglayer_info",
    description: "Get all tags, layers, and sorting layers in the project.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => formatResult(await bridge.getTagsAndLayers(params)),
  },
  {
    name: "unity_taglayer_add_tag",
    description: "Add a new tag to the project.",
    inputSchema: {
      type: "object",
      properties: {
        tag: { type: "string", description: "Tag name to add" },
      },
      required: ["tag"],
    },
    handler: async (params) => formatResult(await bridge.addTag(params)),
  },
  {
    name: "unity_taglayer_set_tag",
    description: "Assign a tag to a GameObject.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "GameObject path" },
        instanceId: { type: "string", description: "GameObject instance ID" },
        tag: { type: "string", description: "Tag to assign" },
      },
      required: ["tag"],
    },
    handler: async (params) => formatResult(await bridge.setTag(params)),
  },
  {
    name: "unity_taglayer_set_layer",
    description: "Assign a layer to a GameObject, optionally including children.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "GameObject path" },
        instanceId: { type: "string", description: "GameObject instance ID" },
        layer: { type: "integer", description: "Layer index (0-31)" },
        layerName: { type: "string", description: "Layer name (alternative to index)" },
        includeChildren: { type: "boolean", description: "Apply to all children recursively" },
      },
    },
    handler: async (params) => formatResult(await bridge.setLayer(params)),
  },
  {
    name: "unity_taglayer_set_static",
    description: "Set a GameObject as static or not, optionally including children.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "GameObject path" },
        instanceId: { type: "string", description: "GameObject instance ID" },
        isStatic: { type: "boolean", description: "True to mark static" },
        includeChildren: { type: "boolean", description: "Apply to all children recursively" },
      },
    },
    handler: async (params) => formatResult(await bridge.setStatic(params)),
  },

  // â”€â”€â”€ Selection & Scene View â”€â”€â”€
  {
    name: "unity_selection_get",
    description: "Get the currently selected GameObjects in the Unity Editor.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => formatResult(await bridge.getSelection(params)),
  },
  {
    name: "unity_selection_set",
    description: "Set the editor selection to specific GameObjects.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Single GameObject path to select" },
        paths: { type: "array", items: { type: "string" }, description: "Multiple GameObject paths to select" },
        instanceId: { type: "string", description: "Instance ID of GameObject to select" },
      },
    },
    handler: async (params) => formatResult(await bridge.setSelection(params)),
  },
  {
    name: "unity_selection_focus_scene_view",
    description: "Control the Scene View camera: frame a GameObject, set pivot/rotation/zoom, toggle orthographic.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "GameObject to frame in scene view" },
        instanceId: { type: "string", description: "Instance ID of GameObject to frame" },
        position: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } }, description: "Scene view pivot position" },
        rotation: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } }, description: "Scene view rotation (euler angles)" },
        size: { type: "number", description: "Scene view zoom (camera distance)" },
        orthographic: { type: "boolean", description: "Toggle orthographic/perspective" },
      },
    },
    handler: async (params) => formatResult(await bridge.focusSceneView(params)),
  },
  {
    name: "unity_selection_find_by_type",
    description: "Find all GameObjects in the scene that have a specific component type (e.g. 'Rigidbody', 'Camera', 'Light', 'AudioSource', or custom scripts).",
    inputSchema: {
      type: "object",
      properties: {
        typeName: { type: "string", description: "Component type name (e.g. 'Rigidbody', 'Camera', 'MyScript')" },
      },
      required: ["typeName"],
    },
    handler: async (params) => formatResult(await bridge.findObjectsByType(params)),
  },

  // â”€â”€â”€ Agent Management â”€â”€â”€
  {
    // â”€â”€â”€ Input Actions â”€â”€â”€
    name: "unity_input_create",
    description: "Create a new Input Action Asset (.inputactions file) for Unity's Input System. Supports optional initial action maps.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path (e.g. 'Assets/Settings/Controls.inputactions')" },
        name: { type: "string", description: "Asset name (defaults to filename)" },
        maps: {
          type: "array",
          description: "Optional initial action maps to create",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Action map name (e.g. 'Gameplay', 'UI')" },
            },
          },
        },
      },
      required: ["path"],
    },
    handler: async (params) => formatResult(await bridge.createInputActions(params)),
  },
  {
    name: "unity_input_info",
    description: "Get detailed info about an Input Action Asset: maps, actions, bindings, and control schemes.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path of the .inputactions file" },
      },
      required: ["path"],
    },
    handler: async (params) => formatResult(await bridge.getInputActionsInfo(params)),
  },
  {
    name: "unity_input_add_map",
    description: "Add a new action map to an Input Action Asset.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path of the .inputactions file" },
        mapName: { type: "string", description: "Name of the action map to add (e.g. 'Gameplay', 'UI')" },
      },
      required: ["path", "mapName"],
    },
    handler: async (params) => formatResult(await bridge.addInputActionMap(params)),
  },
  {
    name: "unity_input_remove_map",
    description: "Remove an action map from an Input Action Asset.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path of the .inputactions file" },
        mapName: { type: "string", description: "Name of the action map to remove" },
      },
      required: ["path", "mapName"],
    },
    handler: async (params) => formatResult(await bridge.removeInputActionMap(params)),
  },
  {
    name: "unity_input_add_action",
    description: "Add an action to an action map in an Input Action Asset.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path of the .inputactions file" },
        mapName: { type: "string", description: "Name of the action map" },
        actionName: { type: "string", description: "Name of the action (e.g. 'Move', 'Jump', 'Fire')" },
        actionType: { type: "string", enum: ["Value", "Button", "PassThrough"], description: "Action type (default: Value)" },
        expectedControlType: { type: "string", description: "Expected control type (e.g. 'Vector2', 'Axis', 'Button')" },
      },
      required: ["path", "mapName", "actionName"],
    },
    handler: async (params) => formatResult(await bridge.addInputAction(params)),
  },
  {
    name: "unity_input_remove_action",
    description: "Remove an action (and its bindings) from an action map.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path of the .inputactions file" },
        mapName: { type: "string", description: "Name of the action map" },
        actionName: { type: "string", description: "Name of the action to remove" },
      },
      required: ["path", "mapName", "actionName"],
    },
    handler: async (params) => formatResult(await bridge.removeInputAction(params)),
  },
  {
    name: "unity_input_add_binding",
    description: "Add a simple (non-composite) binding to an action. Use for single-key bindings like '<Keyboard>/space' or '<Gamepad>/buttonSouth'.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path of the .inputactions file" },
        mapName: { type: "string", description: "Name of the action map" },
        actionName: { type: "string", description: "Name of the action to bind to" },
        bindingPath: { type: "string", description: "Input binding path (e.g. '<Keyboard>/space', '<Gamepad>/leftStick')" },
      },
      required: ["path", "mapName", "actionName", "bindingPath"],
    },
    handler: async (params) => formatResult(await bridge.addInputBinding(params)),
  },
  {
    name: "unity_input_add_composite_binding",
    description: "Add a composite binding (e.g. WASD, arrows) to an action. Composites combine multiple keys into a single value (1DAxis for up/down, 2DVector for WASD).",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path of the .inputactions file" },
        mapName: { type: "string", description: "Name of the action map" },
        actionName: { type: "string", description: "Name of the action to bind to" },
        compositeName: { type: "string", description: "Display name for the composite (e.g. 'WASD', 'Arrows')" },
        compositeType: { type: "string", description: "Composite type path: '1DAxis' for pos/neg axis, '2DVector' for 4-directional (default: '1DAxis')" },
        parts: {
          type: "array",
          description: "Composite parts â€” each has a 'name' (e.g. 'positive','negative','up','down','left','right') and 'path' (e.g. '<Keyboard>/w')",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Part name: 'positive'/'negative' for 1DAxis, 'up'/'down'/'left'/'right' for 2DVector" },
              path: { type: "string", description: "Input binding path for this part (e.g. '<Keyboard>/w')" },
            },
            required: ["name", "path"],
          },
        },
      },
      required: ["path", "mapName", "actionName", "compositeName", "parts"],
    },
    handler: async (params) => formatResult(await bridge.addInputCompositeBinding(params)),
  },

  // â”€â”€â”€ Assembly Definitions â”€â”€â”€
  {
    name: "unity_asmdef_create",
    description: "Create a new Assembly Definition (.asmdef) file for code containerisation and compilation optimisation. Assembly definitions split your project code into separate assemblies, reducing recompilation time and enforcing clean dependency boundaries.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path for the .asmdef file (e.g. 'Assets/Scripts/Runtime/MyGame.Runtime.asmdef')" },
        name: { type: "string", description: "Assembly name (defaults to filename). Convention: 'Company.Product.Layer' (e.g. 'MyGame.Runtime', 'MyGame.Editor')" },
        rootNamespace: { type: "string", description: "Root namespace for scripts in this assembly (e.g. 'MyGame.Runtime')" },
        references: {
          type: "array",
          description: "Assembly references â€” names (e.g. 'Unity.TextMeshPro') or GUID refs (e.g. 'GUID:xxx')",
          items: { type: "string" },
        },
        includePlatforms: {
          type: "array",
          description: "Only compile for these platforms. Common: 'Editor', 'Android', 'iOS', 'StandaloneWindows64', 'StandaloneOSX', 'StandaloneLinux64', 'WebGL'",
          items: { type: "string" },
        },
        excludePlatforms: {
          type: "array",
          description: "Compile for all platforms EXCEPT these",
          items: { type: "string" },
        },
        allowUnsafeCode: { type: "boolean", description: "Allow unsafe C# code blocks (default: false)" },
        autoReferenced: { type: "boolean", description: "Automatically referenced by predefined assemblies (default: true)" },
        noEngineReferences: { type: "boolean", description: "Don't reference UnityEngine (for pure C# libraries, default: false)" },
        overrideReferences: { type: "boolean", description: "Override precompiled references (default: false)" },
        precompiledReferences: {
          type: "array",
          description: "Precompiled DLL references (when overrideReferences is true)",
          items: { type: "string" },
        },
        defineConstraints: {
          type: "array",
          description: "Define constraints â€” assembly only compiles when ALL symbols are defined (e.g. 'UNITY_EDITOR', 'ENABLE_INPUT_SYSTEM')",
          items: { type: "string" },
        },
      },
      required: ["path"],
    },
    handler: async (params) => formatResult(await bridge.createAssemblyDef(params)),
  },
  {
    name: "unity_asmdef_info",
    description: "Get detailed info about an Assembly Definition file: name, references, platforms, settings.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path of the .asmdef file" },
      },
      required: ["path"],
    },
    handler: async (params) => formatResult(await bridge.getAssemblyDefInfo(params)),
  },
  {
    name: "unity_asmdef_list",
    description: "List all Assembly Definition files in the project. Returns name, path, reference count, and platform info for each.",
    inputSchema: {
      type: "object",
      properties: {
        folder: { type: "string", description: "Folder to search in (default: 'Assets')" },
        includePackages: { type: "boolean", description: "Also list assembly definitions from Packages/ (default: false)" },
      },
    },
    handler: async (params) => formatResult(await bridge.listAssemblyDefs(params)),
  },
  {
    name: "unity_asmdef_add_references",
    description: "Add assembly references to an existing .asmdef file. Supports assembly names (e.g. 'Unity.TextMeshPro') which are auto-resolved to GUID format, or direct GUID refs.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path of the .asmdef file to modify" },
        references: {
          type: "array",
          description: "Assembly names or GUID references to add (e.g. ['Unity.TextMeshPro', 'MyGame.Core'])",
          items: { type: "string" },
        },
      },
      required: ["path", "references"],
    },
    handler: async (params) => formatResult(await bridge.addAssemblyDefReferences(params)),
  },
  {
    name: "unity_asmdef_remove_references",
    description: "Remove assembly references from an existing .asmdef file.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path of the .asmdef file to modify" },
        references: {
          type: "array",
          description: "Assembly names or GUID references to remove",
          items: { type: "string" },
        },
      },
      required: ["path", "references"],
    },
    handler: async (params) => formatResult(await bridge.removeAssemblyDefReferences(params)),
  },
  {
    name: "unity_asmdef_set_platforms",
    description: "Set the include/exclude platform lists for an assembly definition. Use includePlatforms to restrict to specific platforms (e.g. ['Editor'] for editor-only code) or excludePlatforms to exclude certain platforms.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path of the .asmdef file" },
        includePlatforms: {
          type: "array",
          description: "Only compile for these platforms (e.g. ['Editor']). Clears excludePlatforms if set.",
          items: { type: "string" },
        },
        excludePlatforms: {
          type: "array",
          description: "Compile for all platforms except these",
          items: { type: "string" },
        },
      },
      required: ["path"],
    },
    handler: async (params) => formatResult(await bridge.setAssemblyDefPlatforms(params)),
  },
  {
    name: "unity_asmdef_update_settings",
    description: "Update settings on an assembly definition: rootNamespace, allowUnsafeCode, autoReferenced, noEngineReferences, defineConstraints, etc. Only supply the properties you want to change.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path of the .asmdef file" },
        name: { type: "string", description: "New assembly name" },
        rootNamespace: { type: "string", description: "New root namespace" },
        allowUnsafeCode: { type: "boolean", description: "Allow unsafe code" },
        overrideReferences: { type: "boolean", description: "Override precompiled references" },
        autoReferenced: { type: "boolean", description: "Auto-referenced by predefined assemblies" },
        noEngineReferences: { type: "boolean", description: "No UnityEngine references" },
        defineConstraints: {
          type: "array",
          description: "Define constraints (symbols required for compilation)",
          items: { type: "string" },
        },
        precompiledReferences: {
          type: "array",
          description: "Precompiled DLL references",
          items: { type: "string" },
        },
      },
      required: ["path"],
    },
    handler: async (params) => formatResult(await bridge.updateAssemblyDefSettings(params)),
  },
  {
    name: "unity_asmdef_create_ref",
    description: "Create an Assembly Definition Reference (.asmref) file. This lets you include scripts from a different folder into an existing assembly, useful for extending packages or splitting code across directories while keeping them in the same compilation unit.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path for the .asmref file (e.g. 'Assets/Plugins/Extension/MyGame.Runtime.asmref')" },
        reference: { type: "string", description: "Name of the target assembly definition to reference (e.g. 'MyGame.Runtime')" },
      },
      required: ["path", "reference"],
    },
    handler: async (params) => formatResult(await bridge.createAssemblyRef(params)),
  },

  // â”€â”€â”€ Profiler â”€â”€â”€
  {
    name: "unity_profiler_enable",
    description: "Enable or disable the Unity Profiler. Optionally enable deep profiling for detailed call stacks (has significant performance overhead).",
    inputSchema: {
      type: "object",
      properties: {
        enabled: { type: "boolean", description: "true to start profiling, false to stop" },
        deepProfile: { type: "boolean", description: "Enable deep profiling for full call stacks (high overhead, default: false)" },
      },
      required: ["enabled"],
    },
    handler: async (params) => formatResult(await bridge.enableProfiler(params)),
  },
  {
    name: "unity_profiler_stats",
    description: "Get current rendering statistics: draw calls, batches, triangles, vertices, set-pass calls, frame time, render time, shadow casters, and more. The profiler does NOT need to be enabled for this â€” stats come from UnityStats which is always available.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => formatResult(await bridge.getRenderingStats(params)),
  },
  {
    name: "unity_profiler_memory",
    description: "Get detailed memory usage breakdown: total allocated, reserved, Mono heap used/size, graphics driver memory, temp allocator size, and GC info. Values are returned in both bytes and human-readable MB.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => formatResult(await bridge.getMemoryInfo(params)),
  },
  {
    name: "unity_profiler_frame_data",
    description: "Get CPU profiler frame data as a hierarchical timing breakdown. Shows function names, total/self time, call counts, and GC allocations. The profiler must be enabled and have captured at least one frame.",
    inputSchema: {
      type: "object",
      properties: {
        frameIndex: { type: "number", description: "Frame index to read (-1 for latest, default: -1)" },
        threadIndex: { type: "number", description: "Thread index (0 = main thread, default: 0)" },
        maxDepth: { type: "number", description: "Maximum hierarchy depth to traverse (default: 5)" },
        minTimeMs: { type: "number", description: "Minimum total time in ms to include an item (default: 0.1)" },
      },
    },
    handler: async (params) => formatResult(await bridge.getProfilerFrameData(params)),
  },
  {
    name: "unity_profiler_analyze",
    description: "Run a comprehensive performance analysis combining memory, rendering stats, profiler frame data, and scene complexity. Returns optimization suggestions based on configurable thresholds (e.g. too many batches, high triangle count, excessive set-pass calls, GPU memory usage, shadow casters).",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => formatResult(await bridge.analyzePerformance(params)),
  },

  // â”€â”€â”€ Frame Debugger â”€â”€â”€
  {
    name: "unity_debugger_enable",
    description: "Enable or disable the Frame Debugger. When enabled, Unity pauses rendering after a specific draw call so you can inspect the GPU state. Uses reflection to access internal Unity APIs (Unity 6+).",
    inputSchema: {
      type: "object",
      properties: {
        enabled: { type: "boolean", description: "true to enable, false to disable the Frame Debugger" },
      },
      required: ["enabled"],
    },
    handler: async (params) => formatResult(await bridge.enableFrameDebugger(params)),
  },
  {
    name: "unity_debugger_events",
    description: "List all rendering events (draw calls) captured by the Frame Debugger. The Frame Debugger must be enabled first. Returns event index, type, and name for each draw call.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => formatResult(await bridge.getFrameDebuggerEvents(params)),
  },
  {
    name: "unity_debugger_event_details",
    description: "Get detailed information about a specific Frame Debugger event: shader name, pass, keywords, vertex/index/instance counts, render target, batch break cause, and mesh info. The Frame Debugger must be enabled first.",
    inputSchema: {
      type: "object",
      properties: {
        eventIndex: { type: "number", description: "The event index to inspect (from unity_debugger_events list)" },
      },
      required: ["eventIndex"],
    },
    handler: async (params) => formatResult(await bridge.getFrameDebuggerEventDetails(params)),
  },

  // â”€â”€â”€ Memory Profiler â”€â”€â”€
  {
    name: "unity_memory_status",
    description: "Check Memory Profiler status: whether the com.unity.memoryprofiler package is installed, available commands, and a quick memory summary. Always call this first before other memory profiler commands.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => formatResult(await bridge.getMemoryStatus(params)),
  },
  {
    name: "unity_memory_breakdown",
    description: "Get detailed memory breakdown by asset type: textures, meshes, materials, shaders, audio clips, animation clips, fonts, render textures, and scriptable objects. Shows count, total size, and optionally top assets per category. Works without the Memory Profiler package (uses built-in Profiler APIs).",
    inputSchema: {
      type: "object",
      properties: {
        includeDetails: { type: "boolean", description: "If true, include top assets per category with names, sizes, and asset paths (default: false)" },
        maxPerCategory: { type: "number", description: "Max assets to list per category when includeDetails=true (default: 5)" },
      },
    },
    handler: async (params) => formatResult(await bridge.getMemoryBreakdown(params)),
  },
  {
    name: "unity_memory_top_assets",
    description: "Get the top N memory-consuming assets across all types. Shows asset name, type, size, and asset path. Optionally filter by type (texture, mesh, audio, material, shader, animation, font, rendertexture). Works without the Memory Profiler package.",
    inputSchema: {
      type: "object",
      properties: {
        count: { type: "number", description: "Number of top assets to return (default: 20)" },
        type: { type: "string", description: "Filter by asset type: texture, rendertexture, mesh, audio, material, shader, animation, font (default: all)" },
      },
    },
    handler: async (params) => formatResult(await bridge.getTopMemoryConsumers(params)),
  },
  {
    name: "unity_memory_snapshot",
    description: "Take a detailed memory snapshot using the Memory Profiler package (com.unity.memoryprofiler). Requires the package to be installed. The snapshot can be inspected in the Memory Profiler window. Returns an error with alternatives if the package is not installed.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory to save snapshot in (default: temp cache)" },
      },
    },
    handler: async (params) => formatResult(await bridge.takeMemorySnapshot(params)),
  },

  // â”€â”€â”€ Shader Graph â”€â”€â”€
  {
    name: "unity_shadergraph_status",
    description: "Check which graph packages are installed: Shader Graph (com.unity.shadergraph) and Visual Effect Graph (com.unity.visualeffectgraph). Returns available commands based on installed packages.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => formatResult(await bridge.getShaderGraphStatus(params)),
  },
  {
    name: "unity_shader_list",
    description: "List all shaders in the project (both .shader and .shadergraph files). Works without Shader Graph package. Filter by name, include/exclude built-in shaders.",
    inputSchema: {
      type: "object",
      properties: {
        filter: { type: "string", description: "Filter shaders by name or path (case-insensitive)" },
        includeBuiltin: { type: "boolean", description: "Include Unity built-in shaders (default: false)" },
        maxResults: { type: "number", description: "Maximum results to return (default: 100)" },
      },
    },
    handler: async (params) => formatResult(await bridge.listShaders(params)),
  },
  {
    name: "unity_shadergraph_list",
    description: "List all Shader Graph (.shadergraph) assets in the project. Requires Shader Graph package. Shows shader name, path, property count, pass count, and file size.",
    inputSchema: {
      type: "object",
      properties: {
        filter: { type: "string", description: "Filter by name or path" },
        maxResults: { type: "number", description: "Maximum results (default: 100)" },
      },
    },
    handler: async (params) => formatResult(await bridge.listShaderGraphs(params)),
  },
  {
    name: "unity_shadergraph_info",
    description: "Get detailed info about a specific shader graph: exposed properties (with types, ranges), node count, features used (custom functions, sub-graphs, keywords), file size, pass count.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path of the .shadergraph file" },
      },
      required: ["path"],
    },
    handler: async (params) => formatResult(await bridge.getShaderGraphInfo(params)),
  },
  {
    name: "unity_shader_get_properties",
    description: "Get exposed properties of any shader (.shader or .shadergraph). Shows property name, display name, type (Color, Vector, Float, Range, TexEnv), range limits, texture dimension, visibility.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path of the shader" },
        shaderName: { type: "string", description: "Shader name (e.g. 'Universal Render Pipeline/Lit'). Alternative to path." },
      },
    },
    handler: async (params) => formatResult(await bridge.getShaderProperties(params)),
  },
  {
    name: "unity_shadergraph_create",
    description: "Create a new Shader Graph from a template. Templates: urp_lit, urp_unlit, urp_sprite_lit, urp_sprite_unlit, urp_decal, hdrp_lit, hdrp_unlit, blank. Requires Shader Graph package.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path for the new shader graph (e.g. 'Assets/Shaders/MyShader.shadergraph')" },
        template: { type: "string", description: "Template: urp_lit, urp_unlit, urp_sprite_lit, urp_sprite_unlit, or blank (target-less). Default urp_lit. Builds a valid graph via the real ShaderGraph API." },
        overwrite: { type: "boolean", description: "Replace an existing graph at this path (default false: refuse)." },
      },
      required: ["path"],
    },
    handler: async (params) => formatResult(await bridge.createShaderGraph(params)),
  },
  {
    name: "unity_shadergraph_open",
    description: "Open a shader graph in the Shader Graph editor window for visual editing. Requires Shader Graph package.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path of the .shadergraph file" },
      },
      required: ["path"],
    },
    handler: async (params) => formatResult(await bridge.openShaderGraph(params)),
  },
  {
    name: "unity_shadergraph_list_subgraphs",
    description: "List all Sub Graph (.shadersubgraph) assets in the project. Sub Graphs are reusable node groups for Shader Graphs. Requires Shader Graph package.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => formatResult(await bridge.listSubGraphs(params)),
  },
  {
    name: "unity_vfx_list",
    description: "List all Visual Effect Graph assets in the project. Requires Visual Effect Graph package (com.unity.visualeffectgraph).",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => formatResult(await bridge.listVFXGraphs(params)),
  },
  {
    name: "unity_vfx_open",
    description: "Open a Visual Effect Graph in the VFX Graph editor window. Requires Visual Effect Graph package.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path of the VFX Graph asset" },
      },
      required: ["path"],
    },
    handler: async (params) => formatResult(await bridge.openVFXGraph(params)),
  },
  {
    name: "unity_shadergraph_get_nodes",
    description: "Get all nodes in a Shader Graph file. Returns node IDs, types, positions, and basic property data by parsing the .shadergraph JSON. Essential for understanding graph structure before editing.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path of the .shadergraph file" },
      },
      required: ["path"],
    },
    handler: async (params) => formatResult(await bridge.getShaderGraphNodes(params)),
  },
  {
    name: "unity_shadergraph_get_edges",
    description: "Get all edges (connections) in a Shader Graph. Returns source and target node IDs with slot IDs, showing how nodes are wired together.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path of the .shadergraph file" },
      },
      required: ["path"],
    },
    handler: async (params) => formatResult(await bridge.getShaderGraphEdges(params)),
  },
  {
    name: "unity_shadergraph_add_node",
    description: "Add a new node to a Shader Graph. Supports common types: Add, Multiply, Subtract, Divide, Lerp, Color, Float, Vector2, Vector3, Vector4, Time, UV, Position, Normal, SampleTexture2D, Fresnel, Saturate, OneMinus, Power, Split, Combine. Also supports any type by full class name.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path of the .shadergraph file" },
        nodeType: { type: "string", description: "Node type name (e.g., 'Add', 'Multiply', 'Color', 'SampleTexture2D') or full class name" },
        positionX: { type: "number", description: "X position in the graph (default 0)" },
        positionY: { type: "number", description: "Y position in the graph (default 0)" },
      },
      required: ["path", "nodeType"],
    },
    handler: async (params) => formatResult(await bridge.addShaderGraphNode(params)),
  },
  {
    name: "unity_shadergraph_remove_node",
    description: "Remove a node from a Shader Graph by its ID. Also removes all edges connected to the node.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path of the .shadergraph file" },
        nodeId: { type: "string", description: "The node's objectId (GUID) to remove â€” get from get_nodes" },
      },
      required: ["path", "nodeId"],
    },
    handler: async (params) => formatResult(await bridge.removeShaderGraphNode(params)),
  },
  {
    name: "unity_shadergraph_connect",
    description: "Connect two nodes in a Shader Graph by creating an edge between an output slot and an input slot.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path of the .shadergraph file" },
        outputNodeId: { type: "string", description: "Source node objectId" },
        outputSlotId: { type: "number", description: "Output slot ID on the source node" },
        inputNodeId: { type: "string", description: "Target node objectId" },
        inputSlotId: { type: "number", description: "Input slot ID on the target node" },
      },
      required: ["path", "outputNodeId", "outputSlotId", "inputNodeId", "inputSlotId"],
    },
    handler: async (params) => formatResult(await bridge.connectShaderGraphNodes(params)),
  },
  {
    name: "unity_shadergraph_disconnect",
    description: "Disconnect two nodes in a Shader Graph by removing the edge between them.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path of the .shadergraph file" },
        outputNodeId: { type: "string", description: "Source node objectId" },
        outputSlotId: { type: "number", description: "Output slot ID" },
        inputNodeId: { type: "string", description: "Target node objectId" },
        inputSlotId: { type: "number", description: "Input slot ID" },
      },
      required: ["path", "outputNodeId", "outputSlotId", "inputNodeId", "inputSlotId"],
    },
    handler: async (params) => formatResult(await bridge.disconnectShaderGraphNodes(params)),
  },
  {
    name: "unity_shadergraph_set_node_property",
    description: "Set a property value on a Shader Graph node. Can modify any serialized property like color values, float inputs, vector components, etc.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path of the .shadergraph file" },
        nodeId: { type: "string", description: "Target node objectId" },
        propertyName: { type: "string", description: "Property name in the serialized JSON (e.g., 'm_Value', 'm_DefaultValue')" },
        value: { type: ["string", "number", "boolean"], description: "New value â€” string, number, or boolean depending on the property" },
      },
      required: ["path", "nodeId", "propertyName", "value"],
    },
    handler: async (params) => formatResult(await bridge.setShaderGraphNodeProperty(params)),
  },
  {
    name: "unity_shadergraph_get_node_types",
    description: "List all available Shader Graph node types by reflecting over the ShaderGraph assembly. Returns type names, categories, and full class names. Useful for discovering available nodes before adding them.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => formatResult(await bridge.getShaderGraphNodeTypes(params)),
  },

  // â”€â”€â”€ Amplify Shader Editor â”€â”€â”€
  {
    name: "unity_amplify_status",
    description: "Check if Amplify Shader Editor is installed in the project. Returns available commands, shader count, and function count. Only works when Amplify Shader Editor is imported.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => formatResult(await bridge.getAmplifyStatus(params)),
  },
  {
    name: "unity_amplify_list",
    description: "List all shaders created with Amplify Shader Editor. Detects Amplify shaders by scanning for ASE serialization markers in .shader files. Only available when Amplify is installed.",
    inputSchema: {
      type: "object",
      properties: {
        filter: { type: "string", description: "Filter by shader name or path" },
        maxResults: { type: "number", description: "Maximum results (default: 100)" },
      },
    },
    handler: async (params) => formatResult(await bridge.listAmplifyShaders(params)),
  },
  {
    name: "unity_amplify_info",
    description: "Get detailed info about an Amplify shader: properties, render queue, pass count, and Amplify metadata (node count, version, features like custom expressions, functions, texture samples).",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path of the .shader file" },
      },
      required: ["path"],
    },
    handler: async (params) => formatResult(await bridge.getAmplifyShaderInfo(params)),
  },
  {
    name: "unity_amplify_open",
    description: "Open a shader in the Amplify Shader Editor window for visual editing. Only available when Amplify is installed.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path of the .shader file" },
      },
      required: ["path"],
    },
    handler: async (params) => formatResult(await bridge.openAmplifyShader(params)),
  },
  {
    name: "unity_amplify_list_functions",
    description: "List all Amplify Shader Functions in the project. Functions are reusable node groups (similar to Shader Graph Sub Graphs). Only available when Amplify is installed.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => formatResult(await bridge.listAmplifyFunctions(params)),
  },
  {
    name: "unity_amplify_get_node_types",
    description: "List all available Amplify Shader Editor node types by reflecting over the ASE assembly. Returns type names, categories, and descriptions. Requires Amplify to be installed.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => formatResult(await bridge.getAmplifyNodeTypes(params)),
  },
  {
    name: "unity_amplify_get_nodes",
    description: "Get all nodes in the currently open Amplify Shader Editor graph. Returns node IDs, types, positions, and port counts. The ASE window must be open with a shader loaded.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => formatResult(await bridge.getAmplifyGraphNodes(params)),
  },
  {
    name: "unity_amplify_get_connections",
    description: "Get all connections between nodes in the currently open Amplify Shader Editor graph. Shows which output ports connect to which input ports.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => formatResult(await bridge.getAmplifyGraphConnections(params)),
  },
  {
    name: "unity_amplify_create_shader",
    description: "Create a new Amplify Shader Editor shader file with proper ASE serialization markers. The shader can then be opened in ASE for visual editing.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path for the new shader (e.g., 'Assets/Shaders/MyShader.shader')" },
        shaderName: { type: "string", description: "Shader name in the shader dropdown (e.g., 'Custom/MyShader')" },
      },
      required: ["path", "shaderName"],
    },
    handler: async (params) => formatResult(await bridge.createAmplifyShader(params)),
  },
  {
    name: "unity_amplify_add_node",
    description: "Add a node to the currently open Amplify Shader Editor graph. The ASE window must be open with a shader loaded. Use unity_amplify_get_node_types to discover available node types first.",
    inputSchema: {
      type: "object",
      properties: {
        nodeType: { type: "string", description: "Full type name of the node (e.g., 'AmplifyShaderEditor.ColorNode', 'AmplifyShaderEditor.SimpleMultiplyOpNode', 'AmplifyShaderEditor.SamplerNode')" },
        x: { type: "number", description: "X position in graph (default: 0)" },
        y: { type: "number", description: "Y position in graph (default: 0)" },
      },
      required: ["nodeType"],
    },
    handler: async (params) => formatResult(await bridge.addAmplifyNode(params)),
  },
  {
    name: "unity_amplify_remove_node",
    description: "Remove a node from the currently open Amplify Shader Editor graph by its unique ID. Cannot remove the master/output node.",
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "number", description: "Unique ID of the node to remove (from unity_amplify_get_nodes)" },
      },
      required: ["nodeId"],
    },
    handler: async (params) => formatResult(await bridge.removeAmplifyNode(params)),
  },
  {
    name: "unity_amplify_connect",
    description: "Connect two nodes in the Amplify Shader Editor graph. Connects an output port of one node to an input port of another node.",
    inputSchema: {
      type: "object",
      properties: {
        outputNodeId: { type: "number", description: "ID of the source node (output side)" },
        outputPortId: { type: "number", description: "Port index on the output node (0-based)" },
        inputNodeId: { type: "number", description: "ID of the destination node (input side)" },
        inputPortId: { type: "number", description: "Port index on the input node (0-based)" },
      },
      required: ["outputNodeId", "outputPortId", "inputNodeId", "inputPortId"],
    },
    handler: async (params) => formatResult(await bridge.connectAmplifyNodes(params)),
  },
  {
    name: "unity_amplify_disconnect",
    description: "Disconnect a specific port on a node in the Amplify Shader Editor graph.",
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "number", description: "ID of the node" },
        portId: { type: "number", description: "Port index (0-based)" },
        isInput: { type: "boolean", description: "True to disconnect an input port, false for output port (default: true)" },
      },
      required: ["nodeId", "portId"],
    },
    handler: async (params) => formatResult(await bridge.disconnectAmplifyNodes(params)),
  },
  {
    name: "unity_amplify_node_info",
    description: "Get detailed information about a specific node in the Amplify Shader Editor graph, including all input/output ports with names, data types, and connection status.",
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "number", description: "Unique ID of the node" },
      },
      required: ["nodeId"],
    },
    handler: async (params) => formatResult(await bridge.getAmplifyNodeInfo(params)),
  },
  {
    name: "unity_amplify_set_node_property",
    description: "Set a property or field value on a node in the Amplify Shader Editor graph via reflection. If the property name is wrong, returns a list of available properties.",
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "number", description: "Unique ID of the node" },
        propertyName: { type: "string", description: "Name of the property or field to set (e.g., 'm_defaultValue', 'PropertyName')" },
        value: { type: "string", description: "Value to set (will be parsed based on property type)" },
      },
      required: ["nodeId", "propertyName", "value"],
    },
    handler: async (params) => formatResult(await bridge.setAmplifyNodeProperty(params)),
  },
  {
    name: "unity_amplify_move_node",
    description: "Move a node to a new position in the Amplify Shader Editor graph.",
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "number", description: "Unique ID of the node" },
        x: { type: "number", description: "New X position" },
        y: { type: "number", description: "New Y position" },
      },
      required: ["nodeId", "x", "y"],
    },
    handler: async (params) => formatResult(await bridge.moveAmplifyNode(params)),
  },
  {
    name: "unity_amplify_save",
    description: "Save the currently open Amplify Shader Editor graph to disk. If the shader has never been saved, auto-determines a save path from the shader name or uses the provided path.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Optional asset path to save to (e.g. 'Assets/Shaders/MyShader.shader'). Only needed if the shader has never been saved before." },
      },
    },
    handler: async (params) => formatResult(await bridge.saveAmplifyGraph(params)),
  },
  {
    name: "unity_amplify_close",
    description: "Close the Amplify Shader Editor window. By default saves the graph before closing to prevent save dialogs.",
    inputSchema: {
      type: "object",
      properties: {
        save: { type: "boolean", description: "Save the graph before closing (default: true)" },
      },
    },
    handler: async (params) => formatResult(await bridge.closeAmplifyEditor(params)),
  },
  {
    name: "unity_amplify_create_from_template",
    description: "Create a new Amplify shader from a predefined template (surface, unlit, urp_lit, transparent, post_process). The shader file is created and can then be opened in ASE.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path for the new shader (e.g., 'Assets/Shaders/MyShader.shader')" },
        shaderName: { type: "string", description: "Shader name in the dropdown (e.g., 'Custom/MyShader')" },
        template: { type: "string", description: "Template type: 'surface' (Standard PBR), 'unlit', 'urp' or 'urp_lit' (URP Lit), 'transparent', 'post_process' or 'postprocess'" },
      },
      required: ["path", "shaderName", "template"],
    },
    handler: async (params) => formatResult(await bridge.createAmplifyFromTemplate(params)),
  },
  {
    name: "unity_amplify_focus_node",
    description: "Focus the Amplify Shader Editor view on a specific node, centering and optionally zooming to it.",
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "number", description: "Unique ID of the node to focus on" },
        zoom: { type: "number", description: "Zoom level (default: 1.0)" },
        select: { type: "boolean", description: "Also select the node (default: true)" },
      },
      required: ["nodeId"],
    },
    handler: async (params) => formatResult(await bridge.focusAmplifyNode(params)),
  },
  {
    name: "unity_amplify_master_node_info",
    description: "Get detailed information about the master/output node of the currently open Amplify shader graph, including all its input ports and properties.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => formatResult(await bridge.getAmplifyMasterNodeInfo(params)),
  },
  {
    name: "unity_amplify_disconnect_all",
    description: "Remove all connections from a specific node in the Amplify Shader Editor graph (both input and output connections).",
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "number", description: "Unique ID of the node to disconnect" },
      },
      required: ["nodeId"],
    },
    handler: async (params) => formatResult(await bridge.disconnectAllAmplifyNode(params)),
  },
  {
    name: "unity_amplify_duplicate_node",
    description: "Duplicate a node in the Amplify Shader Editor graph. Creates a new node of the same type at a slight offset from the original.",
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "number", description: "Unique ID of the node to duplicate" },
        offsetX: { type: "number", description: "X offset from original (default: 50)" },
        offsetY: { type: "number", description: "Y offset from original (default: 50)" },
      },
      required: ["nodeId"],
    },
    handler: async (params) => formatResult(await bridge.duplicateAmplifyNode(params)),
  },

  // â”€â”€â”€ Search & Find â”€â”€â”€
  {
    name: "unity_search_by_component",
    description: "Find all GameObjects in the scene that have a specific component type. Returns their paths and instance IDs.",
    inputSchema: {
      type: "object",
      properties: {
        componentType: { type: "string", description: "Component type name (e.g. 'Rigidbody', 'Camera', 'AudioSource', 'MyScript')" },
        includeInactive: { type: "boolean", description: "Include inactive GameObjects (default: false)" },
        limit: { type: "number", description: "Maximum results to return (default: 500). Use lower values on large scenes." },
      },
      required: ["componentType"],
    },
    handler: async (params) => formatResult(await bridge.findByComponent(params)),
  },
  {
    name: "unity_search_by_tag",
    description: "Find all GameObjects with a specific tag.",
    inputSchema: {
      type: "object",
      properties: {
        tag: { type: "string", description: "Tag name (e.g. 'Player', 'Enemy', 'MainCamera')" },
        limit: { type: "number", description: "Maximum results to return (default: 500)." },
      },
      required: ["tag"],
    },
    handler: async (params) => formatResult(await bridge.findByTag(params)),
  },
  {
    name: "unity_search_by_layer",
    description: "Find all GameObjects on a specific layer.",
    inputSchema: {
      type: "object",
      properties: {
        layer: { type: "string", description: "Layer name or index (e.g. 'UI', 'Water', '5')" },
        limit: { type: "number", description: "Maximum results to return (default: 500)." },
      },
      required: ["layer"],
    },
    handler: async (params) => formatResult(await bridge.findByLayer(params)),
  },
  {
    name: "unity_search_by_name",
    description: "Find all GameObjects whose name contains a pattern. Supports substring matching or regex.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name pattern to search for" },
        regex: { type: "boolean", description: "Use regex matching instead of substring (default: false)" },
        includeInactive: { type: "boolean", description: "Include inactive GameObjects (default: false)" },
        limit: { type: "number", description: "Maximum results to return (default: 500)." },
      },
      required: ["name"],
    },
    handler: async (params) => formatResult(await bridge.findByName(params)),
  },
  {
    name: "unity_search_by_shader",
    description: "Find all renderers using a specific shader.",
    inputSchema: {
      type: "object",
      properties: {
        shader: { type: "string", description: "Shader name to search for (partial match)" },
        limit: { type: "number", description: "Maximum results to return (default: 500)." },
      },
      required: ["shader"],
    },
    handler: async (params) => formatResult(await bridge.findByShader(params)),
  },
  {
    name: "unity_search_assets",
    description: "Search for assets in the project by name, type, and folder. Uses Unity's AssetDatabase search.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (asset name)" },
        type: { type: "string", description: "Asset type filter (e.g. 'Material', 'Texture2D', 'Prefab', 'Scene', 'AnimationClip', 'ScriptableObject')" },
        folder: { type: "string", description: "Folder to search in (e.g. 'Assets/Prefabs')" },
        maxResults: { type: "number", description: "Maximum results to return (default: 100)" },
      },
    },
    handler: async (params) => formatResult(await bridge.searchAssets(params)),
  },
  {
    name: "unity_search_missing_references",
    description: "Find all missing/broken object references and missing scripts in the scene. Essential for cleanup and debugging.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", description: "'scene' (default) or 'assets'" },
        limit: { type: "number", description: "Maximum results to return (default: 500)." },
      },
    },
    handler: async (params) => formatResult(await bridge.findMissingReferences(params)),
  },
  {
    name: "unity_scene_stats",
    description: "Get comprehensive scene statistics: total objects, vertices, triangles, lights, cameras, colliders, and top component types.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => formatResult(await bridge.getSceneStats(params)),
  },

  // â”€â”€â”€ Project Settings â”€â”€â”€
  {
    name: "unity_settings_quality",
    description: "Get current quality settings: level, shadows, anti-aliasing, LOD bias, vsync, and all quality levels available.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => formatResult(await bridge.getQualitySettings(params)),
  },
  {
    name: "unity_settings_set_quality_level",
    description: "Set the active quality level by name or index.",
    inputSchema: {
      type: "object",
      properties: {
        level: { type: "string", description: "Quality level name (e.g. 'Ultra', 'High') or index (e.g. '0', '3')" },
      },
      required: ["level"],
    },
    handler: async (params) => formatResult(await bridge.setQualityLevel(params)),
  },
  {
    name: "unity_settings_physics",
    description: "Get physics settings: gravity, solver iterations, sleep threshold, contact offset, bounce threshold.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => formatResult(await bridge.getPhysicsSettings(params)),
  },
  {
    name: "unity_settings_set_physics",
    description: "Modify physics settings like gravity, solver iterations, sleep threshold, etc.",
    inputSchema: {
      type: "object",
      properties: {
        gravity: { type: "object", description: "Gravity vector { x, y, z } (default: 0, -9.81, 0)", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } } },
        defaultSolverIterations: { type: "number", description: "Physics solver iterations (default: 6)" },
        sleepThreshold: { type: "number", description: "Energy threshold for sleep" },
        bounceThreshold: { type: "number", description: "Velocity threshold for bouncing" },
        defaultContactOffset: { type: "number", description: "Default contact offset" },
        queriesHitTriggers: { type: "boolean", description: "Whether raycasts hit trigger colliders" },
      },
    },
    handler: async (params) => formatResult(await bridge.setPhysicsSettings(params)),
  },
  {
    name: "unity_settings_time",
    description: "Get time settings: fixedDeltaTime, maximumDeltaTime, timeScale.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => formatResult(await bridge.getTimeSettings(params)),
  },
  {
    name: "unity_settings_set_time",
    description: "Modify time settings: fixed timestep, max delta time, time scale (for slow-mo or fast-forward).",
    inputSchema: {
      type: "object",
      properties: {
        fixedDeltaTime: { type: "number", description: "Fixed timestep (default: 0.02 = 50Hz)" },
        maximumDeltaTime: { type: "number", description: "Maximum allowed delta time" },
        timeScale: { type: "number", description: "Time scale (1 = normal, 0.5 = half speed, 2 = double speed)" },
      },
    },
    handler: async (params) => formatResult(await bridge.setTimeSettings(params)),
  },
  {
    name: "unity_settings_player",
    description: "Get player settings: company name, product name, version, color space, scripting backend, target architecture.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => formatResult(await bridge.getPlayerSettings(params)),
  },
  {
    name: "unity_settings_set_player",
    description: "Modify player settings like company name, product name, bundle version, run in background.",
    inputSchema: {
      type: "object",
      properties: {
        companyName: { type: "string", description: "Company name" },
        productName: { type: "string", description: "Product/game name" },
        bundleVersion: { type: "string", description: "Version string (e.g. '1.0.0')" },
        runInBackground: { type: "boolean", description: "Run in background when unfocused" },
      },
    },
    handler: async (params) => formatResult(await bridge.setPlayerSettings(params)),
  },
  {
    name: "unity_settings_render_pipeline",
    description: "Get information about the current render pipeline (Built-in, URP, HDRP).",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => formatResult(await bridge.getRenderPipelineInfo(params)),
  },

  // â”€â”€â”€ Undo â”€â”€â”€
  {
    name: "unity_undo",
    description: "Undo the single most recent step on Unity's global undo stack (Ctrl+Z). To revert a specific MCP action, prefer unity_undo_last.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => formatResult(await bridge.performUndo(params)),
  },
  {
    name: "unity_undo_last",
    description:
      "Revert the most recent undoable MCP action as a whole (create/edit/boolean, not one internal step — each write runs in its own named undo group). With agentId, targets that agent's most recent action. " +
      "Unity's undo is LINEAR: reverting an action also reverts anything newer stacked on it, so this refuses to cascade and lists what would be affected unless force:true. (execute-code and reads are never targets.)",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "Optional: revert this agent's most recent action instead of the global newest (see unity_undo_history for ids)." },
        force: { type: "boolean", description: "Also revert newer actions stacked on top of the target (Unity's linear undo). Default false." },
      },
    },
    handler: async (params) => formatResult(await bridge.undoLast(params)),
  },
  {
    name: "unity_redo",
    description: "Redo the last undone operation in Unity Editor.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => formatResult(await bridge.performRedo(params)),
  },
  {
    name: "unity_undo_history",
    description: "List recent MCP actions with undo state: per-agent attribution, whether each is still undoable, target, and the current undo group. Use it to decide what unity_undo_last reverts or to pick an agentId.",
    inputSchema: {
      type: "object",
      properties: {
        count: { type: "number", description: "Max actions to return, newest first (default 20)." },
        agentId: { type: "string", description: "Optional: only show actions from this agent." },
      },
    },
    handler: async (params) => formatResult(await bridge.getUndoHistory(params)),
  },
  {
    name: "unity_undo_clear",
    description: "Clear undo history. Can clear for a specific object or all undo history.",
    inputSchema: {
      type: "object",
      properties: {
        objectPath: { type: "string", description: "Optional: clear undo only for this GameObject. If omitted, clears all." },
      },
    },
    handler: async (params) => formatResult(await bridge.clearUndo(params)),
  },

  // â”€â”€â”€ Screenshot / Scene View â”€â”€â”€
  {
    name: "unity_screenshot_game",
    description: "Capture a screenshot of the Game View. The screenshot is saved on the next frame render.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Save path (default: Assets/Screenshots/GameView_timestamp.png)" },
        superSize: { type: "number", description: "Resolution multiplier (1 = normal, 2 = 2x, 4 = 4x)" },
      },
    },
    handler: async (params) => formatResult(await bridge.captureGameView(params)),
  },
  {
    name: "unity_screenshot_scene",
    description: "Capture a screenshot of the Scene View camera. Returns immediately with the saved file path.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Save path (default: Assets/Screenshots/SceneView_timestamp.png)" },
        width: { type: "number", description: "Image width (default: 1920)" },
        height: { type: "number", description: "Image height (default: 1080)" },
      },
    },
    handler: async (params) => formatResult(await bridge.captureSceneView(params)),
  },
  {
    name: "unity_screenshot_editor_window",
    description:
      "Capture a specific Editor window (Inspector, Project, Console, custom) to a PNG file via Win32 PrintWindow — works even when occluded, no focus steal. " +
      "USE ONLY ON EXPLICIT USER REQUEST — never proactively or for your own inspection. " +
      "WINDOWS EDITOR ONLY: on macOS/Linux it returns { success:false, platform } — do not retry, tell the user it's unavailable there. " +
      "For game/scene views use unity_screenshot_game / unity_screenshot_scene (cross-platform).",
    inputSchema: {
      type: "object",
      properties: {
        window: { type: "string", description: "EditorWindow type FullName (e.g. 'UnityEditor.InspectorWindow'), simple type name, or tab title." },
        path: { type: "string", description: "Save path ending in .png (default: Assets/Screenshots/EditorWindow_<time>.png)." },
        maxDimension: { type: "number", description: "Max pixels per side (default 8192, clamped to GPU max)." },
      },
      required: ["window"],
    },
    handler: async (params) => formatResult(await bridge.captureEditorWindow(params)),
  },
  {
    name: "unity_sceneview_info",
    description: "Get Scene View camera info: pivot position, rotation, zoom, orthographic mode, 2D mode.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => formatResult(await bridge.getSceneViewInfo(params)),
  },
  {
    name: "unity_sceneview_set_camera",
    description: "Control the Scene View camera: set pivot, rotation, zoom, orthographic mode, look-at target, or frame selection.",
    inputSchema: {
      type: "object",
      properties: {
        pivot: { type: "object", description: "Camera pivot position { x, y, z }", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } } },
        rotation: { type: "object", description: "Camera rotation (Euler angles) { x, y, z }", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } } },
        size: { type: "number", description: "Zoom level / camera size" },
        orthographic: { type: "boolean", description: "Orthographic projection mode" },
        is2D: { type: "boolean", description: "2D mode" },
        lookAt: { type: "object", description: "Point to look at { x, y, z }", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } } },
        lookAtSize: { type: "number", description: "Size when using lookAt (default: 10)" },
        frameSelected: { type: "boolean", description: "Frame the currently selected object" },
      },
    },
    handler: async (params) => formatResult(await bridge.setSceneViewCamera(params)),
  },

  // â”€â”€â”€ Graphics & Visuals â”€â”€â”€
  {
    name: "unity_graphics_asset_preview",
    description:
      "Get a visual preview thumbnail of any Unity asset (prefab, material, texture, mesh, etc.) as an inline image. Returns base64 PNG image that Claude can see directly.",
    inputSchema: {
      type: "object",
      properties: {
        assetPath: {
          type: "string",
          description:
            "Asset path (e.g. 'Assets/Models/Character.fbx', 'Assets/Materials/Wood.mat')",
        },
        width: {
          type: "number",
          description: "Preview width in pixels (default: 256)",
        },
        height: {
          type: "number",
          description: "Preview height in pixels (default: 256)",
        },
      },
      required: ["assetPath"],
    },
    handler: async (params) =>
      imageResultBlocks(await bridge.captureAssetPreview(params), "Asset preview returned no image data"),
  },
  {
    name: "unity_graphics_scene_capture",
    description:
      "Capture the current Scene View as an inline image. Returns base64 PNG that Claude can see directly. Use to visually inspect the scene layout.",
    inputSchema: {
      type: "object",
      properties: {
        width: {
          type: "number",
          description: "Image width in pixels (default: 512)",
        },
        height: {
          type: "number",
          description: "Image height in pixels (default: 512)",
        },
      },
    },
    handler: async (params) =>
      imageResultBlocks(await bridge.captureSceneViewGraphics(params), "Scene capture returned no image data"),
  },
  {
    name: "unity_graphics_game_capture",
    description:
      "Capture the Game View camera as an inline image. Returns base64 PNG that Claude can see directly. Use to see what the player sees.",
    inputSchema: {
      type: "object",
      properties: {
        width: {
          type: "number",
          description: "Image width in pixels (default: 512)",
        },
        height: {
          type: "number",
          description: "Image height in pixels (default: 512)",
        },
        cameraName: {
          type: "string",
          description:
            "Name of camera to use (default: Camera.main / MainCamera tag)",
        },
      },
    },
    handler: async (params) =>
      imageResultBlocks(await bridge.captureGameViewGraphics(params), "Game capture returned no image data"),
  },
  {
    name: "unity_graphics_prefab_render",
    description:
      "Render a prefab from a configurable angle as an inline image. Returns base64 PNG that Claude can see directly. Great for previewing 3D models and prefabs.",
    inputSchema: {
      type: "object",
      properties: {
        assetPath: {
          type: "string",
          description: "Prefab asset path (e.g. 'Assets/Prefabs/Enemy.prefab')",
        },
        width: {
          type: "number",
          description: "Image width in pixels (default: 512)",
        },
        height: {
          type: "number",
          description: "Image height in pixels (default: 512)",
        },
        rotationY: {
          type: "number",
          description:
            "Horizontal rotation angle in degrees (default: 30). Controls left-right viewing angle.",
        },
        rotationX: {
          type: "number",
          description:
            "Vertical rotation angle in degrees (default: 20). Controls up-down viewing angle.",
        },
        padding: {
          type: "number",
          description:
            "Padding multiplier around the object (default: 1.2). Higher = more space around object.",
        },
      },
      required: ["assetPath"],
    },
    handler: async (params) =>
      imageResultBlocks(await bridge.renderPrefabPreview(params), "Prefab render returned no image data"),
  },
  {
    name: "unity_graphics_mesh_info",
    description:
      "Get detailed mesh geometry information: vertex count, triangle count, submeshes, UV channels, blend shapes, bone count, bounds. Works on mesh assets or scene GameObjects with MeshFilter/SkinnedMeshRenderer.",
    inputSchema: {
      type: "object",
      properties: {
        assetPath: {
          type: "string",
          description:
            "Mesh asset path (e.g. 'Assets/Models/Character.fbx'). Use this OR objectPath.",
        },
        objectPath: {
          type: "string",
          description:
            "Scene GameObject path to get mesh from its MeshFilter or SkinnedMeshRenderer. Use this OR assetPath.",
        },
      },
    },
    handler: async (params) =>
      formatResult(await bridge.getMeshInfo(params)),
  },
  {
    name: "unity_graphics_material_info",
    description:
      "Get detailed material information: shader name, render queue, all properties (colors, floats, vectors, textures), keywords, and a visual preview thumbnail. Works on material assets or scene GameObjects.",
    inputSchema: {
      type: "object",
      properties: {
        assetPath: {
          type: "string",
          description:
            "Material asset path (e.g. 'Assets/Materials/Wood.mat'). Use this OR objectPath.",
        },
        objectPath: {
          type: "string",
          description:
            "Scene GameObject path to get material from its Renderer. Use this OR assetPath.",
        },
        materialIndex: {
          type: "number",
          description:
            "Material index on the Renderer (default: 0). Only used with objectPath.",
        },
        includePreview: {
          type: "boolean",
          description:
            "Include a base64 PNG preview thumbnail (default: true)",
        },
      },
    },
    handler: async (params) => {
      const result = await bridge.getMaterialInfo(params);
      const hasImage = typeof (result.data?.base64 || result.base64) === "string";
      return hasImage
        ? imageResultBlocks(result, "Material preview returned no image data")
        : formatResult(result);
    },
  },
  {
    name: "unity_graphics_texture_info",
    description:
      "Get detailed texture information: dimensions, format, compression, mipmaps, memory estimate, import settings, and a visual preview thumbnail. Use for texture analysis and optimization.",
    inputSchema: {
      type: "object",
      properties: {
        assetPath: {
          type: "string",
          description:
            "Texture asset path (e.g. 'Assets/Textures/Wood_Diffuse.png')",
        },
        previewSize: {
          type: "number",
          description:
            "Preview thumbnail size in pixels (default: 128). Set 0 to skip preview.",
        },
      },
      required: ["assetPath"],
    },
    handler: async (params) => {
      const result = await bridge.getTextureInfoGraphics(params);
      const hasImage = typeof (result.data?.base64 || result.base64) === "string";
      return hasImage
        ? imageResultBlocks(result, "Texture preview returned no image data")
        : formatResult(result);
    },
  },
  {
    name: "unity_graphics_renderer_info",
    description:
      "Get detailed Renderer component information: renderer type, materials list, mesh reference, bounds, shadow settings, sorting layer, lightmap index. Use for rendering analysis.",
    inputSchema: {
      type: "object",
      properties: {
        objectPath: {
          type: "string",
          description: "Scene GameObject path with a Renderer component",
        },
      },
      required: ["objectPath"],
    },
    handler: async (params) =>
      formatResult(await bridge.getRendererInfo(params)),
  },
  {
    name: "unity_graphics_lighting_summary",
    description:
      "Get a summary of all lights in the scene, or details about a specific light. Returns type, color, intensity, range, spot angle, shadow settings, and render mode.",
    inputSchema: {
      type: "object",
      properties: {
        lightName: {
          type: "string",
          description:
            "Optional: name of a specific light to get details for. If omitted, returns all lights.",
        },
      },
    },
    handler: async (params) =>
      formatResult(await bridge.getLightingSummary(params)),
  },

  // â”€â”€â”€ Terrain â”€â”€â”€
  {
    name: "unity_terrain_create",
    description: "Create a new Terrain in the scene with configurable size and heightmap resolution.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Terrain name (default: 'Terrain')" },
        width: { type: "number", description: "Terrain width in units (default: 1000)" },
        length: { type: "number", description: "Terrain length in units (default: 1000)" },
        height: { type: "number", description: "Maximum terrain height (default: 600)" },
        heightmapResolution: { type: "number", description: "Heightmap resolution, must be power of 2 + 1 (default: 513)" },
        position: { type: "object", description: "World position { x, y, z }", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } } },
        dataPath: { type: "string", description: "Path to save terrain data asset (default: Assets/TerrainName_Data.asset)" },
        overwrite: { type: "boolean", description: "Replace existing terrain data at dataPath (default false: refuse, to avoid wiping a sculpted terrain)." },
      },
    },
    handler: async (params) => formatResult(await bridge.createTerrain(params)),
  },
  {
    name: "unity_terrain_info",
    description: "Get detailed terrain information: size, resolution, layers, tree/detail counts, settings.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Terrain name. If omitted, uses the active terrain." },
      },
    },
    handler: async (params) => formatResult(await bridge.getTerrainInfo(params)),
  },
  {
    name: "unity_terrain_set_height",
    description: "Set terrain height at a position with optional radius falloff. Coordinates are normalized (0-1).",
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "number", description: "Normalized X position (0-1)" },
        z: { type: "number", description: "Normalized Z position (0-1)" },
        height: { type: "number", description: "Height value (0-1, where 1 = max terrain height)" },
        radius: { type: "number", description: "Brush radius in heightmap pixels (default: 1)" },
        name: { type: "string", description: "Terrain name (optional)" },
      },
      required: ["x", "z", "height"],
    },
    handler: async (params) => formatResult(await bridge.setTerrainHeight(params)),
  },
  {
    name: "unity_terrain_flatten",
    description: "Flatten the entire terrain to a uniform height.",
    inputSchema: {
      type: "object",
      properties: {
        height: { type: "number", description: "Height value (0-1, default: 0)" },
        name: { type: "string", description: "Terrain name (optional)" },
      },
    },
    handler: async (params) => formatResult(await bridge.flattenTerrain(params)),
  },
  {
    name: "unity_terrain_add_layer",
    description: "Add a texture layer to the terrain for painting.",
    inputSchema: {
      type: "object",
      properties: {
        texturePath: { type: "string", description: "Asset path of the diffuse texture" },
        normalMapPath: { type: "string", description: "Asset path of the normal map texture (optional)" },
        tileSizeX: { type: "number", description: "Tile size X (default: 10)" },
        tileSizeY: { type: "number", description: "Tile size Y (default: 10)" },
        name: { type: "string", description: "Terrain name (optional)" },
      },
      required: ["texturePath"],
    },
    handler: async (params) => formatResult(await bridge.addTerrainLayer(params)),
  },
  {
    name: "unity_terrain_get_height",
    description: "Sample the terrain height at a world position.",
    inputSchema: {
      type: "object",
      properties: {
        worldX: { type: "number", description: "World X coordinate" },
        worldZ: { type: "number", description: "World Z coordinate" },
        name: { type: "string", description: "Terrain name (optional)" },
      },
      required: ["worldX", "worldZ"],
    },
    handler: async (params) => formatResult(await bridge.getTerrainHeight(params)),
  },
  {
    name: "unity_terrain_list",
    description: "List all terrains in the scene with their names, positions, sizes, and basic info.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => formatResult(await bridge.listTerrains(params)),
  },
  {
    name: "unity_terrain_raise_lower",
    description: "Raise or lower terrain height at a normalized position with a brush radius and falloff. Use positive delta to raise, negative to lower.",
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "number", description: "Normalized X position (0-1)" },
        z: { type: "number", description: "Normalized Z position (0-1)" },
        delta: { type: "number", description: "Height change amount (-1 to 1). Positive raises, negative lowers." },
        radius: { type: "number", description: "Brush radius in heightmap pixels (default: 10)" },
        falloff: { type: "string", description: "Falloff type: 'linear', 'smooth', or 'constant' (default: 'smooth')" },
        name: { type: "string", description: "Terrain name (optional)" },
      },
      required: ["x", "z", "delta"],
    },
    handler: async (params) => formatResult(await bridge.raiseLowerTerrainHeight(params)),
  },
  {
    name: "unity_terrain_smooth",
    description: "Smooth terrain heights at a normalized position to reduce sharp edges. Uses kernel averaging.",
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "number", description: "Normalized X position (0-1)" },
        z: { type: "number", description: "Normalized Z position (0-1)" },
        radius: { type: "number", description: "Brush radius in heightmap pixels (default: 10)" },
        strength: { type: "number", description: "Smoothing strength 0-1 (default: 0.5)" },
        name: { type: "string", description: "Terrain name (optional)" },
      },
      required: ["x", "z"],
    },
    handler: async (params) => formatResult(await bridge.smoothTerrainHeight(params)),
  },
  {
    name: "unity_terrain_noise",
    description: "Apply Perlin noise to the entire terrain heightmap. Great for generating natural-looking terrain.",
    inputSchema: {
      type: "object",
      properties: {
        scale: { type: "number", description: "Noise scale / frequency (default: 20)" },
        amplitude: { type: "number", description: "Noise amplitude 0-1 (default: 0.1)" },
        octaves: { type: "number", description: "Number of noise octaves for detail (default: 4)" },
        seed: { type: "number", description: "Random seed (default: 0)" },
        additive: { type: "boolean", description: "If true, adds noise to existing heights. If false, replaces (default: false)" },
        name: { type: "string", description: "Terrain name (optional)" },
      },
    },
    handler: async (params) => formatResult(await bridge.setTerrainNoise(params)),
  },
  {
    name: "unity_terrain_set_heights_region",
    description: "Set heights for a rectangular region of the heightmap. Heights are normalized 0-1.",
    inputSchema: {
      type: "object",
      properties: {
        xBase: { type: "number", description: "Start X index in heightmap" },
        yBase: { type: "number", description: "Start Y index in heightmap" },
        heights: { type: "array", description: "2D array of height values [row][col], each 0-1", items: { type: "array", items: { type: "number" } } },
        name: { type: "string", description: "Terrain name (optional)" },
      },
      required: ["xBase", "yBase", "heights"],
    },
    handler: async (params) => formatResult(await bridge.setTerrainHeightsRegion(params)),
  },
  {
    name: "unity_terrain_get_heights_region",
    description: "Get heights for a rectangular region of the heightmap. Returns normalized 0-1 values.",
    inputSchema: {
      type: "object",
      properties: {
        xBase: { type: "number", description: "Start X index in heightmap" },
        yBase: { type: "number", description: "Start Y index in heightmap" },
        width: { type: "number", description: "Width of region to read" },
        height: { type: "number", description: "Height of region to read" },
        name: { type: "string", description: "Terrain name (optional)" },
      },
      required: ["xBase", "yBase", "width", "height"],
    },
    handler: async (params) => formatResult(await bridge.getTerrainHeightsRegion(params)),
  },
  {
    name: "unity_terrain_remove_layer",
    description: "Remove a texture layer from the terrain by index.",
    inputSchema: {
      type: "object",
      properties: {
        layerIndex: { type: "number", description: "Index of the terrain layer to remove" },
        name: { type: "string", description: "Terrain name (optional)" },
      },
      required: ["layerIndex"],
    },
    handler: async (params) => formatResult(await bridge.removeTerrainLayer(params)),
  },
  {
    name: "unity_terrain_paint_layer",
    description: "Paint a terrain texture layer at a normalized position with brush radius, opacity and falloff.",
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "number", description: "Normalized X position (0-1)" },
        z: { type: "number", description: "Normalized Z position (0-1)" },
        layerIndex: { type: "number", description: "Index of the terrain layer to paint" },
        radius: { type: "number", description: "Brush radius in alphamap pixels (default: 10)" },
        opacity: { type: "number", description: "Paint opacity 0-1 (default: 1.0)" },
        falloff: { type: "string", description: "Falloff type: 'linear', 'smooth', or 'constant' (default: 'smooth')" },
        name: { type: "string", description: "Terrain name (optional)" },
      },
      required: ["x", "z", "layerIndex"],
    },
    handler: async (params) => formatResult(await bridge.paintTerrainLayer(params)),
  },
  {
    name: "unity_terrain_fill_layer",
    description: "Fill the entire terrain with a single texture layer (sets that layer to 100% everywhere).",
    inputSchema: {
      type: "object",
      properties: {
        layerIndex: { type: "number", description: "Index of the terrain layer to fill with" },
        name: { type: "string", description: "Terrain name (optional)" },
      },
      required: ["layerIndex"],
    },
    handler: async (params) => formatResult(await bridge.fillTerrainLayer(params)),
  },
  {
    name: "unity_terrain_add_tree_prototype",
    description: "Add a tree prefab prototype to the terrain for tree placement.",
    inputSchema: {
      type: "object",
      properties: {
        prefabPath: { type: "string", description: "Asset path to the tree prefab (e.g. 'Assets/Trees/Oak.prefab')" },
        bendFactor: { type: "number", description: "Wind bend factor (default: 0)" },
        name: { type: "string", description: "Terrain name (optional)" },
      },
      required: ["prefabPath"],
    },
    handler: async (params) => formatResult(await bridge.addTerrainTreePrototype(params)),
  },
  {
    name: "unity_terrain_remove_tree_prototype",
    description: "Remove a tree prototype from the terrain by index. Also removes all placed instances of that prototype.",
    inputSchema: {
      type: "object",
      properties: {
        prototypeIndex: { type: "number", description: "Index of the tree prototype to remove" },
        name: { type: "string", description: "Terrain name (optional)" },
      },
      required: ["prototypeIndex"],
    },
    handler: async (params) => formatResult(await bridge.removeTerrainTreePrototype(params)),
  },
  {
    name: "unity_terrain_place_trees",
    description: "Place trees on the terrain. Supports random scatter over an area or manual positions. Scatter mode supports steepness and altitude filtering.",
    inputSchema: {
      type: "object",
      properties: {
        prototypeIndex: { type: "number", description: "Index of the tree prototype to place" },
        count: { type: "number", description: "Number of trees for random scatter mode" },
        area: { type: "object", description: "Scatter area { xMin, xMax, zMin, zMax } normalized 0-1 (default: entire terrain)", properties: { xMin: { type: "number" }, xMax: { type: "number" }, zMin: { type: "number" }, zMax: { type: "number" } } },
        positions: { type: "array", description: "Manual positions array of { x, z } normalized 0-1. Overrides scatter mode.", items: { type: "object", properties: { x: { type: "number" }, z: { type: "number" } } } },
        minHeight: { type: "number", description: "Min tree height scale (default: 0.8)" },
        maxHeight: { type: "number", description: "Max tree height scale (default: 1.2)" },
        minWidth: { type: "number", description: "Min tree width scale (default: 0.8)" },
        maxWidth: { type: "number", description: "Max tree width scale (default: 1.2)" },
        minSteepness: { type: "number", description: "Min terrain steepness in degrees for placement (default: 0)" },
        maxSteepness: { type: "number", description: "Max terrain steepness in degrees for placement (default: 90)" },
        minAltitude: { type: "number", description: "Min terrain altitude (world units) for placement" },
        maxAltitude: { type: "number", description: "Max terrain altitude (world units) for placement" },
        name: { type: "string", description: "Terrain name (optional)" },
      },
      required: ["prototypeIndex"],
    },
    handler: async (params) => formatResult(await bridge.placeTerrainTrees(params)),
  },
  {
    name: "unity_terrain_clear_trees",
    description: "Clear all trees from the terrain, optionally filtering by prototype index.",
    inputSchema: {
      type: "object",
      properties: {
        prototypeIndex: { type: "number", description: "If specified, only remove trees of this prototype index" },
        name: { type: "string", description: "Terrain name (optional)" },
      },
    },
    handler: async (params) => formatResult(await bridge.clearTerrainTrees(params)),
  },
  {
    name: "unity_terrain_get_tree_instances",
    description: "Get all tree instances on the terrain. Returns positions, prototype indices, scales, and count.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max number of trees to return (default: 500)" },
        name: { type: "string", description: "Terrain name (optional)" },
      },
    },
    handler: async (params) => formatResult(await bridge.getTerrainTreeInstances(params)),
  },
  {
    name: "unity_terrain_add_detail_prototype",
    description: "Add a detail/grass prototype to the terrain. Use texturePath for grass billboards or prefabPath for mesh details.",
    inputSchema: {
      type: "object",
      properties: {
        texturePath: { type: "string", description: "Asset path for grass texture (billboard mode)" },
        prefabPath: { type: "string", description: "Asset path for detail mesh prefab" },
        minWidth: { type: "number", description: "Min width (default: 1)" },
        maxWidth: { type: "number", description: "Max width (default: 2)" },
        minHeight: { type: "number", description: "Min height (default: 1)" },
        maxHeight: { type: "number", description: "Max height (default: 2)" },
        dryColor: { type: "object", description: "Dry color { r, g, b, a } 0-1", properties: { r: { type: "number" }, g: { type: "number" }, b: { type: "number" }, a: { type: "number" } } },
        healthyColor: { type: "object", description: "Healthy color { r, g, b, a } 0-1", properties: { r: { type: "number" }, g: { type: "number" }, b: { type: "number" }, a: { type: "number" } } },
        name: { type: "string", description: "Terrain name (optional)" },
      },
    },
    handler: async (params) => formatResult(await bridge.addTerrainDetailPrototype(params)),
  },
  {
    name: "unity_terrain_paint_detail",
    description: "Paint terrain detail/grass at a normalized position with a brush.",
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "number", description: "Normalized X position (0-1)" },
        z: { type: "number", description: "Normalized Z position (0-1)" },
        detailIndex: { type: "number", description: "Index of the detail prototype to paint" },
        radius: { type: "number", description: "Brush radius in detail pixels (default: 10)" },
        density: { type: "number", description: "Detail density value 0-16 (default: 8)" },
        name: { type: "string", description: "Terrain name (optional)" },
      },
      required: ["x", "z", "detailIndex"],
    },
    handler: async (params) => formatResult(await bridge.paintTerrainDetail(params)),
  },
  {
    name: "unity_terrain_scatter_detail",
    description: "Randomly scatter detail/grass across the entire terrain or a region.",
    inputSchema: {
      type: "object",
      properties: {
        detailIndex: { type: "number", description: "Index of the detail prototype" },
        density: { type: "number", description: "Detail density value 0-16 (default: 4)" },
        coverage: { type: "number", description: "Coverage percentage 0-1 (default: 0.5)" },
        seed: { type: "number", description: "Random seed (default: 0)" },
        name: { type: "string", description: "Terrain name (optional)" },
      },
      required: ["detailIndex"],
    },
    handler: async (params) => formatResult(await bridge.scatterTerrainDetail(params)),
  },
  {
    name: "unity_terrain_clear_detail",
    description: "Clear all detail/grass from the terrain, optionally filtering by prototype index.",
    inputSchema: {
      type: "object",
      properties: {
        detailIndex: { type: "number", description: "If specified, only clear this detail prototype index" },
        name: { type: "string", description: "Terrain name (optional)" },
      },
    },
    handler: async (params) => formatResult(await bridge.clearTerrainDetail(params)),
  },
  {
    name: "unity_terrain_set_holes",
    description: "Create or fill holes in the terrain at a region. Holes make the terrain transparent and non-collidable.",
    inputSchema: {
      type: "object",
      properties: {
        xBase: { type: "number", description: "Start X index in holes map" },
        yBase: { type: "number", description: "Start Y index in holes map" },
        holes: { type: "array", description: "2D boolean array [row][col] â€” true = solid, false = hole", items: { type: "array", items: { type: "boolean" } } },
        name: { type: "string", description: "Terrain name (optional)" },
      },
      required: ["xBase", "yBase", "holes"],
    },
    handler: async (params) => formatResult(await bridge.setTerrainHoles(params)),
  },
  {
    name: "unity_terrain_set_settings",
    description: "Modify terrain rendering and physics settings like pixel error, base map distance, detail density, etc.",
    inputSchema: {
      type: "object",
      properties: {
        heightmapPixelError: { type: "number", description: "Heightmap pixel error (LOD accuracy, default: 5)" },
        baseMapDist: { type: "number", description: "Base map distance for texture blending" },
        detailObjectDistance: { type: "number", description: "Max distance for detail objects" },
        detailObjectDensity: { type: "number", description: "Detail object density 0-1" },
        treeDistance: { type: "number", description: "Max distance for trees" },
        treeBillboardDistance: { type: "number", description: "Distance at which trees become billboards" },
        treeCrossFadeLength: { type: "number", description: "Cross-fade length for tree LOD transitions" },
        treeMaximumFullLODCount: { type: "number", description: "Max number of full-LOD trees" },
        drawHeightmap: { type: "boolean", description: "Whether to draw the heightmap" },
        drawTreesAndFoliage: { type: "boolean", description: "Whether to draw trees and foliage" },
        materialPath: { type: "string", description: "Asset path for custom terrain material" },
        name: { type: "string", description: "Terrain name (optional)" },
      },
    },
    handler: async (params) => formatResult(await bridge.setTerrainSettings(params)),
  },
  {
    name: "unity_terrain_resize",
    description: "Resize an existing terrain's dimensions or heightmap resolution. Warning: may reset heights.",
    inputSchema: {
      type: "object",
      properties: {
        width: { type: "number", description: "New terrain width" },
        length: { type: "number", description: "New terrain length" },
        height: { type: "number", description: "New max terrain height" },
        heightmapResolution: { type: "number", description: "New heightmap resolution (power of 2 + 1)" },
        name: { type: "string", description: "Terrain name (optional)" },
      },
    },
    handler: async (params) => formatResult(await bridge.resizeTerrain(params)),
  },
  {
    name: "unity_terrain_create_grid",
    description: "Create a grid of connected terrain tiles for large worlds. Automatically sets up terrain neighbors for seamless LOD transitions.",
    inputSchema: {
      type: "object",
      properties: {
        rows: { type: "number", description: "Number of rows in the grid" },
        cols: { type: "number", description: "Number of columns in the grid" },
        tileWidth: { type: "number", description: "Width of each tile (default: 1000)" },
        tileLength: { type: "number", description: "Length of each tile (default: 1000)" },
        tileHeight: { type: "number", description: "Max height of each tile (default: 600)" },
        heightmapResolution: { type: "number", description: "Heightmap resolution per tile (default: 513)" },
        baseName: { type: "string", description: "Base name for terrain tiles (default: 'Terrain')" },
        startPosition: { type: "object", description: "World position of the grid origin { x, y, z }", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } } },
      },
      required: ["rows", "cols"],
    },
    handler: async (params) => formatResult(await bridge.createTerrainGrid(params)),
  },
  {
    name: "unity_terrain_set_neighbors",
    description: "Set terrain neighbor connections for seamless LOD transitions between tiles.",
    inputSchema: {
      type: "object",
      properties: {
        terrain: { type: "string", description: "Name of the terrain to set neighbors for" },
        left: { type: "string", description: "Name of the left neighbor terrain (or null)" },
        top: { type: "string", description: "Name of the top neighbor terrain (or null)" },
        right: { type: "string", description: "Name of the right neighbor terrain (or null)" },
        bottom: { type: "string", description: "Name of the bottom neighbor terrain (or null)" },
      },
      required: ["terrain"],
    },
    handler: async (params) => formatResult(await bridge.setTerrainNeighbors(params)),
  },
  {
    name: "unity_terrain_import_heightmap",
    description: "Import a heightmap from a RAW file or texture asset into the terrain.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "Path to .raw file (absolute) or asset path to a Texture2D" },
        format: { type: "string", description: "'raw16' (16-bit RAW, default), 'raw8' (8-bit RAW), or 'texture'" },
        byteOrder: { type: "string", description: "Byte order for RAW: 'little' (default) or 'big'" },
        name: { type: "string", description: "Terrain name (optional)" },
      },
      required: ["filePath"],
    },
    handler: async (params) => formatResult(await bridge.importTerrainHeightmap(params)),
  },
  {
    name: "unity_terrain_export_heightmap",
    description: "Export terrain heightmap to a RAW file or PNG texture.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "Output file path (e.g. 'Assets/Heightmaps/terrain.raw')" },
        format: { type: "string", description: "'raw16' (16-bit RAW, default) or 'png'" },
        name: { type: "string", description: "Terrain name (optional)" },
      },
      required: ["filePath"],
    },
    handler: async (params) => formatResult(await bridge.exportTerrainHeightmap(params)),
  },
  {
    name: "unity_terrain_get_steepness",
    description: "Get the terrain steepness (slope angle in degrees) and surface normal at a world position.",
    inputSchema: {
      type: "object",
      properties: {
        worldX: { type: "number", description: "World X coordinate" },
        worldZ: { type: "number", description: "World Z coordinate" },
        name: { type: "string", description: "Terrain name (optional)" },
      },
      required: ["worldX", "worldZ"],
    },
    handler: async (params) => formatResult(await bridge.getTerrainSteepness(params)),
  },

  // â”€â”€â”€ Particle System â”€â”€â”€
  {
    name: "unity_particle_create",
    description: "Create a new Particle System with optional initial settings.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "GameObject name (default: 'Particle System')" },
        position: { type: "object", description: "World position { x, y, z }", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } } },
        parent: { type: "string", description: "Parent GameObject path" },
        duration: { type: "number", description: "Effect duration in seconds" },
        loop: { type: "boolean", description: "Whether the system loops" },
        startLifetime: { type: "number", description: "Particle lifetime in seconds" },
        startSpeed: { type: "number", description: "Initial particle speed" },
        startSize: { type: "number", description: "Initial particle size" },
        maxParticles: { type: "number", description: "Maximum number of particles" },
        gravityModifier: { type: "number", description: "Gravity multiplier" },
      },
    },
    handler: async (params) => formatResult(await bridge.createParticleSystem(params)),
  },
  {
    name: "unity_particle_info",
    description: "Get detailed Particle System info: main module, emission, shape, and all module enable states.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "GameObject path" },
        instanceId: { type: "string", description: "Instance ID (alternative)" },
      },
    },
    handler: async (params) => formatResult(await bridge.getParticleSystemInfo(params)),
  },
  {
    name: "unity_particle_set_main",
    description: "Configure the main module of a Particle System: duration, lifetime, speed, size, gravity, simulation space.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "GameObject path" },
        instanceId: { type: "string", description: "Instance ID (alternative)" },
        duration: { type: "number" }, loop: { type: "boolean" },
        startLifetime: { type: "number" }, startSpeed: { type: "number" },
        startSize: { type: "number" }, startRotation: { type: "number" },
        maxParticles: { type: "number" }, gravityModifier: { type: "number" },
        playOnAwake: { type: "boolean" },
        simulationSpace: { type: "string", description: "Local, World, or Custom" },
      },
    },
    handler: async (params) => formatResult(await bridge.setParticleMainModule(params)),
  },
  {
    name: "unity_particle_set_emission",
    description: "Configure particle emission: rate over time, rate over distance.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "GameObject path" },
        instanceId: { type: "string", description: "Instance ID (alternative)" },
        enabled: { type: "boolean" },
        rateOverTime: { type: "number", description: "Particles emitted per second" },
        rateOverDistance: { type: "number", description: "Particles emitted per unit distance" },
      },
    },
    handler: async (params) => formatResult(await bridge.setParticleEmission(params)),
  },
  {
    name: "unity_particle_set_shape",
    description: "Configure the emission shape: Sphere, Hemisphere, Cone, Box, Circle, Edge, etc.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "GameObject path" },
        instanceId: { type: "string", description: "Instance ID (alternative)" },
        enabled: { type: "boolean" },
        shapeType: { type: "string", description: "Shape type: Sphere, Hemisphere, Cone, Box, Circle, Edge, Rectangle, etc." },
        radius: { type: "number" }, angle: { type: "number" },
        arc: { type: "number" }, radiusThickness: { type: "number", description: "0 = emit from surface only, 1 = emit from entire volume" },
      },
    },
    handler: async (params) => formatResult(await bridge.setParticleShape(params)),
  },
  {
    name: "unity_particle_playback",
    description: "Control particle system playback: play, stop, pause, restart, or clear.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "GameObject path" },
        instanceId: { type: "string", description: "Instance ID (alternative)" },
        action: { type: "string", description: "play, stop, pause, restart, or clear" },
      },
      required: ["action"],
    },
    handler: async (params) => formatResult(await bridge.particlePlayback(params)),
  },

  // â”€â”€â”€ ScriptableObject â”€â”€â”€
  {
    name: "unity_scriptableobject_create",
    description: "Create a new ScriptableObject asset from a C# type. The type must already exist as a compiled script.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", description: "Full type name (e.g. 'GameSettings', 'MyNamespace.PlayerData')" },
        path: { type: "string", description: "Asset path (default: Assets/TypeName.asset)" },
        overwrite: { type: "boolean", description: "Replace an existing asset at this path (default false: refuse, to avoid resetting tuned data)." },
      },
      required: ["type"],
    },
    handler: async (params) => formatResult(await bridge.createScriptableObject(params)),
  },
  {
    name: "unity_scriptableobject_info",
    description: "Get all serialized properties and values of a ScriptableObject asset.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path of the ScriptableObject" },
      },
      required: ["path"],
    },
    handler: async (params) => formatResult(await bridge.getScriptableObjectInfo(params)),
  },
  {
    name: "unity_scriptableobject_set_field",
    description: "Set a field value on a ScriptableObject asset. Supports int, float, bool, string, and enum types.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path of the ScriptableObject" },
        field: { type: "string", description: "Property/field name" },
        value: { type: ["string", "number", "boolean", "object", "array", "null"], description: "Value to set (type depends on field)" },
      },
      required: ["path", "field", "value"],
    },
    handler: async (params) => formatResult(await bridge.setScriptableObjectField(params)),
  },
  {
    name: "unity_scriptableobject_list_types",
    description: "List all available ScriptableObject types in the project. Useful for discovering what SO types can be created.",
    inputSchema: {
      type: "object",
      properties: {
        filter: { type: "string", description: "Filter by type name (optional)" },
        includeEngine: { type: "boolean", description: "Include Unity engine types (default: false, project types only)" },
      },
    },
    handler: async (params) => formatResult(await bridge.listScriptableObjectTypes(params)),
  },

  // â”€â”€â”€ Texture â”€â”€â”€
  {
    name: "unity_texture_info",
    description: "Get texture info and import settings: size, format, compression, sprite mode, filter, wrap, mip maps, etc.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path of the texture" },
      },
      required: ["path"],
    },
    handler: async (params) => formatResult(await bridge.getTextureInfo(params)),
  },
  {
    name: "unity_texture_set_import",
    description: "Set texture import settings: type, compression, max size, filter mode, wrap mode, mipmaps, etc.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path of the texture" },
        textureType: { type: "string", description: "Default, NormalMap, Sprite, Cursor, Cookie, Lightmap, SingleChannel" },
        sRGB: { type: "boolean", description: "sRGB color space" },
        readable: { type: "boolean", description: "Read/Write enabled (uses more memory)" },
        mipmapEnabled: { type: "boolean", description: "Generate mipmaps" },
        filterMode: { type: "string", description: "Point, Bilinear, or Trilinear" },
        wrapMode: { type: "string", description: "Repeat, Clamp, Mirror, MirrorOnce" },
        maxTextureSize: { type: "number", description: "Max texture size (32, 64, 128, 256, 512, 1024, 2048, 4096, 8192)" },
        textureCompression: { type: "string", description: "Uncompressed, Compressed, CompressedHQ, CompressedLQ" },
        anisoLevel: { type: "number", description: "Anisotropic filtering level (0-16)" },
        alphaIsTransparency: { type: "boolean", description: "Alpha is transparency" },
        spritePixelsPerUnit: { type: "number", description: "Pixels per unit for sprites" },
        spriteMode: { type: "string", description: "Single, Multiple, Polygon (for sprite textures)" },
        npotScale: { type: "string", description: "Non-power-of-2 handling: None, ToNearest, ToLarger, ToSmaller" },
      },
      required: ["path"],
    },
    handler: async (params) => formatResult(await bridge.setTextureImportSettings(params)),
  },
  {
    name: "unity_texture_reimport",
    description: "Force reimport a texture to apply pending changes.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path of the texture" },
      },
      required: ["path"],
    },
    handler: async (params) => formatResult(await bridge.reimportTexture(params)),
  },
  {
    name: "unity_texture_set_sprite",
    description: "Quick-set a texture as a Sprite with optional pixels-per-unit and single/multiple mode.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path of the texture" },
        pixelsPerUnit: { type: "number", description: "Pixels per unit (default: 100)" },
        multiple: { type: "boolean", description: "Use Multiple sprite mode for spritesheets (default: false = Single)" },
      },
      required: ["path"],
    },
    handler: async (params) => formatResult(await bridge.setTextureAsSprite(params)),
  },
  {
    name: "unity_texture_set_normalmap",
    description: "Quick-set a texture as a Normal Map.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path of the texture" },
      },
      required: ["path"],
    },
    handler: async (params) => formatResult(await bridge.setTextureAsNormalMap(params)),
  },

  // â”€â”€â”€ Navigation â”€â”€â”€

  {
    name: "unity_navmesh_bake",
    description: "Bake the NavMesh for AI navigation. Optionally configure agent radius, height, slope, and climb.",
    inputSchema: {
      type: "object",
      properties: {
        agentRadius: { type: "number", description: "Agent radius (default: from NavMesh settings)" },
        agentHeight: { type: "number", description: "Agent height" },
        agentSlope: { type: "number", description: "Max slope angle in degrees" },
        agentClimb: { type: "number", description: "Step height the agent can climb" },
      },
    },
    handler: async (params) => formatResult(await bridge.bakeNavMesh(params)),
  },
  {
    name: "unity_navmesh_clear",
    description: "Clear all baked NavMeshes from the scene.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => formatResult(await bridge.clearNavMesh(params)),
  },
  {
    name: "unity_navmesh_add_agent",
    description: "Add a NavMeshAgent component to a GameObject with optional settings (speed, angular speed, acceleration, stopping distance, radius, height).",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "GameObject path or name" },
        speed: { type: "number", description: "Movement speed" },
        angularSpeed: { type: "number", description: "Turning speed in deg/s" },
        acceleration: { type: "number", description: "Acceleration" },
        stoppingDistance: { type: "number", description: "Distance to stop before target" },
        radius: { type: "number", description: "Agent radius" },
        height: { type: "number", description: "Agent height" },
      },
      required: ["path"],
    },
    handler: async (params) => formatResult(await bridge.addNavMeshAgent(params)),
  },
  {
    name: "unity_navmesh_add_obstacle",
    description: "Add a NavMeshObstacle component to a GameObject.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "GameObject path or name" },
        carve: { type: "boolean", description: "Whether the obstacle carves the NavMesh" },
        shape: { type: "string", description: "Shape: 'box' or 'capsule'" },
      },
      required: ["path"],
    },
    handler: async (params) => formatResult(await bridge.addNavMeshObstacle(params)),
  },
  {
    name: "unity_navmesh_info",
    description: "Get NavMesh information: vertex/triangle count, agents, obstacles, agent types.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => formatResult(await bridge.getNavMeshInfo(params)),
  },
  {
    name: "unity_navmesh_set_destination",
    description: "Set the destination for a NavMeshAgent (requires Play mode).",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "GameObject path with NavMeshAgent" },
        destination: {
          type: "object",
          description: "Target position {x, y, z}",
          properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } },
        },
      },
      required: ["path", "destination"],
    },
    handler: async (params) => formatResult(await bridge.setAgentDestination(params)),
  },

  // â”€â”€â”€ UI â”€â”€â”€

  {
    name: "unity_ui_create_canvas",
    description: "Create a UI Canvas with an EventSystem. Render modes: 'overlay', 'camera', 'world'.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Canvas name (default: 'Canvas')" },
        renderMode: { type: "string", description: "Render mode: overlay, camera, or world" },
      },
    },
    handler: async (params) => formatResult(await bridge.createCanvas(params)),
  },
  {
    name: "unity_ui_create_element",
    description: "Create a UI element: text, image, button, panel, slider, toggle, or inputfield.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", description: "Element type: text, image, button, panel, slider, toggle, inputfield" },
        name: { type: "string", description: "Element name" },
        parent: { type: "string", description: "Parent GameObject path (defaults to first Canvas)" },
        label: { type: "string", description: "Button label text (for button type)" },
        anchoredPosition: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } } },
        sizeDelta: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } } },
      },
      required: ["type"],
    },
    handler: async (params) => formatResult(await bridge.createUIElement(params)),
  },
  {
    name: "unity_ui_info",
    description: "Get UI information: canvases, text/image/button counts.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => formatResult(await bridge.getUIInfo(params)),
  },
  {
    name: "unity_ui_set_text",
    description: "Set properties on a UI Text component (text content, fontSize, color, alignment).",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "GameObject path with Text component" },
        text: { type: "string", description: "Text content" },
        fontSize: { type: "number", description: "Font size" },
        color: { type: "object", properties: { r: { type: "number" }, g: { type: "number" }, b: { type: "number" }, a: { type: "number" } } },
        alignment: { type: "string", description: "Text alignment (e.g. MiddleCenter, UpperLeft)" },
      },
      required: ["path"],
    },
    handler: async (params) => formatResult(await bridge.setUIText(params)),
  },
  {
    name: "unity_ui_set_image",
    description: "Set properties on a UI Image component (color, sprite, imageType, raycastTarget).",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "GameObject path with Image component" },
        color: { type: "object", properties: { r: { type: "number" }, g: { type: "number" }, b: { type: "number" }, a: { type: "number" } } },
        sprite: { type: "string", description: "Asset path to sprite" },
        imageType: { type: "string", description: "Image type: simple, sliced, tiled, filled" },
        raycastTarget: { type: "boolean", description: "Whether image blocks raycasts" },
      },
      required: ["path"],
    },
    handler: async (params) => formatResult(await bridge.setUIImage(params)),
  },

  // â”€â”€â”€ Package Manager â”€â”€â”€

  {
    name: "unity_packages_list",
    description: "List all installed Unity packages with their name, version, source, and status.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => formatResult(await bridge.listPackages(params)),
  },
  {
    name: "unity_packages_add",
    description: "Add/install a Unity package by identifier (e.g. 'com.unity.cinemachine' or 'com.unity.cinemachine@3.0.0').",
    inputSchema: {
      type: "object",
      properties: {
        identifier: { type: "string", description: "Package identifier, e.g. 'com.unity.cinemachine@3.0.0'" },
      },
      required: ["identifier"],
    },
    handler: async (params) => formatResult(await bridge.addPackage(params)),
  },
  {
    name: "unity_packages_remove",
    description: "Remove/uninstall a Unity package by name.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Package name, e.g. 'com.unity.cinemachine'" },
      },
      required: ["name"],
    },
    handler: async (params) => formatResult(await bridge.removePackage(params)),
  },
  {
    name: "unity_packages_search",
    description: "Search for Unity packages in the registry.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    },
    handler: async (params) => formatResult(await bridge.searchPackage(params)),
  },
  {
    name: "unity_packages_info",
    description: "Get detailed info about an installed package including versions and dependencies.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Package name, e.g. 'com.unity.cinemachine'" },
      },
      required: ["name"],
    },
    handler: async (params) => formatResult(await bridge.getPackageInfo(params)),
  },

  // â”€â”€â”€ Constraints & LOD â”€â”€â”€

  {
    name: "unity_constraint_add",
    description: "Add an animation constraint (position, rotation, scale, aim, parent, lookat) to a GameObject with optional source.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Target GameObject path" },
        type: { type: "string", description: "Constraint type: position, rotation, scale, aim, parent, lookat" },
        source: { type: "string", description: "Source GameObject path" },
        activate: { type: "boolean", description: "Activate the constraint immediately" },
      },
      required: ["path", "type"],
    },
    handler: async (params) => formatResult(await bridge.addConstraint(params)),
  },
  {
    name: "unity_constraint_info",
    description: "Get all constraints on a GameObject with their type, active state, weight, and source count.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "GameObject path" },
      },
      required: ["path"],
    },
    handler: async (params) => formatResult(await bridge.getConstraintInfo(params)),
  },
  {
    name: "unity_lod_create",
    description: "Create or configure a LODGroup on a GameObject with specified number of LOD levels.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "GameObject path" },
        levels: { type: "number", description: "Number of LOD levels (1-8, default: 3)" },
      },
      required: ["path"],
    },
    handler: async (params) => formatResult(await bridge.createLODGroup(params)),
  },
  {
    name: "unity_lod_info",
    description: "Get LODGroup info: LOD levels, screen transition heights, renderer counts.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "GameObject path with LODGroup" },
      },
      required: ["path"],
    },
    handler: async (params) => formatResult(await bridge.getLODGroupInfo(params)),
  },

  // â”€â”€â”€ Prefs â”€â”€â”€

  {
    name: "unity_editorprefs_get",
    description: "Get an EditorPrefs value by key. Specify type: string (default), int, float, bool.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Preference key" },
        type: { type: "string", description: "Value type: string, int, float, bool" },
      },
      required: ["key"],
    },
    handler: async (params) => formatResult(await bridge.getEditorPref(params)),
  },
  {
    name: "unity_editorprefs_set",
    description: "Set an EditorPrefs value. Specify type: string (default), int, float, bool.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Preference key" },
        value: { type: ["string", "number", "boolean"], description: "Value to set" },
        type: { type: "string", description: "Value type: string, int, float, bool" },
      },
      required: ["key", "value"],
    },
    handler: async (params) => formatResult(await bridge.setEditorPref(params)),
  },
  {
    name: "unity_editorprefs_delete",
    description: "Delete an EditorPrefs key.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Preference key to delete" },
      },
      required: ["key"],
    },
    handler: async (params) => formatResult(await bridge.deleteEditorPref(params)),
  },
  {
    name: "unity_playerprefs_get",
    description: "Get a PlayerPrefs value by key. Specify type: string (default), int, float.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Preference key" },
        type: { type: "string", description: "Value type: string, int, float" },
      },
      required: ["key"],
    },
    handler: async (params) => formatResult(await bridge.getPlayerPref(params)),
  },
  {
    name: "unity_playerprefs_set",
    description: "Set a PlayerPrefs value. Specify type: string (default), int, float.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Preference key" },
        value: { type: ["string", "number"], description: "Value to set" },
        type: { type: "string", description: "Value type: string, int, float" },
      },
      required: ["key", "value"],
    },
    handler: async (params) => formatResult(await bridge.setPlayerPref(params)),
  },
  {
    name: "unity_playerprefs_delete",
    description: "Delete a PlayerPrefs key.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Preference key to delete" },
      },
      required: ["key"],
    },
    handler: async (params) => formatResult(await bridge.deletePlayerPref(params)),
  },
  {
    name: "unity_playerprefs_delete_all",
    description: "Delete ALL PlayerPrefs. Use with caution.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => formatResult(await bridge.deleteAllPlayerPrefs(params)),
  },

  // â”€â”€â”€ Queue Management (Multi-Agent) â”€â”€â”€
  {
    name: "unity_queue_info",
    description:
      "Get the current state of the multi-agent request queue: total queued requests, active agents, per-agent queue depths, and completed cache size. Useful for monitoring when multiple agents are working on the same Unity project.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => formatResult(await bridge.getQueueInfo()),
  },
  {
    name: "unity_queue_ticket_status",
    description:
      "Check the status of a specific queue ticket by ID. Returns the ticket's current status (Queued, Executing, Completed, Failed, TimedOut), result data if completed, and timing information.",
    inputSchema: {
      type: "object",
      properties: {
        ticketId: {
          type: "number",
          description: "The ticket ID returned from a queue submission",
        },
      },
      required: ["ticketId"],
    },
    handler: async ({ ticketId }) =>
      formatResult(await bridge.getTicketStatus(ticketId)),
  },
  {
    name: "unity_agents_list",
    description:
      "List all active agent sessions connected to the AB Unity MCP bridge. Shows each agent's ID, connection time, last activity, current action, total actions count, queued/completed request counts, and average response time.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => formatResult(await bridge.listAgents()),
  },
  {
    name: "unity_agent_log",
    description:
      "Get the action log for a specific agent, showing the last 100 actions with timestamps.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: {
          type: "string",
          description: "The agent ID to get logs for",
        },
      },
      required: ["agentId"],
    },
    handler: async (params) =>
      formatResult(await bridge.getAgentLog(params)),
  },

  // â”€â”€â”€ MPPM Scenario Management â”€â”€â”€
  // These are NOT in CORE_TOOLS, so they automatically become advanced/lazy-loaded
  // tools accessible via unity_advanced_tool, keeping the exposed tool count low.
  {
    name: "unity_mppm_list_scenarios",
    description: "List all MPPM (Multiplayer PlayMode) scenarios in the project with details about instances and configurations.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => formatResult(await bridge.sendCommand("scenario/list", {})),
  },
  {
    name: "unity_mppm_status",
    description: "Get the current scenario status including running state, active scenario name, and progress.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => formatResult(await bridge.sendCommand("scenario/status", {})),
  },
  {
    name: "unity_mppm_activate_scenario",
    description: "Load/activate a specific scenario by its asset path.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path to the scenario (e.g., 'Assets/MPPM/Scenarios/MyScenario.asset')" },
      },
      required: ["path"],
    },
    handler: async ({ path }) => formatResult(await bridge.sendCommand("scenario/activate", { path })),
  },
  {
    name: "unity_mppm_start",
    description:
      "Start the currently active scenario. By default also enters Play mode on the main editor " +
      "so MPPM's Play-mode hooks fire (virtual players launch, scene tick starts). " +
      "Set enterPlayMode=false to only mark the scenario running without entering Play.",
    inputSchema: {
      type: "object",
      properties: {
        enterPlayMode: {
          type: "boolean",
          description: "Enter Play mode after starting the scenario. Default true.",
        },
      },
    },
    handler: async (args) =>
      formatResult(await bridge.sendCommand("scenario/start", args || {})),
  },
  {
    name: "unity_mppm_stop",
    description:
      "Stop the running scenario. By default also exits Play mode on the main editor so " +
      "virtual-player processes shut down. Set exitPlayMode=false to leave Play mode running.",
    inputSchema: {
      type: "object",
      properties: {
        exitPlayMode: {
          type: "boolean",
          description: "Exit Play mode after stopping the scenario. Default true.",
        },
      },
    },
    handler: async (args) =>
      formatResult(await bridge.sendCommand("scenario/stop", args || {})),
  },
  {
    name: "unity_mppm_info",
    description: "Get multiplayer play mode information including CurrentPlayer state, tags, and MPPM package version.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => formatResult(await bridge.sendCommand("scenario/info", {})),
  },
  {
    name: "unity_mppm_create_scenario",
    description:
      "Create an MPPM ScenarioConfig asset programmatically. Unity 6+ (MPPM 2.0). " +
      "Produces 1 MainEditor instance + N VirtualEditor instances, saved as a .asset " +
      "file you can then activate with unity_mppm_activate_scenario and run with unity_mppm_start.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Scenario name (also used as the default asset file name)." },
        path: { type: "string", description: "Optional asset path. Defaults to 'Assets/MPPM/{name}.asset'." },
        mainRole: {
          type: "string",
          enum: ["Host", "Client", "Server"],
          description: "Role for the Main Editor instance. 'Host' = ClientAndServer (default).",
        },
        virtualEditors: {
          type: "integer",
          minimum: 0,
          description: "Number of Virtual Editor instances (clones) to add. Default 1.",
        },
        virtualRole: {
          type: "string",
          enum: ["Client", "Server", "Host"],
          description: "Role for each Virtual Editor instance. Default 'Client'.",
        },
        description: { type: "string", description: "Optional human-readable description." },
      },
      required: ["name"],
    },
    handler: async (args) =>
      formatResult(await bridge.sendCommand("scenario/create", args || {})),
  },

  // ─── MPPM Virtual Players (direct lifecycle, no scenario asset needed) ───
  {
    name: "unity_mppm_list_players",
    description:
      "List the 4 MPPM virtual-player slots and their current state " +
      "(NotLaunched / Launching / Launched / Communicative). Use this before " +
      "activating a player to verify slot availability.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => formatResult(await bridge.sendCommand("mppm/list-players", {})),
  },
  {
    name: "unity_mppm_activate_player",
    description:
      "Activate a Virtual Player (clone Unity Editor process). index must be 2, 3, or 4 " +
      "(Player 1 is the main editor). Returns immediately while the player is in 'Launching' " +
      "state — poll unity_mppm_list_players or unity_list_instances to detect when ready " +
      "(typically 30-60s on a cold project). Refuses to activate if there are pending compile " +
      "errors (returns ActivationError=CompileErrors).",
    inputSchema: {
      type: "object",
      properties: {
        index: { type: "integer", description: "Player slot to activate: 2, 3, or 4.", minimum: 2, maximum: 4 },
      },
      required: ["index"],
    },
    handler: async ({ index }) => formatResult(await bridge.sendCommand("mppm/activate-player", { index })),
  },
  {
    name: "unity_mppm_deactivate_player",
    description:
      "Deactivate a Virtual Player previously activated via unity_mppm_activate_player. " +
      "index must be 2, 3, or 4.",
    inputSchema: {
      type: "object",
      properties: {
        index: { type: "integer", description: "Player slot to deactivate: 2, 3, or 4.", minimum: 2, maximum: 4 },
      },
      required: ["index"],
    },
    handler: async ({ index }) => formatResult(await bridge.sendCommand("mppm/deactivate-player", { index })),
  },

  // ─── Testing ───
  {
    name: "unity_testing_run_tests",
    description:
      "Start a Unity Test Runner test run. Returns a job ID immediately — use unity_testing_get_job to poll for progress and results. " +
      "Supports EditMode and PlayMode tests with optional filters by test name, category, assembly, or group.",
    inputSchema: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          description: "Test mode: 'EditMode' or 'PlayMode' (default: EditMode)",
          enum: ["EditMode", "PlayMode"],
        },
        testNames: {
          type: "array",
          items: { type: "string" },
          description: "Run only tests matching these full names (e.g. ['MyNamespace.MyTestClass.MyTest'])",
        },
        categories: {
          type: "array",
          items: { type: "string" },
          description: "Run only tests in these NUnit categories",
        },
        assemblies: {
          type: "array",
          items: { type: "string" },
          description: "Run only tests from these assembly names (e.g. ['Augmentus.Repository.Tests'])",
        },
        groupNames: {
          type: "array",
          items: { type: "string" },
          description: "Regex patterns matched against the test fixture's FullName (Unity's Filter.groupNames). Class name like 'MountSmokeTests' runs every method on that class.",
        },
        filter: {
          type: "string",
          description: "Convenience alias forwarded into Unity's Filter.groupNames as a regex. Pass a class name (e.g. 'MountSmokeTests') or a regex; comma-separated values are split into multiple groupNames entries. Merges with any explicit groupNames array.",
        },
        clearStuck: {
          type: "boolean",
          description: "Force-clear a stuck test job before starting a new one",
        },
      },
    },
    handler: async (params) => {
      const result = await bridge.runTests(params);
      // Bridge wraps handler payloads as { success, data:{...} }, so the jobId/status
      // live under .data. Reading the top level made this early-feedback branch dead.
      const started = result.data ?? result;
      if (started.jobId && started.status === "running") {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          return formatResult(await bridge.getTestJob({ jobId: started.jobId }));
        } catch (_) {
          return formatResult(result);
        }
      }
      return formatResult(result);
    },
  },
  {
    name: "unity_testing_get_job",
    description:
      "Get the status and results of a test run job. If no jobId is provided, returns the latest job. " +
      "Poll this after calling unity_testing_run_tests until status is 'succeeded' or 'failed'. " +
      "Use waitTimeout for server-side polling to avoid repeated calls.",
    inputSchema: {
      type: "object",
      properties: {
        jobId: {
          type: "string",
          description: "The job ID returned by unity_testing_run_tests. Omit to get the latest job.",
        },
        includeDetails: {
          type: "boolean",
          description: "Include full results for every test (name, status, duration, message, stackTrace)",
        },
        includeFailedOnly: {
          type: "boolean",
          description: "Include detailed results only for failed/inconclusive tests",
        },
        waitTimeout: {
          type: "number",
          description:
            "Server-side wait timeout in seconds. If set, polls Unity every 2s until tests complete or timeout expires. " +
            "Reduces client-side polling. Recommended: 30-60 seconds.",
        },
      },
    },
    handler: async (params) => {
      const waitTimeout = params?.waitTimeout;
      if (waitTimeout && waitTimeout > 0) {
        // Server-side polling loop. Terminal status lives under .data (bridge envelope);
        // reading the top level meant this never short-circuited and always burned the
        // full timeout even when the run finished in seconds.
        const TERMINAL = new Set(["succeeded", "failed", "error", "cancelled", "canceled", "completed", "timedout"]);
        const deadline = Date.now() + waitTimeout * 1000;
        let lastResult;
        while (Date.now() < deadline) {
          lastResult = await bridge.getTestJob(params);
          const status = (lastResult?.data?.status ?? lastResult?.status ?? "").toLowerCase();
          if (TERMINAL.has(status)) {
            return formatResult(lastResult);
          }
          await new Promise((r) => setTimeout(r, 2000));
        }
        // Timeout — return last known state
        return formatResult(lastResult || (await bridge.getTestJob(params)));
      }
      return formatResult(await bridge.getTestJob(params));
    },
  },
  {
    name: "unity_testing_list_tests",
    description:
      "List available tests in the Unity project. Returns test names, categories, and run state. " +
      "Use this to discover what tests exist before running them.",
    inputSchema: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          description: "Test mode: 'EditMode' or 'PlayMode' (default: EditMode)",
          enum: ["EditMode", "PlayMode"],
        },
        nameFilter: {
          type: "string",
          description: "Filter tests by name (case-insensitive substring match)",
        },
        maxResults: {
          type: "number",
          description: "Maximum number of tests to return (default: 200)",
        },
      },
    },
    handler: async (params) => formatResult(await bridge.listTests(params || {})),
  },

  // ─── Sprite Atlas ───

  {
    name: "unity_spriteatlas_create",
    description: "Create a new SpriteAtlas asset at the given path.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path (e.g. 'Assets/Atlases/MyAtlas.spriteatlas')" },
        includeInBuild: { type: "boolean", description: "Include atlas in builds (default: true)" },
      },
      required: ["path"],
    },
    handler: async (params) => formatResult(await bridge.createSpriteAtlas(params)),
  },
  {
    name: "unity_spriteatlas_info",
    description: "Get SpriteAtlas details: packables, texture settings, packing settings.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path of the SpriteAtlas" },
      },
      required: ["path"],
    },
    handler: async (params) => formatResult(await bridge.getSpriteAtlasInfo(params)),
  },
  {
    name: "unity_spriteatlas_add",
    description: "Add sprites, textures, or folders to a SpriteAtlas.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path of the SpriteAtlas" },
        assetPaths: { type: "array", items: { type: "string" }, description: "Asset paths to add" },
        assetPath: { type: "string", description: "Single asset path to add (alternative to assetPaths)" },
      },
      required: ["path"],
    },
    handler: async (params) => formatResult(await bridge.addToSpriteAtlas(params)),
  },
  {
    name: "unity_spriteatlas_remove",
    description: "Remove packables from a SpriteAtlas.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path of the SpriteAtlas" },
        assetPaths: { type: "array", items: { type: "string" }, description: "Asset paths to remove" },
        assetPath: { type: "string", description: "Single asset path to remove (alternative to assetPaths)" },
      },
      required: ["path"],
    },
    handler: async (params) => formatResult(await bridge.removeFromSpriteAtlas(params)),
  },
  {
    name: "unity_spriteatlas_settings",
    description: "Update SpriteAtlas packing and texture settings.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path of the SpriteAtlas" },
        includeInBuild: { type: "boolean", description: "Include in builds" },
        enableRotation: { type: "boolean", description: "Allow sprite rotation during packing" },
        enableTightPacking: { type: "boolean", description: "Use tight packing" },
        padding: { type: "number", description: "Padding between sprites in pixels" },
        readable: { type: "boolean", description: "Make atlas texture readable" },
        generateMipMaps: { type: "boolean", description: "Generate mipmaps" },
        sRGB: { type: "boolean", description: "Use sRGB color space" },
        filterMode: { type: "string", description: "Texture filter mode (Point, Bilinear, Trilinear)" },
      },
      required: ["path"],
    },
    handler: async (params) => formatResult(await bridge.setSpriteAtlasSettings(params)),
  },
  {
    name: "unity_spriteatlas_delete",
    description: "Delete a SpriteAtlas asset.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path of the SpriteAtlas to delete" },
      },
      required: ["path"],
    },
    handler: async (params) => formatResult(await bridge.deleteSpriteAtlas(params)),
  },
  {
    name: "unity_spriteatlas_list",
    description: "Find all SpriteAtlas assets in the project, optionally filtered by folder.",
    inputSchema: {
      type: "object",
      properties: {
        folder: { type: "string", description: "Folder to search in (e.g. 'Assets/Atlases'). Omit to search entire project." },
      },
    },
    handler: async (params) => formatResult(await bridge.listSpriteAtlases(params)),
  },
];
