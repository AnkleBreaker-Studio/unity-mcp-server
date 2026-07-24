// AnkleBreaker Unity MCP — Shared response formatting
//
// formatResult(): single choke point for serializing tool results. Compact JSON by
// default — the C# plugin already sends compact JSON over HTTP; re-indenting it on the
// Node side only inflated every structured response by 20-50% in tokens. Set
// UNITY_MCP_PRETTY_JSON=1 to restore 2-space indentation for human debugging.
//
// isErrorText()/looksLikeErrorObject(): the Unity bridge returns HTTP 200 for logical
// failures, and handlers surface several error shapes ({error}, {success:false},
// {ok:false}, queue-wrapped {success:true, data:{error}}) — none of which set the MCP
// isError flag on their own. index.js uses these helpers at the CallTool seam so MCP
// clients stop reading logical failures as successes.
// (Idea credit: community PR #31 by D3vCrow, re-implemented on current main.)

const PRETTY = process.env.UNITY_MCP_PRETTY_JSON === "1";

/**
 * Serialize a tool result object to the response text.
 * @param {*} value JSON-serializable tool result.
 * @returns {string}
 */
export function formatResult(value) {
  return PRETTY ? JSON.stringify(value, null, 2) : JSON.stringify(value);
}

/**
 * Conservative check: does this parsed object look like a logical failure?
 * @param {*} obj
 * @returns {boolean}
 */
export function looksLikeErrorObject(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
  // An explicit self-reported success is authoritative: a status handler answering
  // "is X installed?" may legitimately carry an `error`/`installed:false` field while
  // having succeeded. Don't flag those (queue-wrapped failures have no inner success flag).
  if (obj.success === true || obj.ok === true) return false;
  if (obj.success === false || obj.ok === false) return true;
  if (typeof obj.error === "string" && obj.error.length > 0) return true;
  if (obj.error && typeof obj.error === "object" && typeof obj.error.message === "string") return true;
  return false;
}

/**
 * Strip per-property prose from a JSON schema while keeping its full STRUCTURE
 * (types, required, enums survive — strict clients still validate). Used by the
 * compact tools/list mode and the advanced-tool catalog's lean views.
 * @param {object} schema
 * @returns {object}
 */
export function stripSchemaDescriptions(schema) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return schema;
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "description") continue;
    if (key === "properties" && value && typeof value === "object") {
      const props = {};
      for (const [prop, sub] of Object.entries(value)) props[prop] = stripSchemaDescriptions(sub);
      out[key] = props;
    } else if (key === "items") {
      out[key] = stripSchemaDescriptions(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * First sentence of a description (abbreviation-safe, capped at 160 chars).
 * The token-diet summary used wherever a full description would be waste.
 * @param {string} text
 * @returns {string}
 */
export function firstSentence(text) {
  if (!text) return text;
  // Find the first sentence-ending ". " that isn't part of "e.g." / "i.e." — otherwise
  // descriptions get cut mid-abbreviation ("... in one call (e.g.").
  let from = 0;
  let cut = -1;
  while (true) {
    const idx = text.indexOf(". ", from);
    if (idx < 0) break;
    const before = text.slice(Math.max(0, idx - 3), idx).toLowerCase();
    if (before.endsWith("e.g") || before.endsWith("i.e")) {
      from = idx + 2;
      continue;
    }
    cut = idx;
    break;
  }
  const sentence = cut > 0 ? text.slice(0, cut + 1) : text;
  return sentence.length > 160 ? `${sentence.slice(0, 157)}...` : sentence;
}

/**
 * Does a tool's text output represent a logical failure?
 * Handles both JSON payloads (top level or bridge-enveloped) and plain-text
 * "Error ..." strings emitted by a few handlers.
 * @param {string} text
 * @returns {boolean}
 */
export function isErrorText(text) {
  if (typeof text !== "string" || text.length === 0) return false;
  const first = text[0];
  if (first === "{" || first === "[") {
    try {
      const parsed = JSON.parse(text);
      if (looksLikeErrorObject(parsed)) return true;
      // Bridge envelope: HTTP 200 always sets outer success:true, so the real signal
      // is the inner data payload. An explicit inner success:true still wins (handled
      // inside looksLikeErrorObject).
      if (parsed && typeof parsed === "object" && looksLikeErrorObject(parsed.data)) return true;
      return false;
    } catch {
      // Fall through to the plain-text check.
    }
  }
  return /^Error[:\s]/.test(text);
}
