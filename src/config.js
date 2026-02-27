// AnkleBreaker Unity MCP — Configuration
// Adjust these paths to match your Unity installation

import { homedir } from "os";
import { join } from "path";

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

  // Multi-instance support
  portRangeStart: parseInt(process.env.UNITY_PORT_RANGE_START || "7890"),
  portRangeEnd: parseInt(process.env.UNITY_PORT_RANGE_END || "7899"),
  instanceRegistryPath: process.env.UNITY_INSTANCE_REGISTRY || getRegistryPath(),

  // Queue mode polling (for async ticket-based requests)
  queuePollIntervalMs: parseInt(process.env.UNITY_QUEUE_POLL_INTERVAL || "150"),
  queuePollMaxMs: parseInt(process.env.UNITY_QUEUE_POLL_MAX || "1500"),
  queuePollTimeoutMs: parseInt(process.env.UNITY_QUEUE_POLL_TIMEOUT || "120000"), // Max total poll time (2 min)

  // Default Unity Editor path pattern (version will be interpolated)
  editorPathPattern: process.env.UNITY_EDITOR_PATH || "C:\\Program Files\\Unity\\Hub\\Editor\\{version}\\Editor\\Unity.exe",

  // Response size limits (bytes) — protects against Write EOF errors on large projects
  // Soft limit: log a warning but still return the response
  responseSoftLimitBytes: parseInt(process.env.UNITY_RESPONSE_SOFT_LIMIT || String(2 * 1024 * 1024)),   // 2 MB
  // Hard limit: truncate the response and return pagination guidance instead
  responseHardLimitBytes: parseInt(process.env.UNITY_RESPONSE_HARD_LIMIT || String(4 * 1024 * 1024)),   // 4 MB

  // Logging
  logLevel: process.env.LOG_LEVEL || "info",
};
