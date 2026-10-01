import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { McpTestClient } from "./helpers/mcp-client.mjs";

const project = process.env.UNITY_MCP_QUEUE_ADMISSION_PROJECT;
const canonical = path => realpathSync(path).replaceAll("\\", "/").toLowerCase();
const parse = result => {
  assert.notEqual(result.isError, true, result.payloadText);
  return result.payload;
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test("live command saturation rejects new work and recovers without executing the refused write", {
  skip: !project && "set UNITY_MCP_QUEUE_ADMISSION_PROJECT to a marked open validation project", timeout: 80_000,
}, async () => {
  assert.ok(isAbsolute(project) && existsSync(join(project, ".unity-mcp-validation")));
  const client = new McpTestClient({ serverEntry: process.env.UNITY_MCP_TEST_SERVER_ENTRY, timeoutMs: 45_000 }).start();
  const report = { nodeVersion: process.version, serverEntry: process.env.UNITY_MCP_TEST_SERVER_ENTRY || "current", passed: false, checks: [] };
  const key = `queue-admission-${randomUUID()}`, objectName = `__MustNotCreate_${key}`;
  let port, scheduled = false;
  const call = (name, args = {}) => client.callTool(name, { ...args, port });
  const info = async () => parse(await call("unity_queue_info")).data.httpCommands;
  try {
    await client.initialize();
    const discovered = parse(await client.callTool("unity_list_instances", { refresh: true }));
    const instance = discovered.instances.find(item => item.projectPath && canonical(item.projectPath) === canonical(project));
    assert.ok(instance, "Marked validation editor was not discovered"); port = instance.port;
    parse(await call("unity_select_instance"));
    const initial = parse(await call("unity_editor_state")).data;
    assert.equal(canonical(initial.projectPath), canonical(project)); assert.equal(initial.sceneDirty, false);
    assert.equal(initial.isPlaying, false); assert.equal(initial.isCompiling, false);
    const compilation = parse(await call("unity_get_compilation_errors", { severity: "error" })).data;
    assert.equal(compilation.count, 0);
    const before = await info(); assert.equal(before.activeCount, 0); assert.equal(before.argumentCostBytes, 0);
    report.project = { projectPath: project, port, unityVersion: instance.unityVersion, pluginVersion: instance.pluginVersion };
    const code = `
if (!UnityEngine.Application.dataPath.Replace(System.IO.Path.DirectorySeparatorChar, '/').Equals(${JSON.stringify(join(project, "Assets").replaceAll("\\", "/"))}, System.StringComparison.OrdinalIgnoreCase)) throw new System.Exception("Unexpected validation project");
if (!System.IO.File.Exists(${JSON.stringify(join(project, ".unity-mcp-validation").replaceAll("\\", "/"))})) throw new System.Exception("Validation marker missing");
var scene = UnityEngine.SceneManagement.SceneManager.GetActiveScene();
if (scene.isDirty || UnityEditor.EditorApplication.isPlayingOrWillChangePlaymode) throw new System.Exception("Validation editor is not clean");
var type = typeof(UnityMCP.Editor.MCPRequestQueue);
var flags = System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic;
var submit = type.GetMethod("SubmitHttpDeferredRequest", flags);
var finish = type.GetMethod("TryCompleteTicket", flags);
var tickets = new System.Collections.Generic.List<UnityMCP.Editor.MCPRequestQueue.RequestTicket>();
double expires = UnityEditor.EditorApplication.timeSinceStartup + 30;
bool filled = false;
System.AppDomain.CurrentDomain.SetData(${JSON.stringify(key)}, true);
UnityEditor.EditorApplication.CallbackFunction update = null;
update = () => {
  if (!filled) {
    filled = true;
    try {
      var metrics = (System.Collections.Generic.Dictionary<string, object>)UnityMCP.Editor.MCPRequestQueue.GetQueueInfo()["httpCommands"];
      if (System.Convert.ToInt32(metrics["activeCount"]) != 0) throw new System.Exception("Another command is active in this validation editor");
      int count = System.Convert.ToInt32(metrics["maxCount"]);
      for (int index = 0; index < count; index++) {
        System.Action<System.Action<object>, System.Func<bool>> hold = (resolve, active) => {};
        tickets.Add((UnityMCP.Editor.MCPRequestQueue.RequestTicket)submit.Invoke(null, new object[] { ${JSON.stringify(key)}, "editor/state", hold, 1024L }));
      }
    } catch { expires = 0; }
  }
  if (UnityEditor.EditorApplication.timeSinceStartup < expires) return;
  UnityEditor.EditorApplication.update -= update;
  foreach (var ticket in tickets) finish.Invoke(null, new object[] { ticket, UnityMCP.Editor.MCPRequestQueue.RequestStatus.TimedOut, null, "Validation hold released", -1, null });
  tickets.Clear(); System.AppDomain.CurrentDomain.SetData(${JSON.stringify(key)}, null);
};
UnityEditor.EditorApplication.update += update;
return "Scheduled bounded admission fixture with automatic cleanup";`;
    scheduled = true;
    parse(await call("unity_execute_code", { code }));
    let full;
    for (let attempt = 0; attempt < 20; attempt++) {
      full = await info(); if (full.activeCount === full.maxCount) break; await sleep(100);
    }
    assert.equal(full.activeCount, 256); assert.equal(full.argumentCostBytes, 256 * 1024);
    report.checks.push({ name: "All 256 HTTP command slots remain occupied after request bodies finish", passed: true, metrics: full });
    const rejected = await call("unity_gameobject_create", { name: objectName });
    assert.equal(rejected.isError, true, rejected.payloadText);
    if (!process.env.UNITY_MCP_TEST_SERVER_ENTRY) {
      assert.equal(rejected.payload.requestAccepted, false); assert.equal(rejected.payload.code, "command_queue_busy");
      assert.equal(rejected.payload.outcomeUnknown, undefined);
    }
    report.checks.push({ name: "Saturated request returns an error before admission", passed: true, response: rejected.payload || rejected.payloadText });
    for (let attempt = 0; attempt < 45 && (await info()).activeCount !== 0; attempt++) await sleep(1000);
    const after = await info(); assert.equal(after.activeCount, 0); assert.equal(after.argumentCostBytes, 0);
    assert.ok(after.admissionRefusals > before.admissionRefusals);
    const verify = parse(await call("unity_execute_code", { code: `return new { missing = UnityEngine.GameObject.Find(${JSON.stringify(objectName)}) == null, fixtureReleased = System.AppDomain.CurrentDomain.GetData(${JSON.stringify(key)}) == null };` })).data;
    assert.equal(verify.success, true); assert.equal(verify.result.missing, true); assert.equal(verify.result.fixtureReleased, true);
    report.checks.push({ name: "Automatic cleanup returns the budget and refused write has no scene effect", passed: true, metrics: after });
    const final = parse(await call("unity_editor_state")).data;
    assert.equal(final.sceneDirty, false); assert.equal(final.activeScenePath, initial.activeScenePath);
    assert.equal(canonical(final.projectPath), canonical(project)); assert.deepEqual(client.stdoutViolations, []);
    report.passed = true;
  } finally {
    if (scheduled && port) {
      for (let attempt = 0; attempt < 40; attempt++) {
        try { if ((await info()).activeCount === 0) break; } catch {}
        await sleep(1000);
      }
    }
    await client.close();
    writeFileSync(join(project, "Library", "UnityMcpQueueAdmissionLive.json"), JSON.stringify(report, null, 2) + "\n");
  }
});
