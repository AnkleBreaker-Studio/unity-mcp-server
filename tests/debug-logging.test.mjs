import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MockBridge } from "./helpers/mock-bridge.mjs";
import { McpTestClient } from "./helpers/mcp-client.mjs";

const fixture = fileURLToPath(new URL("./fixtures/debug-log-worker.mjs", import.meta.url));
const limit = 5 * 1024 * 1024, entryLimit = 64 * 1024;

function worker(directory, mode, id) {
  const child = spawn(process.execPath, [fixture, directory, mode, String(id ?? 0)], { windowsHide: true });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => stdout += chunk); child.stderr.on("data", chunk => stderr += chunk);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error("Debug logger fixture timed out")); }, 15000);
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

async function isolated(action) {
  const directory = mkdtempSync(join(tmpdir(), "umcp-debug-test-"));
  try { await action(directory); }
  finally {
    const resolved = resolve(directory), parent = resolve(tmpdir());
    assert.equal(dirname(resolved), parent); assert.ok(resolved.startsWith(join(parent, "umcp-debug-test-")));
    rmSync(resolved, { recursive: true, force: true });
  }
}
const logs = directory => readdirSync(directory).filter(name => /^mcp-debug\.log(?:\.old)?$/.test(name));
const contents = (directory, name = "mcp-debug.log") => readFileSync(join(directory, name));
function successful(result, allowDiagnostics = false) {
  assert.equal(result.code, 0, result.stderr.slice(-1000)); assert.equal(result.stdout, "");
  if (!allowDiagnostics) assert.equal(result.stderr, "");
}

test("disabled debugging creates no files and does not format messages", () => isolated(async directory => {
  successful(await worker(join(directory, "unused"), "disabled")); assert.deepEqual(readdirSync(directory), []);
}));
test("small debug entries preserve timestamp, PID and text without stdout output", () => isolated(async directory => {
  successful(await worker(directory, "small"));
  const lines = contents(directory).toString("utf8").trimEnd().split("\n");
  assert.equal(lines.length, 2); assert.match(lines[0], /^\[\d{4}-\d\d-\d\dT[^\]]+\] \[PID:\d+\] first message$/);
  assert.match(lines[1], /second message$/);
}));
test("sustained logging rotates within one process", () => isolated(async directory => {
  successful(await worker(directory, "sustained")); assert.deepEqual(logs(directory).sort(), ["mcp-debug.log", "mcp-debug.log.old"]);
  for (const name of logs(directory)) assert.ok(statSync(join(directory, name)).size <= limit);
  assert.match(contents(directory).toString("utf8"), /entry 95:/);
}));
test("repeated rotations keep only one previous generation", () => isolated(async directory => {
  successful(await worker(directory, "multiple-rotations")); assert.equal(logs(directory).length, 2);
  for (const name of logs(directory)) assert.ok(statSync(join(directory, name)).size <= limit);
  assert.match(contents(directory).toString("utf8"), /entry 259:/);
}));
test("large Unicode entries are bounded and end on a valid UTF-8 boundary", () => isolated(async directory => {
  successful(await worker(directory, "unicode")); const bytes = contents(directory);
  assert.ok(bytes.length <= entryLimit, `Unbounded entry: ${bytes.length} bytes`);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  assert.match(text, /start: abc😀é/); assert.match(text, / \[truncated\]\n$/); assert.equal(text.includes("�"), false);
}));
test("an existing oversized log is preserved as the previous generation", () => isolated(async directory => {
  successful(await worker(directory, "historical"));
  assert.equal(contents(directory, "mcp-debug.log.old").length, limit + 100);
  assert.match(contents(directory).toString("utf8"), /after existing oversized log/);
}));
test("truncation remains valid across multibyte character boundaries", () => isolated(async directory => {
  successful(await worker(directory, "unicode-boundaries"));
  const lines = new TextDecoder("utf-8", { fatal: true }).decode(contents(directory)).trimEnd().split("\n");
  assert.equal(lines.length, 8);
  for (const line of lines) { assert.ok(Buffer.byteLength(line) + 1 <= entryLimit); assert.equal(line.includes("�"), false); assert.match(line, / \[truncated\]$/); }
}));
test("failed rotation does not append past the threshold and logging can recover", () => isolated(async directory => {
  const result = await worker(directory, "rotation-failure"); assert.equal(result.code, 0, result.stderr.slice(-1000));
  const evidence = JSON.parse(result.stdout); assert.equal(evidence.sizeAfterFailure, limit); assert.equal(evidence.recovered, true);
  assert.ok(Buffer.byteLength(result.stderr) <= 1024);
}));
test("file failures emit bounded, rate-limited stderr diagnostics", () => isolated(async directory => {
  const blocked = join(directory, "not-a-directory"); writeFileSync(blocked, "sentinel");
  const result = await worker(blocked, "unwritable"); successful(result, true);
  assert.ok(Buffer.byteLength(result.stderr) <= 1024, `Unbounded fallback: ${Buffer.byteLength(result.stderr)} bytes`);
  assert.equal(result.stderr.trimEnd().split("\n").length, 1); assert.equal(readFileSync(blocked, "utf8"), "sentinel");
}));
test("message conversion failures cannot escape debugLog", () => isolated(async directory => {
  const result = await worker(directory, "bad-message"); successful(result, true); assert.ok(Buffer.byteLength(result.stderr) <= 1024);
}));
test("concurrent processes retain rotating UTF-8 logs without protocol output", () => isolated(async directory => {
  const pending = Array.from({ length: 4 }, (_, id) => worker(directory, "concurrent", id));
  writeFileSync(join(directory, "start"), "go");
  const results = await Promise.allSettled(pending);
  for (const result of results) { if (result.status === "rejected") throw result.reason; successful(result.value, true); assert.ok(Buffer.byteLength(result.value.stderr) <= 1024); }
  assert.equal(logs(directory).length, 2);
  for (const name of logs(directory)) {
    const bytes = contents(directory, name); assert.ok(bytes.length <= limit + 4 * entryLimit);
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }
}));
test("logging failures preserve actual MCP responses and stdout framing", () => isolated(async directory => {
  const bridge = await new MockBridge().on("editor/state", () => ({ marker: "executed" })).start();
  let client;
  try {
    mkdirSync(join(directory, "mcp-debug.log"));
    client = new McpTestClient({ env: {
      UNITY_MCP_DEBUG: "1", UNITY_INSTANCE_REGISTRY: join(directory, "instances.json"),
      UNITY_BRIDGE_PORT: String(bridge.port), UNITY_PORT_RANGE_START: String(bridge.port), UNITY_PORT_RANGE_END: String(bridge.port),
      UNITY_QUEUE_POLL_INTERVAL: "10", UNITY_QUEUE_POLL_MAX: "50",
    } }).start();
    await client.initialize();
    for (let i = 0; i < 2; i++) {
      const response = await client.callTool("unity_editor_state", { port: bridge.port });
      assert.equal(response.isError, false); assert.equal(response.payload.data.marker, "executed");
    }
    assert.equal(bridge.seen.filter(item => item.route === "editor/state").length, 2);
    assert.deepEqual(client.stdoutViolations, []); assert.match(client.stderr, /File logging unavailable/);
  } finally { await client?.close(); await bridge.stop(); }
}));
