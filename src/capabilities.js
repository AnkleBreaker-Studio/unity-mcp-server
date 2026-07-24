// AnkleBreaker Unity MCP — Plugin capability handshake (server half)
//
// The server and plugin ship on separate release trains, so the pair must
// tolerate version drift in both directions. Plugins >= protocolVersion 1
// advertise a monotonic `protocolVersion` int in /api/ping; the server gates
// newer wire features on it instead of failing on older plugins.
//
// Pattern: one monotonic int (not a bool catalog that would rot) — adapted from
// Unity ML-Agents' UnityRLCapabilities. Idea credit: community PR #32 (D3vCrow),
// re-implemented on current main.

/** Feature → minimum plugin protocolVersion that supports it. */
export const PLUGIN_FEATURES = {
  // protocolVersion 1: handshake baseline — ping advertises versions,
  // unknown routes return HTTP 404 on the legacy path.
  UNKNOWN_ROUTE_404: 1,
};

/**
 * Does the given instance's plugin support a feature?
 * @param {{protocolVersion?: number}|null} instance Instance metadata captured at discovery.
 * @param {keyof typeof PLUGIN_FEATURES} feature
 * @returns {boolean} False when the plugin predates the handshake (protocolVersion absent).
 */
export function pluginSupports(instance, feature) {
  const minimum = PLUGIN_FEATURES[feature];
  if (minimum === undefined) return false;
  const version = instance && typeof instance.protocolVersion === "number" ? instance.protocolVersion : 0;
  return version >= minimum;
}

/**
 * Does a bridge result indicate the plugin doesn't know the route at all
 * (as opposed to the call failing)? Handles every era of plugin:
 *  - new plugins (protocolVersion >= 1): legacy path returns HTTP 404 → bridge
 *    surfaces { success:false, error: "HTTP 404: ..." }
 *  - old plugins: dispatch switch returns { error: "Unknown API endpoint: x" }
 *    either as the bridge data or as a failed-ticket error message
 * @param {*} result A settled sendCommand()/wrapper result.
 * @returns {boolean}
 */
export function isUnknownRouteResult(result) {
  if (!result || typeof result !== "object") return false;
  const texts = [];
  if (typeof result.error === "string") texts.push(result.error);
  if (result.data && typeof result.data === "object" && typeof result.data.error === "string") {
    texts.push(result.data.error);
  }
  return texts.some((t) => /HTTP 404|Unknown route|Unknown API endpoint/i.test(t));
}
