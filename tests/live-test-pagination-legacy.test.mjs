import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { McpTestClient } from "./helpers/mcp-client.mjs";

const project = process.env.UNITY_MCP_TEST_PAGINATION_LEGACY_PROJECT;
const canonical = path => realpathSync(path).replaceAll("\\", "/").toLowerCase();

test("a real older plugin retains full results and explicitly refuses new pagination", {
  skip: !project && "set UNITY_MCP_TEST_PAGINATION_LEGACY_PROJECT to a marked editor using the released plugin", timeout: 60_000,
}, async () => {
  assert.ok(isAbsolute(project) && existsSync(join(project, ".unity-mcp-validation")));
  const client = new McpTestClient().start(), id = `pagination-legacy-${randomUUID()}`;
  const report = { nodeVersion: process.version, passed: false }; let port, created = false;
  const raw = params => client.callTool("unity_advanced_tool", { tool: "unity_testing_get_job", params, port });
  const guard = `if (!UnityEngine.Application.dataPath.Replace('\\\\', '/').Equals(${JSON.stringify(join(project, "Assets").replaceAll("\\", "/"))}, System.StringComparison.OrdinalIgnoreCase) || !System.IO.File.Exists(".unity-mcp-validation")) throw new System.Exception("Unexpected validation project");\n`;
  async function code(source) {
    const result = await client.callTool("unity_execute_code", { port, code: guard + source });
    assert.notEqual(result.isError, true, result.payloadText); assert.equal(result.payload.data.success, true, result.payloadText); return result.payload.data.result;
  }
  try {
    await client.initialize();
    const discovered = await client.callTool("unity_list_instances", { refresh: true });
    const instance = discovered.payload.instances.find(x => x.projectPath && canonical(x.projectPath) === canonical(project));
    assert.ok(instance); port = instance.port; await client.callTool("unity_select_instance", { port }); report.project = instance;
    const state = (await client.callTool("unity_editor_state", { port })).payload.data;
    assert.equal(state.sceneDirty, false); assert.equal(state.isPlaying, false); assert.equal(state.isCompiling, false);
    await code(`var flags = System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic;
var commands = typeof(UnityMCP.Editor.MCPTestRunnerCommands); var type = commands.GetNestedType("TestJob", System.Reflection.BindingFlags.NonPublic);
var job = System.Activator.CreateInstance(type); type.GetField("JobId").SetValue(job, ${JSON.stringify(id)});
type.GetField("Status").SetValue(job, System.Enum.Parse(type.GetField("Status").FieldType, "Succeeded"));
type.GetField("StartedAt").SetValue(job, System.DateTime.UtcNow); type.GetField("CompletedAt").SetValue(job, (System.DateTime?)System.DateTime.UtcNow);
type.GetField("TotalTests").SetValue(job, 1); type.GetField("CompletedTests").SetValue(job, 1);
var resultType = commands.GetNestedType("TestResult", System.Reflection.BindingFlags.NonPublic); var entry = System.Activator.CreateInstance(resultType);
resultType.GetField("Name").SetValue(entry, "LegacyResult"); resultType.GetField("FullName").SetValue(entry, "Pagination.LegacyResult"); resultType.GetField("Status").SetValue(entry, "Passed");
((System.Collections.IList)type.GetField("AllResults").GetValue(job)).Add(entry);
((System.Collections.IDictionary)commands.GetField("_jobs", flags).GetValue(null)).Add(${JSON.stringify(id)}, job); return true;`); created = true;
    const full = await raw({ jobId: id, includeDetails: true }); assert.notEqual(full.isError, true, full.payloadText);
    assert.equal(full.payload.data.tests.length, 1); assert.equal(full.payload.data.tests[0].fullName, "Pagination.LegacyResult");
    const paged = await raw({ jobId: id, resultOffset: 0, resultLimit: 1, waitTimeout: 30 });
    assert.equal(paged.isError, true); assert.equal(paged.payload.code, "test_result_pagination_unsupported"); assert.equal(paged.payload.jobId, id);
    const again = await raw({ jobId: id, includeDetails: true }); assert.deepEqual(again.payload.data.tests, full.payload.data.tests);
    report.legacyDetailsPreserved = true; report.unsupportedCode = paged.payload.code; report.passed = true;
  } catch (error) { report.error = error.stack; throw error; }
  finally {
    try {
      if (created) await code(`((System.Collections.IDictionary)typeof(UnityMCP.Editor.MCPTestRunnerCommands).GetField("_jobs", System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic).GetValue(null)).Remove(${JSON.stringify(id)}); return true;`);
      assert.deepEqual(client.stdoutViolations, []);
    } finally { await client.close(); writeFileSync(join(project, "Library/UnityMcpTestPaginationLegacy.json"), JSON.stringify(report, null, 2) + "\n"); }
  }
});
