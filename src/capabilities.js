// AnkleBreaker Unity MCP — server↔plugin capability negotiation (drift resilience).
//
// The Node server and the Unity plugin ship on separate release trains and drift
// (server 2.28.2 vs plugin 2.27.0 at time of writing). Before this module the two
// never exchanged a version or feature signal: a call to a route an older plugin
// lacks came back as `{error:"Unknown API endpoint"}` and — since WIN A — surfaced
// as an MCP error, but with no graceful fallback and no "why".
//
// Pattern ported (not copied) from Unity ML-Agents' UnityRLCapabilities handshake:
// each side advertises what it supports; a missing/older peer is detected and the
// feature DEGRADES with one warning instead of failing. Two deliberate differences
// from ml-agents, because this is an HTTP route bridge, not a bilateral RL protocol:
//   1. Capability is PROVIDER-side, not symmetric. The plugin provides a route; the
//      server consumes it. The predicate is one-sided ("does the plugin support
//      it?"), NOT `serverCap AND pluginCap` — a symmetric AND would wrongly gate a
//      route the plugin actually implements.
//   2. We gate on a single monotonic `protocolVersion` int, not a hand-maintained
//      bool map. A bool catalog would rot exactly like the plugin's already-stale
//      `_meta/routes` list. Route existence stays the plugin's job; this file only
//      decides "is the peer new enough for feature X, and if not, how do we cope".
//
// Ref: knowledge/research/2026-07-12-vet-unity-ml-agents.md

/**
 * Wire-protocol version this server speaks. Bump when the server starts REQUIRING a
 * plugin-side behavior that older plugins can't provide. Keep in sync with the
 * plugin's MCPCapabilities.ProtocolVersion.
 */
export const PROTOCOL_VERSION = 1;

/**
 * Minimum plugin `protocolVersion` required for each negotiated feature. A feature
 * absent from this map is unknown → unsupported (fail-safe to degrade).
 */
export const FEATURE_MIN_PROTOCOL = {
  // component/batch-wire — the first negotiated flag. Degrades to N single
  // component/set-reference calls when the plugin predates it.
  batchWire: 1,
};

/**
 * Is the connected plugin KNOWN to support a negotiated feature?
 * One-sided provider check: the plugin advertises `protocolVersion` in its ping
 * response; a plugin that predates the handshake omits it → treated as 0 →
 * unsupported. Mirrors ml-agents' "a capability the peer never mentions is false".
 * @param {object|null} instance - selected Unity instance (from getSelectedInstance()).
 * @param {string} feature - key in FEATURE_MIN_PROTOCOL.
 * @returns {boolean}
 */
export function pluginSupports(instance, feature) {
  const need = FEATURE_MIN_PROTOCOL[feature] ?? Infinity;
  const have = instance?.protocolVersion ?? 0;
  return have >= need;
}

// One warning per (feature, port) — a busy session must not spam identical lines.
const _warned = new Set();

/**
 * Warn exactly once that a feature is unavailable on the connected plugin and the
 * server is degrading. Writes to stderr (never stdout — stdout is the MCP channel).
 * @returns {boolean} true if a warning was emitted this call, false if deduped.
 */
export function warnOnMissing(feature, instance) {
  const port = instance?.port ?? "?";
  const key = `${feature}@${port}`;
  if (_warned.has(key)) return false;
  _warned.add(key);
  const detail = `plugin ${instance?.pluginVersion ?? "unknown"}, protocol ${instance?.protocolVersion ?? "none"}`;
  console.error(
    `[AB-UMCP] Connected Unity plugin does not support "${feature}" (${detail}). ` +
    `Degrading gracefully — update the plugin to remove this warning.`,
  );
  return true;
}

/** Reset the warn-dedupe cache (test hook; also call after a reconnect). */
export function resetWarnings() {
  _warned.clear();
}

/**
 * Reactive safety net: true when a bridge result is the plugin's "route does not
 * exist" signal — the `{error:"Unknown API endpoint"}` body (bare or queue-wrapped)
 * or an HTTP-404 error string. Lets the server fall back even when `protocolVersion`
 * was never captured (e.g. a registry-sourced instance) or is misreported.
 */
export function isRouteUnsupportedError(result) {
  const RE = /unknown api endpoint|http 404\b|\b404 not found\b/i;
  if (result == null) return false;
  if (typeof result === "string") return RE.test(result);
  if (typeof result === "object") {
    if (typeof result.error === "string" && RE.test(result.error)) return true;
    if (result.data && typeof result.data === "object" &&
        typeof result.data.error === "string" && RE.test(result.data.error)) return true;
  }
  return false;
}

/**
 * Call component/batch-wire, degrading to N single component/set-reference calls
 * when the connected plugin can't do batch-wire. Never throws on the drift case.
 *
 * Decision table:
 *   - protocolVersion present and >= min  → fast path (batch-wire).
 *   - protocolVersion present and <  min  → known-old: skip the call, degrade.
 *   - protocolVersion absent (unknown)    → try the fast path; degrade only if the
 *                                           route comes back unsupported (reactive).
 *
 * @param {object} bridge - the unity-editor-bridge module (injected for testability).
 * @param {object|null} instance - selected Unity instance.
 * @param {object} params - { references: [ ...set-reference-shaped entries ] }.
 */
export async function callBatchWireWithFallback(bridge, instance, params) {
  const pv = instance?.protocolVersion;
  const knownUnsupported = typeof pv === "number" && !pluginSupports(instance, "batchWire");

  if (!knownUnsupported) {
    const result = await bridge.batchWireReferences(params);
    if (!isRouteUnsupportedError(result)) return result; // fast path (or unknown-peer success)
    // Peer advertised support (or version unknown) but the route is missing — degrade.
  }

  warnOnMissing("batchWire", instance);
  return degradeBatchWire(bridge, params);
}

/**
 * Emulate component/batch-wire with one component/set-reference call per entry.
 * @returns {object} aggregate result flagged `degraded:true`.
 */
async function degradeBatchWire(bridge, params) {
  const refs = Array.isArray(params?.references) ? params.references : [];
  const results = [];
  let failed = 0;
  for (const entry of refs) {
    const r = await bridge.setComponentReference(entry);
    if (isRouteUnsupportedError(r) || (r && r.error) || (r && r.success === false)) failed++;
    results.push(r);
  }
  return {
    degraded: true,
    mode: "batch-wire→set-reference (plugin lacks component/batch-wire)",
    total: refs.length,
    failed,
    results,
  };
}
