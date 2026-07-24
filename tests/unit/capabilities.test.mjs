// Unit tests for the plugin capability handshake helpers.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { PLUGIN_FEATURES, pluginSupports, isUnknownRouteResult } from "../../src/capabilities.js";
import { looksLikeErrorObject, isErrorText } from "../../src/response-format.js";

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

describe("error-shape detection (isError seam)", () => {
  test("explicit self-reported success wins over a stray error field (status tools)", () => {
    // A "is X installed?" handler answering successfully but carrying an error string.
    assert.equal(looksLikeErrorObject({ success: true, installed: false, error: "UMA not installed" }), false);
    assert.equal(looksLikeErrorObject({ ok: true, error: "nothing to bake" }), false);
    assert.equal(isErrorText(JSON.stringify({ success: true, data: { success: true, error: "package absent" } })), false);
  });

  test("queue-wrapped and inner failures are still flagged", () => {
    assert.equal(isErrorText(JSON.stringify({ success: true, data: { error: "boom" } })), true);
    assert.equal(isErrorText(JSON.stringify({ success: true, data: { success: false } })), true);
    assert.equal(isErrorText(JSON.stringify({ error: "top-level failure" })), true);
    assert.equal(isErrorText("Error: plain text failure"), true);
  });

  test("legitimate nested error collections are not flagged", () => {
    // Compilation errors live under a plural array, console errors under entries[].
    assert.equal(isErrorText(JSON.stringify({ success: true, data: { count: 2, errors: ["a", "b"] } })), false);
    assert.equal(isErrorText(JSON.stringify({ data: { entries: [{ type: "error", message: "x" }] } })), false);
  });
});
