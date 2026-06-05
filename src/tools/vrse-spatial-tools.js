import * as bridge from "../unity-editor-bridge.js";

// VRse spatial tools — ported from unity-mcp-pro for parity. Used by the VRse build pipeline's
// Step 4.5 (auto-position interactables) on no-marker modules. Backing C# handler:
// VRseBuilderSDK-mcp-plugin/Editor/MCPSpatialCommands.cs (ported from unity-mcp-pro's SpatialCommands.cs).
//
// Schema strategy: identical to unity-mcp-pro snake_case params so skill renames are tool-name-only.

export const vrseSpatialTools = [
  {
    name: "unity_spatial_analyze_scene",
    description:
      "First-call spatial index of the scene. Returns all renderable objects with world bounds, " +
      "6 AABB face centers, classification (surface/mechanism/panel/object), children, and discovered " +
      "horizontal surfaces (via downward raycast grid). Used at the start of Step 4.5 to build the " +
      "scene-wide context the pipeline uses to position objects.",
    inputSchema: {
      type: "object",
      properties: {
        filter_tag:       { type: "string", description: "Optional: only return objects with this tag" },
        center:           { type: "string", description: "Optional: filter center as 'x,y,z' string" },
        filter_radius:    { type: "number", description: "Optional: only return objects within this radius of center" },
        include_surfaces: { type: "boolean", description: "Run downward raycast grid to discover horizontal surfaces (default true)" },
        grid_resolution:  { type: "number", description: "NxN raycast grid resolution for surface discovery (default 10)" },
      },
    },
    handler: async (params) => JSON.stringify(await bridge.sendCommand("vrse/spatial/analyze-scene", params), null, 2),
  },

  {
    name: "unity_spatial_probe_surfaces",
    description:
      "Find internal horizontal surfaces (shelves, racks, compartments) of a complex object. " +
      "Multi-directional raycast sweep with greedy clustering. Use when the storyboard references " +
      "'place X on the rack' or 'on the lower shelf' — returns each discovered surface with height, " +
      "extent, normal, and approximate area.",
    inputSchema: {
      type: "object",
      properties: {
        target_object:     { type: "string", description: "GameObject name or hierarchy path of the object to probe" },
        probe_resolution:  { type: "number", description: "Ray grid resolution per face, 2-20 (default 5)" },
        axis:              { type: "string", description: "'vertical' (default), 'horizontal_x', 'horizontal_z', or 'all'" },
        cluster_tolerance: { type: "number", description: "Distance tolerance for grouping ray hits into surfaces (default 0.05)" },
      },
      required: ["target_object"],
    },
    handler: async (params) => JSON.stringify(await bridge.sendCommand("vrse/spatial/list-probe-surfaces", params), null, 2),
  },

  {
    name: "unity_spatial_check_placement",
    description:
      "Validate the placement of an object: is it floating, penetrating the floor, or overlapping others? " +
      "Returns an issues[] array with human-readable diagnoses (e.g. 'Floating 0.32m above Table', " +
      "'Overlapping with: Wheel'). Pipeline reads placementOk:bool to gate proceed/refine decisions.",
    inputSchema: {
      type: "object",
      properties: {
        game_object_path: { type: "string", description: "Path or name of the object to check" },
        check_surface:    { type: "boolean", description: "Check for resting surface below (default true)" },
        check_overlap:    { type: "boolean", description: "Check for bounds intersections with other objects (default true)" },
        check_floor:      { type: "boolean", description: "Check for floor penetration (default true)" },
      },
      required: ["game_object_path"],
    },
    handler: async (params) => JSON.stringify(await bridge.sendCommand("vrse/spatial/check-placement", params), null, 2),
  },

  {
    name: "unity_spatial_find_surface",
    description:
      "Find the exact surface point on a target object from a given approach direction. " +
      "Single raycast from outside the bounds toward the object; falls back to AABB face center if " +
      "the ray misses. Returns surfacePoint + surfaceNormal — used to position placepoints and " +
      "compute their rotation (placepoint forward = -surfaceNormal).",
    inputSchema: {
      type: "object",
      properties: {
        target_object: { type: "string", description: "Path or name of the target object" },
        direction:     { type: "string", description: "Approach direction as 'x,y,z' string (default '0,-1,0' = from above)" },
        offset:        { type: "number", description: "Extra ray-origin distance beyond bounds (default 1.0)" },
      },
      required: ["target_object"],
    },
    handler: async (params) => JSON.stringify(await bridge.sendCommand("vrse/spatial/get-surface", params), null, 2),
  },

  {
    name: "unity_gameobject_bounds",
    description:
      "World-space bounds (center, size, min, max) plus 6 AABB face centers for a GameObject. " +
      "Aggregates Renderer bounds from the object and its children (excluding ParticleSystemRenderer " +
      "and TrailRenderer). Falls back to Collider bounds if no renderers found. Used for placepoint " +
      "collider sizing and spatial reasoning.",
    inputSchema: {
      type: "object",
      properties: {
        game_object_path: { type: "string", description: "Path or name of the GameObject" },
        include_children: { type: "boolean", description: "Aggregate child bounds too (default true)" },
      },
      required: ["game_object_path"],
    },
    handler: async (params) => JSON.stringify(await bridge.sendCommand("vrse/spatial/get-bounds", params), null, 2),
  },
];
