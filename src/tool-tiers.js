// AnkleBreaker Unity MCP — Two-tier tool system
// Reduces the exposed tool count to avoid overwhelming MCP clients.
//
// Core tools: Always exposed as individual MCP tools (~60 tools)
// Advanced tools: Accessed via unity_advanced_tool (200+ tools)
//
// Why: MCP clients like Claude Cowork silently fail when a server
// exposes too many tools (our 268 tools / 125KB response was ~5x
// larger than working servers). This keeps us under the safe limit.
//
// Lazy loading: Advanced tools support dynamic dispatch. If a tool
// isn't in the cached map, the route is derived from the tool name
// (unity_terrain_list → terrain/list) and called directly via sendCommand.
// This means new tools added to the C# plugin work immediately without
// restarting the MCP server.

import { sendCommand } from "./unity-editor-bridge.js";
import { formatResult } from "./response-format.js";
import { isUnknownRouteResult } from "./capabilities.js";

/**
 * Explicit route overrides for tools whose API endpoints
 * don't follow the standard name → route derivation pattern.
 * E.g. unity_mppm_* tools use "scenario/*" endpoints on the C# side.
 */
const ROUTE_OVERRIDES = {
  unity_mppm_list_scenarios: "scenario/list",
  unity_mppm_status: "scenario/status",
  unity_mppm_activate_scenario: "scenario/activate",
  unity_mppm_start: "scenario/start",
  unity_mppm_stop: "scenario/stop",
  unity_mppm_info: "scenario/info",
  unity_mppm_list_players: "mppm/list-players",
  unity_mppm_activate_player: "mppm/activate-player",
  unity_mppm_deactivate_player: "mppm/deactivate-player",
};

/**
 * Derive an HTTP route from a tool name.
 * unity_terrain_raise_lower → terrain/raise-lower
 * unity_animation_create_clip → animation/create-clip
 */
function toolNameToRoute(toolName) {
  // Check explicit overrides first (for tools whose API routes don't match their name)
  if (ROUTE_OVERRIDES[toolName]) return ROUTE_OVERRIDES[toolName];

  // Remove unity_ prefix
  const withoutPrefix = toolName.replace(/^unity_/, "");
  // Split into parts: first part is category, rest is action
  const parts = withoutPrefix.split("_");
  if (parts.length < 2) return null;
  const category = parts[0];
  const action = parts.slice(1).join("-");
  return `${category}/${action}`;
}

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

  // Console & Compilation
  "unity_console_log",
  "unity_console_clear",
  "unity_get_compilation_errors",

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
  "unity_screenshot_editor_window",
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
 * Levenshtein distance (iterative two-row) — powers "did you mean" suggestions
 * for mistyped advanced tool names. (Idea credit: community PR #31 by D3vCrow.)
 */
function levenshtein(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        prev[j] + 1,
        current[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = current;
  }
  return prev[b.length];
}

/** Closest tool names within a sane edit distance, best first (max 3). */
function suggestSimilarTools(input, candidates) {
  const scored = [];
  for (const name of candidates) {
    const distance = levenshtein(input, name);
    if (distance <= 5) scored.push({ name, distance });
  }
  scored.sort((a, b) => a.distance - b.distance);
  return scored.slice(0, 3).map((s) => s.name);
}

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
      "List advanced Unity tools by category; call them via unity_advanced_tool. Categories: " +
      "uma, animation, prefab, physics, lighting, audio, shadergraph, amplify, terrain, particle, " +
      "navmesh, ui, texture, profiler, memory, settings, input, asmdef, scriptableobject, " +
      "constraint, lod, editorprefs, playerprefs, vfx, graphics, sceneview, more.",
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
      // Try to fetch dynamic routes from Unity plugin for lazy discovery
      let dynamicRoutes = null;
      try {
        dynamicRoutes = await sendCommand("_meta/routes", {});
      } catch (_) {
        // Plugin might not support _meta/routes yet, use cached list only
      }

      // Merge dynamic routes into the advanced tool list
      // Dynamic routes that aren't in our cached map get listed as lazy-loadable tools
      let mergedCategories = { ...categories };
      let dynamicCount = 0;

      // The bridge wraps results as { success, data } — the route list lives in data.routes.
      // (Top-level .routes kept as a fallback for legacy sync payload shapes.)
      const dynamicRouteList = dynamicRoutes?.data?.routes || dynamicRoutes?.routes;
      if (Array.isArray(dynamicRouteList)) {
        for (const route of dynamicRouteList) {
          // Convert route to tool name: terrain/list → unity_terrain_list
          const toolName = "unity_" + route.replace(/\//g, "_").replace(/-/g, "_");
          const cat = route.split("/")[0];

          // Skip if already in our cached map
          if (advancedMap.has(toolName) || CORE_TOOLS.has(toolName)) continue;

          // Add to merged categories
          if (!mergedCategories[cat]) mergedCategories[cat] = [];
          if (!mergedCategories[cat].includes(toolName)) {
            mergedCategories[cat].push(toolName);
            dynamicCount++;
          }
        }
      }

      if (category) {
        const cat = category.toLowerCase();

        // Check cached tools first
        const matching = advanced.filter((t) => {
          const toolCat = t.name.replace(/^unity_/, "").split("_")[0];
          return toolCat === cat;
        });

        // Also include dynamic-only tools for this category
        const dynamicTools = (mergedCategories[cat] || [])
          .filter((name) => !advancedMap.has(name))
          .map((name) => ({ name, description: `(lazy-loaded from Unity plugin)` }));

        // Echo inputSchema in the category view so agents (and compact-mode clients)
        // can read parameters on demand without the tool being directly exposed.
        const all = [
          ...matching.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
          ...dynamicTools,
        ];

        if (all.length === 0) {
          return `No advanced tools found for category "${category}". Available categories: ${Object.keys(mergedCategories).join(", ")}`;
        }
        return formatResult(all);
      }

      // Full catalog grouped by category
      const result = {};
      for (const [cat, names] of Object.entries(mergedCategories)) {
        result[cat] = names;
      }
      return formatResult({
        totalAdvancedTools: advanced.length + dynamicCount,
        dynamicTools: dynamicCount,
        categories: result,
      });
    },
  };

  const advancedTool = {
    name: "unity_advanced_tool",
    description:
      "Execute an advanced Unity tool by name (254 tools; discover names and parameters " +
      "with unity_list_advanced_tools).",
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
      if (targetTool) {
        return await targetTool.handler(params || {});
      }

      // ─── Lazy loading fallback ───
      // Tool not in cached map — derive the route from the name and call Unity directly.
      // This allows new tools added to the C# plugin to work without restarting the MCP server.
      const route = toolNameToRoute(tool);
      if (route) {
        try {
          // Log to stderr, not stdout — stdout carries the MCP JSON-RPC transport.
          console.error(`[MCP] Lazy-loading tool "${tool}" via route "${route}"`);
          const result = await sendCommand(route, params || {});
          // Only an UNKNOWN-ROUTE failure means a probable typo — suggest close names.
          // A legit failure from a correctly-named tool (e.g. "no terrain in scene")
          // must not get an irrelevant name suggestion bolted on.
          if (isUnknownRouteResult(result)) {
            const suggestions = suggestSimilarTools(tool, [...advancedMap.keys(), ...CORE_TOOLS]);
            if (suggestions.length > 0) {
              return formatResult({ ...result, hint: `Did you mean: ${suggestions.join(", ")}?` });
            }
          }
          return formatResult(result);
        } catch (err) {
          return `Error executing "${tool}" (lazy route: ${route}): ${err.message}`;
        }
      }

      const suggestions = suggestSimilarTools(tool, [...advancedMap.keys(), ...CORE_TOOLS]);
      const hint = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(", ")}?` : "";
      return `Error: Unknown tool "${tool}".${hint} Use unity_list_advanced_tools to see available tools.`;
    },
  };

  return {
    coreTools: core,
    metaTools: [catalogTool, advancedTool],
    advancedCount: advanced.length,
    coreCount: core.length,
  };
}
