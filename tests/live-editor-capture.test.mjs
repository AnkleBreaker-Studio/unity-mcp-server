import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { McpTestClient } from "./helpers/mcp-client.mjs";

const project = process.env.UNITY_MCP_CAPTURE_PROJECT;
const canonical = value => realpathSync(value).replaceAll("\\", "/").toLowerCase();

test("editor capture selects unshown owned fixtures without changing the editor layout", {
  skip: !project && "set UNITY_MCP_CAPTURE_PROJECT to a marked project containing EditorCaptureValidation.cs",
  timeout: 90_000,
}, async () => {
  assert.ok(isAbsolute(project)); assert.ok(existsSync(join(project, ".unity-mcp-validation")));
  assert.ok(existsSync(join(project, "Assets/Editor/EditorCaptureValidation.cs")));
  const client = new McpTestClient({ serverEntry: process.env.UNITY_MCP_CAPTURE_SERVER_ENTRY, timeoutMs: 45_000 }).start();
  const marker = "__McpCapture_" + randomUUID().replaceAll("-", "");
  const report = { nodeVersion: process.version, passed: false, checks: [] };
  let port, created = false;
  const call = async (name, args = {}) => {
    const result = await client.callTool(name, { port, ...args }); assert.equal(result.isError, false, result.payloadText);
    return result.payload.data ?? result.payload;
  };
  const code = async source => (await call("unity_execute_code", { code: source })).result;
  const capture = async params => {
    const result = await client.callTool("unity_advanced_tool", { port, tool: "unity_screenshot_editor_window", params });
    assert.equal(result.isError, true, result.payloadText); return result.payload.data ?? result.payload;
  };
  try {
    await client.initialize();
    const instances = await call("unity_list_instances", { refresh: true });
    const target = instances.instances.find(item => item.projectPath && canonical(item.projectPath) === canonical(project));
    assert.ok(target); port = target.port;
    assert.equal(canonical((await call("unity_select_instance", { port })).instance.projectPath), canonical(project));
    const state = await call("unity_editor_state"); report.unityVersion = state.unityVersion;
    assert.equal(state.isPlaying, false); assert.equal(state.isCompiling, false); assert.equal(state.sceneDirty, false);
    await call("unity_list_advanced_tools", { tool: "unity_screenshot_editor_window" });
    created = true;
    const ids = await code(`var type = AppDomain.CurrentDomain.GetAssemblies().Select(a => a.GetType("UnityMcpCaptureFixture.CaptureWindow")).First(t => t != null); var identity = typeof(UnityMCP.Editor.MCPBridgeServer).Assembly.GetType("UnityMCP.Editor.MCPObjectId").GetMethod("Get"); var windows = new List<EditorWindow>(); for (int i = 0; i < 2; i++) { var window = (EditorWindow)ScriptableObject.CreateInstance(type); window.titleContent = new GUIContent("${marker}" + i); windows.Add(window); } return windows.Select(w => (string)identity.Invoke(null, new object[] { w })).ToArray();`);
    const ambiguous = await capture({ window: "UnityMcpCaptureFixture.CaptureWindow" });
    assert.equal(ambiguous.code, "ambiguous_window");
    assert.deepEqual(ambiguous.candidates.map(item => item.window).sort(), ids.map(id => "id:" + id).sort());
    report.checks.push({ name: "Duplicate types return exact string identities through MCP", passed: true, candidates: ambiguous.candidates });
    for (const id of ids) {
      const result = await capture({ window: "id:" + id });
      assert.equal(result.code, "window_not_visible");
    }
    const title = await capture({ window: marker + "0", activateTab: true });
    assert.equal(title.code, "window_not_visible");
    const missing = await capture({ window: "id:0" }); assert.equal(missing.code, "window_not_found");
    report.checks.push({ name: "Identity/title selection never creates or displays an unshown window", passed: true });
    const visibility = await code(`return Resources.FindObjectsOfTypeAll<EditorWindow>().Where(w => w.titleContent.text.StartsWith("${marker}")).Select(w => new { visible = w.hasFocus, docked = w.docked }).ToArray();`);
    assert.equal(visibility.length, 2); assert.ok(visibility.every(w => !w.visible && !w.docked));
    const compilation = await call("unity_get_compilation_errors", { severity: "error" }); assert.equal(compilation.count, 0); assert.equal(compilation.isCompiling, false);
    const final = await call("unity_editor_state"); assert.equal(final.sceneDirty, false); assert.equal(final.isPlaying, false);
    assert.deepEqual(client.stdoutViolations, []); report.passed = true;
  } finally {
    try {
      if (created) { report.fixturesRemoved = await code(`var windows = Resources.FindObjectsOfTypeAll<EditorWindow>().Where(w => w.titleContent.text.StartsWith("${marker}")).ToArray(); foreach (var window in windows) UnityEngine.Object.DestroyImmediate(window); return windows.Length;`); }
    } finally { await client.close(); writeFileSync(join(project, "Library/UnityMcpEditorCapture.json"), JSON.stringify(report, null, 2) + "\n"); }
  }
});
