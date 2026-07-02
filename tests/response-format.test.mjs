// Unit cases for WIN A keystone: isErrorResult / looksLikeErrorObject.
// Forward-ported from branch agent-contract-wins onto main (2026-07-02).
// The Unity bridge returns HTTP 200 on logical failure; these helpers let the
// Node seam set MCP isError for every existing Unity-side error shape.
import assert from "node:assert/strict";
import { isErrorResult, looksLikeErrorObject } from "../src/response-format.js";

const cases = [
  // label, input, expected isErrorResult
  ["legacy {error}", { error: "boom" }, true],
  ["{success:false}", { success: false }, true],
  ["queue-wrapped {success:true,data:{error}}", { success: true, data: { error: "x" } }, true],
  ["factory {ok:false,error}", { ok: false, error: { code: "E", message: "m" } }, true],
  ["{data:{error}} no success claim", { data: { error: "x" } }, true],
  ["self-declared {ok:true}", { ok: true, value: 1 }, false],
  ["self-declared {success:true}", { success: true, value: 1 }, false],
  ["{success:true,error:''} JsonUtility empty", { success: true, error: "" }, false],
  ["JSON string error", '{"error":"boom"}', true],
  ["JSON string success", '{"success":true}', false],
  ["prose error string", "Error: something failed", true],
  ["plain success string", "Done.", false],
  ["content-block array", [{ type: "image", data: "..." }], false],
];

let pass = 0;
const failures = [];
for (const [label, input, expected] of cases) {
  const got = isErrorResult(input);
  try {
    assert.equal(got, expected);
    pass++;
  } catch {
    failures.push(`FAIL: ${label} — expected ${expected}, got ${got}`);
  }
}

// Spot-check the lower-level predicate too.
assert.equal(looksLikeErrorObject({ ok: false }), true);
assert.equal(looksLikeErrorObject({ ok: true, error: "" }), false);

for (const f of failures) console.error(f);
console.log(`response-format isErrorResult: ${pass}/${cases.length} passed`);
process.exit(failures.length === 0 ? 0 : 1);
