// MCP Tool definitions for Unity Editor operations (via HTTP bridge)
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
    description: "Set a property value on a component. Supports floats, ints, strings, bools, vectors, colors, and object references.",
    inputSchema: {
      type: "object",
      properties: {
        gameObjectPath: { type: "string", description: "Path or name of target GameObject" },
        componentType: { type: "string", description: "Component type name" },
        propertyName: { type: "string", description: "Name of the property to set" },
        value: { description: "Value to set (type depends on property)" },
      },
      required: ["gameObjectPath", "componentType", "propertyName", "value"],
    },
    handler: async (params) => JSON.stringify(await bridge.setComponentProperty(params), null, 2),
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
];
