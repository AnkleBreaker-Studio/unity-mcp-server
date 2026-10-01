import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { McpTestClient } from "./helpers/mcp-client.mjs";

const project = process.env.UNITY_MCP_PREVIEW_PROJECT;
const baseline = process.env.UNITY_MCP_PREVIEW_BASELINE === "1";
const canonical = path => realpathSync(path).replaceAll("\\", "/").toLowerCase();
test("live previews yield, preserve images and metadata options, and clean their fixtures", {
  skip: !project && "set UNITY_MCP_PREVIEW_PROJECT to a marked project with AssetPreviewLiveValidation.cs",
  timeout: 180_000,
}, async () => {
  assert.ok(isAbsolute(project)); assert.ok(existsSync(join(project, ".unity-mcp-validation")));
  const client = new McpTestClient({ serverEntry: process.env.UNITY_MCP_PREVIEW_SERVER_ENTRY, timeoutMs: 45_000 }).start();
  const report = { nodeVersion: process.version, baseline, passed: false, checks: [], coldProbes: [] };
  let port, opened = false, core;
  const call = async (name, args = {}) => {
    const result = await client.callTool(name, { port, ...args });
    assert.equal(result.isError, false, result.payloadText); return result.payload.data ?? result.payload;
  };
  const invoke = async expression => {
    const result = await call("unity_execute_code", { code: `return UnityMcpAssetPreviewLiveValidation.${expression};` });
    assert.equal(result.success, true, JSON.stringify(result)); return result.result;
  };
  const tool = (name, params) => core.has(name) ? client.callTool(name, { port, ...params })
    : client.callTool("unity_advanced_tool", { port, tool: name, params });
  const close = async () => {
    const result = await invoke("CloseLive()");
    assert.equal(result.assetsRemoved, true); assert.equal(result.sceneCountRestored, true); assert.equal(result.originalSceneClean, true);
    report.cleanup = result; opened = false;
  };
  try {
    await client.initialize(); core = new Set((await client.listTools()).tools.map(tool => tool.name));
    const instances = (await call("unity_list_instances", { refresh: true })).instances;
    const target = instances.find(item => item.projectPath && canonical(item.projectPath) === canonical(project));
    assert.ok(target); port = target.port;
    await call("unity_select_instance", { port });
    const initial = await call("unity_editor_state");
    assert.equal(initial.isPlaying, false); assert.equal(initial.isCompiling, false); assert.equal(initial.sceneDirty, false);
    report.unityVersion = initial.unityVersion;
    const fixture = await invoke("OpenLive()"); opened = true;
    for (let i = 0; i < 3; i++) {
      await invoke("StartColdProbe()");
      let result; const deadline = Date.now() + 30_000;
      do { result = await invoke("ReadColdProbe()"); if (!result.done) await delay(100); } while (!result.done && Date.now() < deadline);
      assert.equal(result.done, true); assert.ok(result.image.width > 0);
      if (!baseline) assert.equal(result.deferred, true);
      report.coldProbes.push(result);
    }
    if (!baseline) {
      assert.ok(report.coldProbes.some(probe => probe.heartbeats > 0 && probe.readBeforePreview));
      for (const [name, params, width, height, green] of [
        ["unity_graphics_asset_preview", { assetPath: fixture.texturePath, width: 40, height: 24 }, 40, 24, true],
        ["unity_graphics_prefab_render", { assetPath: fixture.prefabPath, width: 48, height: 32 }, 48, 32, false],
        ["unity_graphics_texture_info", { assetPath: fixture.texturePath, previewSize: 24 }, 24, 12, true],
        ["unity_graphics_material_info", { assetPath: fixture.materialPath }, 0, 0, false],
      ]) {
        const response = await tool(name, params);
        assert.equal(response.isError, false, response.payloadText);
        const image = response.blocks.find(block => block.type === "image"); assert.ok(image, response.payloadText);
        assert.equal(image.mimeType, "image/png"); assert.match(image.data, /^[A-Za-z0-9+/=]+$/);
        const pixels = await invoke(`CheckPng("${image.data}", ${width}, ${height}, ${green})`);
        report.checks.push({ name, passed: true, ...pixels });
      }
      for (const [name, params, key] of [
        ["unity_graphics_material_info", { objectPath: fixture.objectPath, includePreview: false }, "shaderName"],
        ["unity_graphics_material_info", { gameObjectPath: fixture.objectPath, includePreview: false }, "shaderName"],
        ["unity_graphics_texture_info", { assetPath: fixture.texturePath, previewSize: 0 }, "importSettings"],
      ]) {
        const response = await tool(name, params); assert.equal(response.isError, false, response.payloadText);
        assert.equal(response.blocks.some(block => block.type === "image"), false);
        const data = response.payload.data ?? response.payload; assert.ok(data[key]); assert.equal(data.base64, undefined);
        report.checks.push({ name: name + " omits preview and preserves metadata", passed: true });
      }
      for (const [name, params] of [
        ["unity_graphics_asset_preview", { assetPath: fixture.texturePath, width: 8193, height: 1 }],
        ["unity_graphics_texture_info", { assetPath: fixture.texturePath, previewSize: 2.5 }],
        ["unity_graphics_material_info", { objectPath: fixture.objectPath, materialIndex: -1 }],
      ]) {
        const response = await tool(name, params); assert.equal(response.isError, true, response.payloadText);
        report.checks.push({ name: name + " refuses invalid input", passed: true });
      }
    }
    await close();
    const final = await call("unity_editor_state");
    assert.equal(final.activeScenePath, initial.activeScenePath); assert.equal(final.sceneDirty, false); assert.equal(final.isPlaying, false);
    const errors = await call("unity_get_compilation_errors", { severity: "error" }); assert.equal(errors.count, 0); assert.equal(errors.isCompiling, false);
    assert.deepEqual(client.stdoutViolations, []); report.passed = true;
  } finally {
    try { if (opened) await close(); }
    finally { await client.close(); writeFileSync(join(project, "Library/UnityMcpAssetPreviewLive.json"), JSON.stringify(report, null, 2) + "\n"); }
  }
});
