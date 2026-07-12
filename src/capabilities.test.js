// Tests for the capability-negotiation / graceful-degrade layer.
// Run: node --test src/capabilities.test.js   (Node >= 18, zero deps)
//
// This suite IS the "prove the mechanism" artifact: it demonstrates that an OLD
// peer (no protocolVersion) triggers exactly one warning and a clean fall-back to
// single set-reference calls, with no throw — the ml-agents WarnOnMissing behavior.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROTOCOL_VERSION,
  FEATURE_MIN_PROTOCOL,
  pluginSupports,
  warnOnMissing,
  resetWarnings,
  isRouteUnsupportedError,
  callBatchWireWithFallback,
} from "./capabilities.js";

test("constants: protocol + feature floor are sane", () => {
  assert.equal(PROTOCOL_VERSION, 1);
  assert.equal(FEATURE_MIN_PROTOCOL.batchWire, 1);
});

test("pluginSupports: new peer yes; old/missing/no-instance/unknown-feature no", () => {
  assert.equal(pluginSupports({ protocolVersion: 1 }, "batchWire"), true);
  assert.equal(pluginSupports({ protocolVersion: 2 }, "batchWire"), true);
  assert.equal(pluginSupports({ protocolVersion: 0 }, "batchWire"), false);
  assert.equal(pluginSupports({}, "batchWire"), false); // old peer: field absent
  assert.equal(pluginSupports(null, "batchWire"), false); // no instance
  assert.equal(pluginSupports({ protocolVersion: 9 }, "nope"), false); // unknown feature
});

test("warnOnMissing: fires once per feature+port, then dedupes; other port warns", () => {
  resetWarnings();
  const inst = { port: 7890, pluginVersion: "2.20.0", protocolVersion: 0 };
  assert.equal(warnOnMissing("batchWire", inst), true); // first time
  assert.equal(warnOnMissing("batchWire", inst), false); // deduped
  assert.equal(warnOnMissing("batchWire", { port: 7892 }), true); // different peer
});

test("isRouteUnsupportedError: matches bare/queue-wrapped unknown-endpoint + 404; not success", () => {
  assert.equal(isRouteUnsupportedError({ error: "Unknown API endpoint: component/batch-wire" }), true);
  assert.equal(isRouteUnsupportedError({ data: { error: "Unknown API endpoint: x" } }), true);
  assert.equal(isRouteUnsupportedError("HTTP 404 Not Found"), true);
  assert.equal(isRouteUnsupportedError({ success: true, data: { wired: 3 } }), false);
  assert.equal(isRouteUnsupportedError({ error: "some unrelated failure" }), false);
  assert.equal(isRouteUnsupportedError(null), false);
});

test("degrade (proactive): KNOWN-old peer (protocolVersion 0) → N set-reference, no batch call, no throw", async () => {
  resetWarnings();
  let batchCalls = 0;
  let setRefCalls = 0;
  const bridge = {
    batchWireReferences: async () => { batchCalls++; return { success: true }; },
    setComponentReference: async () => { setRefCalls++; return { success: true }; },
  };
  const params = { references: [{ propertyName: "a" }, { propertyName: "b" }, { propertyName: "c" }] };

  const out = await callBatchWireWithFallback(bridge, { port: 7890, protocolVersion: 0 }, params);

  assert.equal(batchCalls, 0, "must not call batch-wire on a known-unsupported peer");
  assert.equal(setRefCalls, 3, "one set-reference per entry");
  assert.equal(out.degraded, true);
  assert.equal(out.total, 3);
  assert.equal(out.failed, 0);
});

test("degrade (reactive): peer CLAIMS support but route missing → tries once, falls back, no throw", async () => {
  resetWarnings();
  let batchCalls = 0;
  let setRefCalls = 0;
  const bridge = {
    batchWireReferences: async () => { batchCalls++; return { error: "Unknown API endpoint: component/batch-wire" }; },
    setComponentReference: async () => { setRefCalls++; return { success: true }; },
  };
  const params = { references: [{ propertyName: "a" }, { propertyName: "b" }] };

  const out = await callBatchWireWithFallback(bridge, { port: 7890, protocolVersion: 1 }, params);

  assert.equal(batchCalls, 1, "reactive path tries the fast route once");
  assert.equal(setRefCalls, 2);
  assert.equal(out.degraded, true);
});

test("unknown peer (no protocolVersion): tries fast path; keeps it when the route works", async () => {
  resetWarnings();
  let batchCalls = 0;
  let setRefCalls = 0;
  const bridge = {
    batchWireReferences: async () => { batchCalls++; return { success: true, wired: 2 }; },
    setComponentReference: async () => { setRefCalls++; return { success: true }; },
  };
  const params = { references: [{ propertyName: "a" }, { propertyName: "b" }] };

  const out = await callBatchWireWithFallback(bridge, { port: 7890 }, params); // field absent

  assert.equal(batchCalls, 1, "unknown peer must NOT be pre-degraded");
  assert.equal(setRefCalls, 0);
  assert.equal(out.degraded, undefined, "fast path returns the bridge result as-is");
  assert.equal(out.success, true);
});

test("fast path: KNOWN-new peer → batch-wire used, no fallback", async () => {
  resetWarnings();
  let batchCalls = 0;
  let setRefCalls = 0;
  const bridge = {
    batchWireReferences: async () => { batchCalls++; return { success: true, wired: 2 }; },
    setComponentReference: async () => { setRefCalls++; return { success: true }; },
  };
  const params = { references: [{ propertyName: "a" }, { propertyName: "b" }] };

  const out = await callBatchWireWithFallback(bridge, { port: 7890, protocolVersion: 1 }, params);

  assert.equal(batchCalls, 1);
  assert.equal(setRefCalls, 0);
  assert.equal(out.success, true);
});
