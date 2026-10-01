import { AsyncLocalStorage } from "node:async_hooks";
import { agentState } from "./agent-state.js";

// Stdio requests can overlap at every await; process globals cannot carry routing state.
const requests = new AsyncLocalStorage();
const defaults = { agentId: "default", portOverride: null, bridgeUrl: null, signal: undefined };
const scopes = new WeakMap();

export function getRequestContext() {
  return requests.getStore() || defaults;
}

export function runWithRequestContext(context, callback) {
  const current = { ...defaults, ...context };
  const scope = { record: null, closed: false };
  scopes.set(current, scope);
  const finish = () => {
    scope.closed = true;
    agentState.release(scope.record);
    scope.record = null;
  };
  return requests.run(current, () => {
    try {
      const result = callback();
      if (result && typeof result.then === "function") return Promise.resolve(result).finally(finish);
      finish();
      return result;
    } catch (error) { finish(); throw error; }
  });
}

export function getAgentState(create = true) {
  const context = getRequestContext(), scope = scopes.get(context);
  if (!scope) {
    const record = agentState.acquire(context.agentId, create);
    agentState.release(record);
    return record;
  }
  if (scope.closed) throw new Error("Agent request scope has already finished");
  if (scope.record?.agentId !== context.agentId) {
    agentState.release(scope.record);
    scope.record = null;
  }
  if (!scope.record) scope.record = agentState.acquire(context.agentId, create);
  return scope.record;
}

export function retainAgentState() {
  const record = getAgentState(false);
  if (!record) return () => {};
  record.activeLeases++;
  return () => agentState.release(record);
}

export function getCurrentAgentId() {
  return getRequestContext().agentId;
}
