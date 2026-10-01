import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { McpTestClient } from "./helpers/mcp-client.mjs";

const project = process.env.UNITY_MCP_CANCEL_PROJECT;
const canonical = path => realpathSync(path).replaceAll("\\", "/").toLowerCase();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const payload = response => JSON.parse(response.content.filter(block => block.type === "text").at(-1).text);

test("live cancellation stops ticket observation while accepted Unity work executes once", {
  skip: !project && "set UNITY_MCP_CANCEL_PROJECT to an open marked validation project",
  timeout: 90_000,
}, async () => {
  assert.ok(isAbsolute(project));
  assert.ok(existsSync(join(project, ".unity-mcp-validation")));
  const observer = new McpTestClient({ timeoutMs: 30_000 }).start();
  const cancelled = new McpTestClient({
    timeoutMs: 30_000,
    serverEntry: fileURLToPath(new URL("./helpers/cancellation-trace-server.mjs", import.meta.url)),
  }).start();
  const key = `UnityMcpCancellation-${randomUUID()}`;
  const report = { nodeVersion: process.version, project, passed: false };
  const traces = () => [...cancelled.stderr.matchAll(/\[CancellationValidation\] (.+)/g)].map(match => JSON.parse(match[1]));
  let port;
  let submitted = false;
  let requestSettled = false;
  const raw = (client, name, args = {}) => client.request("tools/call", { name, arguments: { port, ...args } });
  try {
    await observer.initialize();
    await cancelled.initialize();
    const listed = await observer.callTool("unity_list_instances", { refresh: true });
    assert.equal(listed.isError, false);
    const instance = listed.payload.instances.find(item => canonical(item.projectPath) === canonical(project));
    assert.ok(instance);
    port = instance.port;
    report.port = port;
    report.unityVersion = instance.unityVersion;
    for (const client of [observer, cancelled]) {
      const selected = await client.callTool("unity_select_instance", { port });
      assert.equal(selected.isError, false, selected.payloadText);
      assert.equal(canonical(selected.payload.instance.projectPath), canonical(project));
    }
    const before = await raw(observer, "unity_editor_state");
    assert.notEqual(before.isError, true);
    assert.equal(payload(before).data.isPlaying, false);
    assert.equal(payload(before).data.isCompiling, false);

    const pending = raw(cancelled, "unity_execute_code", {
      code: `System.Threading.Thread.Sleep(800); int count = SessionState.GetInt("${key}", 0) + 1; SessionState.SetInt("${key}", count); return count;`,
    });
    pending.then(() => { requestSettled = true; }, () => { requestSettled = true; });
    submitted = true;
    const requestId = cancelled._id;
    const deadline = performance.now() + 15_000;
    while (traces().length === 0 && !requestSettled && performance.now() < deadline) await sleep(10);
    assert.ok(traces().length > 0, "A ticket must be accepted before cancelling observation");
    assert.equal(requestSettled, false);
    const ticketId = traces()[0].ticketId;
    cancelled.notify("notifications/cancelled", { requestId, reason: "Live validation: stop observation" });
    await cancelled.listTools();
    await sleep(150);
    const pollsAtCancellation = traces().filter(item => item.ticketId === ticketId).length;

    const readback = await raw(observer, "unity_execute_code", { code: `return SessionState.GetInt("${key}", 0);` });
    assert.notEqual(readback.isError, true, JSON.stringify(readback));
    assert.equal(payload(readback).data.result, 1, "Accepted Unity work did not execute exactly once");
    await sleep(200);
    const pollsAfterCompletion = traces().filter(item => item.ticketId === ticketId).length;
    assert.equal(pollsAfterCompletion, pollsAtCancellation, "Cancelled ticket polling continued");
    assert.equal(requestSettled, false, "Cancelled request returned a response");
    const after = await raw(observer, "unity_editor_state");
    assert.notEqual(after.isError, true);
    assert.equal(payload(after).data.isPlaying, false);
    assert.equal(payload(after).data.isCompiling, false);
    assert.deepEqual(observer.stdoutViolations, []);
    assert.deepEqual(cancelled.stdoutViolations, []);
    Object.assign(report, { ticketId, pollsAtCancellation, pollsAfterCompletion, executions: 1, responseSuppressed: true, passed: true });
  } finally {
    try {
      if (submitted) {
        const cleanup = await raw(observer, "unity_execute_code", { code: `SessionState.EraseInt("${key}"); return SessionState.GetInt("${key}", -1);` });
        assert.notEqual(cleanup.isError, true);
        assert.equal(payload(cleanup).data.result, -1);
        report.fixtureRestored = true;
      }
    } catch (error) {
      report.passed = false;
      throw error;
    } finally {
      await cancelled.close();
      await observer.close();
      writeFileSync(join(project, "Library", "UnityMcpCancellation.json"), JSON.stringify(report, null, 2) + "\n");
    }
  }
});
