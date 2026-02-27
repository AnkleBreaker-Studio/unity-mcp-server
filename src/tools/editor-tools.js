// AnkleBreaker Unity MCP — Tool definitions for Unity Editor operations (via HTTP bridge)
import * as bridge from "../unity-editor-bridge.js";

export const editorTools = [
  // ─── Connection ───
  {
    name: "unity_editor_ping",
    description: "Check if the Unity Editor bridge is running and responsive. Returns editor version, project name, and connection status.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => JSON.stringify(await bridge.ping(), null, 2),
  },
  {
    name: "unity_editor_state",
    description: "Get the current Unity Editor state: play mode, compilation status, active scene, project path.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => JSON.stringify(await bridge.getEditorState(), null, 2),
  },

  // ─── Scene Management ───
  {
    name: "unity_scene_info",
    description: "Get information about the currently open scene(s), including name, path, dirty state, and root game objects.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => JSON.stringify(await bridge.getSceneInfo(), null, 2),
  },
  {
    name: "unity_scene_open",
    description: "Open a scene by its asset path (relative to Assets/).",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Scene asset path, e.g. 'Assets/Scenes/MainScene.unity'" },
      },
      required: ["path"],
    },
    handler: async ({ path }) => JSON.stringify(await bridge.openScene(path), null, 2),
  },
  {
    name: "unity_scene_save",
    description: "Save the current scene.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => JSON.stringify(await bridge.saveScene(), null, 2),
  },
  {
    name: "unity_scene_new",
    description: "Create a new empty scene.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => JSON.stringify(await bridge.newScene(), null, 2),
  },
  {
    name: "unity_scene_hierarchy",
    description: "Get the full hierarchy tree of all GameObjects in the active scene, including their components and children.",
    inputSchema: {
      type: "object",
      properties: {
        maxDepth: { type: "number", description: "Maximum depth to traverse (default: 10)" },
      },
    },
    handler: async (params) => JSON.stringify(await bridge.getHierarchy(params), null, 2),
  },

  // ─── GameObject Operations ───
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
    handler: async (params) => JSON.stringify(await bridge.createGameObject(params), null, 2),
  },
  {
    name: "unity_gameobject_delete",
    description: "Delete a GameObject from the scene by path or name.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Hierarchy path or name of the GameObject to delete" },
        instanceId: { type: "number", description: "Instance ID (alternative to path)" },
      },
    },
    handler: async (params) => JSON.stringify(await bridge.deleteGameObject(params), null, 2),
  },
  {
    name: "unity_gameobject_info",
    description: "Get detailed info about a specific GameObject: transform, components, children, active state, tags, layer.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Hierarchy path or name" },
        instanceId: { type: "number", description: "Instance ID (alternative to path)" },
      },
    },
    handler: async (params) => JSON.stringify(await bridge.getGameObjectInfo(params), null, 2),
  },
  {
    name: "unity_gameobject_set_transform",
    description: "Set the transform (position, rotation, scale) of a GameObject.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Hierarchy path or name" },
        instanceId: { type: "number", description: "Instance ID (alternative)" },
        position: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } } },
        rotation: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } } },
        scale: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } } },
        local: { type: "boolean", description: "If true, set local transform instead of world (default: false)" },
      },
    },
    handler: async (params) => JSON.stringify(await bridge.setTransform(params), null, 2),
  },

  // ─── Component Operations ───
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
    handler: async (params) => JSON.stringify(await bridge.addComponent(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.removeComponent(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.getComponentProperties(params), null, 2),
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
        value: { description: "Value to set (type depends on property). For ObjectReference: string asset path, string scene object name, null, or {assetPath?, instanceId?, gameObject?, componentType?}" },
      },
      required: ["gameObjectPath", "componentType", "propertyName", "value"],
    },
    handler: async (params) => JSON.stringify(await bridge.setComponentProperty(params), null, 2),
  },
  {
    name: "unity_component_set_reference",
    description: "Set an object reference on a component property. Dedicated tool for wiring references between GameObjects, components, and assets. More powerful than set_property for ObjectReference fields — supports resolution by asset path, scene GameObject name, component type, or instance ID.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Hierarchy path or name of the target GameObject" },
        instanceId: { type: "number", description: "Instance ID of the target GameObject (alternative to path)" },
        componentType: { type: "string", description: "Component type containing the property (optional — will auto-search all components)" },
        propertyName: { type: "string", description: "Name of the ObjectReference property to set" },
        assetPath: { type: "string", description: "Asset path to assign (e.g. 'Assets/Materials/MyMat.mat', 'Assets/Prefabs/Enemy.prefab')" },
        referenceGameObject: { type: "string", description: "Name or hierarchy path of a scene GameObject to assign" },
        referenceComponentType: { type: "string", description: "When referencing a scene object, get a specific component instead of the GameObject itself (e.g. 'Camera', 'AudioSource')" },
        referenceInstanceId: { type: "number", description: "Instance ID of the object to assign" },
        clear: { type: "boolean", description: "Set to true to clear/null the reference" },
      },
      required: ["propertyName"],
    },
    handler: async (params) => JSON.stringify(await bridge.setComponentReference(params), null, 2),
  },
  {
    name: "unity_component_batch_wire",
    description: "Wire multiple object references in a single call. Efficient for setting up many references at once (e.g. wiring a UI manager to all its panels, connecting enemy AI to patrol waypoints). Each entry specifies a target GameObject, property, and reference to assign.",
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
              instanceId: { type: "number", description: "Target GameObject instance ID" },
              componentType: { type: "string", description: "Component type (optional)" },
              propertyName: { type: "string", description: "Property name to set" },
              assetPath: { type: "string", description: "Asset path to assign" },
              referenceGameObject: { type: "string", description: "Scene GameObject to assign" },
              referenceComponentType: { type: "string", description: "Component type on the referenced GameObject" },
              referenceInstanceId: { type: "number", description: "Instance ID to assign" },
              clear: { type: "boolean", description: "Clear the reference" },
            },
            required: ["propertyName"],
          },
        },
      },
      required: ["references"],
    },
    handler: async (params) => JSON.stringify(await bridge.batchWireReferences(params), null, 2),
  },
  {
    name: "unity_component_get_referenceable",
    description: "Discover what objects can be assigned to an ObjectReference property. Returns matching scene objects and project assets filtered by the expected type. Useful before wiring references to know what's available.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Target GameObject path or name" },
        instanceId: { type: "number", description: "Target GameObject instance ID" },
        componentType: { type: "string", description: "Component type containing the property" },
        propertyName: { type: "string", description: "ObjectReference property name to inspect" },
        maxResults: { type: "number", description: "Maximum results to return (default: 50)" },
      },
      required: ["propertyName"],
    },
    handler: async (params) => JSON.stringify(await bridge.getReferenceableObjects(params), null, 2),
  },

  // ─── Asset Management ───
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
      },
    },
    handler: async (params) => JSON.stringify(await bridge.getAssetList(params), null, 2),
  },
  {
    name: "unity_asset_import",
    description: "Import an external file into the Unity project as an asset.",
    inputSchema: {
      type: "object",
      properties: {
        sourcePath: { type: "string", description: "Absolute path to the source file on disk" },
        destinationPath: { type: "string", description: "Destination path inside Assets/ folder" },
      },
      required: ["sourcePath", "destinationPath"],
    },
    handler: async (params) => JSON.stringify(await bridge.importAsset(params), null, 2),
  },
  {
    name: "unity_asset_delete",
    description: "Delete an asset from the project.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path relative to project root (e.g. 'Assets/Scripts/MyScript.cs')" },
      },
      required: ["path"],
    },
    handler: async (params) => JSON.stringify(await bridge.deleteAsset(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.createPrefab(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.instantiatePrefab(params), null, 2),
  },

  // ─── Script / Code Operations ───
  {
    name: "unity_script_create",
    description: "Create a new C# script file in the project with the given content.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path for the script (e.g. 'Assets/Scripts/PlayerController.cs')" },
        content: { type: "string", description: "Full C# source code content" },
        className: { type: "string", description: "Class name (defaults to filename without extension)" },
      },
      required: ["path", "content"],
    },
    handler: async (params) => JSON.stringify(await bridge.createScript(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.readScript(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.updateScript(params), null, 2),
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
    handler: async ({ code }) => JSON.stringify(await bridge.executeCode(code), null, 2),
  },

  // ─── Material / Rendering ───
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
      },
      required: ["path"],
    },
    handler: async (params) => JSON.stringify(await bridge.createMaterial(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.setMaterial(params), null, 2),
  },

  // ─── Build ───
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
    handler: async (params) => JSON.stringify(await bridge.buildProject(params), null, 2),
  },

  // ─── Console / Logging ───
  {
    name: "unity_console_log",
    description: "Get recent Unity console log messages (errors, warnings, info). Useful for debugging.",
    inputSchema: {
      type: "object",
      properties: {
        count: { type: "number", description: "Number of recent messages to retrieve (default: 50)" },
        type: { type: "string", description: "Filter: 'error', 'warning', 'info', or 'all' (default: 'all')" },
      },
    },
    handler: async (params) => JSON.stringify(await bridge.getConsoleLog(params), null, 2),
  },
  {
    name: "unity_console_clear",
    description: "Clear the Unity console log.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => JSON.stringify(await bridge.clearConsoleLog(), null, 2),
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
    handler: async ({ action }) => JSON.stringify(await bridge.playMode(action), null, 2),
  },

  // ─── Editor Menu ───
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
    handler: async ({ menuPath }) => JSON.stringify(await bridge.executeMenuItem(menuPath), null, 2),
  },

  // ─── Project Info ───
  {
    name: "unity_project_info",
    description: "Get project information: name, path, Unity version, render pipeline, packages, build settings.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => JSON.stringify(await bridge.getProjectInfo(), null, 2),
  },

  // ─── Animation ───
  {
    name: "unity_animation_create_controller",
    description: "Create a new Animator Controller asset at the specified path.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path for the controller (e.g. 'Assets/Animations/PlayerController.controller')" },
      },
      required: ["path"],
    },
    handler: async (params) => JSON.stringify(await bridge.createAnimatorController(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.getAnimatorControllerInfo(params), null, 2),
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
        defaultValue: { description: "Default value for the parameter (not applicable to Trigger)" },
      },
      required: ["controllerPath", "parameterName", "parameterType"],
    },
    handler: async (params) => JSON.stringify(await bridge.addAnimationParameter(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.removeAnimationParameter(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.addAnimationState(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.removeAnimationState(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.addAnimationTransition(params), null, 2),
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
      },
      required: ["path"],
    },
    handler: async (params) => JSON.stringify(await bridge.createAnimationClip(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.getAnimationClipInfo(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.setAnimationClipCurve(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.addAnimationLayer(params), null, 2),
  },
  {
    name: "unity_animation_assign_controller",
    description: "Assign an Animator Controller to a GameObject (adds Animator component if needed).",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Hierarchy path or name of the target GameObject" },
        instanceId: { type: "number", description: "Instance ID (alternative to path)" },
        controllerPath: { type: "string", description: "Asset path of the Animator Controller to assign" },
      },
      required: ["controllerPath"],
    },
    handler: async (params) => JSON.stringify(await bridge.assignAnimatorController(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.getCurveKeyframes(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.removeCurve(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.addKeyframe(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.removeKeyframe(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.addAnimationEvent(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.removeAnimationEvent(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.getAnimationEvents(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.setClipSettings(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.removeAnimationTransition(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.removeAnimationLayer(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.createBlendTree(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.getBlendTreeInfo(params), null, 2),
  },

  // ─── Prefab (Advanced) ───
  {
    name: "unity_prefab_info",
    description: "Get detailed prefab information: overrides, variant status, added/removed components. Works on both prefab assets and scene instances.",
    inputSchema: {
      type: "object",
      properties: {
        assetPath: { type: "string", description: "Asset path of the prefab (e.g. 'Assets/Prefabs/Player.prefab')" },
        path: { type: "string", description: "Hierarchy path of a prefab instance in the scene" },
        instanceId: { type: "number", description: "Instance ID of a prefab instance" },
      },
    },
    handler: async (params) => JSON.stringify(await bridge.getPrefabInfo(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.createPrefabVariant(params), null, 2),
  },
  {
    name: "unity_prefab_apply_overrides",
    description: "Apply all overrides from a prefab instance in the scene back to the source prefab asset.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Hierarchy path of the prefab instance" },
        instanceId: { type: "number", description: "Instance ID (alternative to path)" },
      },
    },
    handler: async (params) => JSON.stringify(await bridge.applyPrefabOverrides(params), null, 2),
  },
  {
    name: "unity_prefab_revert_overrides",
    description: "Revert all overrides on a prefab instance, restoring it to match the source prefab.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Hierarchy path of the prefab instance" },
        instanceId: { type: "number", description: "Instance ID (alternative to path)" },
      },
    },
    handler: async (params) => JSON.stringify(await bridge.revertPrefabOverrides(params), null, 2),
  },
  {
    name: "unity_prefab_unpack",
    description: "Unpack a prefab instance, converting it to regular GameObjects.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Hierarchy path of the prefab instance" },
        instanceId: { type: "number", description: "Instance ID (alternative to path)" },
        completely: { type: "boolean", description: "If true, unpack completely including nested prefabs (default: false)" },
      },
    },
    handler: async (params) => JSON.stringify(await bridge.unpackPrefab(params), null, 2),
  },
  {
    name: "unity_set_object_reference",
    description: "[LEGACY — prefer unity_component_set_reference] Set an object reference property on a component via the prefab system. Use unity_component_set_reference instead for richer resolution options.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Hierarchy path of the target GameObject" },
        instanceId: { type: "number", description: "Instance ID (alternative to path)" },
        componentType: { type: "string", description: "Component type name (optional - will search all components)" },
        propertyName: { type: "string", description: "Name of the ObjectReference property to set" },
        referencePath: { type: "string", description: "Asset path of the reference (for assets like prefabs, materials, textures)" },
        referenceGameObject: { type: "string", description: "Name/path of a GameObject in the scene (for scene references)" },
      },
      required: ["propertyName"],
    },
    handler: async (params) => JSON.stringify(await bridge.setObjectReference(params), null, 2),
  },
  {
    name: "unity_gameobject_duplicate",
    description: "Duplicate a GameObject with all its children and components.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Hierarchy path or name of the GameObject to duplicate" },
        instanceId: { type: "number", description: "Instance ID (alternative to path)" },
        newName: { type: "string", description: "Name for the duplicate (default: original name + ' (Copy)')" },
      },
    },
    handler: async (params) => JSON.stringify(await bridge.duplicateGameObject(params), null, 2),
  },
  {
    name: "unity_gameobject_set_active",
    description: "Set a GameObject active or inactive.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Hierarchy path or name of the GameObject" },
        instanceId: { type: "number", description: "Instance ID (alternative to path)" },
        active: { type: "boolean", description: "Whether the GameObject should be active" },
      },
      required: ["active"],
    },
    handler: async (params) => JSON.stringify(await bridge.setGameObjectActive(params), null, 2),
  },
  {
    name: "unity_gameobject_reparent",
    description: "Move a GameObject under a new parent in the hierarchy.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Hierarchy path or name of the GameObject to move" },
        instanceId: { type: "number", description: "Instance ID (alternative to path)" },
        newParent: { type: "string", description: "Path of the new parent (empty string for scene root)" },
        worldPositionStays: { type: "boolean", description: "Maintain world position after reparenting (default: true)" },
      },
    },
    handler: async (params) => JSON.stringify(await bridge.reparentGameObject(params), null, 2),
  },

  // ─── Prefab Asset (Direct Editing) ───
  {
    name: "unity_prefab_get_hierarchy",
    description: "Get the full hierarchy tree of a prefab asset directly from disk — no scene instance needed. Shows all GameObjects, components, and nested children inside the prefab.",
    inputSchema: {
      type: "object",
      properties: {
        assetPath: { type: "string", description: "Asset path of the prefab (e.g. 'Assets/Prefabs/Player.prefab')" },
        maxDepth: { type: "number", description: "Maximum hierarchy depth to traverse (default: 10)" },
      },
      required: ["assetPath"],
    },
    handler: async (params) => JSON.stringify(await bridge.getPrefabAssetHierarchy(params), null, 2),
  },
  {
    name: "unity_prefab_get_properties",
    description: "Read all serialized properties of a component on a GameObject inside a prefab asset — no scene instance needed. Use prefabPath to target nested children (e.g. 'Body/Head').",
    inputSchema: {
      type: "object",
      properties: {
        assetPath: { type: "string", description: "Asset path of the prefab (e.g. 'Assets/Prefabs/Player.prefab')" },
        prefabPath: { type: "string", description: "Path within the prefab hierarchy to the target GameObject (e.g. 'Body/Head'). Empty or omitted = prefab root." },
        componentType: { type: "string", description: "Component type name (e.g. 'MeshRenderer', 'PlayerController')" },
      },
      required: ["assetPath", "componentType"],
    },
    handler: async (params) => JSON.stringify(await bridge.getPrefabAssetProperties(params), null, 2),
  },
  {
    name: "unity_prefab_set_property",
    description: "Set a serialized property value on a component inside a prefab asset — no scene instance needed. Supports floats, ints, strings, bools, vectors, colors, enums.",
    inputSchema: {
      type: "object",
      properties: {
        assetPath: { type: "string", description: "Asset path of the prefab (e.g. 'Assets/Prefabs/Player.prefab')" },
        prefabPath: { type: "string", description: "Path within the prefab hierarchy (e.g. 'Body/Head'). Empty = root." },
        componentType: { type: "string", description: "Component type name" },
        propertyName: { type: "string", description: "Name of the property to set" },
        value: { description: "Value to set (type depends on property)" },
      },
      required: ["assetPath", "componentType", "propertyName"],
    },
    handler: async (params) => JSON.stringify(await bridge.setPrefabAssetProperty(params), null, 2),
  },
  {
    name: "unity_prefab_add_component",
    description: "Add a component to a GameObject inside a prefab asset — no scene instance needed. Supports built-in types (Rigidbody, BoxCollider, etc.) and custom scripts.",
    inputSchema: {
      type: "object",
      properties: {
        assetPath: { type: "string", description: "Asset path of the prefab" },
        prefabPath: { type: "string", description: "Path within the prefab hierarchy. Empty = root." },
        componentType: { type: "string", description: "Full type name (e.g. 'Rigidbody', 'BoxCollider', 'MyNamespace.MyScript')" },
      },
      required: ["assetPath", "componentType"],
    },
    handler: async (params) => JSON.stringify(await bridge.addPrefabAssetComponent(params), null, 2),
  },
  {
    name: "unity_prefab_remove_component",
    description: "Remove a component from a GameObject inside a prefab asset — no scene instance needed.",
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
    handler: async (params) => JSON.stringify(await bridge.removePrefabAssetComponent(params), null, 2),
  },
  {
    name: "unity_prefab_set_reference",
    description: "Wire an ObjectReference property on a component inside a prefab asset — no scene instance needed. Can reference project assets (materials, textures, prefabs, ScriptableObjects) or other GameObjects within the same prefab.",
    inputSchema: {
      type: "object",
      properties: {
        assetPath: { type: "string", description: "Asset path of the prefab" },
        prefabPath: { type: "string", description: "Path within the prefab hierarchy. Empty = root." },
        componentType: { type: "string", description: "Component type (optional — searches all if omitted)" },
        propertyName: { type: "string", description: "Name of the ObjectReference property to set" },
        referenceAssetPath: { type: "string", description: "Asset path of the reference target (e.g. 'Assets/Materials/Red.mat')" },
        referencePrefabPath: { type: "string", description: "Path to another GameObject within the same prefab (e.g. 'Body/Head')" },
        referenceComponentType: { type: "string", description: "Get a specific component on the referenced prefab GameObject" },
        clear: { type: "boolean", description: "Set to true to null out the reference" },
      },
      required: ["assetPath", "propertyName"],
    },
    handler: async (params) => JSON.stringify(await bridge.setPrefabAssetReference(params), null, 2),
  },
  {
    name: "unity_prefab_add_gameobject",
    description: "Create a new child GameObject inside a prefab asset — no scene instance needed. Optionally create as a primitive (Cube, Sphere, etc.) with position/rotation/scale.",
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
    handler: async (params) => JSON.stringify(await bridge.addPrefabAssetGameObject(params), null, 2),
  },
  {
    name: "unity_prefab_remove_gameobject",
    description: "Delete a child GameObject from inside a prefab asset — no scene instance needed. Cannot remove the prefab root.",
    inputSchema: {
      type: "object",
      properties: {
        assetPath: { type: "string", description: "Asset path of the prefab" },
        prefabPath: { type: "string", description: "Path to the child GameObject to remove (e.g. 'Body/OldPart'). Cannot be empty (can't delete root)." },
      },
      required: ["assetPath", "prefabPath"],
    },
    handler: async (params) => JSON.stringify(await bridge.removePrefabAssetGameObject(params), null, 2),
  },

  // ─── Prefab Variant Management ───
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
    handler: async (params) => JSON.stringify(await bridge.getPrefabVariantInfo(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.comparePrefabVariantToBase(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.applyPrefabVariantOverride(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.revertPrefabVariantOverride(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.transferPrefabVariantOverrides(params), null, 2),
  },

  // ─── Physics ───
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
    handler: async (params) => JSON.stringify(await bridge.physicsRaycast(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.physicsOverlapSphere(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.physicsOverlapBox(params), null, 2),
  },
  {
    name: "unity_physics_collision_matrix",
    description: "Get the physics collision matrix showing which layers collide with each other.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => JSON.stringify(await bridge.getCollisionMatrix(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.setCollisionLayer(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.setGravity(params), null, 2),
  },

  // ─── Lighting ───
  {
    name: "unity_lighting_info",
    description: "Get info about all lights in the scene plus environment/fog settings.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => JSON.stringify(await bridge.getLightingInfo(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.createLight(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.setEnvironment(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.createReflectionProbe(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.createLightProbeGroup(params), null, 2),
  },

  // ─── Audio ───
  {
    name: "unity_audio_info",
    description: "Get info about all AudioSources and AudioListeners in the scene.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => JSON.stringify(await bridge.getAudioInfo(params), null, 2),
  },
  {
    name: "unity_audio_create_source",
    description: "Create or configure an AudioSource on a GameObject. Can attach to existing object or create new one.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name for new GameObject (if not attaching to existing)" },
        path: { type: "string", description: "Path of existing GameObject to attach AudioSource to" },
        instanceId: { type: "integer", description: "Instance ID of existing GameObject" },
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
    handler: async (params) => JSON.stringify(await bridge.createAudioSource(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.setGlobalAudio(params), null, 2),
  },

  // ─── Tags & Layers ───
  {
    name: "unity_taglayer_info",
    description: "Get all tags, layers, and sorting layers in the project.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => JSON.stringify(await bridge.getTagsAndLayers(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.addTag(params), null, 2),
  },
  {
    name: "unity_taglayer_set_tag",
    description: "Assign a tag to a GameObject.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "GameObject path" },
        instanceId: { type: "integer", description: "GameObject instance ID" },
        tag: { type: "string", description: "Tag to assign" },
      },
      required: ["tag"],
    },
    handler: async (params) => JSON.stringify(await bridge.setTag(params), null, 2),
  },
  {
    name: "unity_taglayer_set_layer",
    description: "Assign a layer to a GameObject, optionally including children.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "GameObject path" },
        instanceId: { type: "integer", description: "GameObject instance ID" },
        layer: { type: "integer", description: "Layer index (0-31)" },
        layerName: { type: "string", description: "Layer name (alternative to index)" },
        includeChildren: { type: "boolean", description: "Apply to all children recursively" },
      },
    },
    handler: async (params) => JSON.stringify(await bridge.setLayer(params), null, 2),
  },
  {
    name: "unity_taglayer_set_static",
    description: "Set a GameObject as static or not, optionally including children.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "GameObject path" },
        instanceId: { type: "integer", description: "GameObject instance ID" },
        isStatic: { type: "boolean", description: "True to mark static" },
        includeChildren: { type: "boolean", description: "Apply to all children recursively" },
      },
    },
    handler: async (params) => JSON.stringify(await bridge.setStatic(params), null, 2),
  },

  // ─── Selection & Scene View ───
  {
    name: "unity_selection_get",
    description: "Get the currently selected GameObjects in the Unity Editor.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => JSON.stringify(await bridge.getSelection(params), null, 2),
  },
  {
    name: "unity_selection_set",
    description: "Set the editor selection to specific GameObjects.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Single GameObject path to select" },
        paths: { type: "array", items: { type: "string" }, description: "Multiple GameObject paths to select" },
        instanceId: { type: "integer", description: "Instance ID of GameObject to select" },
      },
    },
    handler: async (params) => JSON.stringify(await bridge.setSelection(params), null, 2),
  },
  {
    name: "unity_selection_focus_scene_view",
    description: "Control the Scene View camera: frame a GameObject, set pivot/rotation/zoom, toggle orthographic.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "GameObject to frame in scene view" },
        instanceId: { type: "integer", description: "Instance ID of GameObject to frame" },
        position: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } }, description: "Scene view pivot position" },
        rotation: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } }, description: "Scene view rotation (euler angles)" },
        size: { type: "number", description: "Scene view zoom (camera distance)" },
        orthographic: { type: "boolean", description: "Toggle orthographic/perspective" },
      },
    },
    handler: async (params) => JSON.stringify(await bridge.focusSceneView(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.findObjectsByType(params), null, 2),
  },

  // ─── Agent Management ───
  {
    // ─── Input Actions ───
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
    handler: async (params) => JSON.stringify(await bridge.createInputActions(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.getInputActionsInfo(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.addInputActionMap(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.removeInputActionMap(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.addInputAction(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.removeInputAction(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.addInputBinding(params), null, 2),
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
          description: "Composite parts — each has a 'name' (e.g. 'positive','negative','up','down','left','right') and 'path' (e.g. '<Keyboard>/w')",
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
    handler: async (params) => JSON.stringify(await bridge.addInputCompositeBinding(params), null, 2),
  },

  // ─── Assembly Definitions ───
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
          description: "Assembly references — names (e.g. 'Unity.TextMeshPro') or GUID refs (e.g. 'GUID:xxx')",
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
          description: "Define constraints — assembly only compiles when ALL symbols are defined (e.g. 'UNITY_EDITOR', 'ENABLE_INPUT_SYSTEM')",
          items: { type: "string" },
        },
      },
      required: ["path"],
    },
    handler: async (params) => JSON.stringify(await bridge.createAssemblyDef(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.getAssemblyDefInfo(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.listAssemblyDefs(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.addAssemblyDefReferences(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.removeAssemblyDefReferences(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.setAssemblyDefPlatforms(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.updateAssemblyDefSettings(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.createAssemblyRef(params), null, 2),
  },

  // ─── Profiler ───
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
    handler: async (params) => JSON.stringify(await bridge.enableProfiler(params), null, 2),
  },
  {
    name: "unity_profiler_stats",
    description: "Get current rendering statistics: draw calls, batches, triangles, vertices, set-pass calls, frame time, render time, shadow casters, and more. The profiler does NOT need to be enabled for this — stats come from UnityStats which is always available.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => JSON.stringify(await bridge.getRenderingStats(params), null, 2),
  },
  {
    name: "unity_profiler_memory",
    description: "Get detailed memory usage breakdown: total allocated, reserved, Mono heap used/size, graphics driver memory, temp allocator size, and GC info. Values are returned in both bytes and human-readable MB.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => JSON.stringify(await bridge.getMemoryInfo(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.getProfilerFrameData(params), null, 2),
  },
  {
    name: "unity_profiler_analyze",
    description: "Run a comprehensive performance analysis combining memory, rendering stats, profiler frame data, and scene complexity. Returns optimization suggestions based on configurable thresholds (e.g. too many batches, high triangle count, excessive set-pass calls, GPU memory usage, shadow casters).",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => JSON.stringify(await bridge.analyzePerformance(params), null, 2),
  },

  // ─── Frame Debugger ───
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
    handler: async (params) => JSON.stringify(await bridge.enableFrameDebugger(params), null, 2),
  },
  {
    name: "unity_debugger_events",
    description: "List all rendering events (draw calls) captured by the Frame Debugger. The Frame Debugger must be enabled first. Returns event index, type, and name for each draw call.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => JSON.stringify(await bridge.getFrameDebuggerEvents(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.getFrameDebuggerEventDetails(params), null, 2),
  },

  // ─── Memory Profiler ───
  {
    name: "unity_memory_status",
    description: "Check Memory Profiler status: whether the com.unity.memoryprofiler package is installed, available commands, and a quick memory summary. Always call this first before other memory profiler commands.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => JSON.stringify(await bridge.getMemoryStatus(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.getMemoryBreakdown(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.getTopMemoryConsumers(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.takeMemorySnapshot(params), null, 2),
  },

  // ─── Shader Graph ───
  {
    name: "unity_shadergraph_status",
    description: "Check which graph packages are installed: Shader Graph (com.unity.shadergraph) and Visual Effect Graph (com.unity.visualeffectgraph). Returns available commands based on installed packages.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => JSON.stringify(await bridge.getShaderGraphStatus(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.listShaders(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.listShaderGraphs(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.getShaderGraphInfo(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.getShaderProperties(params), null, 2),
  },
  {
    name: "unity_shadergraph_create",
    description: "Create a new Shader Graph from a template. Templates: urp_lit, urp_unlit, urp_sprite_lit, urp_sprite_unlit, urp_decal, hdrp_lit, hdrp_unlit, blank. Requires Shader Graph package.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path for the new shader graph (e.g. 'Assets/Shaders/MyShader.shadergraph')" },
        template: { type: "string", description: "Template type: urp_lit, urp_unlit, urp_sprite_lit, urp_sprite_unlit, urp_decal, hdrp_lit, hdrp_unlit, blank (default: urp_lit)" },
      },
      required: ["path"],
    },
    handler: async (params) => JSON.stringify(await bridge.createShaderGraph(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.openShaderGraph(params), null, 2),
  },
  {
    name: "unity_shadergraph_list_subgraphs",
    description: "List all Sub Graph (.shadersubgraph) assets in the project. Sub Graphs are reusable node groups for Shader Graphs. Requires Shader Graph package.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => JSON.stringify(await bridge.listSubGraphs(params), null, 2),
  },
  {
    name: "unity_vfx_list",
    description: "List all Visual Effect Graph assets in the project. Requires Visual Effect Graph package (com.unity.visualeffectgraph).",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => JSON.stringify(await bridge.listVFXGraphs(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.openVFXGraph(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.getShaderGraphNodes(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.getShaderGraphEdges(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.addShaderGraphNode(params), null, 2),
  },
  {
    name: "unity_shadergraph_remove_node",
    description: "Remove a node from a Shader Graph by its ID. Also removes all edges connected to the node.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path of the .shadergraph file" },
        nodeId: { type: "string", description: "The node's objectId (GUID) to remove — get from get_nodes" },
      },
      required: ["path", "nodeId"],
    },
    handler: async (params) => JSON.stringify(await bridge.removeShaderGraphNode(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.connectShaderGraphNodes(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.disconnectShaderGraphNodes(params), null, 2),
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
        value: { description: "New value — string, number, or boolean depending on the property" },
      },
      required: ["path", "nodeId", "propertyName", "value"],
    },
    handler: async (params) => JSON.stringify(await bridge.setShaderGraphNodeProperty(params), null, 2),
  },
  {
    name: "unity_shadergraph_get_node_types",
    description: "List all available Shader Graph node types by reflecting over the ShaderGraph assembly. Returns type names, categories, and full class names. Useful for discovering available nodes before adding them.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => JSON.stringify(await bridge.getShaderGraphNodeTypes(params), null, 2),
  },

  // ─── Amplify Shader Editor ───
  {
    name: "unity_amplify_status",
    description: "Check if Amplify Shader Editor is installed in the project. Returns available commands, shader count, and function count. Only works when Amplify Shader Editor is imported.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => JSON.stringify(await bridge.getAmplifyStatus(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.listAmplifyShaders(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.getAmplifyShaderInfo(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.openAmplifyShader(params), null, 2),
  },
  {
    name: "unity_amplify_list_functions",
    description: "List all Amplify Shader Functions in the project. Functions are reusable node groups (similar to Shader Graph Sub Graphs). Only available when Amplify is installed.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => JSON.stringify(await bridge.listAmplifyFunctions(params), null, 2),
  },
  {
    name: "unity_amplify_get_node_types",
    description: "List all available Amplify Shader Editor node types by reflecting over the ASE assembly. Returns type names, categories, and descriptions. Requires Amplify to be installed.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => JSON.stringify(await bridge.getAmplifyNodeTypes(params), null, 2),
  },
  {
    name: "unity_amplify_get_nodes",
    description: "Get all nodes in the currently open Amplify Shader Editor graph. Returns node IDs, types, positions, and port counts. The ASE window must be open with a shader loaded.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => JSON.stringify(await bridge.getAmplifyGraphNodes(params), null, 2),
  },
  {
    name: "unity_amplify_get_connections",
    description: "Get all connections between nodes in the currently open Amplify Shader Editor graph. Shows which output ports connect to which input ports.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => JSON.stringify(await bridge.getAmplifyGraphConnections(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.createAmplifyShader(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.addAmplifyNode(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.removeAmplifyNode(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.connectAmplifyNodes(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.disconnectAmplifyNodes(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.getAmplifyNodeInfo(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.setAmplifyNodeProperty(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.moveAmplifyNode(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.saveAmplifyGraph(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.closeAmplifyEditor(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.createAmplifyFromTemplate(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.focusAmplifyNode(params), null, 2),
  },
  {
    name: "unity_amplify_master_node_info",
    description: "Get detailed information about the master/output node of the currently open Amplify shader graph, including all its input ports and properties.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => JSON.stringify(await bridge.getAmplifyMasterNodeInfo(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.disconnectAllAmplifyNode(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.duplicateAmplifyNode(params), null, 2),
  },

  // ─── Search & Find ───
  {
    name: "unity_search_by_component",
    description: "Find all GameObjects in the scene that have a specific component type. Returns their paths and instance IDs.",
    inputSchema: {
      type: "object",
      properties: {
        componentType: { type: "string", description: "Component type name (e.g. 'Rigidbody', 'Camera', 'AudioSource', 'MyScript')" },
        includeInactive: { type: "boolean", description: "Include inactive GameObjects (default: false)" },
      },
      required: ["componentType"],
    },
    handler: async (params) => JSON.stringify(await bridge.findByComponent(params), null, 2),
  },
  {
    name: "unity_search_by_tag",
    description: "Find all GameObjects with a specific tag.",
    inputSchema: {
      type: "object",
      properties: {
        tag: { type: "string", description: "Tag name (e.g. 'Player', 'Enemy', 'MainCamera')" },
      },
      required: ["tag"],
    },
    handler: async (params) => JSON.stringify(await bridge.findByTag(params), null, 2),
  },
  {
    name: "unity_search_by_layer",
    description: "Find all GameObjects on a specific layer.",
    inputSchema: {
      type: "object",
      properties: {
        layer: { type: "string", description: "Layer name or index (e.g. 'UI', 'Water', '5')" },
      },
      required: ["layer"],
    },
    handler: async (params) => JSON.stringify(await bridge.findByLayer(params), null, 2),
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
      },
      required: ["name"],
    },
    handler: async (params) => JSON.stringify(await bridge.findByName(params), null, 2),
  },
  {
    name: "unity_search_by_shader",
    description: "Find all renderers using a specific shader.",
    inputSchema: {
      type: "object",
      properties: {
        shader: { type: "string", description: "Shader name to search for (partial match)" },
      },
      required: ["shader"],
    },
    handler: async (params) => JSON.stringify(await bridge.findByShader(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.searchAssets(params), null, 2),
  },
  {
    name: "unity_search_missing_references",
    description: "Find all missing/broken object references and missing scripts in the scene. Essential for cleanup and debugging.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", description: "'scene' (default) or 'assets'" },
      },
    },
    handler: async (params) => JSON.stringify(await bridge.findMissingReferences(params), null, 2),
  },
  {
    name: "unity_scene_stats",
    description: "Get comprehensive scene statistics: total objects, vertices, triangles, lights, cameras, colliders, and top component types.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => JSON.stringify(await bridge.getSceneStats(params), null, 2),
  },

  // ─── Project Settings ───
  {
    name: "unity_settings_quality",
    description: "Get current quality settings: level, shadows, anti-aliasing, LOD bias, vsync, and all quality levels available.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => JSON.stringify(await bridge.getQualitySettings(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.setQualityLevel(params), null, 2),
  },
  {
    name: "unity_settings_physics",
    description: "Get physics settings: gravity, solver iterations, sleep threshold, contact offset, bounce threshold.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => JSON.stringify(await bridge.getPhysicsSettings(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.setPhysicsSettings(params), null, 2),
  },
  {
    name: "unity_settings_time",
    description: "Get time settings: fixedDeltaTime, maximumDeltaTime, timeScale.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => JSON.stringify(await bridge.getTimeSettings(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.setTimeSettings(params), null, 2),
  },
  {
    name: "unity_settings_player",
    description: "Get player settings: company name, product name, version, color space, scripting backend, target architecture.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => JSON.stringify(await bridge.getPlayerSettings(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.setPlayerSettings(params), null, 2),
  },
  {
    name: "unity_settings_render_pipeline",
    description: "Get information about the current render pipeline (Built-in, URP, HDRP).",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => JSON.stringify(await bridge.getRenderPipelineInfo(params), null, 2),
  },

  // ─── Undo ───
  {
    name: "unity_undo",
    description: "Undo the last operation in Unity Editor.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => JSON.stringify(await bridge.performUndo(params), null, 2),
  },
  {
    name: "unity_redo",
    description: "Redo the last undone operation in Unity Editor.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => JSON.stringify(await bridge.performRedo(params), null, 2),
  },
  {
    name: "unity_undo_history",
    description: "Get information about the current undo group.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => JSON.stringify(await bridge.getUndoHistory(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.clearUndo(params), null, 2),
  },

  // ─── Screenshot / Scene View ───
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
    handler: async (params) => JSON.stringify(await bridge.captureGameView(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.captureSceneView(params), null, 2),
  },
  {
    name: "unity_sceneview_info",
    description: "Get Scene View camera info: pivot position, rotation, zoom, orthographic mode, 2D mode.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => JSON.stringify(await bridge.getSceneViewInfo(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.setSceneViewCamera(params), null, 2),
  },

  // ─── Graphics & Visuals ───
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
    handler: async (params) => {
      const result = await bridge.captureAssetPreview(params);
      if (result.error) return JSON.stringify(result, null, 2);
      const metadata = { ...result };
      delete metadata.base64;
      return [
        { type: "image", data: result.base64, mimeType: "image/png" },
        { type: "text", text: JSON.stringify(metadata, null, 2) },
      ];
    },
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
    handler: async (params) => {
      const result = await bridge.captureSceneViewGraphics(params);
      if (result.error) return JSON.stringify(result, null, 2);
      const metadata = { ...result };
      delete metadata.base64;
      return [
        { type: "image", data: result.base64, mimeType: "image/png" },
        { type: "text", text: JSON.stringify(metadata, null, 2) },
      ];
    },
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
    handler: async (params) => {
      const result = await bridge.captureGameViewGraphics(params);
      if (result.error) return JSON.stringify(result, null, 2);
      const metadata = { ...result };
      delete metadata.base64;
      return [
        { type: "image", data: result.base64, mimeType: "image/png" },
        { type: "text", text: JSON.stringify(metadata, null, 2) },
      ];
    },
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
    handler: async (params) => {
      const result = await bridge.renderPrefabPreview(params);
      if (result.error) return JSON.stringify(result, null, 2);
      const metadata = { ...result };
      delete metadata.base64;
      return [
        { type: "image", data: result.base64, mimeType: "image/png" },
        { type: "text", text: JSON.stringify(metadata, null, 2) },
      ];
    },
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
      JSON.stringify(await bridge.getMeshInfo(params), null, 2),
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
      if (result.error) return JSON.stringify(result, null, 2);
      if (result.base64) {
        const metadata = { ...result };
        delete metadata.base64;
        return [
          { type: "image", data: result.base64, mimeType: "image/png" },
          { type: "text", text: JSON.stringify(metadata, null, 2) },
        ];
      }
      return JSON.stringify(result, null, 2);
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
      if (result.error) return JSON.stringify(result, null, 2);
      if (result.base64) {
        const metadata = { ...result };
        delete metadata.base64;
        return [
          { type: "image", data: result.base64, mimeType: "image/png" },
          { type: "text", text: JSON.stringify(metadata, null, 2) },
        ];
      }
      return JSON.stringify(result, null, 2);
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
      JSON.stringify(await bridge.getRendererInfo(params), null, 2),
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
      JSON.stringify(await bridge.getLightingSummary(params), null, 2),
  },

  // ─── Terrain ───
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
      },
    },
    handler: async (params) => JSON.stringify(await bridge.createTerrain(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.getTerrainInfo(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.setTerrainHeight(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.flattenTerrain(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.addTerrainLayer(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.getTerrainHeight(params), null, 2),
  },

  // ─── Particle System ───
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
    handler: async (params) => JSON.stringify(await bridge.createParticleSystem(params), null, 2),
  },
  {
    name: "unity_particle_info",
    description: "Get detailed Particle System info: main module, emission, shape, and all module enable states.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "GameObject path" },
        instanceId: { type: "number", description: "Instance ID (alternative)" },
      },
    },
    handler: async (params) => JSON.stringify(await bridge.getParticleSystemInfo(params), null, 2),
  },
  {
    name: "unity_particle_set_main",
    description: "Configure the main module of a Particle System: duration, lifetime, speed, size, gravity, simulation space.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "GameObject path" },
        instanceId: { type: "number", description: "Instance ID (alternative)" },
        duration: { type: "number" }, loop: { type: "boolean" },
        startLifetime: { type: "number" }, startSpeed: { type: "number" },
        startSize: { type: "number" }, startRotation: { type: "number" },
        maxParticles: { type: "number" }, gravityModifier: { type: "number" },
        playOnAwake: { type: "boolean" },
        simulationSpace: { type: "string", description: "Local, World, or Custom" },
      },
    },
    handler: async (params) => JSON.stringify(await bridge.setParticleMainModule(params), null, 2),
  },
  {
    name: "unity_particle_set_emission",
    description: "Configure particle emission: rate over time, rate over distance.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "GameObject path" },
        instanceId: { type: "number", description: "Instance ID (alternative)" },
        enabled: { type: "boolean" },
        rateOverTime: { type: "number", description: "Particles emitted per second" },
        rateOverDistance: { type: "number", description: "Particles emitted per unit distance" },
      },
    },
    handler: async (params) => JSON.stringify(await bridge.setParticleEmission(params), null, 2),
  },
  {
    name: "unity_particle_set_shape",
    description: "Configure the emission shape: Sphere, Hemisphere, Cone, Box, Circle, Edge, etc.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "GameObject path" },
        instanceId: { type: "number", description: "Instance ID (alternative)" },
        enabled: { type: "boolean" },
        shapeType: { type: "string", description: "Shape type: Sphere, Hemisphere, Cone, Box, Circle, Edge, Rectangle, etc." },
        radius: { type: "number" }, angle: { type: "number" },
        arc: { type: "number" }, radiusThickness: { type: "number", description: "0 = emit from surface only, 1 = emit from entire volume" },
      },
    },
    handler: async (params) => JSON.stringify(await bridge.setParticleShape(params), null, 2),
  },
  {
    name: "unity_particle_playback",
    description: "Control particle system playback: play, stop, pause, restart, or clear.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "GameObject path" },
        instanceId: { type: "number", description: "Instance ID (alternative)" },
        action: { type: "string", description: "play, stop, pause, restart, or clear" },
      },
      required: ["action"],
    },
    handler: async (params) => JSON.stringify(await bridge.particlePlayback(params), null, 2),
  },

  // ─── ScriptableObject ───
  {
    name: "unity_scriptableobject_create",
    description: "Create a new ScriptableObject asset from a C# type. The type must already exist as a compiled script.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", description: "Full type name (e.g. 'GameSettings', 'MyNamespace.PlayerData')" },
        path: { type: "string", description: "Asset path (default: Assets/TypeName.asset)" },
      },
      required: ["type"],
    },
    handler: async (params) => JSON.stringify(await bridge.createScriptableObject(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.getScriptableObjectInfo(params), null, 2),
  },
  {
    name: "unity_scriptableobject_set_field",
    description: "Set a field value on a ScriptableObject asset. Supports int, float, bool, string, and enum types.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Asset path of the ScriptableObject" },
        field: { type: "string", description: "Property/field name" },
        value: { description: "Value to set (type depends on field)" },
      },
      required: ["path", "field", "value"],
    },
    handler: async (params) => JSON.stringify(await bridge.setScriptableObjectField(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.listScriptableObjectTypes(params), null, 2),
  },

  // ─── Texture ───
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
    handler: async (params) => JSON.stringify(await bridge.getTextureInfo(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.setTextureImportSettings(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.reimportTexture(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.setTextureAsSprite(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.setTextureAsNormalMap(params), null, 2),
  },

  // ─── Navigation ───

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
    handler: async (params) => JSON.stringify(await bridge.bakeNavMesh(params), null, 2),
  },
  {
    name: "unity_navmesh_clear",
    description: "Clear all baked NavMeshes from the scene.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => JSON.stringify(await bridge.clearNavMesh(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.addNavMeshAgent(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.addNavMeshObstacle(params), null, 2),
  },
  {
    name: "unity_navmesh_info",
    description: "Get NavMesh information: vertex/triangle count, agents, obstacles, agent types.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => JSON.stringify(await bridge.getNavMeshInfo(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.setAgentDestination(params), null, 2),
  },

  // ─── UI ───

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
    handler: async (params) => JSON.stringify(await bridge.createCanvas(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.createUIElement(params), null, 2),
  },
  {
    name: "unity_ui_info",
    description: "Get UI information: canvases, text/image/button counts.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => JSON.stringify(await bridge.getUIInfo(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.setUIText(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.setUIImage(params), null, 2),
  },

  // ─── Package Manager ───

  {
    name: "unity_packages_list",
    description: "List all installed Unity packages with their name, version, source, and status.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => JSON.stringify(await bridge.listPackages(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.addPackage(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.removePackage(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.searchPackage(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.getPackageInfo(params), null, 2),
  },

  // ─── Constraints & LOD ───

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
    handler: async (params) => JSON.stringify(await bridge.addConstraint(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.getConstraintInfo(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.createLODGroup(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.getLODGroupInfo(params), null, 2),
  },

  // ─── Prefs ───

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
    handler: async (params) => JSON.stringify(await bridge.getEditorPref(params), null, 2),
  },
  {
    name: "unity_editorprefs_set",
    description: "Set an EditorPrefs value. Specify type: string (default), int, float, bool.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Preference key" },
        value: { description: "Value to set" },
        type: { type: "string", description: "Value type: string, int, float, bool" },
      },
      required: ["key", "value"],
    },
    handler: async (params) => JSON.stringify(await bridge.setEditorPref(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.deleteEditorPref(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.getPlayerPref(params), null, 2),
  },
  {
    name: "unity_playerprefs_set",
    description: "Set a PlayerPrefs value. Specify type: string (default), int, float.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Preference key" },
        value: { description: "Value to set" },
        type: { type: "string", description: "Value type: string, int, float" },
      },
      required: ["key", "value"],
    },
    handler: async (params) => JSON.stringify(await bridge.setPlayerPref(params), null, 2),
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
    handler: async (params) => JSON.stringify(await bridge.deletePlayerPref(params), null, 2),
  },
  {
    name: "unity_playerprefs_delete_all",
    description: "Delete ALL PlayerPrefs. Use with caution.",
    inputSchema: { type: "object", properties: {} },
    handler: async (params) => JSON.stringify(await bridge.deleteAllPlayerPrefs(params), null, 2),
  },

  // ─── Queue Management (Multi-Agent) ───
  {
    name: "unity_queue_info",
    description:
      "Get the current state of the multi-agent request queue: total queued requests, active agents, per-agent queue depths, and completed cache size. Useful for monitoring when multiple agents are working on the same Unity project.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => JSON.stringify(await bridge.getQueueInfo(), null, 2),
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
      JSON.stringify(await bridge.getTicketStatus(ticketId), null, 2),
  },
  {
    name: "unity_agents_list",
    description:
      "List all active agent sessions connected to the AB Unity MCP bridge. Shows each agent's ID, connection time, last activity, current action, total actions count, queued/completed request counts, and average response time.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => JSON.stringify(await bridge.listAgents(), null, 2),
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
      JSON.stringify(await bridge.getAgentLog(params), null, 2),
  },
];
