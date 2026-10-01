import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { McpTestClient } from "./helpers/mcp-client.mjs";

const project = process.env.UNITY_MCP_RENDER_PROJECT;
const canonical = value => realpathSync(value).replaceAll("\\", "/").toLowerCase();
const fixture = "UnityMcpRenderFixture.UnityMcpEditorRenderValidation";

test("owned Unity windows render complete pixels while capture preserves focus and tabs", {
  skip: !project && "set UNITY_MCP_RENDER_PROJECT to a marked Windows project containing EditorRenderValidation.cs",
  timeout: 180_000,
}, async () => {
  assert.ok(isAbsolute(project)); assert.ok(existsSync(join(project, ".unity-mcp-validation")));
  assert.ok(existsSync(join(project, "Assets/Editor/EditorRenderValidation.cs")));
  const client = new McpTestClient({ serverEntry: process.env.UNITY_MCP_RENDER_SERVER_ENTRY, timeoutMs: 45_000 }).start();
  const report = { nodeVersion: process.version, passed: false, captures: [], layouts: [], cleanup: [] };
  let port, started = false;
  const call = async (name, args = {}) => {
    const response = await client.callTool(name, { port, ...args });
    assert.equal(response.isError, false, response.payloadText);
    return response.payload.data ?? response.payload;
  };
  const code = async source => {
    const data = await call("unity_execute_code", { code: source });
    assert.equal(data.success, true, JSON.stringify(data)); return data.result;
  };
  const invoke = expression => code(`return ${fixture}.${expression};`);
  const focus = result => assert.equal(result.foregroundPreserved, true, JSON.stringify(result));
  const capture = async (id, name, activate = false) => {
    const result = await invoke(`Capture("${id}", "${name}.png", ${activate})`);
    assert.equal(result.capture.success, true, JSON.stringify(result)); focus(result);
    assert.equal(result.selectedTabPreserved, true); assert.equal(result.previousDockTabPreserved, true);
    report.captures.push({ name, ...result }); return result.capture;
  };
  const cleanup = async () => {
    const result = await invoke("Close()"); report.cleanup.push(result); focus(result);
    assert.equal(result.preferencesRestored, true); assert.equal(result.dockRestored, true);
  };
  const inspect = async (id, name) => {
    const result = await invoke(`Inspect("${id}")`);
    assert.equal(result.panelAttached, true); assert.equal(result.visible, true);
    assert.ok(result.labels.length > 0);
    const overflow = result.labels.filter(label => label.x < -1 || label.x + label.width > result.width + 1);
    assert.deepEqual(overflow, [], `Horizontal overflow at ${name}`);
    report.layouts.push({ name, ...result }); return result;
  };
  try {
    await client.initialize();
    const instances = await call("unity_list_instances", { refresh: true });
    const target = instances.instances.find(item => item.projectPath && canonical(item.projectPath) === canonical(project));
    assert.ok(target); port = target.port; report.pluginVersion = target.pluginVersion;
    assert.equal(canonical((await call("unity_select_instance", { port })).instance.projectPath), canonical(project));
    const initial = await call("unity_editor_state"); report.unityVersion = initial.unityVersion;
    assert.equal(initial.isPlaying, false); assert.equal(initial.isCompiling, false); assert.equal(initial.sceneDirty, false);
    report.pixelsPerPoint = await code("return EditorGUIUtility.pixelsPerPoint;"); started = true;
    const pattern = await invoke('Open("pattern", 360, 320)'); focus(pattern);
    await delay(500); await capture(pattern.id, "floating-pattern");
    report.floatingPattern = await invoke('CheckPattern("floating-pattern.png")');
    const dashboard = await invoke('Open("dashboard", 360, 500)'); focus(dashboard);
    for (const [width, height] of [[360, 500], [360, 800], [640, 800]]) {
      focus(await invoke(`Resize("${dashboard.id}", ${width}, ${height})`));
      await invoke(`Scroll("${dashboard.id}", 0)`); await delay(500);
      const name = `dashboard-${width}-${height}`;
      const layout = await inspect(dashboard.id, name);
      assert.ok(layout.labels.some(label => label.text.startsWith("__McpRender_LongAgent") && label.overflow === "Ellipsis" && label.tooltip === label.text));
      await capture(dashboard.id, name + "-top");
      await invoke(`Scroll("${dashboard.id}", 10000)`); await delay(500);
      await capture(dashboard.id, name + "-bottom");
    }
    focus(await invoke(`Resize("${dashboard.id}", 360, 500)`));
    for (const section of ["Project Context", "Feature Categories", "Settings"]) {
      await invoke(`Sections("${dashboard.id}", "${section}")`); await delay(500);
      const name = "dashboard-" + section.toLowerCase().replaceAll(" ", "-");
      const layout = await inspect(dashboard.id, name);
      const contextHelp = layout.labels.find(label => label.text.startsWith("No context files found."));
      if (contextHelp && contextHelp.naturalWidth > contextHelp.width) {
        assert.ok(contextHelp.height >= contextHelp.naturalHeight * 1.9, "Context help must remain readable on multiple lines");
      }
      await capture(dashboard.id, name + "-top");
      await invoke(`Scroll("${dashboard.id}", 10000)`); await delay(500);
      await capture(dashboard.id, name + "-bottom");
    }
    await cleanup();
    report.dockedPatterns = [];
    for (const imgui of [false, true]) {
      const name = imgui ? "docked-imgui" : "docked-uitk";
      const dock = await invoke(`OpenDocked(${imgui})`); focus(dock);
      assert.equal(dock.selected, true); assert.equal(dock.docked, true); await delay(500);
      await capture(dock.id, name + "-selected");
      const selected = await invoke(`CheckPattern("${name}-selected.png", true)`);
      const previous = await invoke("SelectPreviousDockTab()"); focus(previous); assert.equal(previous.selected, true);
      const refused = await invoke(`Capture("${dock.id}", "${name}-refused.png")`);
      assert.equal(refused.capture.code, "window_not_visible"); focus(refused);
      assert.equal(refused.selectedTabPreserved, true); assert.equal(refused.previousDockTabPreserved, true);
      await capture(dock.id, name + "-activated", true);
      const activated = await invoke(`CheckPattern("${name}-activated.png", true)`);
      report.dockedPatterns.push({ name, selected, activated, inactiveRefused: true }); await cleanup();
    }
    const compilation = await call("unity_get_compilation_errors", { severity: "error" });
    assert.equal(compilation.count, 0); assert.equal(compilation.isCompiling, false);
    const final = await call("unity_editor_state");
    assert.equal(final.sceneDirty, false); assert.equal(final.isPlaying, false); assert.equal(final.activeScenePath, initial.activeScenePath);
    assert.deepEqual(client.stdoutViolations, []); report.passed = true;
  } finally {
    try { if (started) await cleanup(); }
    catch (error) { report.passed = false; throw error; }
    finally { await client.close(); writeFileSync(join(project, "Library/UnityMcpEditorRender.json"), JSON.stringify(report, null, 2) + "\n"); }
  }
});
