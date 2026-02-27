// AnkleBreaker Unity MCP — Two-tier tool system
// Reduces the exposed tool count to avoid overwhelming MCP clients.
//
// Core tools: Always exposed as individual MCP tools (~60 tools)
// Advanced tools: Accessed via unity_advanced_tool (200+ tools)
//
// Why: MCP clients like Claude Cowork silently fail when a server
// exposes too many tools (our 268 tools / 125KB response was ~5x
// larger than working servers). This keeps us under the safe limit.

// ─── Core tool names (always exposed individually) ───
const CORE_TOOLS = new Set([
  // Connection & state
  "unity_editor_ping",
  "unity_editor_state",
  "unity_project_info",

  // Scene management
  "unity_scene_info",
  "unity_scene_open",
  "unity_scene_save",
  "unity_scene_new",
  "unity_scene_hierarchy",
  "unity_scene_stats",

  // GameObject CRUD
  "unity_gameobject_create",
  "unity_gameobject_delete",
  "unity_gameobject_info",
  "unity_gameobject_set_transform",
  "unity_gameobject_duplicate",
  "unity_gameobject_set_active",
  "unity_gameobject_reparent",

  // Component management
  "unity_component_add",
  "unity_component_remove",
  "unity_component_get_properties",
  "unity_component_set_property",
  "unity_component_set_reference",
  "unity_component_batch_wire",
  "unity_component_get_referenceable",

  // Asset management
  "unity_asset_list",
  "unity_asset_import",
  "unity_asset_delete",
  "unity_asset_create_prefab",
  "unity_asset_instantiate_prefab",

  // Script management
  "unity_script_create",
  "unity_script_read",
  "unity_script_update",
  "unity_execute_code",

  // Material
  "unity_material_create",
  "unity_renderer_set_material",

  // Build & play
  "unity_build",
  "unity_play_mode",

  // Console
  "unity_console_log",
  "unity_console_clear",

  // Editor actions
  "unity_execute_menu_item",
  "unity_undo",
  "unity_redo",
  "unity_undo_history",

  // Selection & search
  "unity_selection_get",
  "unity_selection_set",
  "unity_selection_focus_scene_view",
  "unity_selection_find_by_type",
  "unity_search_by_component",
  "unity_search_by_tag",
  "unity_search_by_layer",
  "unity_search_by_name",
  "unity_search_assets",
  "unity_search_missing_references",

  // Screenshots & capture
  "unity_screenshot_game",
  "unity_screenshot_scene",
  "unity_graphics_scene_capture",
  "unity_graphics_game_capture",

  // Prefab basics
  "unity_prefab_info",
  "unity_set_object_reference",

  // Packages
  "unity_packages_list",
  "unity_packages_add",
  "unity_packages_remove",
  "unity_packages_search",
  "unity_packages_info",

  // Queue & agents
  "unity_queue_info",
  "unity_agents_list",
  "unity_agent_log",
]);

/**
 * Split a flat tool array into { core, advanced }.
 * Also generates the meta-tools for accessing advanced tools.
 */
export function splitToolTiers(allEditorTools) {
  const core = [];
  const advanced = [];

  for (const tool of allEditorTools) {
    if (CORE_TOOLS.has(tool.name)) {
      core.push(tool);
    } else {
      advanced.push(tool);
    }
  }

  // Build an index of advanced tools for the catalog
  const advancedIndex = advanced.map((t) => ({
    name: t.name,
    description: t.description,
  }));

  // Group advanced tools by category for the catalog
  const categories = {};
  for (const t of advanced) {
    // Extract category from tool name: unity_animation_create_clip → animation
    const parts = t.name.replace(/^unity_/, "").split("_");
    const cat = parts[0];
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(t.name);
  }

  // Build the handler map for quick lookup
  const advancedMap = new Map();
  for (const t of advanced) {
    advancedMap.set(t.name, t);
  }

  // ─── Meta-tools ───

  const catalogTool = {
    name: "unity_list_advanced_tools",
    description:
      "List all available advanced/specialized Unity tools organized by category. " +
      "These tools are not directly exposed but can be called via unity_advanced_tool. " +
      "Categories include: animation, prefab, physics, lighting, audio, shadergraph, " +
      "amplify, terrain, particle, navmesh, ui, texture, profiler, memory, settings, " +
      "input, asmdef, scriptableobject, constraint, lod, editorprefs, playerprefs, " +
      "vfx, graphics, sceneview, and more.",
    inputSchema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description:
            'Filter by category name (e.g. "animation", "prefab", "shadergraph"). Omit for full list.',
        },
      },
    },
    handler: async ({ category } = {}) => {
      if (category) {
        const cat = category.toLowerCase();
        const matching = advanced.filter((t) => {
          const toolCat = t.name.replace(/^unity_/, "").split("_")[0];
          return toolCat === cat;
        });
        if (matching.length === 0) {
          return `No advanced tools found for category "${category}". Available categories: ${Object.keys(categories).join(", ")}`;
        }
        return JSON.stringify(
          matching.map((t) => ({ name: t.name, description: t.description })),
          null,
          2
        );
      }

      // Full catalog grouped by category
      const result = {};
      for (const [cat, names] of Object.entries(categories)) {
        result[cat] = names;
      }
      return JSON.stringify(
        { totalAdvancedTools: advanced.length, categories: result },
        null,
        2
      );
    },
  };

  const advancedTool = {
    name: "unity_advanced_tool",
    description:
      "Execute an advanced/specialized Unity tool by name. Use unity_list_advanced_tools " +
      "to discover available tools and their parameters. This provides access to 200+ " +
      "specialized tools for animation, prefabs, physics, shaders, terrain, particles, " +
      "UI, profiling, and more.",
    inputSchema: {
      type: "object",
      properties: {
        tool: {
          type: "string",
          description:
            'The tool name to execute (e.g. "unity_animation_create_controller", "unity_shadergraph_create")',
        },
        params: {
          type: "object",
          description:
            "Parameters to pass to the tool. Use unity_list_advanced_tools to see required parameters.",
          additionalProperties: true,
        },
      },
      required: ["tool"],
    },
    handler: async ({ tool, params } = {}) => {
      if (!tool) {
        return "Error: 'tool' parameter is required. Use unity_list_advanced_tools to see available tools.";
      }

      const targetTool = advancedMap.get(tool);
      if (!targetTool) {
        // Maybe it's a core tool being called through advanced?
        return `Error: Unknown advanced tool "${tool}". Use unity_list_advanced_tools to see available tools.`;
      }

      return await targetTool.handler(params || {});
    },
  };

  return {
    coreTools: core,
    metaTools: [catalogTool, advancedTool],
    advancedCount: advanced.length,
    coreCount: core.length,
  };
}
