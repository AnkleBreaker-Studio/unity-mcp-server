// Unity MCP Server Configuration
// Adjust these paths to match your Unity installation

export const CONFIG = {
  // Unity Hub
  unityHubPath: process.env.UNITY_HUB_PATH || "C:\\Program Files\\Unity Hub\\Unity Hub.exe",

  // Unity Editor Bridge
  editorBridgeHost: process.env.UNITY_BRIDGE_HOST || "127.0.0.1",
  editorBridgePort: parseInt(process.env.UNITY_BRIDGE_PORT || "7890"),
  editorBridgeTimeout: parseInt(process.env.UNITY_BRIDGE_TIMEOUT || "30000"),

  // Queue mode polling (for async ticket-based requests)
  queuePollIntervalMs: parseInt(process.env.UNITY_QUEUE_POLL_INTERVAL || "150"),
  queuePollMaxMs: parseInt(process.env.UNITY_QUEUE_POLL_MAX || "1500"),

  // Default Unity Editor path pattern (version will be interpolated)
  editorPathPattern: process.env.UNITY_EDITOR_PATH || "C:\\Program Files\\Unity\\Hub\\Editor\\{version}\\Editor\\Unity.exe",

  // Logging
  logLevel: process.env.LOG_LEVEL || "info",
};
