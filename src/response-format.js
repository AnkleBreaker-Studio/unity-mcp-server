// AnkleBreaker Unity MCP — shared response payload formatter (WIN N: compact JSON).
//
// Compact JSON by default to save agent tokens (~44% byte reduction measured on
// nested payloads like deep scene hierarchies — the responses that matter most).
// The C# bridge (MiniJson) already serializes compact over HTTP; the Node side
// was re-inflating it with `null, 2` indentation that the model parses identically
// but pays for in tokens. This reverts that one unnecessary re-pretty step.
//
// Set UNITY_MCP_PRETTY_JSON=1 to restore human-readable indentation for debugging.

const PRETTY = process.env.UNITY_MCP_PRETTY_JSON === "1";

/**
 * Serialize a tool result for the MCP text channel.
 * Compact by default; indented only when UNITY_MCP_PRETTY_JSON=1.
 * @param {*} value - the object/array/value to serialize.
 * @returns {string} JSON string.
 */
export function formatResult(value) {
  return PRETTY ? JSON.stringify(value, null, 2) : JSON.stringify(value);
}

// ─── Error-flag detection (WIN A keystone) ───
// The Unity bridge returns HTTP 200 for LOGICAL failures, and tool handlers
// return one of several error shapes — a `{error: "..."}` object (legacy), a
// `{success:false}` object, a queue-wrapped `{success:true, data:{error:...}}`,
// or (with the MCPResponse factory) a `{ok:false, error:{code,message,hint}}`
// envelope. None set the MCP `isError` flag by themselves, so a client reads a
// logical failure as success and the agent can't branch on it. These helpers let
// the Node seam set isError for every existing error shape with ZERO C# edits.

/**
 * True when a parsed object looks like a logical-error envelope.
 * A self-declared success (ok:true / success:true) is never treated as an error
 * even if it carries an `error` key (JsonUtility serializes null strings as "").
 */
export function looksLikeErrorObject(obj) {
  if (!obj || typeof obj !== "object") return false;
  const claimsSuccess = obj.ok === true || obj.success === true;
  if (obj.ok === false) return true; // MCPResponse factory envelope
  if (obj.success === false) return true; // legacy success flag
  if (obj.error && !claimsSuccess) return true; // legacy {error: msg}
  if (obj.data && typeof obj.data === "object" && obj.data.error) return true; // queue-wrapped
  return false;
}

/**
 * True when a tool result (string, object, or content-block array) represents a
 * logical error and the MCP response should carry isError:true.
 */
export function isErrorResult(result) {
  // Content-block arrays (images, screenshots) are always non-error payloads.
  if (Array.isArray(result)) return false;
  if (typeof result === "string") {
    const s = result.trimStart();
    if (s.startsWith("{") || s.startsWith("[")) {
      try {
        return looksLikeErrorObject(JSON.parse(s));
      } catch {
        // Not JSON — fall through to the prose check.
      }
    }
    // Plain-string error convention used by the meta-tools (tool-tiers.js).
    return /^error\b/i.test(s);
  }
  return looksLikeErrorObject(result);
}
