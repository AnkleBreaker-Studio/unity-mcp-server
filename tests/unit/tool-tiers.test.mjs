// Unit tests for the two-tier tool system. The exact tier counts are pinned on purpose:
// the exposed surface is client-facing compatibility (issue #27 — oversized registries can
// break MCP clients). Adding/moving a tool must consciously update these numbers.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { splitToolTiers } from "../../src/tool-tiers.js";
import { editorTools } from "../../src/tools/editor-tools.js";
import { umaTools } from "../../src/tools/uma-tools.js";

describe("splitToolTiers on the real tool set", () => {
  const split = splitToolTiers([...editorTools, ...umaTools]);

  test("tier counts are pinned (update deliberately when the surface changes)", () => {
    assert.equal(split.coreCount, 68, "core tier count");
    assert.equal(split.advancedCount, 254, "advanced tier count");
    assert.equal(split.coreCount + split.advancedCount, editorTools.length + umaTools.length);
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
    ]) {
      assert.ok(coreNames.has(name), `${name} stays core`);
    }
  });

  test("no tool is lost or duplicated across tiers", () => {
    const all = [...editorTools, ...umaTools];
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
    for (const t of [...editorTools, ...umaTools]) {
      assert.ok(/^unity_[a-z0-9_]+$/.test(t.name), `name convention: ${t.name}`);
      assert.equal(typeof t.description, "string");
      assert.equal(t.inputSchema?.type, "object", `${t.name} schema root`);
      assert.equal(typeof t.handler, "function", `${t.name} handler`);
    }
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
