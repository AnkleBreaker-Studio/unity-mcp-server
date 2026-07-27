// Unit tests for the two-tier tool system. The exact tier counts are pinned on purpose:
// the exposed surface is client-facing compatibility (issue #27 — oversized registries can
// break MCP clients). Adding/moving a tool must consciously update these numbers.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { splitToolTiers } from "../../src/tool-tiers.js";
import { editorTools } from "../../src/tools/editor-tools.js";
import { umaTools } from "../../src/tools/uma-tools.js";
import { probuilderTools } from "../../src/tools/probuilder-tools.js";

describe("splitToolTiers on the real tool set", () => {
  const split = splitToolTiers([...editorTools, ...umaTools, ...probuilderTools]);

  test("tier counts are pinned (update deliberately when the surface changes)", () => {
    assert.equal(split.coreCount, 69, "core tier count");
    assert.equal(split.advancedCount, 269, "advanced tier count");
    assert.equal(
      split.coreCount + split.advancedCount,
      editorTools.length + umaTools.length + probuilderTools.length
    );
  });

  test("meta-tools are generated with strict-enough schemas", () => {
    const names = split.metaTools.map((t) => t.name);
    assert.deepEqual(names, ["unity_list_advanced_tools", "unity_advanced_tool"]);
    for (const tool of split.metaTools) {
      assert.equal(tool.inputSchema.type, "object");
      assert.equal(typeof tool.handler, "function");
    }
    const dispatcher = split.metaTools[1];
    assert.deepEqual(dispatcher.inputSchema.required, ["tool"]);
  });

  test("core tier keeps the daily-driver tools", () => {
    const coreNames = new Set(split.coreTools.map((t) => t.name));
    for (const name of [
      "unity_editor_state", "unity_scene_hierarchy", "unity_gameobject_create",
      "unity_component_set_property", "unity_execute_code", "unity_console_log",
      "unity_get_compilation_errors", "unity_play_mode", "unity_search_assets",
      "unity_undo_last",
    ]) {
      assert.ok(coreNames.has(name), `${name} stays core`);
    }
  });

  test("no tool is lost or duplicated across tiers", () => {
    const all = [...editorTools, ...umaTools, ...probuilderTools];
    const seen = new Set();
    for (const t of all) {
      assert.ok(!seen.has(t.name), `duplicate tool definition: ${t.name}`);
      seen.add(t.name);
    }
    const coreNames = new Set(split.coreTools.map((t) => t.name));
    let advanced = 0;
    for (const t of all) if (!coreNames.has(t.name)) advanced++;
    assert.equal(advanced, split.advancedCount);
  });

  test("every tool definition has the {name, description, inputSchema, handler} contract", () => {
    for (const t of [...editorTools, ...umaTools, ...probuilderTools]) {
      assert.ok(/^unity_[a-z0-9_]+$/.test(t.name), `name convention: ${t.name}`);
      assert.equal(typeof t.description, "string");
      assert.equal(t.inputSchema?.type, "object", `${t.name} schema root`);
      assert.equal(typeof t.handler, "function", `${t.name} handler`);
    }
  });

  // Strict-client schema shaping must hold for ADVANCED tools too, not only the exposed
  // core surface (the protocol test only sees the ~80 exposed tools). A batch of advanced
  // tools once shipped `value: { description }` with no `type`, which a strict validator
  // rejects — this guards the whole 346-tool surface, recursively.
  test("every property of every tool (all tiers) is explicitly type-shaped", () => {
    const isShaped = (s) =>
      s && typeof s === "object" &&
      ("type" in s || "enum" in s || "const" in s || "anyOf" in s || "oneOf" in s || "allOf" in s || "$ref" in s);
    const walk = (toolName, path, schema, out) => {
      if (!isShaped(schema)) { out.push(`${toolName}.${path}`); return; }
      for (const [k, sub] of Object.entries(schema.properties || {})) walk(toolName, `${path}.${k}`, sub, out);
      if (schema.items && typeof schema.items === "object" && !Array.isArray(schema.items))
        walk(toolName, `${path}[]`, schema.items, out);
    };
    const violations = [];
    for (const t of [...editorTools, ...umaTools, ...probuilderTools])
      for (const [prop, schema] of Object.entries(t.inputSchema?.properties || {}))
        walk(t.name, prop, schema, violations);
    assert.deepEqual(violations, [], `${violations.length} untyped properties: ${violations.slice(0, 10).join(", ")}`);
  });

  test("all 14 ProBuilder tools land in the advanced tier under the 'probuilder' category", () => {
    const coreNames = new Set(split.coreTools.map((t) => t.name));
    assert.equal(probuilderTools.length, 14, "ProBuilder tool count");
    for (const t of probuilderTools) {
      assert.ok(!coreNames.has(t.name), `${t.name} must be advanced, not core`);
      const category = t.name.replace(/^unity_/, "").split("_")[0];
      assert.equal(category, "probuilder", `${t.name} category`);
    }
  });

  test("ProBuilder tool names derive to the exact plugin routes (lazy-load parity)", () => {
    // Mirrors toolNameToRoute in tool-tiers.js: unity_probuilder_create_shape → probuilder/create-shape.
    const derive = (name) => {
      const parts = name.replace(/^unity_/, "").split("_");
      return `${parts[0]}/${parts.slice(1).join("-")}`;
    };
    const expected = new Set([
      "probuilder/create-shape", "probuilder/info", "probuilder/extrude-faces",
      "probuilder/bevel-edges", "probuilder/subdivide", "probuilder/delete-faces",
      "probuilder/translate-faces", "probuilder/flip-normals", "probuilder/set-face-material",
      "probuilder/boolean", "probuilder/combine", "probuilder/probuilderize",
      "probuilder/center-pivot", "probuilder/export-mesh",
    ]);
    const derived = new Set(probuilderTools.map((t) => derive(t.name)));
    assert.deepEqual(derived, expected, "derived routes must match the plugin's registered routes");
  });
});

describe("splitToolTiers on synthetic input", () => {
  test("unknown names fall into the advanced tier", () => {
    const fake = [
      { name: "unity_editor_state", description: "core-listed", inputSchema: { type: "object" }, handler: async () => "" },
      { name: "unity_experimental_new_thing", description: "not core-listed", inputSchema: { type: "object" }, handler: async () => "" },
    ];
    const split = splitToolTiers(fake);
    assert.equal(split.coreCount, 1);
    assert.equal(split.advancedCount, 1);
    assert.equal(split.coreTools[0].name, "unity_editor_state");
  });
});
