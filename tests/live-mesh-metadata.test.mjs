import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { McpTestClient } from "./helpers/mcp-client.mjs";

const project = process.env.UNITY_MCP_MESH_PROJECT;
const canonical = path => realpathSync(path).replaceAll("\\", "/").toLowerCase();

test("live mesh and renderer metadata preserve aliases, attributes and shared resources", {
  skip: !project && "set UNITY_MCP_MESH_PROJECT to a marked project with MeshMetadataValidation.cs",
  timeout: 120_000,
}, async () => {
  assert.ok(isAbsolute(project)); assert.ok(existsSync(join(project, ".unity-mcp-validation")));
  assert.ok(existsSync(join(project, "Assets/Editor/MeshMetadataValidation.cs")));
  const client = new McpTestClient({ serverEntry: process.env.UNITY_MCP_MESH_SERVER_ENTRY, timeoutMs: 45_000 }).start();
  const report = { nodeVersion: process.version, passed: false, checks: [] };
  let port, opened = false, core;
  const call = async (name, args = {}) => {
    const response = await client.callTool(name, { port, ...args });
    assert.equal(response.isError, false, response.payloadText); return response.payload.data ?? response.payload;
  };
  const code = async source => {
    const data = await call("unity_execute_code", { code: source });
    assert.equal(data.success, true, JSON.stringify(data)); return data.result;
  };
  const invoke = expression => code(`return UnityMcpMeshMetadataValidation.${expression};`);
  const tool = (name, params) => core.has(name) ? client.callTool(name, { port, ...params })
    : client.callTool("unity_advanced_tool", { port, tool: name, params });
  const close = async () => {
    const result = await invoke("CloseLive()");
    assert.equal(result.remaining, 0); assert.equal(result.sceneCountRestored, true); assert.equal(result.originalSceneClean, true);
    report.cleanup = result; opened = false;
  };
  try {
    await client.initialize(); core = new Set((await client.listTools()).tools.map(item => item.name));
    const target = (await call("unity_list_instances", { refresh: true })).instances.find(item => item.projectPath && canonical(item.projectPath) === canonical(project));
    assert.ok(target); port = target.port;
    assert.equal(canonical((await call("unity_select_instance", { port })).instance.projectPath), canonical(project));
    const initial = await call("unity_editor_state"); report.unityVersion = initial.unityVersion;
    assert.equal(initial.isPlaying, false); assert.equal(initial.isCompiling, false); assert.equal(initial.sceneDirty, false);
    const fixture = await invoke("OpenLive()"); opened = true;
    for (const key of ["objectPath", "gameObjectPath"]) {
      for (const name of ["unity_graphics_mesh_info", "unity_graphics_renderer_info"]) {
        const response = await tool(name, { [key]: fixture.objectPath });
        assert.equal(response.isError, false, response.payloadText);
        const data = response.payload.data ?? response.payload;
        const mesh = name.endsWith("mesh_info") ? data : data.mesh;
        assert.equal(mesh.vertexCount, 4); assert.equal(mesh.triangleCount, 1);
        if (name.endsWith("mesh_info")) {
          assert.equal(data.uvChannelCount, 4); assert.equal(data.hasNormals, true); assert.equal(data.hasTangents, true); assert.equal(data.hasColors, true);
        } else {
          assert.equal(data.materialCount, 2); assert.deepEqual(data.materials.map(item => item.name), ["(null/missing)", "(null/missing)"]);
        }
        report.checks.push({ name: name + " via " + key, passed: true, data });
      }
    }
    for (const name of ["unity_graphics_mesh_info", "unity_graphics_renderer_info"]) {
      const response = await tool(name, { objectPath: fixture.missingPath });
      assert.equal(response.isError, true); assert.match(response.payloadText, /not found|no mesh/i);
      report.checks.push({ name: name + " missing object error", passed: true });
    }
    assert.equal(await code(`var mesh = UnityEngine.GameObject.Find("${fixture.objectPath}").GetComponent<UnityEngine.MeshFilter>().sharedMesh; mesh.UploadMeshData(true); return mesh.isReadable;`), false);
    const unreadable = await tool("unity_graphics_mesh_info", { objectPath: fixture.objectPath });
    assert.equal(unreadable.isError, false, unreadable.payloadText);
    const data = unreadable.payload.data ?? unreadable.payload;
    assert.equal(data.isReadable, false); assert.equal(data.triangleCount, 1); assert.equal(data.uvChannelCount, 4);
    report.checks.push({ name: "Non-readable metadata through the editor queue", passed: true, data });
    await close();
    const final = await call("unity_editor_state");
    assert.equal(final.activeScenePath, initial.activeScenePath); assert.equal(final.sceneDirty, false); assert.equal(final.isPlaying, false);
    const errors = await call("unity_get_compilation_errors", { severity: "error" });
    assert.equal(errors.count, 0); assert.equal(errors.isCompiling, false);
    assert.deepEqual(client.stdoutViolations, []); report.passed = true;
  } finally {
    try { if (opened) await close(); }
    catch (error) { report.passed = false; throw error; }
    finally { await client.close(); writeFileSync(join(project, "Library/UnityMcpMeshMetadataLive.json"), JSON.stringify(report, null, 2) + "\n"); }
  }
});
