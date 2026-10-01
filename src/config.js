// AnkleBreaker Unity MCP — Configuration
// Adjust these paths to match your Unity installation

import { homedir } from "os";
import { join } from "path";

function byteLimit(name, fallback, minimum) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = /^\d+$/.test(raw.trim()) ? Number(raw) : NaN;
  if (Number.isSafeInteger(value) && value >= minimum) return value;
  console.error(`[MCP] Invalid ${name}; using ${fallback} bytes (minimum ${minimum}).`);
  return fallback;
}

function agentLimit() {
  const raw = process.env.UNITY_MCP_AGENT_STATE_LIMIT;
  if (raw === undefined) return 1024;
  const value = /^\d+$/.test(raw.trim()) ? Number(raw) : NaN;
  if (Number.isSafeInteger(value) && value >= 1 && value <= 65536) return value;
  console.error("[MCP] Invalid UNITY_MCP_AGENT_STATE_LIMIT; using 1024 agents (range 1..65536).");
  return 1024;
}

// Reserve enough space to return a useful bounded error when a result cannot be delivered.
const responseHardLimitBytes = byteLimit("UNITY_RESPONSE_HARD_LIMIT", 4 * 1024 * 1024, 1024);
const responseSoftLimitBytes = Math.min(byteLimit("UNITY_RESPONSE_SOFT_LIMIT", 2 * 1024 * 1024, 1), responseHardLimitBytes);

// Determine the instance registry path based on platform
function getRegistryPath() {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
    return join(localAppData, "UnityMCP", "instances.json");
  }
  // macOS / Linux
  return join(homedir(), ".local", "share", "UnityMCP", "instances.json");
}

export const CONFIG = {
  // Unity Hub
  unityHubPath: process.env.UNITY_HUB_PATH || "C:\\Program Files\\Unity Hub\\Unity Hub.exe",

  // Unity Editor Bridge (default — used as fallback when no instance is selected)
  editorBridgeHost: process.env.UNITY_BRIDGE_HOST || "127.0.0.1",
  editorBridgePort: parseInt(process.env.UNITY_BRIDGE_PORT || "7890"),
  editorBridgeTimeout: parseInt(process.env.UNITY_BRIDGE_TIMEOUT || "60000"),
  httpResponseLimitBytes: byteLimit("UNITY_HTTP_RESPONSE_LIMIT", 32 * 1024 * 1024, 1024),

  // Multi-instance support
  portRangeStart: parseInt(process.env.UNITY_PORT_RANGE_START || "7890"),
  portRangeEnd: parseInt(process.env.UNITY_PORT_RANGE_END || "7899"),
  instanceRegistryPath: process.env.UNITY_INSTANCE_REGISTRY || getRegistryPath(),
  agentStateLimit: agentLimit(),
  agentStateBytes: byteLimit("UNITY_MCP_AGENT_STATE_BYTES", 8 * 1024 * 1024, 1024),

  // Queue mode polling (for async ticket-based requests)
  queuePollIntervalMs: parseInt(process.env.UNITY_QUEUE_POLL_INTERVAL || "150"),
  queuePollMaxMs: parseInt(process.env.UNITY_QUEUE_POLL_MAX || "1500"),
  queuePollTimeoutMs: parseInt(process.env.UNITY_QUEUE_POLL_TIMEOUT || "120000"), // Max total poll time (2 min)

  // Default Unity Editor path pattern (version will be interpolated)
  editorPathPattern: process.env.UNITY_EDITOR_PATH || "C:\\Program Files\\Unity\\Hub\\Editor\\{version}\\Editor\\Unity.exe",

  // Registry staleness timeout (ms) — if a registry entry's lastSeen timestamp is older
  // than this AND the port is unresponsive, the entry is considered stale (Unity likely crashed).
  // The plugin sends a heartbeat every 30s, so 5 minutes gives plenty of margin.
  registryStalenessTimeoutMs: parseInt(process.env.UNITY_REGISTRY_STALENESS_TIMEOUT || "300000"), // 5 minutes

  // Budget serialized UTF-8 tool/resource results, excluding the JSON-RPC envelope and request ID.
  responseSoftLimitBytes,
  responseHardLimitBytes,

  // Logging
  logLevel: process.env.LOG_LEVEL || "info",
};
