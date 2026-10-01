import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { McpTestClient } from "./helpers/mcp-client.mjs";

const project = process.env.UNITY_MCP_SERIALIZATION_PROJECT;
const canonical = path => realpathSync(path).replaceAll("\\", "/").toLowerCase();

test("live result serialization preserves valid values and never repeats oversized writes", {
  skip: !project && "set UNITY_MCP_SERIALIZATION_PROJECT to an open marked validation project",
  timeout: 180_000,
}, async () => {
  assert.ok(isAbsolute(project));
  assert.ok(existsSync(join(project, ".unity-mcp-validation")));
  const client = new McpTestClient({ timeoutMs: 60_000, serverEntry: process.env.UNITY_MCP_SERIALIZATION_SERVER_ENTRY }).start();
  const report = { nodeVersion: process.version, passed: false, checks: [] };
  const marker = "UnityMcpValidation.Serialization." + randomUUID();
  let port;
  const raw = (name, args = {}) => client.callTool(name, { port, ...args });
  const call = async (name, args = {}) => {
    const result = await raw(name, args);
    assert.equal(result.isError, false, result.payloadText);
    return result.payload.data;
  };
  const code = async source => (await call("unity_execute_code", { code: source })).result;
  const reset = () => code(`SessionState.SetInt("${marker}", 0); return true;`);
  const counted = source => `SessionState.SetInt("${marker}", SessionState.GetInt("${marker}", 0) + 1); ${source}`;
  const count = () => code(`return SessionState.GetInt("${marker}", 0);`);
  try {
    await client.initialize();
    const instances = await client.callTool("unity_list_instances", { refresh: true });
    const instance = instances.payload.instances.find(item => item.projectPath && canonical(item.projectPath) === canonical(project));
    assert.ok(instance);
    port = instance.port;
    assert.equal((await client.callTool("unity_select_instance", { port })).isError, false);
    const original = await call("unity_editor_state");
    assert.equal(original.isPlaying, false);
    assert.equal(original.isCompiling, false);
    assert.equal(original.sceneDirty, false);
    report.unityVersion = original.unityVersion;

    const values = await code('return new { finite = -7, notANumber = double.NaN, infinity = double.PositiveInfinity, vector = new Vector3(float.NaN, float.NegativeInfinity, 3), text = "Quote \\" \\u4e2d \\ud83d\\ude00 \\ud800" };');
    assert.deepEqual(values, { finite: -7, notANumber: "NaN", infinity: "Infinity", vector: { x: "NaN", y: "-Infinity", z: 3 }, text: 'Quote " 中 😀 \ud800' });
    report.checks.push({ name: "Finite numbers, non-finite representations, vectors and Unicode survive actual JSON transport", values });

    const list = await call("unity_execute_code", { code: "return new[] {1, 2, 3};" });
    assert.deepEqual(list.result, [1, 2, 3]);
    assert.equal(list.count, 3);
    const truncated = await call("unity_execute_code", { code: "return new int[1001];" });
    assert.equal(truncated.count, 1001);
    assert.match(truncated.result.at(-1), /truncated at 1000/);
    report.checks.push({ name: "Legacy list count and truncation shape remain intact", listCount: list.count, truncatedCount: truncated.count });

    for (const [name, source, expectedCode] of [
      ["Global result expansion", "var row = new int[1000]; return Enumerable.Repeat(row, 1000).ToArray();", "execution_result_limit"],
      ["Deferred iterator exception", 'return Enumerable.Range(0, 3).Select(i => i == 1 ? throw new InvalidOperationException("Controlled result iterator failure") : i);', "execution_result_serialization_failed"],
    ]) {
      await reset();
      const result = await raw("unity_execute_code", { code: counted(source) });
      assert.equal(result.isError, true, result.payloadText);
      assert.equal(result.payload.data.code, expectedCode, result.payloadText);
      assert.equal(result.payload.data.executionCompleted, true);
      assert.equal(typeof result.payload.data.stackTrace, "string");
      assert.ok(result.payload.data.stackTrace.length > 0);
      assert.equal(await count(), 1);
      report.checks.push({ name, code: expectedCode, executionCompleted: true, executions: 1 });
    }

    await reset();
    const oversized = await raw("unity_execute_code", { code: counted("return new string('x', 17 * 1024 * 1024);") });
    assert.equal(oversized.isError, true, oversized.payloadText.slice(0, 2000));
    assert.match(oversized.payloadText, /413.*response_too_large/);
    assert.ok(oversized.payloadText.length < 4000);
    assert.equal(await count(), 1);
    report.checks.push({ name: "Plugin HTTP serialization limit returns an error without replay", executions: 1, response: oversized.payload });

    assert.equal(await code("return 42;"), 42);
    const after = await call("unity_editor_state");
    assert.equal(after.sceneDirty, false);
    assert.equal(after.isPlaying, false);
    const compilation = await call("unity_get_compilation_errors", { severity: "error" });
    assert.equal(compilation.count, 0);
    assert.equal(compilation.isCompiling, false);
    assert.deepEqual(client.stdoutViolations, []);
    report.passed = true;
  } finally {
    try {
      if (port) { await code(`SessionState.EraseInt("${marker}"); return true;`); report.fixtureRemoved = true; }
    } finally {
      await client.close();
      writeFileSync(join(project, "Library/UnityMcpSerialization.json"), JSON.stringify(report, null, 2) + "\n");
    }
  }
});
