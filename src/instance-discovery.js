// Unity MCP — Multi-Instance Discovery
// Discovers running Unity Editor instances via:
//   1. Shared registry file (%LOCALAPPDATA%/UnityMCP/instances.json)
//   2. Port scanning fallback (7890-7899)
//
// Also manages instance selection state for the current MCP session.

import { readFileSync } from "fs";
import { CONFIG } from "./config.js";
import { persistState, loadState, debugLog } from "./state-persistence.js";

// ─── Session State ───
// Tracks which Unity instance this MCP session is targeting.
// State is also persisted to disk so it survives process restarts.
let _selectedInstance = null; // { port, projectName, projectPath, ... }
let _instanceSelectionRequired = false;

// On module load, restore persisted state (the process may have been restarted)
(function restorePersistedState() {
  try {
    const persisted = loadState("selectedInstance");
    if (persisted && persisted.port) {
      // Store as tentative — will be validated on first use via validateSelectedInstance()
      _selectedInstance = persisted;
      _needsIdentityValidation = true;
      _instanceSelectionRequired = false;
      debugLog(`Restored persisted instance (pending validation): ${persisted.projectName} (port ${persisted.port})`);
    }
  } catch {
    // Ignore — fresh start
  }
})();

// Flag: when true, the restored selection needs identity validation before use
let _needsIdentityValidation = false;

/**
 * Get the currently selected Unity instance for this session.
 * Falls through to persisted state if in-memory state was lost (process restart).
 * @returns {object|null} Selected instance info, or null if none selected.
 */
export function getSelectedInstance() {
  if (_selectedInstance) return _selectedInstance;

  // Check persisted state (survives process restarts)
  const persisted = loadState("selectedInstance");
  if (persisted && persisted.port) {
    _selectedInstance = persisted;
    _needsIdentityValidation = true;
    _instanceSelectionRequired = false;
    debugLog(`getSelectedInstance: restored from persistence — port ${persisted.port}`);
    return _selectedInstance;
  }

  return null;
}

/**
 * Validate that the currently selected instance still hosts the expected project.
 * Detects port swapping: if ProjectA was on port 7891 but now ProjectB is there,
 * re-discovers instances and re-selects by matching projectPath.
 *
 * Compile-time resilience:
 *   During long Unity compilations the main thread is blocked, so the HTTP bridge
 *   can't respond to pings. We use the instance registry file (written at startup,
 *   persists across compiles) as a secondary signal. If a port is unresponsive but
 *   the registry still claims our project is on that port, we keep the selection —
 *   Unity is likely just compiling. We only clear the selection when we have positive
 *   evidence the project is gone (not in registry AND not responding).
 *
 * This MUST be called before the first tool execution after a process restart.
 * @returns {object|null} Validated instance, or null if validation cleared the selection.
 */
export async function validateSelectedInstance() {
  if (!_needsIdentityValidation || !_selectedInstance) {
    _needsIdentityValidation = false;
    return _selectedInstance;
  }

  _needsIdentityValidation = false;
  const saved = _selectedInstance;
  const savedPath = saved.projectPath;
  const savedPort = saved.port;

  debugLog(`Validating persisted selection: ${saved.projectName} expected on port ${savedPort}`);

  // Ping the saved port and check what project is actually there
  const alive = await pingInstance(savedPort);
  if (alive) {
    const info = await getInstanceInfo(savedPort);
    if (info && info.projectPath && info.projectPath === savedPath) {
      debugLog(`Validation OK: port ${savedPort} still hosts ${saved.projectName}`);
      return _selectedInstance;
    }

    if (info && info.projectPath) {
      // PORT SWAP DETECTED: a different project is on the saved port
      debugLog(`⚠ Port swap detected! Port ${savedPort} now hosts "${info.projectName}" (expected "${saved.projectName}")`);
      console.error(
        `[MCP Discovery] Port swap detected: port ${savedPort} now hosts "${info.projectName}" instead of "${saved.projectName}". Re-discovering...`
      );
    }
    // Fall through to re-discovery (swap or info unavailable)
  } else {
    // Port not responding — could be compiling, could be shut down.
    // Check the registry file as a secondary signal before assuming the worst.
    const registryEntries = readRegistryFile();
    const registryMatch = registryEntries.find(
      (entry) =>
        entry.port === savedPort &&
        entry.projectPath &&
        entry.projectPath === savedPath
    );

    if (registryMatch) {
      // Registry still claims our project is on this port.
      // But check for staleness — if Unity crashed, OnDisable never fires and
      // the entry persists forever. The plugin sends a heartbeat every 30s,
      // so if lastSeen is older than the staleness timeout, Unity likely crashed.
      if (isRegistryEntryStale(registryMatch)) {
        debugLog(
          `Port ${savedPort} unresponsive and registry entry is STALE (lastSeen: ${registryMatch.lastSeen}). Unity likely crashed. Proceeding to re-discovery.`
        );
        console.error(
          `[MCP Discovery] Registry entry for "${saved.projectName}" on port ${savedPort} is stale — Unity may have crashed. Re-discovering...`
        );
      } else {
        // Entry is fresh — Unity is very likely just compiling (main thread blocked → HTTP bridge unresponsive).
        // Keep the selection — the bridge will respond once compilation finishes.
        debugLog(
          `Port ${savedPort} unresponsive but registry entry is fresh (lastSeen: ${registryMatch.lastSeen}) — likely compiling. Keeping selection.`
        );
        return _selectedInstance;
      }
    }

    debugLog(`Port ${savedPort} unresponsive and not in registry — re-discovering...`);
  }

  // Re-discover all instances and find the one matching our saved projectPath
  const instances = await discoverInstances();
  const match = instances.find(
    (inst) => inst.projectPath && inst.projectPath === savedPath
  );

  if (match) {
    debugLog(`Re-selected ${saved.projectName} on new port ${match.port} (was ${savedPort})`);
    _selectedInstance = match;
    _instanceSelectionRequired = false;
    persistState("selectedInstance", match);
    persistState("instanceSelectionRequired", false);
    return _selectedInstance;
  }

  // Last resort: check if the registry has our project on ANY port (could be compiling on a new port)
  const registryFallback = readRegistryFile().find(
    (entry) => entry.projectPath && entry.projectPath === savedPath
  );
  if (registryFallback && registryFallback.port) {
    // But check for staleness — a crashed Unity leaves a stale entry forever
    if (isRegistryEntryStale(registryFallback)) {
      debugLog(
        `Project "${saved.projectName}" found in registry on port ${registryFallback.port} but entry is STALE (lastSeen: ${registryFallback.lastSeen}). Unity likely crashed. Clearing selection.`
      );
    } else {
      debugLog(
        `Project "${saved.projectName}" not responding but found in registry on port ${registryFallback.port} (fresh entry) — likely compiling. Keeping selection with updated port.`
      );
      _selectedInstance = { ...saved, port: registryFallback.port };
      persistState("selectedInstance", _selectedInstance);
      return _selectedInstance;
    }
  }

  // Project truly gone — not responding AND not in registry
  debugLog(`Project "${saved.projectName}" no longer found (not in registry, not responding). Clearing selection.`);
  _selectedInstance = null;
  _instanceSelectionRequired = false;
  persistState("selectedInstance", null);
  return null;
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

  // Persist to disk so the selection survives process restarts
  persistState("selectedInstance", match);
  persistState("instanceSelectionRequired", false);
  debugLog(`selectInstance: saved port ${port} (${match.projectName})`);

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
      persistState("selectedInstance", _selectedInstance);
      persistState("instanceSelectionRequired", false);
      debugLog(`autoSelect: single default instance on port ${CONFIG.editorBridgePort}`);
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
    persistState("selectedInstance", _selectedInstance);
    persistState("instanceSelectionRequired", false);
    debugLog(`autoSelect: single instance on port ${_selectedInstance.port}`);
    return {
      autoSelected: true,
      instance: _selectedInstance,
      instances,
      message: `Auto-connected to Unity Editor: ${_selectedInstance.projectName} (port ${_selectedInstance.port})`,
    };
  }

  // Multiple instances — require user selection (but only if none already selected manually)
  if (!_selectedInstance) {
    _instanceSelectionRequired = true;
    persistState("instanceSelectionRequired", true);
    debugLog(`autoSelect: ${instances.length} instances found, selection required`);
  }
  return {
    autoSelected: false,
    instances,
    message: `Found ${instances.length} Unity Editor instances. Please use unity_select_instance to choose which one to work with.`,
  };
}

// ─── Internal helpers ───

/**
 * Check if a registry entry is stale (Unity likely crashed).
 * The plugin updates `lastSeen` every ~30s via a heartbeat. If the entry's
 * lastSeen timestamp is older than the staleness timeout, Unity likely crashed
 * without calling OnDisable (which would have cleaned up the entry).
 *
 * If the entry has no `lastSeen` field (old plugin version), we fall back to
 * `registeredAt`. If neither is present, we treat it as stale (no way to verify).
 *
 * @param {object} entry - A registry entry object.
 * @returns {boolean} True if the entry is considered stale.
 */
function isRegistryEntryStale(entry) {
  const timestamp = entry.lastSeen || entry.registeredAt;
  if (!timestamp) {
    // No timestamp at all — can't verify freshness, assume stale
    return true;
  }

  try {
    const entryTime = new Date(timestamp).getTime();
    if (isNaN(entryTime)) return true; // Unparseable timestamp

    const ageMs = Date.now() - entryTime;
    const isStale = ageMs > CONFIG.registryStalenessTimeoutMs;

    if (isStale) {
      const ageMinutes = Math.round(ageMs / 60000);
      debugLog(`Registry entry staleness check: age=${ageMinutes}min, threshold=${CONFIG.registryStalenessTimeoutMs / 60000}min → STALE`);
    }

    return isStale;
  } catch {
    return true; // Error parsing — assume stale
  }
}

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
