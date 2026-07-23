// Live ProBuilder level-building scenario — drives THIS server build over real MCP
// stdio against a REAL Unity Editor (plugin >= 2.35.0 with ProBuilder installed), and
// builds a small level through the multi-agent queue: shapes, face edits, boolean CSG,
// materials, combine, per-action undo, and the dense-hierarchy + lazy-discovery
// features of this version. Everything it creates is prefixed __mcp_lvl_ and destroyed.
//
//   UNITY_MCP_LIVE=1 npm run test:live
//
// Skips cleanly when no live editor is reachable is NOT a goal here — the suite is
// gated on UNITY_MCP_LIVE, so a dead bridge is a real failure the operator asked about.
// Only a project without ProBuilder downgrades the ProBuilder steps to skips.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { McpTestClient } from "./helpers/mcp-client.mjs";

const LIVE = process.env.UNITY_MCP_LIVE === "1";
const P = "__mcp_lvl_"; // probe prefix — every object this suite creates carries it

describe("live ProBuilder level build (write probes, self-cleaning)", { skip: !LIVE && "set UNITY_MCP_LIVE=1 with a running Unity editor" }, () => {
  /** @type {McpTestClient} */ let client;
  let pbInstalled = false;
  let floorId, wallId, stairId;

  const call = async (tool, args) => client.callTool(tool, args);
  const advanced = async (tool, params) => client.callTool("unity_advanced_tool", { tool, params });
  /** Unwrap the bridge envelope: plugin payload lives under data (queue mode). */
  const data = (payload) => (payload && payload.data !== undefined ? payload.data : payload);

  before(async () => {
    client = new McpTestClient({ env: {}, timeoutMs: 45_000 }).start();
    await client.initialize();

    // Bind to exactly one real instance (fail loud on zero — this suite is opt-in live).
    const { payload: list } = await call("unity_list_instances");
    assert.ok(list.totalCount >= 1, "a running Unity editor with the MCP plugin is required");
    await call("unity_select_instance", { port: list.instances[0].port });

    // ProBuilder availability probe (create + immediately remove a unit cube).
    const probe = await advanced("unity_probuilder_create_shape", { shape: "cube", name: `${P}probe` });
    const probeData = data(probe.payload);
    pbInstalled = !(probe.payloadText.includes("not installed")) && probeData && probeData.success === true;
    if (pbInstalled) {
      await call("unity_gameobject_delete", { path: `${P}probe` });
    }
  });

  after(async () => {
    // Sweep every probe object (ours + boolean results parented to nothing) and the
    // temp material, no matter which step failed.
    try {
      await call("unity_execute_code", {
        code:
          `int d = 0; var roots = UnityEngine.SceneManagement.SceneManager.GetActiveScene().GetRootGameObjects();` +
          `foreach (var go in roots) if (go.name.StartsWith("${P}") || go.name.StartsWith("PB_Boolean_")) { UnityEngine.Object.DestroyImmediate(go); d++; }` +
          `UnityEditor.AssetDatabase.DeleteAsset("Assets/${P}mat.mat"); return "swept=" + d;`,
      });
    } catch { /* cleanup is best-effort — a dead bridge already failed the suite */ }
    await client.close();
  });

  test("lazy discovery finds the ProBuilder tools by keyword and serves one schema", async () => {
    const search = await call("unity_list_advanced_tools", { search: "probuilder shape" });
    assert.ok(search.payload.totalMatches >= 1, "search finds probuilder tools");
    assert.ok(search.payload.results.some((r) => r.name === "unity_probuilder_create_shape"));

    const one = await call("unity_list_advanced_tools", { tool: "unity_probuilder_create_shape" });
    assert.equal(one.payload.inputSchema.type, "object", "single-schema fetch works live");
    assert.equal(one.payload.category, "probuilder");
  });

  test("floor: parametric plane spawns as an editable ProBuilder mesh (float dims honored)", async (t) => {
    if (!pbInstalled) return t.skip("ProBuilder not installed in this project");
    const { payload } = await advanced("unity_probuilder_create_shape", {
      shape: "plane", name: `${P}floor`, width: 12.5, depth: 11.8, widthSegments: 2, lengthSegments: 2,
    });
    const d = data(payload);
    assert.equal(d.success, true);
    assert.ok(d.faceCount >= 4, `plane has faces (got ${d.faceCount})`);
    floorId = d.instanceId;
    assert.equal(typeof floorId, "string", "instanceId is the 64-bit-safe string form");
    // Float regression (battle-test BUG 1): non-integer dims used to be silently dropped
    // to defaults on decimal-comma locales. The echo reports the ACTUALLY-applied size.
    assert.ok(Math.abs(d.appliedSize.x - 12.5) < 1e-4, `float width applied (got ${d.appliedSize.x})`);
    assert.ok(Math.abs(d.appliedSize.z - 11.8) < 1e-4, `float depth applied (got ${d.appliedSize.z})`);
  });

  test("wall: cube extrudes a face through the queue", async (t) => {
    if (!pbInstalled) return t.skip("ProBuilder not installed in this project");
    const created = data((await advanced("unity_probuilder_create_shape", {
      shape: "cube", name: `${P}wall`, width: 6, height: 3, depth: 0.4,
      position: { x: 0, y: 1.5, z: 6 },
    })).payload);
    assert.equal(created.success, true);
    wallId = created.instanceId;
    const before = created.faceCount;

    const extruded = data((await advanced("unity_probuilder_extrude_faces", {
      instanceId: wallId, faceIndices: [0], distance: 0.4,
    })).payload);
    assert.equal(extruded.success, true);
    assert.ok(extruded.faceCount > before, `extrude adds faces (${before} → ${extruded.faceCount})`);
  });

  test("doorway: boolean subtract carves the wall into a new editable object", async (t) => {
    if (!pbInstalled) return t.skip("ProBuilder not installed in this project");
    const cutter = data((await advanced("unity_probuilder_create_shape", {
      shape: "cube", name: `${P}cutter`, width: 1.4, height: 2.4, depth: 2,
      position: { x: 0, y: 1.2, z: 6 },
    })).payload);
    assert.equal(cutter.success, true);

    const boolResult = data((await advanced("unity_probuilder_boolean", {
      operation: "subtract", targetInstanceId: wallId, otherInstanceId: cutter.instanceId,
    })).payload);
    assert.equal(boolResult.success, true);
    assert.ok(boolResult.vertexCount > 0, "boolean produced geometry");
    assert.equal(boolResult.editableProBuilder, true, "CSG result is a real ProBuilderMesh");
    // Battle-test BUG 4: operands used to stay alive overlapping the result.
    assert.equal(boolResult.sourcesDeleted, true, "sources removed by default");
    assert.ok(Array.isArray(boolResult.sourceInstanceIds), "source ids reported for traceability");

    // Placement regression: CSG output is world-space; the pivot-centered result must sit
    // AT the carved wall (a double-offset bug once pushed it a full wall-position away).
    const info = data((await call("unity_gameobject_info", { instanceId: boolResult.instanceId })).payload);
    const pos = info.position || (info.transform && info.transform.position);
    assert.ok(pos, `gameobject_info returns a position (${JSON.stringify(info).slice(0, 200)})`);
    assert.ok(
      Math.abs(pos.z - 6) < 1.5 && Math.abs(pos.x) < 1.5,
      `boolean result sits at the carved wall, not double-offset (got ${JSON.stringify(pos)})`
    );
  });

  test("stairs + material: stair shape accepts a face material (submesh path)", async (t) => {
    if (!pbInstalled) return t.skip("ProBuilder not installed in this project");
    const stair = data((await advanced("unity_probuilder_create_shape", {
      shape: "stair", name: `${P}stair`, width: 2, height: 2, depth: 3, steps: 6,
      position: { x: 4, y: 0, z: 0 },
    })).payload);
    assert.equal(stair.success, true);
    assert.ok(stair.faceCount > 10, "stair generated its step faces");
    stairId = stair.instanceId;

    const mat = data((await call("unity_material_create", {
      name: `${P}mat`, path: `Assets/${P}mat.mat`, color: { r: 0.8, g: 0.3, b: 0.2, a: 1 },
    })).payload);
    assert.ok(mat && (mat.success === true || mat.path || mat.assetPath), "material created");

    const painted = data((await advanced("unity_probuilder_set_face_material", {
      instanceId: stairId, material: `Assets/${P}mat.mat`, faceIndices: [0, 1, 2],
    })).payload);
    assert.equal(painted.success, true);
    assert.equal(painted.faces, 3, "material applied to the selected faces");
  });

  test("combine merges two ProBuilder objects into one", async (t) => {
    if (!pbInstalled) return t.skip("ProBuilder not installed in this project");
    const a = data((await advanced("unity_probuilder_create_shape", {
      shape: "cube", name: `${P}comb_a`, position: { x: -4, y: 0.5, z: 0 },
    })).payload);
    const b = data((await advanced("unity_probuilder_create_shape", {
      shape: "cube", name: `${P}comb_b`, position: { x: -4, y: 0.5, z: 2 },
    })).payload);
    assert.equal(a.success, true);
    assert.equal(b.success, true);

    const combined = data((await advanced("unity_probuilder_combine", {
      paths: [`${P}comb_a`, `${P}comb_b`],
    })).payload);
    assert.equal(combined.success, true);
    assert.ok(combined.faceCount >= 12, `combined mesh holds both cubes (${combined.faceCount} faces)`);

    const gone = data((await call("unity_search_by_name", { name: `${P}comb_b` })).payload);
    assert.equal(gone.totalFound, 0, "consumed object was removed");
  });

  test("per-action undo reverts exactly the newest queued write", async (t) => {
    if (!pbInstalled) return t.skip("ProBuilder not installed in this project");
    const marker = data((await advanced("unity_probuilder_create_shape", {
      shape: "cube", name: `${P}undo_marker`, position: { x: 0, y: 5, z: 0 },
    })).payload);
    assert.equal(marker.success, true);

    const undone = data((await call("unity_undo_last", {})).payload);
    assert.equal(undone.success, true);
    assert.equal(undone.reverted[0].target, `${P}undo_marker`, "undo/last targeted the newest action");

    const search = data((await call("unity_search_by_name", { name: `${P}undo_marker` })).payload);
    assert.equal(search.totalFound, 0, "reverted object is gone from the scene");
  });

  test("dense hierarchy omits defaults for the level objects; verbose restores them", async (t) => {
    if (!pbInstalled) return t.skip("ProBuilder not installed in this project");
    const dense = data((await call("unity_scene_hierarchy", { parentPath: `${P}stair`, maxNodes: 3 })).payload);
    const node = dense.hierarchy[0];
    assert.equal(node.name, `${P}stair`);
    assert.equal(node.tag, undefined, "dense: default tag omitted");
    assert.equal(node.active, undefined, "dense: active=true omitted");
    assert.ok(!(node.components || []).includes("Transform"), "dense: universal Transform omitted");
    assert.ok(node.position, "non-default position kept");

    const verbose = data((await call("unity_scene_hierarchy", { parentPath: `${P}stair`, maxNodes: 3, verbose: true })).payload);
    const vnode = verbose.hierarchy[0];
    assert.equal(vnode.tag, "Untagged", "verbose restores default-valued fields");
    assert.ok(vnode.components.includes("Transform"), "verbose restores Transform");
  });

  test("queue attributed the build to this agent", async () => {
    const { payload } = await call("unity_agents_list");
    const text = JSON.stringify(payload);
    assert.match(text, /agent-/, "agent sessions are tracked");
  });

  test("stdout stayed protocol-clean through the whole live build", () => {
    assert.deepEqual(client.stdoutViolations, []);
  });
});
