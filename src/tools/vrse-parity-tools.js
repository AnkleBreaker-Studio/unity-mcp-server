import * as bridge from "../unity-editor-bridge.js";

// VRse parity tools — replace unity-mcp-pro tools the VRse build pipeline depends on
// but VrseBuilder MCP doesn't ship natively. Backing C# handlers live in
// VRseBuilderSDK-mcp-plugin/Editor/MCPParityCommands.cs and MCPSpatialCommands.cs.
//
// Schema strategy: keep the same param keys as unity-mcp-pro (snake_case where the original
// used snake_case, so existing skill files only need a tool-NAME rename, NOT param-shape edits.
// Param "shape" stays identical to unity-mcp-pro across this layer.

export const vrseParityTools = [
  // ─── #1 — batch_execute ─────────────────────────────────────────────
  {
    name: "unity_batch_execute",
    description:
      "Execute multiple MCP commands sequentially in one main-thread tick. " +
      "Preserves the unity-mcp-pro batch_execute semantics: index-aligned results array, " +
      "first-failure rollback when stop_on_error=true (default). " +
      "Each command is { method: 'api/path', params: { ... } }. Use this to bundle independent " +
      "operations (e.g. save_scene + get_compilation_errors + find_missing_references) into one round trip.",
    inputSchema: {
      type: "object",
      properties: {
        commands: {
          type: "array",
          description: "List of commands. Each: { method: 'scene/save', params: { ... } }",
          items: {
            type: "object",
            properties: {
              method: { type: "string", description: "API path, e.g. 'scene/save', 'gameobject/info'" },
              params: { type: "object", description: "Params dict for that command (optional)" },
            },
            required: ["method"],
          },
        },
        stop_on_error: {
          type: "boolean",
          description: "If true (default), halt on first failure and revert undo group. If false, run all commands and report each result.",
        },
      },
      required: ["commands"],
    },
    handler: async (params) => JSON.stringify(await bridge.sendCommand("vrse/parity/batch-execute", params), null, 2),
  },

  // ─── #2 — gameobject_components (all-components with values) ────────
  {
    name: "unity_gameobject_components",
    description:
      "Get ALL components on a GameObject with their full serialized property values. " +
      "Bridges the gap between unity_gameobject_info (component names only) and " +
      "unity_component_get_properties (one component at a time). Critical for the VRse build pipeline's " +
      "verification gates that check multiple required components in one call (e.g. grabbable must have " +
      "MetaXRGrabbableWrapper + NetworkGrabbableWrapper + GameObjectQuery).",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "GameObject hierarchy path or name" },
        instanceId: { type: "number", description: "Instance ID (alternative to path)" },
        include_properties: { type: "boolean", description: "Include serialized property values (default true). Set false for fast type-only list." },
        component_type: { type: "string", description: "Optional: filter to one component type name (e.g. 'BoxCollider')" },
      },
    },
    handler: async (params) => JSON.stringify(await bridge.sendCommand("vrse/parity/get-components", params), null, 2),
  },

  // ─── #3 — screenshot_inline (base64 inline for vision flow) ─────────
  {
    name: "unity_screenshot_inline",
    description:
      "Capture the Scene View camera as base64-encoded PNG/JPEG returned inline in the response " +
      "(not saved to disk). Use this when Claude needs to SEE the screenshot in the same turn — " +
      "the saved-to-disk variants (unity_screenshot_scene / unity_screenshot_game) return a path " +
      "and require an extra Read step. Used by the VRse build pipeline at 3 milestone checkpoints per build.",
    inputSchema: {
      type: "object",
      properties: {
        width:  { type: "number", description: "Image width in pixels (default 640, clamped 64-1920). Keep small — large images overflow the response cap." },
        height: { type: "number", description: "Image height in pixels (default 400, clamped 64-1080)." },
        format: { type: "string", description: "'jpg' (default, small) or 'png'. A size safety-net auto-downscales JPEG quality if the encode is too large." },
        quality: { type: "number", description: "JPEG quality 1-100 (default 70)." },
      },
    },
    handler: async (params) => JSON.stringify(await bridge.sendCommand("vrse/parity/get-screenshot-inline", params), null, 2),
  },

  // ─── #4 — search_all_loaded_scenes (additive-scene support) ─────────
  {
    name: "unity_search_all_loaded_scenes",
    description:
      "Find GameObjects by name across ALL loaded scenes (active + additively loaded). " +
      "Promotes the ListArtSceneObjects C# workaround into a first-class MCP tool. " +
      "Required for the VRse build pipeline which loads art scenes additively and needs to find " +
      "source objects there — unity_search_by_name only searches the active scene. " +
      "Returns matches with sceneName so callers can disambiguate which scene each result is in.",
    inputSchema: {
      type: "object",
      properties: {
        name_pattern: { type: "string", description: "Name to search for (substring or regex match)" },
        name:         { type: "string", description: "Alias for name_pattern (accepted for compatibility with unity_search_by_name callers)" },
        regex:        { type: "boolean", description: "Use regex matching instead of case-insensitive substring (default false)" },
        include_inactive: { type: "boolean", description: "Include inactive GameObjects (default true)" },
        scene_name:   { type: "string", description: "Optional: restrict to one scene name (e.g. 'Module_Art')" },
        limit:        { type: "number", description: "Max results to return (default 500)" },
      },
    },
    handler: async (params) => JSON.stringify(await bridge.sendCommand("vrse/parity/list-loaded-scenes", params), null, 2),
  },
];
