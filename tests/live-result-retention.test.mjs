import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { McpTestClient } from "./helpers/mcp-client.mjs";

const project = process.env.UNITY_MCP_RESULT_RETENTION_PROJECT;
const canonical = path => realpathSync(path).replaceAll("\\", "/").toLowerCase();
const parse = result => { assert.notEqual(result.isError, true, result.payloadText); return result.payload; };

test("live result pressure preserves protected identity and subsequent MCP reads", {
  skip: !project && "set UNITY_MCP_RESULT_RETENTION_PROJECT to a marked open validation project", timeout: 60_000,
}, async () => {
  assert.ok(isAbsolute(project) && existsSync(join(project, ".unity-mcp-validation")));
  const client = new McpTestClient({ serverEntry: process.env.UNITY_MCP_TEST_SERVER_ENTRY, timeoutMs: 45_000 }).start();
  const report = { nodeVersion: process.version, serverEntry: process.env.UNITY_MCP_TEST_SERVER_ENTRY || "current", passed: false, checks: [] };
  let port;
  const call = (name, args = {}) => client.callTool(name, { ...args, port });
  try {
    await client.initialize();
    const discovered = parse(await client.callTool("unity_list_instances", { refresh: true }));
    const instance = discovered.instances.find(item => item.projectPath && canonical(item.projectPath) === canonical(project));
    assert.ok(instance, "Marked validation editor was not discovered"); port = instance.port;
    parse(await call("unity_select_instance"));
    const initial = parse(await call("unity_editor_state")).data;
    assert.equal(canonical(initial.projectPath), canonical(project)); assert.equal(initial.sceneDirty, false);
    assert.equal(initial.isPlaying, false); assert.equal(initial.isCompiling, false);
    assert.equal(parse(await call("unity_get_compilation_errors", { severity: "error" })).data.count, 0);
    report.project = { projectPath: project, port, unityVersion: instance.unityVersion, pluginVersion: instance.pluginVersion };
    const agent = `result-retention-${randomUUID()}`;
    const result = parse(await call("unity_execute_code", { code: `
if (!UnityEngine.Application.dataPath.Replace(System.IO.Path.DirectorySeparatorChar, '/').Equals(${JSON.stringify(join(project, "Assets").replaceAll("\\", "/"))}, System.StringComparison.OrdinalIgnoreCase)) throw new System.Exception("Unexpected validation project");
if (!System.IO.File.Exists(${JSON.stringify(join(project, ".unity-mcp-validation").replaceAll("\\", "/"))})) throw new System.Exception("Validation marker missing");
if (UnityEngine.SceneManagement.SceneManager.GetActiveScene().isDirty || UnityEditor.EditorApplication.isPlayingOrWillChangePlaymode) throw new System.Exception("Validation editor is not clean");
var type = typeof(UnityMCP.Editor.MCPRequestQueue);
var flags = System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic;
var finish = type.GetMethod("TryCompleteTicket", flags);
var timestamp = typeof(UnityMCP.Editor.MCPRequestQueue.RequestTicket).GetField("CompletedTimestamp", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
var owned = new System.Collections.Generic.List<UnityMCP.Editor.MCPRequestQueue.RequestTicket>();
int executions = 0; string agent = ${JSON.stringify(agent)}, id = System.Guid.NewGuid().ToString("N");
long expires = UnityMCP.Editor.MCPRequestQueue.SessionTimeMs + 119000;
try {
  var accepted = UnityMCP.Editor.MCPRequestQueue.SubmitOnce(agent, "editor/state", "{}", id, UnityMCP.Editor.MCPRequestQueue.SessionId, expires,
    () => UnityMCP.Editor.MCPRequestQueue.SubmitRequest(agent, "editor/state", () => { executions++; return "one execution"; }));
  owned.Add(accepted.Ticket);
  UnityMCP.Editor.MCPRequestQueue.ProcessNextRequests();
  if (executions != 1 || (string)accepted.Ticket.Result != "one execution") throw new System.Exception("Original command did not execute once");
  for (int i = 0; i < 4096; i++) {
    var ticket = UnityMCP.Editor.MCPRequestQueue.SubmitRequest(agent, "editor/state", () => null); owned.Add(ticket);
    finish.Invoke(null, new object[] { ticket, UnityMCP.Editor.MCPRequestQueue.RequestStatus.Completed, true, null, -1, null });
  }
  var replay = UnityMCP.Editor.MCPRequestQueue.SubmitOnce(agent, "editor/state", "{}", id, UnityMCP.Editor.MCPRequestQueue.SessionId, expires,
    () => { executions++; throw new System.Exception("Evicted command was submitted again"); });
  var pressure = (System.Collections.Generic.Dictionary<string, object>)UnityMCP.Editor.MCPRequestQueue.GetQueueInfo()["completedResults"];
  return new { executions, replayStatus = replay.StatusCode, replayCode = replay.Code, pollingMissing = UnityMCP.Editor.MCPRequestQueue.GetTicketStatus(accepted.Ticket.TicketId) == null, metrics = pressure };
} finally {
  foreach (var ticket in owned) timestamp.SetValue(ticket, System.Diagnostics.Stopwatch.GetTimestamp() - 121L * System.Diagnostics.Stopwatch.Frequency);
  type.GetMethod("RunCleanup", flags).Invoke(null, null);
  type.GetMethod("FlushCompletedHistory", flags).Invoke(null, new object[] { 10000 });
  var history = (System.Collections.Generic.List<UnityMCP.Editor.MCPActionRecord>)typeof(UnityMCP.Editor.MCPActionHistory).GetField("_history", flags).GetValue(null);
  history.RemoveAll(record => record.AgentId == agent);
  owned.Clear();
}` })).data;
    assert.equal(result.success, true); const evidence = result.result;
    assert.equal(evidence.executions, 1); assert.equal(evidence.replayStatus, 410); assert.equal(evidence.replayCode, "result_expired");
    assert.equal(evidence.pollingMissing, true); assert.equal(evidence.metrics.count, 4096);
    assert.ok(evidence.metrics.costBytes <= evidence.metrics.maxCostBytes);
    report.checks.push({ name: "Native pressure inside a real MCP command expires the old result without replay", passed: true, evidence });
    const after = parse(await call("unity_queue_info")).data;
    assert.equal(after.totalQueued, 0); assert.equal(after.executingCount, 0); assert.equal(after.pendingHistoryRecords, 0);
    assert.ok(after.completedResults.count < 20); assert.equal(after.httpCommands.activeCount, 0);
    report.checks.push({ name: "Owned pressure tickets are cleaned and a subsequent MCP read succeeds", passed: true, metrics: after.completedResults });
    const final = parse(await call("unity_editor_state")).data;
    assert.equal(final.sceneDirty, false); assert.equal(final.activeScenePath, initial.activeScenePath);
    assert.equal(canonical(final.projectPath), canonical(project)); assert.deepEqual(client.stdoutViolations, []);
    report.passed = true;
  } finally {
    await client.close();
    writeFileSync(join(project, "Library", "UnityMcpResultRetentionLive.json"), JSON.stringify(report, null, 2) + "\n");
  }
});
