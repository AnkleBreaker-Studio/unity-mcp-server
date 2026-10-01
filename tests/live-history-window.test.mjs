import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { McpTestClient } from "./helpers/mcp-client.mjs";

const project = process.env.UNITY_MCP_HISTORY_WINDOW_PROJECT;
const baseline = process.env.UNITY_MCP_HISTORY_WINDOW_BASELINE === "1";
const canonical = value => realpathSync(value).replaceAll("\\", "/").toLowerCase();
const fixture = "UnityMcpHistoryWindowFixture.UnityMcpHistoryWindowValidation";

test("history window drawing cost, native resource lifetime and interaction", {
  skip: !project && "set UNITY_MCP_HISTORY_WINDOW_PROJECT to a marked Windows editor with HistoryWindowValidation.cs",
  timeout: 180_000,
}, async () => {
  assert.ok(isAbsolute(project) && existsSync(join(project, ".unity-mcp-validation")));
  const client = new McpTestClient({ serverEntry: process.env.UNITY_MCP_TEST_SERVER_ENTRY, timeoutMs: 40_000 }).start();
  const report = { node: process.version, serverEntry: process.env.UNITY_MCP_TEST_SERVER_ENTRY || "current", baseline, passed: false, measurements: [] };
  let port, started = false;
  async function call(name, args = {}) {
    const response = await client.callTool(name, { port, ...args });
    assert.equal(response.isError, false, response.payloadText); return response.payload.data ?? response.payload;
  }
  async function invoke(expression) {
    const result = await call("unity_execute_code", { code: `return ${fixture}.${expression};` });
    assert.equal(result.success, true, JSON.stringify(result)); return result.result;
  }
  async function wait(label, predicate) {
    const deadline = Date.now() + 50_000;
    while (Date.now() < deadline) { const value = await invoke("Poll()"); if (predicate(value)) return value; await delay(250); }
    throw new Error(label + " timed out");
  }
  try {
    await client.initialize();
    const list = await call("unity_list_instances", { refresh: true });
    const instance = list.instances.find(x => x.projectPath && canonical(x.projectPath) === canonical(project));
    assert.ok(instance); port = instance.port; await call("unity_select_instance");
    const state = await call("unity_editor_state"); report.unity = state.unityVersion;
    assert.equal(state.isPlaying, false); assert.equal(state.isCompiling, false); assert.equal(state.sceneDirty, false);
    const errors = await call("unity_get_compilation_errors", { severity: "error" }); assert.equal(errors.count, 0);
    started = true;
    for (const count of [100, 500, 5000]) {
      const opened = await invoke(`Begin(${count})`);
      assert.equal(opened.foregroundPreserved, true); assert.equal(opened.previousTabPreserved, true); assert.ok(opened.allocationControlEvents > 0);
      const measured = await wait("Window repaint sampling", x => x.ready);
      assert.deepEqual(measured.guiErrors, []);
      assert.equal(measured.records, count); assert.ok(measured.layoutMedianAllocations > 0 && measured.repaintMedianAllocations > 0);
      report.measurements.push({ count, opened, ...measured });
    }
    await invoke("ProbeResources()");
    report.resources = (await wait("Resource probe", x => x.resources != null)).resources;
    if (!baseline) assert.equal(report.resources.texturesAliveAfterWindowDestruction, 0);
    if (!baseline) {
      const small = report.measurements[0], large = report.measurements[2];
      assert.ok(large.layoutMedianAllocations <= small.layoutMedianAllocations * 2, "Layout allocations grow with off-screen records");
      assert.ok(large.repaintMedianAllocations <= small.repaintMedianAllocations * 2, "Repaint allocations grow with off-screen records");
      report.interactions = [];
      async function configure(row, search = "Root/Fixture/", width = 720, height = 520) {
        const pending = await invoke(`Configure(${row}, ${JSON.stringify(search)}, ${width}, ${height})`);
        assert.equal(pending.foregroundPreserved, true);
        await wait("Configured window repaint", x => x.draws > pending.draws);
        return invoke("State()");
      }
      async function click(x, y) {
        const result = await invoke(`Click(${x}, ${y})`); assert.equal(result.foregroundPreserved, true); return result.state;
      }
      await configure(0);
      const top = await click(100, 30); assert.equal(top.selectedIndex, 0); assert.equal(top.selectedTarget, "Root/Fixture/LongTarget-4999");
      report.interactions.push({ name: "Top row click", ...top });
      await invoke("AttachTarget()"); const link = await click(340, 30); assert.equal(link.nativeTargetSelected, true);
      report.interactions.push({ name: "Target link selects the exact native object", ...link });
      const wheel = await invoke("Wheel()"); await wait("Wheel repaint", x => x.draws > wheel.draws);
      const scrolled = await invoke("State()"); assert.ok(scrolled.scrollY > 0); report.interactions.push({ name: "Mouse wheel", ...scrolled });
      await configure(2500); const middle = await click(100, 30);
      assert.equal(middle.selectedIndex, 2500); assert.equal(middle.selectedTarget, "Root/Fixture/LongTarget-2499");
      report.interactions.push({ name: "Middle row click", ...middle });
      for (const [width, height] of [[500, 400], [1200, 900]]) {
        await configure(100000, "Root/Fixture/", width, height);
        const bottom = await click(100, height - 180 - 28 + 18 - 8);
        assert.equal(bottom.selectedIndex, 4999); assert.equal(bottom.selectedTarget, "Root/Fixture/LongTarget-0");
        report.interactions.push({ name: `Bottom row at ${width}x${height}`, ...bottom });
      }
      const narrowed = await configure(100000, "LongTarget-0");
      assert.equal(narrowed.count, 1); assert.equal(narrowed.scrollY, 0); assert.equal(narrowed.selectedIndex, 0);
      report.interactions.push({ name: "Filter shrink clamps scroll and preserves selected identity", ...narrowed });
      const empty = await configure(100000, "__no_matching_fixture__");
      assert.equal(empty.count, 0); assert.equal(empty.scrollY, 0); assert.equal(empty.selectedIndex, -1);
      report.interactions.push({ name: "Empty filter clears selection and scroll", ...empty });
      report.guiErrors = (await invoke("Poll()")).guiErrors; assert.deepEqual(report.guiErrors, []);
    }
    report.cleanup = await invoke("Close()"); started = false;
    assert.equal(report.cleanup.foregroundPreserved, true); assert.equal(report.cleanup.previousTabPreserved, true);
    if (!baseline) assert.equal(report.cleanup.textureSurvived, false);
    assert.deepEqual(client.stdoutViolations, []); report.passed = !baseline || report.resources.texturesAliveAfterWindowDestruction === 0;
  } catch (error) { report.error = error.stack; throw error; }
  finally {
    try { if (started) report.cleanup = await invoke("Close()"); }
    finally { await client.close(); writeFileSync(join(project, "Library/UnityMcpHistoryWindow.json"), JSON.stringify(report, null, 2) + "\n"); }
  }
});
