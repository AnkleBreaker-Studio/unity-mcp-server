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
  editorBridgeTimeout: parseInt(process.env.UNITY_BRIDGE_TIMEOUT || "30000"),

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

  // Logging
  logLevel: process.env.LOG_LEVEL || "info",
};
