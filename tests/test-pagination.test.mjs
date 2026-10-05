import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { MockBridge } from "./helpers/mock-bridge.mjs";
import { McpTestClient } from "./helpers/mcp-client.mjs";

async function exercise(check) {
  const bridge = new MockBridge(); await bridge.start();
  const env = bridge.env(), client = new McpTestClient({ env }).start();
  const call = params => client.callTool("unity_advanced_tool", { tool: "unity_testing_get_job", params, port: bridge.port });
  try { await client.initialize(); await check(bridge, client, call); assert.deepEqual(client.stdoutViolations, []); }
  finally {
    await client.close(); await bridge.stop();
    const directory = resolve(dirname(env.UNITY_INSTANCE_REGISTRY));
    assert.equal(dirname(directory), resolve(tmpdir())); assert.ok(directory.startsWith(join(resolve(tmpdir()), "umcp-test-")));
    rmSync(directory, { recursive: true, force: true });
  }
}

test("test-job discovery exposes optional bounded pagination", () => exercise(async (_bridge, client) => {
  const { payload } = await client.callTool("unity_list_advanced_tools", { tool: "unity_testing_get_job" });
  assert.equal(payload.inputSchema.properties.resultOffset.type, "integer");
  assert.equal(payload.inputSchema.properties.resultOffset.minimum, 0); assert.equal(payload.inputSchema.properties.resultOffset.maximum, 2147483647);
  assert.equal(payload.inputSchema.properties.resultLimit.type, "integer");
  assert.equal(payload.inputSchema.properties.resultLimit.minimum, 1); assert.equal(payload.inputSchema.properties.resultLimit.maximum, 10000);
}));

for (const waitTimeout of [undefined, 30]) test(`test-job pages retain parameters and metadata${waitTimeout ? " after server polling" : ""}`, () => exercise(async (bridge, _client, call) => {
  const page = { offset: 5, limit: 2, total: 9, returned: 2, hasMore: true, nextOffset: 7, stable: true };
  bridge.on("testing/get-job", () => ({ jobId: "job", status: "succeeded", resultsComplete: true, tests: [{ name: "six" }, { name: "seven" }], resultPage: page }));
  const result = await call({ jobId: "job", includeFailedOnly: true, resultOffset: 5, resultLimit: 2, ...(waitTimeout && { waitTimeout }) });
  assert.notEqual(result.isError, true, result.payloadText); assert.deepEqual(result.payload.data.resultPage, page);
  const seen = bridge.seen.filter(x => x.route === "testing/get-job"); assert.equal(seen.length, 1);
  assert.equal(seen[0].params.resultOffset, 5); assert.equal(seen[0].params.resultLimit, 2); assert.equal(seen[0].params.includeFailedOnly, true);
}));

test("old plugins cannot silently return an unpaged list for a page request", () => exercise(async (bridge, _client, call) => {
  bridge.on("testing/get-job", () => ({ jobId: "old-job", status: "succeeded", tests: [{ name: "wrong page" }] }));
  const result = await call({ jobId: "old-job", resultOffset: 0 });
  assert.equal(result.isError, true); assert.equal(result.payload.code, "test_result_pagination_unsupported");
  assert.equal(result.payload.jobId, "old-job"); assert.equal(result.payload.tests, undefined);
  assert.equal(bridge.seen.filter(x => x.route === "testing/get-job").length, 1);
}));

test("unpaged test-job calls retain old-plugin compatibility", () => exercise(async (bridge, _client, call) => {
  bridge.on("testing/get-job", () => ({ jobId: "old-job", status: "succeeded", tests: [{ name: "full result" }] }));
  const result = await call({ jobId: "old-job", includeDetails: true });
  assert.notEqual(result.isError, true); assert.equal(result.payload.data.tests[0].name, "full result");
  assert.equal(result.payload.data.resultPage, undefined);
}));

test("native pagination validation errors retain their diagnostic", () => exercise(async (bridge, _client, call) => {
  bridge.on("testing/get-job", () => ({ error: "resultLimit must be an integer from 1 to 10000" }));
  const result = await call({ resultLimit: -1 }); assert.equal(result.isError, true);
  assert.match(result.payloadText, /resultLimit must be an integer/); assert.doesNotMatch(result.payloadText, /pagination_unsupported/);
}));

for (const kind of ["unsupported", "invalid"]) test(`server polling stops on the first ${kind} page response`, () => exercise(async (bridge, _client, call) => {
  let calls = 0;
  bridge.on("testing/get-job", () => {
    if (++calls === 1) return kind === "unsupported" ? { jobId: "old-job", status: "running" } : { error: "Invalid resultLimit" };
    return { jobId: "later-job", status: "succeeded", resultPage: { offset: 0 }, tests: [] };
  });
  const result = await call({ resultLimit: 1, waitTimeout: 30 });
  assert.equal(result.isError, true); assert.equal(calls, 1);
  assert.match(result.payloadText, kind === "unsupported" ? /pagination_unsupported/ : /Invalid resultLimit/);
}));

test("server polling reads only status until the pinned job finishes, then returns the requested detail", () => exercise(async (bridge, _client, call) => {
  const reads = [{ jobId: "job-7", status: "running", tests: [{ name: "partial" }] }, { jobId: "job-7", status: "succeeded" },
    { jobId: "job-7", status: "succeeded", tests: [{ name: "one" }, { name: "two" }] }];
  bridge.on("testing/get-job", () => reads.shift());
  const result = await call({ includeDetails: true, waitTimeout: 30 });
  assert.notEqual(result.isError, true, result.payloadText); assert.equal(result.payload.data.tests?.length, 2);
  assert.deepEqual(bridge.seen.filter(x => x.route === "testing/get-job").map(x => x.params), [
    { includeDetails: true, waitTimeout: 30 }, { jobId: "job-7", includeDetails: false, includeFailedOnly: false },
    { includeDetails: true, waitTimeout: 30, jobId: "job-7" }]);
}));

test("server polling keeps waiting through a transient status-read failure", () => exercise(async (bridge, _client, call) => {
  const reads = [{ jobId: "job", status: "running" }, { __timeout: true, error: "Editor is reloading scripts" },
    { jobId: "job", status: "succeeded" }, { jobId: "job", status: "succeeded", tests: [{ name: "done" }] }];
  bridge.on("testing/get-job", () => reads.shift());
  const result = await call({ jobId: "job", waitTimeout: 30 });
  assert.notEqual(result.isError, true, result.payloadText); assert.equal(result.payload.data.tests?.[0]?.name, "done");
  assert.equal(bridge.seen.filter(x => x.route === "testing/get-job").length, 4);
}));

test("server polling returns a full read with the caller's params at the deadline", () => exercise(async (bridge, _client, call) => {
  const reads = [{ jobId: "job", status: "running" }, { jobId: "job", status: "running", tests: [{ name: "partial" }] }];
  bridge.on("testing/get-job", () => reads.shift());
  const result = await call({ jobId: "job", includeDetails: true, waitTimeout: 1 });
  assert.notEqual(result.isError, true, result.payloadText); assert.equal(result.payload.data.tests?.[0]?.name, "partial");
  assert.deepEqual(bridge.seen.filter(x => x.route === "testing/get-job").map(x => x.params), [
    { jobId: "job", includeDetails: true, waitTimeout: 1 }, { jobId: "job", includeDetails: true, waitTimeout: 1 }]);
}));

test("run-tests forwards the filter alias as de-duplicated groupNames", () => exercise(async (bridge, client) => {
  bridge.on("testing/run-tests", () => ({ jobId: "job", status: "succeeded" }));
  const run = params => client.callTool("unity_advanced_tool", { tool: "unity_testing_run_tests", params, port: bridge.port });
  const started = await run({ mode: "PlayMode", filter: "A, B", groupNames: ["C", "B"] });
  assert.notEqual(started.isError, true, started.payloadText);
  assert.notEqual((await run({ mode: "EditMode", filter: " , " })).isError, true);
  const invalid = await run({ filter: ["A"] });
  assert.equal(invalid.isError, true); assert.match(invalid.payloadText, /filter must be a string/);
  assert.deepEqual(bridge.seen.filter(x => x.route === "testing/run-tests").map(x => x.params), [
    { mode: "PlayMode", groupNames: ["C", "B", "A"] }, { mode: "EditMode" }]);
}));
