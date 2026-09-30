import { AsyncLocalStorage } from "node:async_hooks";

// Stdio requests can overlap at every await; process globals cannot carry routing state.
const requests = new AsyncLocalStorage();
const defaults = { agentId: "default", portOverride: null, bridgeUrl: null, signal: undefined };

export function getRequestContext() {
  return requests.getStore() || defaults;
}

export function runWithRequestContext(context, callback) {
  return requests.run({ ...defaults, ...context }, callback);
}

export function getCurrentAgentId() {
  return getRequestContext().agentId;
}
