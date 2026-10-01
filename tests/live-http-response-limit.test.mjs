import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { McpTestClient } from "./helpers/mcp-client.mjs";

const project = process.env.UNITY_MCP_HTTP_PROJECT;
const canonical = path => realpathSync(path).replaceAll("\\", "/").toLowerCase();

test("live HTTP download limits stop oversized results without repeating Unity code", {
  skip: !project && "set UNITY_MCP_HTTP_PROJECT to an open marked validation project",
  timeout: 120_000,
}, async () => {
  assert.ok(isAbsolute(project));
  assert.ok(existsSync(join(project, ".unity-mcp-validation")));
  const normal = new McpTestClient({ timeoutMs: 30_000 }).start();
  const limited = new McpTestClient({ timeoutMs: 30_000, env: { UNITY_HTTP_RESPONSE_LIMIT: "16384" } }).start();
  const report = { nodeVersion: process.version, project, passed: false, limitBytes: 16384 };
  const marker = "UnityMcpValidation.HttpLimit." + randomUUID();
  let port;
  const call = async (client, name, args = {}) => {
    const result = await client.callTool(name, { port, ...args });
    assert.equal(result.isError, false, result.payloadText);
    return result.payload.data;
  };
  const code = async (client, source) => (await call(client, "unity_execute_code", { code: source })).result;
  try {
    await normal.initialize();
    await limited.initialize();
    const instances = await normal.callTool("unity_list_instances", { refresh: true });
    const instance = instances.payload.instances.find(item => item.projectPath && canonical(item.projectPath) === canonical(project));
    assert.ok(instance);
    port = instance.port;
    for (const client of [normal, limited]) {
      const selected = await client.callTool("unity_select_instance", { port });
      assert.equal(selected.isError, false, selected.payloadText);
      assert.equal(canonical(selected.payload.instance.projectPath), canonical(project));
    }
    const original = await call(normal, "unity_editor_state");
    assert.equal(original.isPlaying, false);
    assert.equal(original.isCompiling, false);
    assert.equal(original.sceneDirty, false);
    report.unityVersion = instance.unityVersion;
    report.pluginVersion = instance.pluginVersion;
    report.port = port;

    assert.equal(await code(limited, "return new string('\\u754c', 1000);"), "\u754c".repeat(1000));
    report.smallUnicodePreserved = true;
    await code(normal, `SessionState.SetInt("${marker}", 0); return true;`);
    const oversized = await limited.callTool("unity_execute_code", { port, code: `SessionState.SetInt("${marker}", SessionState.GetInt("${marker}", 0) + 1); return new string('x', 65536);` });
    assert.equal(oversized.isError, true);
    assert.equal(oversized.payload.outcomeUnknown, true);
    assert.match(oversized.payload.error, /http_response_too_large/);
    assert.ok(oversized.payload.ticketId);
    assert.ok(oversized.payloadText.length < 2000);
    assert.equal(await code(normal, `return SessionState.GetInt("${marker}", 0);`), 1);
    report.oversized = { response: oversized.payload, executions: 1 };
    assert.equal(await code(limited, "return 42;"), 42);
    report.followUpSucceeded = true;

    const after = await call(normal, "unity_editor_state");
    assert.equal(after.sceneDirty, false);
    assert.equal(after.isPlaying, false);
    assert.equal(after.isCompiling, false);
    const compilation = await call(normal, "unity_get_compilation_errors", { severity: "error" });
    assert.equal(compilation.count, 0);
    assert.equal(compilation.isCompiling, false);
    assert.deepEqual(normal.stdoutViolations, []);
    assert.deepEqual(limited.stdoutViolations, []);
    report.passed = true;
  } finally {
    try {
      if (port) { await code(normal, `SessionState.EraseInt("${marker}"); return true;`); report.fixtureRemoved = true; }
    } finally {
      await limited.close();
      await normal.close();
      writeFileSync(join(project, "Library/UnityMcpHttpResponseLimit.json"), JSON.stringify(report, null, 2) + "\n");
    }
  }
});
