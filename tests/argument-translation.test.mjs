// Schema-to-plugin argument translation. Published schemas keep their argument names and
// required lists (docs/compatibility.md), while released plugins read other keys. Each test
// asserts the payload a translated route forwards to the plugin, through the real MCP server.

import { describe, test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { MockBridge } from "./helpers/mock-bridge.mjs";
import { McpTestClient } from "./helpers/mcp-client.mjs";

describe("schema argument translation", () => {
  /** @type {MockBridge} */ let bridge;
  /** @type {McpTestClient} */ let client;
  let env, tools;

  before(async () => {
    bridge = new MockBridge(); await bridge.start();
    env = bridge.env(); client = new McpTestClient({ env }).start();
    await client.initialize();
    tools = (await client.listTools()).tools;
  });

  after(async () => {
    assert.deepEqual(client.stdoutViolations, []);
    await client.close(); await bridge.stop();
    const directory = resolve(dirname(env.UNITY_INSTANCE_REGISTRY));
    assert.equal(dirname(directory), resolve(tmpdir())); assert.ok(directory.startsWith(join(resolve(tmpdir()), "umcp-test-")));
    rmSync(directory, { recursive: true, force: true });
  });

  beforeEach(() => { bridge.seen.length = 0; });

  const isCore = name => tools.some(tool => tool.name === name);
  const call = (tool, params) => isCore(tool)
    ? client.callTool(tool, { ...params, port: bridge.port })
    : client.callTool("unity_advanced_tool", { tool, params, port: bridge.port });
  const sent = route => bridge.seen.filter(x => x.route === route).map(x => x.params);
  const schemaOf = async name => isCore(name)
    ? tools.find(tool => tool.name === name).inputSchema
    : (await client.callTool("unity_list_advanced_tools", { tool: name })).payload.inputSchema;
  async function forwards(tool, params, route, expected) {
    const result = await call(tool, params);
    assert.notEqual(result.isError, true, `${tool}: ${result.payloadText}`);
    assert.deepEqual(sent(route), [expected], tool);
  }
  async function refuses(tool, params, route, code) {
    const result = await call(tool, params);
    assert.equal(result.isError, true, `${tool} should be refused: ${result.payloadText}`);
    assert.equal(result.payload?.code, code, result.payloadText);
    assert.deepEqual(sent(route), [], `${tool} must not reach the plugin`);
  }

  test("published terrain, animation and profiler schemas keep their argument names and required lists", async () => {
    const required = {
      unity_terrain_set_heights_region: ["xBase", "yBase", "heights"],
      unity_terrain_get_heights_region: ["xBase", "yBase", "width", "height"],
      unity_terrain_set_holes: ["xBase", "yBase", "holes"],
      unity_terrain_set_neighbors: ["terrain"],
      unity_terrain_paint_detail: ["x", "z", "detailIndex"],
      unity_terrain_import_heightmap: ["filePath"],
      unity_terrain_create_grid: ["rows", "cols"],
      unity_terrain_get_steepness: ["worldX", "worldZ"],
      unity_animation_add_keyframe: ["clipPath", "propertyName", "typeName", "time", "value"],
      unity_animation_create_blend_tree: ["controllerPath", "blendTreeName", "blendParameter"],
      unity_debugger_event_details: ["eventIndex"],
      unity_prefab_create_variant: ["basePrefabPath", "variantPath"],
      unity_selection_find_by_type: ["typeName"],
    };
    for (const [name, expected] of Object.entries(required)) {
      const schema = await schemaOf(name);
      assert.deepEqual(schema.required, expected, name);
      for (const key of expected) assert.ok(schema.properties[key], `${name}.${key}`);
    }
    assert.equal((await schemaOf("unity_scene_save")).required, undefined);
  });

  test("terrain detail, neighbour, settings, grid and paint routes receive the keys the plugin reads", async () => {
    await forwards("unity_terrain_clear_detail", { detailIndex: 2, name: "T" }, "terrain/clear-detail",
      { detailIndex: 2, name: "T", prototypeIndex: 2 });
    await forwards("unity_terrain_paint_detail", { x: 0.2, z: 0.3, detailIndex: 1 }, "terrain/paint-detail",
      { x: 0.2, z: 0.3, detailIndex: 1, prototypeIndex: 1 });
    await forwards("unity_terrain_scatter_detail", { detailIndex: 0, density: 6 }, "terrain/scatter-detail",
      { detailIndex: 0, density: 6, prototypeIndex: 0 });
    await forwards("unity_terrain_set_neighbors", { terrain: "T_1", left: "T_0" }, "terrain/set-neighbors",
      { terrain: "T_1", left: "T_0", name: "T_1" });
    await forwards("unity_terrain_set_settings", { baseMapDist: 300 }, "terrain/set-settings",
      { baseMapDist: 300, basemapDistance: 300 });
    const origin = { x: 1, y: 0, z: 2 };
    await forwards("unity_terrain_create_grid", { rows: 2, cols: 3, startPosition: origin }, "terrain/create-grid",
      { rows: 2, cols: 3, startPosition: origin, columns: 3, position: origin });
    await forwards("unity_terrain_paint_layer", { x: 0.5, z: 0.5, layerIndex: 0, opacity: 0.4 }, "terrain/paint-layer",
      { x: 0.5, z: 0.5, layerIndex: 0, opacity: 0.4, strength: 0.4 });
  });

  test("an explicit plugin key is never replaced by its schema alias", async () => {
    await forwards("unity_terrain_clear_detail", { detailIndex: 2, prototypeIndex: 5 }, "terrain/clear-detail",
      { detailIndex: 2, prototypeIndex: 5 });
  });

  test("terrain height regions use the plugin's start keys and flat row-major heights", async () => {
    await forwards("unity_terrain_set_heights_region", { xBase: 4, yBase: 6, heights: [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]] },
      "terrain/set-heights-region",
      { xBase: 4, yBase: 6, startX: 4, startZ: 6, heights: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6], width: 3, heightSize: 2 });
    await forwards("unity_terrain_get_heights_region", { xBase: 8, yBase: 9, width: 5, height: 7 }, "terrain/get-heights-region",
      { xBase: 8, yBase: 9, width: 5, height: 7, startX: 8, startZ: 9 });
    bridge.seen.length = 0;
    for (const heights of [[[0.1], [0.2, 0.3]], [[]], [[0.1], 0.2]]) {
      await refuses("unity_terrain_set_heights_region", { xBase: 0, yBase: 0, heights }, "terrain/set-heights-region", "invalid_heights_region");
    }
  });

  test("place_trees translates the scatter area and scale ranges", async () => {
    const area = { xMin: 0.1, xMax: 0.4, zMin: 0.2, zMax: 0.6 };
    const params = { prototypeIndex: 0, count: 10, area, minHeight: 0.9, maxHeight: 1.1, minWidth: 0.7, maxWidth: 1.3 };
    await forwards("unity_terrain_place_trees", params, "terrain/place-trees", {
      ...params, minX: 0.1, maxX: 0.4, minZ: 0.2, maxZ: 0.6,
      minHeightScale: 0.9, maxHeightScale: 1.1, minWidthScale: 0.7, maxWidthScale: 1.3,
    });
  });

  test("heightmap import and export use path and the RAW depth the schema documents", async () => {
    await forwards("unity_terrain_import_heightmap", { filePath: "C:/h.raw" }, "terrain/import-heightmap",
      { filePath: "C:/h.raw", path: "C:/h.raw", depth: "16" });
    bridge.seen.length = 0;
    await forwards("unity_terrain_import_heightmap", { filePath: "C:/h.raw", format: "raw8" }, "terrain/import-heightmap",
      { filePath: "C:/h.raw", format: "raw8", path: "C:/h.raw", depth: "8" });
    bridge.seen.length = 0;
    await forwards("unity_terrain_import_heightmap", { filePath: "Assets/h.png", format: "texture" }, "terrain/import-heightmap",
      { filePath: "Assets/h.png", format: "texture", path: "Assets/h.png" });
    await forwards("unity_terrain_export_heightmap", { filePath: "Assets/h.raw", name: "T" }, "terrain/export-heightmap",
      { filePath: "Assets/h.raw", name: "T", path: "Assets/h.raw", depth: "16" });
    bridge.seen.length = 0;
    await refuses("unity_terrain_export_heightmap", { filePath: "Assets/h.png", format: "png" }, "terrain/export-heightmap", "heightmap_format_unsupported");
    await refuses("unity_terrain_import_heightmap", { filePath: "C:/h.raw", format: "raw32" }, "terrain/import-heightmap", "heightmap_format_unsupported");
    await refuses("unity_terrain_import_heightmap", { filePath: "C:/h.raw", byteOrder: "big" }, "terrain/import-heightmap", "heightmap_format_unsupported");
  });

  test("get_steepness converts the world position to the normalized coordinates the plugin reads", async () => {
    bridge.on("terrain/info", () => ({ name: "T", position: { x: 100, y: 0, z: 200 }, size: { x: 1000, y: 600, z: 500 } }));
    await forwards("unity_terrain_get_steepness", { worldX: 350, worldZ: 450, name: "T" }, "terrain/get-steepness",
      { worldX: 350, worldZ: 450, name: "T", x: 0.25, z: 0.5 });
    assert.deepEqual(sent("terrain/info"), [{ name: "T" }]);
    bridge.seen.length = 0;
    await refuses("unity_terrain_get_steepness", { worldX: 50, worldZ: 450 }, "terrain/get-steepness", "position_outside_terrain");
    assert.deepEqual(sent("terrain/info"), [{}]);
  });

  test("set_holes refuses the region form that released plugins ignore", async () => {
    await refuses("unity_terrain_set_holes", { xBase: 0, yBase: 0, holes: [[false, true]] }, "terrain/set-holes",
      "terrain_holes_region_unsupported");
  });

  test("animation curve tools and blend trees forward the plugin's type and state keys", async () => {
    const curve = { clipPath: "Assets/A.anim", relativePath: "", propertyName: "m_Color.a", typeName: "SpriteRenderer" };
    await forwards("unity_animation_get_curve_keyframes", curve, "animation/get-curve-keyframes", { ...curve, type: "SpriteRenderer" });
    await forwards("unity_animation_remove_curve", curve, "animation/remove-curve", { ...curve, type: "SpriteRenderer" });
    await forwards("unity_animation_add_keyframe", { ...curve, time: 0, value: 1 }, "animation/add-keyframe",
      { ...curve, time: 0, value: 1, type: "SpriteRenderer" });
    await forwards("unity_animation_remove_keyframe", { ...curve, keyframeIndex: 0 }, "animation/remove-keyframe",
      { ...curve, keyframeIndex: 0, type: "SpriteRenderer" });
    const tree = { controllerPath: "Assets/C.controller", blendTreeName: "Locomotion", blendParameter: "Speed" };
    await forwards("unity_animation_create_blend_tree", tree, "animation/create-blend-tree", { ...tree, stateName: "Locomotion" });
  });

  test("profiler and frame debugger forward the plugin's deepProfiling and index keys", async () => {
    await forwards("unity_profiler_enable", { enabled: true, deepProfile: true }, "profiler/enable",
      { enabled: true, deepProfile: true, deepProfiling: true });
    await forwards("unity_debugger_event_details", { eventIndex: 42 }, "debugger/event-details", { eventIndex: 42, index: 42 });
    const frameData = await schemaOf("unity_profiler_frame_data");
    assert.equal(frameData.properties.maxDepth, undefined, "maxDepth is never read by the plugin");
    assert.equal(frameData.properties.maxItems.type, "integer");
    assert.match(frameData.properties.maxItems.description, /default: 30/);
    assert.match(frameData.properties.minTimeMs.description, /default: 0\)/);
  });

  test("prefab add_gameobject and UMA recipes forward the plugin's parent and display keys", async () => {
    await forwards("unity_prefab_add_gameobject", { assetPath: "Assets/P.prefab", prefabPath: "Body/Arm", name: "Hand" },
      "prefab-asset/add-gameobject", { assetPath: "Assets/P.prefab", prefabPath: "Body/Arm", name: "Hand", parentPrefabPath: "Body/Arm" });
    const recipe = { recipeName: "R", outputFolder: "Assets/U", wardrobeSlot: "Chest", compatibleRaces: ["HumanMale"],
      slots: [{ slotName: "S" }], displayValue: "Iron Chest" };
    await forwards("unity_uma_create_wardrobe_recipe", recipe, "uma/create-wardrobe-recipe", { ...recipe, displayName: "Iron Chest" });
    assert.equal((await schemaOf("unity_uma_create_slot")).properties.keepAllBones, undefined,
      "the plugin always builds the keep list from weighted bones");
  });

  test("scene save, variant creation and find-by-type publish their overwrite and limit options", async () => {
    const save = await schemaOf("unity_scene_save");
    assert.equal(save.properties.overwrite.type, "boolean");
    const variant = await schemaOf("unity_prefab_create_variant");
    assert.equal(variant.properties.overwrite.type, "boolean");
    const find = await schemaOf("unity_selection_find_by_type");
    assert.equal(find.properties.limit.type, "integer");
    assert.match(find.properties.limit.description, /default 500.*truncated.*totalFound/);
    await forwards("unity_scene_save", { path: "Assets/S.unity", overwrite: true }, "scene/save", { path: "Assets/S.unity", overwrite: true });
    await forwards("unity_selection_find_by_type", { typeName: "Light", limit: 20 }, "selection/find-by-type", { typeName: "Light", limit: 20 });
  });
});
