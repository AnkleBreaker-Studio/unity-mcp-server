import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { McpTestClient } from "./helpers/mcp-client.mjs";

const project = process.env.UNITY_MCP_GRAPHICS_PROJECT;
const canonical = path => realpathSync(path).replaceAll("\\", "/").toLowerCase();

test("live inline captures preserve camera choice, dimensions, images and fixture state", {
  skip: !project && "set UNITY_MCP_GRAPHICS_PROJECT to a marked project containing GraphicsCaptureValidation.cs",
  timeout: 120_000,
}, async () => {
  assert.ok(isAbsolute(project)); assert.ok(existsSync(join(project, ".unity-mcp-validation")));
  assert.ok(existsSync(join(project, "Assets/Editor/GraphicsCaptureValidation.cs")));
  const client = new McpTestClient({ serverEntry: process.env.UNITY_MCP_GRAPHICS_SERVER_ENTRY, timeoutMs: 45_000 }).start();
  const report = { nodeVersion: process.version, invocation: "direct core tools", passed: false, checks: [] };
  let port, started = false;
  const call = async (name, args = {}) => {
    const result = await client.callTool(name, { port, ...args });
    assert.equal(result.isError, false, result.payloadText); return result.payload.data ?? result.payload;
  };
  const code = async source => {
    const result = await call("unity_execute_code", { code: source });
    assert.equal(result.success, true, JSON.stringify(result)); return result.result;
  };
  const invoke = expression => code(`return UnityMcpGraphicsCaptureValidation.${expression};`);
  const close = async () => {
    const result = await invoke("CloseLive()");
    assert.equal(result.remaining, 0); assert.equal(result.sceneCountRestored, true); assert.equal(result.originalSceneClean, true);
    report.cleanup = result; started = false;
  };
  try {
    await client.initialize();
    const discovered = await call("unity_list_instances", { refresh: true });
    const target = discovered.instances.find(item => item.projectPath && canonical(item.projectPath) === canonical(project));
    assert.ok(target); port = target.port;
    assert.equal(canonical((await call("unity_select_instance", { port })).instance.projectPath), canonical(project));
    const initial = await call("unity_editor_state"); report.unityVersion = initial.unityVersion;
    assert.equal(initial.isPlaying, false); assert.equal(initial.isCompiling, false); assert.equal(initial.sceneDirty, false);
    const fixture = await invoke("OpenLive()"); started = true;
    for (const [tool, params, blue] of [
      ["unity_graphics_game_capture", { cameraName: fixture.cameraName, width: 64, height: 40 }, true],
      ["unity_graphics_scene_capture", { width: 64, height: 40 }, false],
    ]) {
      const response = await client.callTool(tool, { port, ...params });
      assert.equal(response.isError, false, response.payloadText);
      const image = response.blocks.find(block => block.type === "image");
      assert.ok(image, response.payloadText); assert.equal(image.mimeType, "image/png");
      assert.match(image.data, /^[A-Za-z0-9+/=]+$/);
      const bytes = Buffer.from(image.data, "base64");
      assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
      assert.equal(bytes.readUInt32BE(16), 64); assert.equal(bytes.readUInt32BE(20), 40);
      const pixels = await invoke(`CheckLivePng("${image.data}", 64, 40, ${blue})`);
      report.checks.push({ name: tool + " returns a valid inline PNG", passed: true, ...pixels });
    }
    for (const [name, params, pattern] of [
      ["missing camera", { cameraName: fixture.missingName }, /camera/i],
      ["object without Camera", { cameraName: fixture.emptyName }, /camera/i],
      ["oversized dimensions", { cameraName: fixture.cameraName, width: 8193, height: 1 }, /dimension/i],
      ["fractional dimensions", { cameraName: fixture.cameraName, width: 32.5, height: 40 }, /dimension/i],
    ]) {
      const response = await client.callTool("unity_graphics_game_capture", { port, ...params });
      assert.equal(response.isError, true); assert.match(response.payloadText, pattern);
      assert.equal(response.blocks.some(block => block.type === "image"), false);
      report.checks.push({ name: name + " returns an MCP error without an image", passed: true });
    }
    await close();
    const final = await call("unity_editor_state");
    assert.equal(final.activeScenePath, initial.activeScenePath); assert.equal(final.sceneDirty, false); assert.equal(final.isPlaying, false);
    const errors = await call("unity_get_compilation_errors", { severity: "error" });
    assert.equal(errors.count, 0); assert.equal(errors.isCompiling, false);
    assert.deepEqual(client.stdoutViolations, []); report.passed = true;
  } finally {
    try { if (started) await close(); }
    catch (error) { report.passed = false; throw error; }
    finally { await client.close(); writeFileSync(join(project, "Library/UnityMcpGraphicsLive.json"), JSON.stringify(report, null, 2) + "\n"); }
  }
});
