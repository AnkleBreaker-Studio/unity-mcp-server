// Unity MCP — Multi-Instance Discovery
// Discovers running Unity Editor instances via:
//   1. Shared registry file (%LOCALAPPDATA%/UnityMCP/instances.json)
//   2. Port scanning fallback (7890-7899)
//
// Also manages instance selection state for the current MCP session.

import { readFileSync } from "fs";
import { CONFIG } from "./config.js";

// ─── Session State ───
// Tracks which Unity instance this MCP session is targeting.
let _selectedInstance = null; // { port, projectName, projectPath, ... }
let _instanceSelectionRequired = false;

/**
 * Get the currently selected Unity instance for this session.
 * @returns {object|null} Selected instance info, or null if none selected.
 */
export function getSelectedInstance() {
  return _selectedInstance;
}

/**
 * Check whether the session still needs the user to select an instance.
 */
export function isInstanceSelectionRequired() {
  return _instanceSelectionRequired;
}

/**
 * Mark that instance selection is required (multiple instances found, none selected).
 */
export function setInstanceSelectionRequired(required) {
  _instanceSelectionRequired = required;
}

/**
 * Select a Unity instance by port number.
 * All subsequent bridge commands will be routed to this port.
 * @param {number} port - The port of the instance to select.
 * @returns {object} The selected instance info, or error.
 */
export async function selectInstance(port) {
  const instances = await discoverInstances();
  const match = instances.find((inst) => inst.port === port);

  if (!match) {
    return {
      success: false,
      error: `No Unity instance found on port ${port}. Use unity_list_instances to see available instances.`,
    };
  }

  // Verify the instance is actually reachable
  const alive = await pingInstance(port);
  if (!alive) {
    return {
      success: false,
      error: `Unity instance on port ${port} (${match.projectName}) is not responding. It may have shut down.`,
    };
  }

  _selectedInstance = match;
  _instanceSelectionRequired = false;

  return {
    success: true,
    message: `Selected Unity instance: ${match.projectName} (port ${port})`,
    instance: match,
  };
}

/**
 * Get the bridge URL for the currently selected instance.
 * Falls back to default CONFIG port if no instance is selected.
 * @returns {string} The base URL for HTTP bridge commands.
 */
export function getActiveBridgeUrl() {
  const host = CONFIG.editorBridgeHost;
  if (_selectedInstance) {
    return `http://${host}:${_selectedInstance.port}`;
  }
  return `http://${host}:${CONFIG.editorBridgePort}`;
}

/**
 * Get the port of the currently selected instance, or the default.
 */
export function getActivePort() {
  if (_selectedInstance) {
    return _selectedInstance.port;
  }
  return CONFIG.editorBridgePort;
}

/**
 * Discover all running Unity instances.
 * Reads the shared registry file first, then validates each entry is alive.
 * Falls back to port scanning if the registry is empty/missing.
 *
 * @returns {Array<object>} List of discovered instances with their metadata.
 */
export async function discoverInstances() {
  let instances = [];

  // Step 1: Read registry file
  try {
    const registryData = readRegistryFile();
    if (registryData.length > 0) {
      // Validate each entry by pinging it
      const validated = await Promise.all(
        registryData.map(async (entry) => {
          const port = entry.port;
          if (!port) return null;

          const alive = await pingInstance(port);
          return alive ? { ...entry, alive: true, source: "registry" } : null;
        })
      );

      instances = validated.filter((inst) => inst !== null);
    }
  } catch (err) {
    console.error(`[MCP Discovery] Error reading registry: ${err.message}`);
  }

  // Step 2: Port scan fallback (find instances not in registry)
  const registeredPorts = new Set(instances.map((i) => i.port));

  const scanPromises = [];
  for (let port = CONFIG.portRangeStart; port <= CONFIG.portRangeEnd; port++) {
    if (registeredPorts.has(port)) continue; // Already found via registry

    scanPromises.push(
      (async () => {
        const alive = await pingInstance(port);
        if (alive) {
          // Try to get project info from the instance
          const info = await getInstanceInfo(port);
          return {
            port,
            projectName: info?.projectName || `Unknown (port ${port})`,
            projectPath: info?.projectPath || "",
            unityVersion: info?.unityVersion || "",
            isClone: info?.isClone || false,
            cloneIndex: info?.cloneIndex ?? -1,
            alive: true,
            source: "portscan",
          };
        }
        return null;
      })()
    );
  }

  const scanned = await Promise.all(scanPromises);
  for (const inst of scanned) {
    if (inst) instances.push(inst);
  }

  return instances;
}

/**
 * Auto-select an instance if exactly one is available.
 * If multiple are found, marks selection as required.
 * If none are found, tries the default port.
 * @returns {object} Result with auto-selected instance or selection requirement.
 */
export async function autoSelectInstance() {
  const instances = await discoverInstances();

  if (instances.length === 0) {
    // No instances found — try default port as last resort
    const defaultAlive = await pingInstance(CONFIG.editorBridgePort);
    if (defaultAlive) {
      const info = await getInstanceInfo(CONFIG.editorBridgePort);
      _selectedInstance = {
        port: CONFIG.editorBridgePort,
        projectName: info?.projectName || "Unity Editor",
        projectPath: info?.projectPath || "",
        unityVersion: info?.unityVersion || "",
        isClone: false,
        cloneIndex: -1,
        alive: true,
        source: "default",
      };
      _instanceSelectionRequired = false;
      return {
        autoSelected: true,
        instance: _selectedInstance,
        instances: [_selectedInstance],
        message: `Auto-connected to Unity Editor: ${_selectedInstance.projectName} (port ${CONFIG.editorBridgePort})`,
      };
    }

    _instanceSelectionRequired = false;
    return {
      autoSelected: false,
      instances: [],
      message: "No Unity Editor instances found. Make sure Unity is running with the MCP plugin enabled.",
    };
  }

  if (instances.length === 1) {
    // Exactly one instance — auto-select it
    _selectedInstance = instances[0];
    _instanceSelectionRequired = false;
    return {
      autoSelected: true,
      instance: _selectedInstance,
      instances,
      message: `Auto-connected to Unity Editor: ${_selectedInstance.projectName} (port ${_selectedInstance.port})`,
    };
  }

  // Multiple instances — require user selection
  _instanceSelectionRequired = true;
  return {
    autoSelected: false,
    instances,
    message: `Found ${instances.length} Unity Editor instances. Please use unity_select_instance to choose which one to work with.`,
  };
}

// ─── Internal helpers ───

/**
 * Read the instance registry file.
 * @returns {Array<object>} Parsed instance entries.
 */
function readRegistryFile() {
  try {
    const raw = readFileSync(CONFIG.instanceRegistryPath, "utf-8");
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return data;
    return [];
  } catch {
    // File doesn't exist or can't be parsed — that's fine
    return [];
  }
}

/**
 * Ping a Unity instance at a specific port (fast timeout for discovery).
 * @param {number} port
 * @returns {boolean} True if the instance is alive.
 */
async function pingInstance(port) {
  try {
    const url = `http://${CONFIG.editorBridgeHost}:${port}/api/ping`;
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(1500), // Short timeout for discovery
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Get project information from a Unity instance via its ping endpoint.
 * @param {number} port
 * @returns {object|null} Project info, or null if unavailable.
 */
async function getInstanceInfo(port) {
  try {
    const url = `http://${CONFIG.editorBridgeHost}:${port}/api/ping`;
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(2000),
    });

    if (!response.ok) return null;

    const data = await response.json();
    return {
      projectName: data.projectName || data.project || null,
      projectPath: data.projectPath || null,
      unityVersion: data.unityVersion || data.version || null,
      isClone: data.isClone || false,
      cloneIndex: data.cloneIndex ?? -1,
    };
  } catch {
    return null;
  }
}
