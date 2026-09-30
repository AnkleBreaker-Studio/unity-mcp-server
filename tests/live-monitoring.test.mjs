import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { McpTestClient } from "./helpers/mcp-client.mjs";

const projectPath = process.env.UNITY_MCP_MONITOR_PROJECT;
const canonicalPath = path => realpathSync(path).replaceAll("\\", "/").toLowerCase();

test("a live handler error reaches MCP, session counters and action history", {
  skip: !projectPath && "set UNITY_MCP_MONITOR_PROJECT to an open disposable project path",
  timeout: 60_000,
}, async () => {
  assert.ok(isAbsolute(projectPath), "the validation project path must be absolute");
  assert.ok(existsSync(join(projectPath, ".unity-mcp-validation")), "refusing an unmarked project");
  const agentId = `monitor-live-${randomUUID()}`;
  const client = new McpTestClient().start();
  let port;

  async function call(name, args = {}, expectedError = false) {
    const response = await client.request("tools/call", { name, arguments: { port, ...args }, _meta: { agentId } });
    const payload = JSON.parse(response.content.filter(block => block.type === "text").at(-1).text);
    assert.equal(response.isError === true, expectedError, JSON.stringify(payload));
    return payload.data ?? payload;
  }

  try {
    await client.initialize();
    const selected = await call("unity_select_instance", { projectName: basename(projectPath) });
    assert.equal(canonicalPath(selected.instance.projectPath), canonicalPath(projectPath));
    port = selected.instance.port;
    const compilation = await call("unity_get_compilation_errors", { severity: "error" });
    assert.equal(compilation.isCompiling, false);
    assert.equal(compilation.count, 0);
    const failure = await call("unity_gameobject_info", { path: `__missing_${randomUUID()}` }, true);
    assert.equal(failure.error, "GameObject not found");
    const agents = await call("unity_agents_list");
    const session = agents.find(agent => agent.agentId === agentId);
    assert.equal(session.commandErrors, 1);
    assert.equal(session.failedRequests, 0);
    assert.equal(session.timedOutRequests, 0);
    const history = await call("unity_undo_history", { agentId, count: 20 });
    const records = history.actions.filter(record => record.action === "gameobject/info");
    assert.equal(records.length, 1);
    assert.equal(records[0].status, "Completed");
    assert.equal(records[0].commandFailed, true);
    assert.equal(records[0].errorMessage, failure.error);
    assert.equal(records[0].undoable, false);
    assert.deepEqual(client.stdoutViolations, []);
    writeFileSync(join(projectPath, "Library/UnityMcpLiveMonitoring.json"), JSON.stringify({
      nodeVersion: process.version, unityVersion: selected.instance.unityVersion,
      passed: true, mcpIsError: true, originalError: failure.error,
      commandErrors: session.commandErrors, exceptions: session.failedRequests,
      historyRecords: records.length, history: records[0],
    }, null, 2) + "\n");
  } finally {
    await client.close();
  }
});
