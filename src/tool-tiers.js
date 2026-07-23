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
import { formatResult, firstSentence } from "./response-format.js";
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
  // Core tools whose name → route derivation doesn't match their real endpoint.
  // unity_advanced_tool doubles as a pass-through proxy for core tools (useful when a
  // client's cached schema predates a new parameter), and that lazy path derives the
  // route from the name — every mismatch below made such calls fail with unknown-route.
  // (unity_queue_info stays out: /api/queue/info is a special non-queue endpoint.)
  unity_editor_ping: "ping",
  unity_scene_stats: "search/scene-stats",
  unity_gameobject_duplicate: "prefab/duplicate",
  unity_gameobject_set_active: "prefab/set-active",
  unity_gameobject_reparent: "prefab/reparent",
  unity_execute_code: "editor/execute-code",
  unity_execute_menu_item: "editor/execute-menu-item",
  unity_material_create: "asset/create-material",
  unity_play_mode: "editor/play-mode",
  unity_get_compilation_errors: "compilation/errors",
  unity_set_object_reference: "prefab/set-object-reference",
  unity_agent_log: "agents/log",
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
  "unity_undo_last",
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

  // Core tools by name, for search/tool lookups that land on a directly-exposed tool.
  const coreMap = new Map();
  for (const t of core) {
    coreMap.set(t.name, t);
  }

  // ─── Meta-tools ───
  //
  // Three-level lazy discovery, cheapest first — so finding one tool never costs a
  // full-catalog or full-schema dump:
  //   1. no args        → category names + counts (~0.7KB)
  //   2. search/category → tool names + one-line brief + parameter names (~1-3KB)
  //   3. tool           → ONE tool's complete parameter schema
  // (The old behavior — every name in the catalog, every schema in a category view —
  // cost 10-22KB per discovery call; includeSchemas:true restores it on demand.)

  const catalogTool = {
    name: "unity_list_advanced_tools",
    description:
      "Discover advanced Unity tools (execute them via unity_advanced_tool) without loading full schemas: " +
      "search=keywords → matching tools; category=name → its tools with parameter names; " +
      "tool=name → that tool's full parameter schema; no args → all category names with counts " +
      "(e.g. animation, terrain, shadergraph, probuilder, uma, physics, lighting, ui, …).",
    inputSchema: {
      type: "object",
      properties: {
        search: {
          type: "string",
          description: 'Keywords, e.g. "terrain raise". Every word must match a tool\'s name, category, or description.',
        },
        category: {
          type: "string",
          description: "Category name → its tools with brief + parameter names.",
        },
        tool: {
          type: "string",
          description: "Exact tool name → its full parameter schema.",
        },
        includeSchemas: {
          type: "boolean",
          description: "With category: full schemas for every tool (large — prefer tool= for one).",
        },
      },
    },
    handler: async ({ search, category, tool, includeSchemas } = {}) => {
      // Validate the string filters up front — a client that doesn't enforce the schema
      // (e.g. sends category:123) would otherwise hit a raw TypeError on .toLowerCase().
      for (const [k, v] of [["search", search], ["category", category], ["tool", tool]]) {
        if (v !== undefined && typeof v !== "string") {
          return formatResult({ error: `'${k}' must be a string (got ${typeof v}).` });
        }
      }

      // Fetch dynamic routes from the Unity plugin so lazy-loadable tools (added to the
      // C# plugin after this server started) are discoverable in every view.
      let dynamicRoutes = null;
      try {
        dynamicRoutes = await sendCommand("_meta/routes", {});
      } catch (_) {
        // Plugin might not support _meta/routes yet, use cached list only
      }

      // Dynamic-only tool names (not cached, not core), grouped and flat.
      const mergedCategories = { ...categories };
      const dynamicNames = new Set();

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

          if (!mergedCategories[cat]) mergedCategories[cat] = [];
          if (!mergedCategories[cat].includes(toolName)) {
            mergedCategories[cat].push(toolName);
            dynamicNames.add(toolName);
          }
        }
      }

      const categoryOf = (name) => name.replace(/^unity_/, "").split("_")[0];

      // ── Level 3: one tool's full definition ──
      if (tool) {
        const cached = advancedMap.get(tool);
        if (cached) {
          return formatResult({
            name: cached.name,
            category: categoryOf(cached.name),
            description: cached.description,
            inputSchema: cached.inputSchema,
          });
        }
        const coreTool = coreMap.get(tool);
        if (coreTool) {
          return formatResult({
            name: coreTool.name,
            core: true,
            description: coreTool.description,
            inputSchema: coreTool.inputSchema,
            note: "Core tool — call it directly, not via unity_advanced_tool.",
          });
        }
        if (dynamicNames.has(tool)) {
          return formatResult({
            name: tool,
            dynamic: true,
            route: toolNameToRoute(tool),
            note: "Lazy tool from the Unity plugin — no cached schema on this server; call it via unity_advanced_tool and the plugin validates parameters.",
          });
        }
        const suggestions = suggestSimilarTools(tool, [...advancedMap.keys(), ...CORE_TOOLS, ...dynamicNames]);
        const hint = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(", ")}?` : "";
        return formatResult({ error: `Unknown tool "${tool}".${hint}` });
      }

      // ── Level 2a: keyword search across everything ──
      if (search) {
        const tokens = search.toLowerCase().split(/\s+/).filter(Boolean);
        const candidates = [];
        for (const t of advanced)
          candidates.push({ name: t.name, category: categoryOf(t.name), description: t.description || "" });
        for (const t of core)
          candidates.push({ name: t.name, category: "core", description: t.description || "", core: true });
        for (const name of dynamicNames)
          candidates.push({ name, category: categoryOf(name), description: "", dynamic: true });

        const matches = [];
        for (const c of candidates) {
          if (category && c.category !== category.toLowerCase()) continue;
          const nameText = c.name.toLowerCase();
          const blob = `${nameText} ${c.category} ${c.description.toLowerCase()}`;
          if (!tokens.every((tok) => blob.includes(tok))) continue;
          // Rank name hits above description-only hits.
          const rank = tokens.every((tok) => nameText.includes(tok)) ? 0 : 1;
          matches.push({ rank, c });
        }
        matches.sort((a, b) => a.rank - b.rank || a.c.name.localeCompare(b.c.name));

        const results = matches.slice(0, 20).map(({ c }) => {
          const entry = { name: c.name, category: c.category };
          const brief = firstSentence(c.description);
          if (brief) entry.brief = brief;
          if (c.core) entry.core = true;
          if (c.dynamic) entry.dynamic = true;
          return entry;
        });
        return formatResult({
          totalMatches: matches.length,
          results,
          hint: matches.length === 0
            ? "No tools matched. Try fewer or shorter keywords, or call with no arguments for category counts."
            : "tool=<name> returns a tool's full parameter schema.",
        });
      }

      // ── Level 2b: one category's tools with brief + parameter names ──
      if (category) {
        const cat = category.toLowerCase();
        const matching = advanced.filter((t) => categoryOf(t.name) === cat);
        const dynamicOnly = (mergedCategories[cat] || []).filter((name) => dynamicNames.has(name));

        if (matching.length === 0 && dynamicOnly.length === 0) {
          return `No advanced tools found for category "${category}". Available categories: ${Object.keys(mergedCategories).sort().join(", ")}`;
        }

        // includeSchemas restores the old full-schema echo for one-round-trip callers.
        if (includeSchemas === true) {
          const all = [
            ...matching.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
            ...dynamicOnly.map((name) => ({ name, description: "(lazy-loaded from Unity plugin)" })),
          ];
          return formatResult(all);
        }

        const all = [
          ...matching.map((t) => {
            const entry = { name: t.name, brief: firstSentence(t.description) };
            const params = Object.keys(t.inputSchema?.properties || {});
            if (params.length > 0) entry.params = params;
            const required = t.inputSchema?.required;
            if (Array.isArray(required) && required.length > 0) entry.required = required;
            return entry;
          }),
          ...dynamicOnly.map((name) => ({ name, dynamic: true })),
        ];
        return formatResult({
          category: cat,
          count: all.length,
          tools: all,
          hint: "tool=<name> returns a tool's full parameter schema; includeSchemas=true returns all of them.",
        });
      }

      // ── Level 1: category counts only ──
      const counts = {};
      for (const cat of Object.keys(mergedCategories).sort()) {
        counts[cat] = mergedCategories[cat].length;
      }
      return formatResult({
        totalAdvancedTools: advanced.length + dynamicNames.size,
        dynamicTools: dynamicNames.size,
        categories: counts,
        hint: "Drill down: search=<keywords>, category=<name> (tools + param names), tool=<name> (full schema).",
      });
    },
  };

  const advancedTool = {
    name: "unity_advanced_tool",
    description:
      `Execute an advanced Unity tool by name (${advanced.length} cached + plugin lazy-loaded; ` +
      "discover names via unity_list_advanced_tools search=/category=, parameters via tool=).",
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
