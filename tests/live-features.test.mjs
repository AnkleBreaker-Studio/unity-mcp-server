import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { McpTestClient } from "./helpers/mcp-client.mjs";

const argument = process.env.UNITY_MCP_FEATURE_PROJECT;
const canonical = path => realpathSync(path).replaceAll("\\", "/").toLowerCase();

test("live scene, component, asset, prefab and screenshot workflows", {
  skip: !argument && "set UNITY_MCP_FEATURE_PROJECT to an open marked disposable project",
  timeout: 360_000,
}, async () => {
  assert.ok(isAbsolute(argument), "use an absolute project path");
  const project = resolve(argument);
  assert.ok(existsSync(join(project, ".unity-mcp-validation")), "refusing an unmarked project");
  const id = randomUUID().replaceAll("-", "");
  const folder = `Assets/__McpValidation/Features${id}`;
  const fixture = `McpPropertyFixture${id}`;
  const scene = `${folder}/Scene.unity`;
  const material = `${folder}/Material.mat`;
  const prefab = `${folder}/Root.prefab`;
  const stateScreenshot = `Library/McpFeatureState${id}.png`;
  const client = new McpTestClient({ timeoutMs: 40_000 }).start();
  const evidence = { nodeVersion: process.version, checks: [] };
  let port;
  let original;
  let owned = false;

  async function raw(name, args = {}) { return client.callTool(name, { port, ...args }); }
  async function call(name, args = {}) {
    const response = await raw(name, args);
    assert.equal(response.isError, false, response.payloadText);
    assert.notEqual(response.payload.success, false, response.payloadText);
    const value = response.payload.data ?? response.payload;
    assert.notEqual(value.success, false, response.payloadText);
    return value;
  }
  async function code(source) {
    const data = await call("unity_execute_code", { code: source });
    assert.equal(data.success, true, JSON.stringify(data));
    return data.result;
  }
  async function ready() {
    const deadline = Date.now() + 120_000;
    let failure;
    while (Date.now() < deadline) {
      try {
        const list = await client.callTool("unity_list_instances", { refresh: true });
        const instance = list.payload.instances.find(item => canonical(item.projectPath) === canonical(project));
        assert.ok(instance, "project absent from discovery");
        port = instance.port;
        await call("unity_select_instance", { port });
        const state = await call("unity_editor_state");
        const compilation = await call("unity_get_compilation_errors", { severity: "error" });
        if (state.isCompiling || compilation.isCompiling) { await delay(1000); continue; }
        assert.equal(compilation.count, 0, JSON.stringify(compilation));
        assert.equal(state.isPlaying, false);
        return state;
      } catch (error) { failure = error; }
      await delay(1000);
    }
    throw failure || new Error("editor did not become ready");
  }
  async function rejected(name, args) {
    const result = await raw(name, args);
    assert.equal(result.isError, true, result.payloadText);
    return result.payload.data ?? result.payload;
  }
  async function properties() {
    return (await call("unity_component_get_properties", { gameObjectPath: "McpRoot/Cube", componentType: fixture })).properties;
  }
  async function set(propertyName, value) {
    return call("unity_component_set_property", { gameObjectPath: "McpRoot/Cube", componentType: fixture, propertyName, value });
  }

  try {
    await client.initialize();
    original = await ready();
    assert.equal(original.sceneDirty, false, "save the disposable scene first");
    assert.ok(original.activeScenePath, "save the disposable scene first");
    assert.equal((await call("unity_scene_info")).sceneCount, 1, "use one loaded disposable scene");
    evidence.unityVersion = original.unityVersion;
    mkdirSync(join(project, folder), { recursive: true });
    owned = true;
    const source = readFileSync(new URL("./fixtures/McpPropertyFixture.cs", import.meta.url), "utf8").replaceAll("McpPropertyFixture", fixture);
    writeFileSync(join(project, folder, `${fixture}.cs`), source);
    await call("unity_execute_menu_item", { menuPath: "Assets/Refresh" });
    await ready();
    await call("unity_scene_new");
    assert.equal((await rejected("unity_scene_save")).requiresPath, true);
    await call("unity_gameobject_create", { name: "McpRoot", primitiveType: "Empty" });
    const cube = await call("unity_gameobject_create", { name: "Cube", primitiveType: "Cube", parent: "McpRoot" });
    assert.match(cube.instanceId, /^-?\d+$/);
    await call("unity_gameobject_create", { name: "Lamp", primitiveType: "Empty", parent: "McpRoot" });
    await call("unity_component_add", { gameObjectPath: "McpRoot/Lamp", componentType: "Light" });
    await call("unity_component_add", { gameObjectPath: "McpRoot/Cube", componentType: fixture });
    await call("unity_gameobject_set_transform", { instanceId: cube.instanceId, position: { x: 1, y: 2, z: 3 }, local: true });
    assert.equal((await rejected("unity_scene_new")).requiresConfirmation, true);
    assert.equal((await rejected("unity_scene_open", { path: original.activeScenePath })).requiresConfirmation, true);
    assert.ok((await rejected("unity_scene_new", { saveFirst: true })).unsaveableScenes.length > 0);
    await call("unity_scene_save", { path: scene });
    evidence.checks.push("Unsaved scene guards reject without dialogs; explicit scene save and string object IDs work");

    const initial = await properties();
    assert.equal(initial.find(p => p.name === "mask").enumValue, 3);
    assert.equal(initial.find(p => p.name === "mask").enumIndex, -1);
    await set("mode", "Second");
    assert.equal((await properties()).find(p => p.name === "mode").enumValue, 4);
    await set("mode", 2);
    assert.equal((await properties()).find(p => p.name === "mode").enumValue, 9);
    const invalidEnums = ["Missing", -1, 3, 1.2, true, null,
      ...["4", true, null, 1.2, 2147483648].map(enumValue => ({ enumValue }))];
    for (const value of invalidEnums) {
      await rejected("unity_component_set_property", { gameObjectPath: "McpRoot/Cube", componentType: fixture, propertyName: "mode", value });
      assert.equal((await properties()).find(p => p.name === "mode").enumValue, 9);
    }
    await set("mask", { enumValue: 5 });
    await set("mode", { enumValue: 99 });
    const values = await properties();
    assert.equal(values.find(p => p.name === "mask").value, 5);
    assert.equal(values.find(p => p.name === "mode").value, 99);
    assert.deepEqual(await code(`var item = UnityEngine.GameObject.Find("McpRoot/Cube").GetComponent<${fixture}>(); return new { mode = (int)item.mode, mask = (int)item.mask };`), { mode: 99, mask: 5 });
    evidence.checks.push("Sparse enum names and legacy numeric indices, combined flags, unknown stored values and eleven invalid writes with unchanged data");

    await call("unity_component_set_reference", { path: "McpRoot/Cube", componentType: fixture, propertyName: "lightReference", referenceGameObject: "McpRoot/Lamp", referenceComponentType: "Light" });
    assert.equal((await properties()).find(p => p.name === "lightReference").value.type, "Light");
    await rejected("unity_component_set_reference", { path: "McpRoot/Cube", componentType: fixture, propertyName: "lightReference", referenceGameObject: "Absent" });
    assert.equal((await properties()).find(p => p.name === "lightReference").value.type, "Light");
    await call("unity_material_create", { path: material, shader: "Standard", color: { r: 0.2, g: 0.5, b: 0.8, a: 1 } });
    await rejected("unity_material_create", { path: material, shader: "Standard" });
    await call("unity_component_set_reference", { path: "McpRoot/Cube", componentType: "MeshRenderer", propertyName: "m_Materials.Array.data[0]", assetPath: material });
    await call("unity_asset_create_prefab", { gameObjectPath: "McpRoot", savePath: prefab });
    await rejected("unity_asset_create_prefab", { gameObjectPath: "McpRoot", savePath: prefab });
    await call("unity_asset_instantiate_prefab", { prefabPath: prefab, name: "McpCopy" });
    assert.deepEqual(await code(`var cube = UnityEngine.GameObject.Find("McpCopy/Cube"); var item = cube.GetComponent<${fixture}>();
      return new { prefab = UnityEditor.PrefabUtility.GetPrefabAssetPathOfNearestInstanceRoot(cube),
        material = UnityEditor.AssetDatabase.GetAssetPath(cube.GetComponent<UnityEngine.Renderer>().sharedMaterial),
        target = item.lightReference.transform.parent.name, mode = (int)item.mode, mask = (int)item.mask };`),
    { prefab, material, target: "McpCopy", mode: 99, mask: 5 });
    evidence.checks.push("Scene and material references survive prefab save/instantiate; missing references and asset overwrites preserve data");

    const assets = await call("unity_asset_list", { folder, maxResults: 1 });
    assert.equal(assets.count, 1);
    assert.equal(assets.assets.length, 1);
    assert.ok(assets.totalCount >= 4);
    assert.equal(assets.truncated, true);
    await rejected("unity_asset_list", { folder, maxResults: 0 });
    await rejected("unity_asset_delete", { path: folder });
    assert.ok(existsSync(join(project, prefab)));
    const hierarchy = await call("unity_scene_hierarchy", { parentPath: "McpRoot", maxNodes: 2 });
    assert.equal(hierarchy.returnedNodes, 2);
    assert.equal(hierarchy.truncated, true);
    evidence.checks.push("Asset and hierarchy limits report truncation; folder deletion requires explicit recursion");

    const imagePath = `${folder}/Scene.png`;
    await call("unity_advanced_tool", { tool: "unity_screenshot_scene", params: { path: imagePath, width: 128, height: 96 } });
    const png = readFileSync(join(project, imagePath));
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(png.readUInt32BE(16), 128);
    assert.equal(png.readUInt32BE(20), 96);
    evidence.checks.push("Scene screenshot writes a valid PNG with the requested dimensions");
    for (const [width, height] of [[0, 96], [1, -1], [8193, 1], [8192, 4097]]) {
      await rejected("unity_advanced_tool", { tool: "unity_screenshot_scene", params: { path: imagePath, width, height } });
    }
    evidence.screenshotState = await code(`
      var camera = UnityEditor.SceneView.lastActiveSceneView.camera;
      var originalTarget = camera.targetTexture; var originalActive = UnityEngine.RenderTexture.active;
      var sentinel = new UnityEngine.RenderTexture(8, 8, 0); sentinel.Create();
      var results = new System.Collections.Generic.List<object>();
      try {
        // Unity retains temporary render buffers; warm them before measuring resources owned by the capture.
        var warmup = new UnityEngine.RenderTexture(64, 48, 24);
        try { camera.targetTexture = warmup; camera.Render(); }
        finally { camera.targetTexture = originalTarget; UnityEngine.RenderTexture.active = originalActive; UnityEngine.Object.DestroyImmediate(warmup); }
        foreach (var path in new[] { "${folder}", "${stateScreenshot}" }) {
          camera.targetTexture = sentinel; UnityEngine.RenderTexture.active = sentinel;
          var textures = new System.Collections.Generic.HashSet<UnityEngine.Texture2D>(UnityEngine.Resources.FindObjectsOfTypeAll<UnityEngine.Texture2D>());
          var targets = new System.Collections.Generic.HashSet<UnityEngine.RenderTexture>(UnityEngine.Resources.FindObjectsOfTypeAll<UnityEngine.RenderTexture>());
          string error = "";
          try { UnityMCP.Editor.MCPScreenshotCommands.CaptureSceneView(new System.Collections.Generic.Dictionary<string, object> { {"path", path}, {"width", 64}, {"height", 48} }); }
          catch (System.Exception failure) { error = failure.GetType().Name; }
          results.Add(new { error, targetRestored = camera.targetTexture == sentinel, activeRestored = UnityEngine.RenderTexture.active == sentinel,
            extraTargets = UnityEngine.Resources.FindObjectsOfTypeAll<UnityEngine.RenderTexture>().Where(x => !targets.Contains(x) && x.width == 64 && x.height == 48).Select(x => new { x.name, flags = x.hideFlags.ToString() }).ToArray(),
            extraTextures = UnityEngine.Resources.FindObjectsOfTypeAll<UnityEngine.Texture2D>().Count(x => !textures.Contains(x) && x.width == 64 && x.height == 48) });
          camera.targetTexture = originalTarget; UnityEngine.RenderTexture.active = originalActive;
        }
        return results;
      } finally { camera.targetTexture = originalTarget; UnityEngine.RenderTexture.active = originalActive; UnityEngine.Object.DestroyImmediate(sentinel); }
    `);
    assert.notEqual(evidence.screenshotState[0].error, "");
    assert.equal(evidence.screenshotState[1].error, "");
    for (const state of evidence.screenshotState) {
      assert.equal(state.targetRestored, true);
      assert.equal(state.activeRestored, true);
      assert.deepEqual(state.extraTargets, []);
      assert.equal(state.extraTextures, 0);
    }
    evidence.checks.push("Successful and failed screenshots restore render targets and release their textures; invalid dimensions fail before rendering");
    await call("unity_scene_save");
    await call("unity_scene_open", { path: original.activeScenePath });
    await call("unity_scene_open", { path: scene });
    assert.equal(await code(`return (int)UnityEngine.GameObject.Find("McpCopy/Cube").GetComponent<${fixture}>().mask;`), 5);
    evidence.checks.push("Scene reopening preserves serialized prefab data");
    assert.deepEqual(client.stdoutViolations, []);
    evidence.passed = true;
  } catch (error) {
    evidence.error = error.message;
    throw error;
  } finally {
    try {
      if (owned) {
        await ready();
        await call("unity_scene_open", { path: original.activeScenePath, discardUnsavedChanges: true });
        await call("unity_asset_delete", { path: folder, recursive: true, permanent: true });
        await call("unity_execute_menu_item", { menuPath: "Assets/Refresh" });
        const restored = await ready();
        assert.equal(restored.activeScenePath, original.activeScenePath);
        assert.equal(restored.sceneDirty, false);
        assert.equal(existsSync(join(project, folder)), false);
        evidence.restored = true;
      }
    } catch (error) {
      evidence.cleanupError = error.message;
      evidence.passed = false;
      throw error;
    } finally {
      rmSync(join(project, stateScreenshot), { force: true });
      writeFileSync(join(project, "Library/UnityMcpFeatures.json"), JSON.stringify(evidence, null, 2) + "\n");
      await client.close();
    }
  }
});
