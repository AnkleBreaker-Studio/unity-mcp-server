// Unit tests for the plugin capability handshake helpers.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { PLUGIN_FEATURES, pluginSupports, isUnknownRouteResult } from "../../src/capabilities.js";

describe("pluginSupports", () => {
  test("new plugins advertising protocolVersion pass the gate", () => {
    assert.equal(pluginSupports({ protocolVersion: 1 }, "UNKNOWN_ROUTE_404"), true);
    assert.equal(pluginSupports({ protocolVersion: 7 }, "UNKNOWN_ROUTE_404"), true);
  });

  test("pre-handshake plugins (no protocolVersion) are treated as unsupporting", () => {
    assert.equal(pluginSupports({}, "UNKNOWN_ROUTE_404"), false);
    assert.equal(pluginSupports(null, "UNKNOWN_ROUTE_404"), false);
    assert.equal(pluginSupports({ protocolVersion: 0 }, "UNKNOWN_ROUTE_404"), false);
    assert.equal(pluginSupports({ protocolVersion: "1" }, "UNKNOWN_ROUTE_404"), false, "non-numeric version is not trusted");
  });

  test("unknown features never pass", () => {
    assert.equal(pluginSupports({ protocolVersion: 99 }, "NOT_A_FEATURE"), false);
  });

  test("feature table stays monotonic ints", () => {
    for (const [name, version] of Object.entries(PLUGIN_FEATURES)) {
      assert.ok(Number.isInteger(version) && version >= 1, `${name} maps to a positive int`);
    }
  });
});

describe("isUnknownRouteResult", () => {
  test("matches every era of unknown-route signature", () => {
    assert.equal(isUnknownRouteResult({ success: false, error: "HTTP 404: Unknown route: x/y" }), true);
    assert.equal(isUnknownRouteResult({ success: false, error: "Unknown API endpoint: x/y" }), true);
    assert.equal(isUnknownRouteResult({ success: true, data: { error: "Unknown API endpoint: x/y" } }), true);
  });

  test("does not misfire on ordinary failures or successes", () => {
    assert.equal(isUnknownRouteResult({ success: true, data: { ok: 1 } }), false);
    assert.equal(isUnknownRouteResult({ success: false, error: "NullReferenceException at ..." }), false);
    assert.equal(isUnknownRouteResult({ success: false, error: "Timeout after 30s" }), false);
    assert.equal(isUnknownRouteResult(null), false);
    assert.equal(isUnknownRouteResult("Unknown route"), false);
  });
});
