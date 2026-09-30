import { getRequestContext, runWithRequestContext } from "./request-context.js";

const abortObservers = new WeakMap();
const cancelled = () => new DOMException("MCP request cancelled", "AbortError");

export function throwIfRequestCancelled() {
  if (getRequestContext().signal?.aborted) throw cancelled();
}

function onAbort(signal, callback) {
  if (!signal) return () => {};
  if (signal.aborted) { callback(); return () => {}; }
  let entry = abortObservers.get(signal);
  if (!entry) {
    const callbacks = new Set();
    const dispatch = () => {
      abortObservers.delete(signal);
      for (const observer of callbacks) observer();
      callbacks.clear();
    };
    entry = { callbacks, dispatch };
    abortObservers.set(signal, entry);
    // One listener per signal also covers wide port scans and parallel batch operations.
    signal.addEventListener("abort", dispatch, { once: true });
  }
  entry.callbacks.add(callback);
  return () => {
    entry.callbacks.delete(callback);
    if (entry.callbacks.size === 0) {
      signal.removeEventListener("abort", entry.dispatch);
      if (abortObservers.get(signal) === entry) abortObservers.delete(signal);
    }
  };
}

export function requestSleep(ms) {
  throwIfRequestCancelled();
  const signal = getRequestContext().signal;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unsubscribe(); resolve(); }, ms);
    const unsubscribe = onAbort(signal, () => { clearTimeout(timer); reject(cancelled()); });
  });
}

export function waitForRequest(promise) {
  const signal = getRequestContext().signal;
  return new Promise((resolve, reject) => {
    const unsubscribe = onAbort(signal, () => reject(cancelled()));
    Promise.resolve(promise).then(
      value => { unsubscribe(); resolve(value); },
      error => { unsubscribe(); reject(error); },
    );
  });
}

export async function requestFetch(url, options, timeoutMs) {
  throwIfRequestCancelled();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), Math.max(1, Math.ceil(timeoutMs)));
  const unsubscribe = onAbort(getRequestContext().signal, () => controller.abort(cancelled()));
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    throwIfRequestCancelled();
    return { ok: response.ok, status: response.status, text };
  } finally {
    clearTimeout(timer);
    unsubscribe();
  }
}

export async function shareRequestWork(cache, key, work) {
  throwIfRequestCancelled();
  let entry = cache.get(key);
  if (!entry) {
    const controller = new AbortController();
    const context = { ...getRequestContext(), signal: controller.signal };
    entry = { controller, observers: 0, settled: false };
    entry.promise = Promise.resolve().then(() => runWithRequestContext(context, work)).finally(() => {
      entry.settled = true;
      if (cache.get(key) === entry) cache.delete(key);
    });
    cache.set(key, entry);
  }
  entry.observers++;
  try {
    return await waitForRequest(entry.promise);
  } finally {
    // A cancelled caller cannot abort work still needed by another request.
    if (--entry.observers === 0 && !entry.settled) {
      if (cache.get(key) === entry) cache.delete(key);
      entry.controller.abort(cancelled());
    }
  }
}
