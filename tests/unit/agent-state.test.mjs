import { test } from "node:test";
import assert from "node:assert/strict";

process.env.UNITY_MCP_AGENT_STATE_LIMIT = "1";
const { AgentStateStore, agentState } = await import("../../src/agent-state.js");
const { getAgentState, runWithRequestContext } = await import("../../src/request-context.js");
const { shareRequestWork } = await import("../../src/request-cancellation.js");

test("byte pressure evicts inactive identities and a refused update preserves every selection", () => {
  const store = new AgentStateStore({ limit: 3, byteLimit: 1100 });
  const first = store.acquire("first"); store.select(first, { projectPath: "a".repeat(600) }); store.release(first);
  const second = store.acquire("second"); store.select(second, { projectPath: "b".repeat(600) });
  assert.equal(store.snapshot().agents, 1);
  assert.equal(store.snapshot().evictions, 1);
  const previous = second.selectedInstance, before = store.identityBytes;
  assert.throws(() => store.select(second, { projectPath: "c".repeat(1200) }), /agent_state_capacity/);
  assert.equal(second.selectedInstance, previous);
  assert.equal(store.identityBytes, before);
  assert.equal(store.snapshot().agents, 1);
  store.release(second);
  const returning = store.acquire("first");
  assert.equal(returning.selectionRequired, true);
  store.release(returning);
});

test("request leases release on sync values, sync throws and rejected promises", async () => {
  assert.equal(runWithRequestContext({ agentId: "sync" }, () => { getAgentState(); return 42; }), 42);
  assert.equal(agentState.snapshot().activeLeases, 0);
  assert.throws(() => runWithRequestContext({ agentId: "throw" }, () => { getAgentState(); throw new Error("expected"); }), /expected/);
  assert.equal(agentState.snapshot().activeLeases, 0);
  await assert.rejects(runWithRequestContext({ agentId: "reject" }, async () => { getAgentState(); throw new Error("expected"); }), /expected/);
  assert.equal(agentState.snapshot().activeLeases, 0);
});

test("cancelled shared work stays pinned until its underlying operation settles", async () => {
  const controller = new AbortController(), cache = new Map();
  let complete;
  const observer = runWithRequestContext({ agentId: "abandoned", signal: controller.signal }, () => {
    getAgentState();
    return shareRequestWork(cache, "discovery", () => new Promise(resolve => { complete = resolve; }));
  });
  observer.catch(() => {});
  await Promise.resolve();
  controller.abort();
  await assert.rejects(observer, { name: "AbortError" });
  assert.equal(agentState.snapshot().activeAgents, 1);
  assert.throws(() => runWithRequestContext({ agentId: "replacement" }, () => getAgentState()), /agent_state_capacity/);
  complete();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(agentState.snapshot().activeLeases, 0);
  runWithRequestContext({ agentId: "replacement" }, () => assert.equal(getAgentState().selectionRequired, true));
});

test("a late context failure cannot remove the replacement marker after eviction", () => {
  const store = new AgentStateStore({ limit: 1, byteLimit: 1100 }), record = store.acquire("agent");
  const abandoned = store.beginContext(record, ["url", "first"]);
  for (let index = 0; index < 16; index++) store.beginContext(record, ["url", String(index)]);
  const replacement = store.beginContext(record, ["url", "first"]);
  assert.ok(replacement);
  store.forgetContext(record, abandoned);
  assert.equal(store.beginContext(record, ["url", "first"]), null);
  assert.equal(record.contextMarkers.size, 16);
  store.forgetContext(record, replacement);
  assert.ok(store.beginContext(record, ["url", "first"]));
  store.release(record);
});
