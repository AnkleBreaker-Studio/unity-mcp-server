// Unity MCP — Multi-Instance Discovery
// Discovers running Unity Editor instances via:
//   1. Shared registry file (%LOCALAPPDATA%/UnityMCP/instances.json)
//   2. Port scanning fallback (7890-7899)
//
// Also manages instance selection state for the current MCP session.

import { readFileSync } from "fs";
import { CONFIG } from "./config.js";
import { debugLog, persistState, loadState } from "./state-persistence.js";

// ─── Per-Agent Session State ───
// Tracks which Unity instance each agent is targeting.
// State is stored in Maps keyed by agent ID because a SINGLE MCP process serves
// ALL agents/tasks in the same Claude Desktop session. Without per-agent state,
// Agent A selecting ProjectA would cause Agent B's commands to also route to
// ProjectA — the classic "cross-agent contamination" bug.
//
// The MCP stdio transport processes requests sequentially (no concurrency),
// so we use a "set current agent before handler" pattern: index.js calls
// setCurrentAgent(agentId) before each tool handler, and all state functions
// read/write from the Map entry for _currentAgentId.
const _agentInstances = new Map();          // agentId → { port, projectName, projectPath, ... }
const _agentSelectionRequired = new Map();  // agentId → boolean
let _currentAgentId = "default";

// ─── Per-Request Port Override ───
// When multiple agents share a single MCP process (e.g. parallel Cowork tasks),
// the per-agent state above can get overwritten between sequential requests.
// The port override provides a stateless routing mechanism: each tool call can
// include a `port` parameter, and ALL HTTP requests during that handler execution
// will be routed to that port — bypassing the shared agent state entirely.
// This is safe because stdio transport is sequential (one request at a time).
let _portOverride = null;

/**
 * Set a per-request port override. All bridge URL lookups will use this port
 * until clearPortOverride() is called. Must be called before the tool handler
 * and cleared in a finally block after it completes.
 * @param {number} port - The port to route to for this request.
 */
export function setPortOverride(port) {
  _portOverride = port;
  debugLog(`setPortOverride: routing to port ${port} for this request`);
}

/**
 * Clear the per-request port override. Must be called after tool handler completes.
 */
export function clearPortOverride() {
  if (_portOverride !== null) {
    debugLog(`clearPortOverride: cleared (was ${_portOverride})`);
    _portOverride = null;
  }
}

/**
 * Set the current agent context for subsequent state operations.
 * Must be called before any tool handler execution.
 * @param {string} agentId - The agent ID for the current request.
 */
export function setCurrentAgent(agentId) {
  _currentAgentId = agentId || "default";
}

/**
 * Get the currently selected Unity instance for the current agent.
 * @returns {object|null} Selected instance info, or null if none selected.
 */
export function getSelectedInstance() {
  return _agentInstances.get(_currentAgentId) || null;
}

/**
 * Validate that the currently selected instance is still alive and hosts the expected project.
 * Called on first tool execution to catch cases where Unity was closed or port changed.
 *
 * Compile-time resilience:
 *   During long Unity compilations the main thread is blocked, so the HTTP bridge
 *   can't respond to pings. We use the instance registry file (written at startup,
 *   persists across compiles) as a secondary signal. If a port is unresponsive but
 *   the registry still claims our project is on that port, we keep the selection —
 *   Unity is likely just compiling. We only clear the selection when we have positive
 *   evidence the project is gone (not in registry AND not responding).
 *
 * @returns {object|null} Validated instance, or null if validation cleared the selection.
 */
export async function validateSelectedInstance() {
  const currentInstance = _agentInstances.get(_currentAgentId);
  if (!currentInstance) {
    return null;
  }

  const saved = currentInstance;
  const savedPath = saved.projectPath;
  const savedPort = saved.port;

  // Ping the saved port and check what project is actually there
  const alive = await pingInstance(savedPort);
  if (alive) {
    const info = await getInstanceInfo(savedPort);
    if (info && info.projectPath && info.projectPath === savedPath) {
      return currentInstance;
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
      if (isRegistryEntryStale(registryMatch)) {
        debugLog(
          `Port ${savedPort} unresponsive and registry entry is STALE (lastSeen: ${registryMatch.lastSeen}). Unity likely crashed. Proceeding to re-discovery.`
        );
      } else {
        // Entry is fresh — Unity is very likely just compiling
        debugLog(
          `Port ${savedPort} unresponsive but registry entry is fresh — likely compiling. Keeping selection.`
        );
        return currentInstance;
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
    _agentInstances.set(_currentAgentId, match);
    _agentSelectionRequired.set(_currentAgentId, false);
    return match;
  }

  // Last resort: check if the registry has our project on ANY port (could be compiling on a new port)
  const registryFallback = readRegistryFile().find(
    (entry) => entry.projectPath && entry.projectPath === savedPath
  );
  if (registryFallback && registryFallback.port) {
    if (isRegistryEntryStale(registryFallback)) {
      debugLog(
        `Project "${saved.projectName}" found in registry but entry is STALE. Clearing selection.`
      );
    } else {
      debugLog(
        `Project "${saved.projectName}" found in registry on port ${registryFallback.port} (fresh) — likely compiling. Keeping selection.`
      );
      const updated = { ...saved, port: registryFallback.port };
      _agentInstances.set(_currentAgentId, updated);
      return updated;
    }
  }

  // Project truly gone — not responding AND not in registry
  debugLog(`Project "${saved.projectName}" no longer found. Clearing selection for agent ${_currentAgentId}.`);
  _agentInstances.delete(_currentAgentId);
  _agentSelectionRequired.set(_currentAgentId, false);
  return null;
}

/**
 * Check whether the session still needs the user to select an instance.
 */
export function isInstanceSelectionRequired() {
  return _agentSelectionRequired.get(_currentAgentId) || false;
}

/**
 * Mark that instance selection is required (multiple instances found, none selected).
 */
export function setInstanceSelectionRequired(required) {
  _agentSelectionRequired.set(_currentAgentId, required);
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

  _agentInstances.set(_currentAgentId, match);
  _agentSelectionRequired.set(_currentAgentId, false);

  // Persist to disk so selection survives MCP process restarts.
  // Uses projectPath as the stable key (ports can change, paths don't).
  persistState('selectedInstance', {
    port: match.port,
    projectName: match.projectName,
    projectPath: match.projectPath,
    unityVersion: match.unityVersion,
    isClone: match.isClone,
    cloneIndex: match.cloneIndex,
  });

  debugLog(`selectInstance: agent ${_currentAgentId} selected port ${port} (${match.projectName}) — persisted to disk`);

  return {
    success: true,
    message: `Selected Unity instance: ${match.projectName} (port ${port})`,
    instance: match,
  };
}

/**
 * Get the bridge URL for the currently selected instance.
 * Priority: per-request port override > per-agent selection > default CONFIG port.
 * @returns {string} The base URL for HTTP bridge commands.
 */
export function getActiveBridgeUrl() {
  const host = CONFIG.editorBridgeHost;
  // Per-request override takes highest priority (stateless routing for parallel agents)
  if (_portOverride !== null) {
    return `http://${host}:${_portOverride}`;
  }
  const selected = _agentInstances.get(_currentAgentId);
  if (selected) {
    return `http://${host}:${selected.port}`;
  }
  return `http://${host}:${CONFIG.editorBridgePort}`;
}

/**
 * Get the port of the currently selected instance, or the default.
 * Priority: per-request port override > per-agent selection > default CONFIG port.
 */
export function getActivePort() {
  if (_portOverride !== null) {
    return _portOverride;
  }
  const selected = _agentInstances.get(_currentAgentId);
  if (selected) {
    return selected.port;
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
      const defaultInstance = {
        port: CONFIG.editorBridgePort,
        projectName: info?.projectName || "Unity Editor",
        projectPath: info?.projectPath || "",
        unityVersion: info?.unityVersion || "",
        isClone: false,
        cloneIndex: -1,
        alive: true,
        source: "default",
      };
      _agentInstances.set(_currentAgentId, defaultInstance);
      _agentSelectionRequired.set(_currentAgentId, false);
      debugLog(`autoSelect: agent ${_currentAgentId} → single default instance on port ${CONFIG.editorBridgePort}`);
      return {
        autoSelected: true,
        instance: defaultInstance,
        instances: [defaultInstance],
        message: `Auto-connected to Unity Editor: ${defaultInstance.projectName} (port ${CONFIG.editorBridgePort})`,
      };
    }

    _agentSelectionRequired.set(_currentAgentId, false);
    return {
      autoSelected: false,
      instances: [],
      message: "No Unity Editor instances found. Make sure Unity is running with the MCP plugin enabled.",
    };
  }

  if (instances.length === 1) {
    // Exactly one instance — auto-select it
    _agentInstances.set(_currentAgentId, instances[0]);
    _agentSelectionRequired.set(_currentAgentId, false);
    debugLog(`autoSelect: agent ${_currentAgentId} → single instance on port ${instances[0].port}`);
    return {
      autoSelected: true,
      instance: instances[0],
      instances,
      message: `Auto-connected to Unity Editor: ${instances[0].projectName} (port ${instances[0].port})`,
    };
  }

  // Multiple instances — check in-memory selection first, then persisted selection
  let agentSelected = _agentInstances.get(_currentAgentId);

  // If no in-memory selection (e.g. process restarted), try to restore from disk
  if (!agentSelected) {
    const persisted = loadState('selectedInstance');
    if (persisted && persisted.projectPath) {
      // Match by projectPath (stable) — port may have changed since last session
      const match = instances.find(
        (inst) => inst.projectPath && inst.projectPath === persisted.projectPath
      );
      if (match) {
        _agentInstances.set(_currentAgentId, match);
        _agentSelectionRequired.set(_currentAgentId, false);
        agentSelected = match;

        // Update persisted port if it changed
        if (match.port !== persisted.port) {
          persistState('selectedInstance', {
            port: match.port,
            projectName: match.projectName,
            projectPath: match.projectPath,
            unityVersion: match.unityVersion,
            isClone: match.isClone,
            cloneIndex: match.cloneIndex,
          });
        }

        debugLog(`autoSelect: agent ${_currentAgentId} → restored persisted selection: ${match.projectName} (port ${match.port})`);
        return {
          autoSelected: true,
          instance: match,
          instances,
          message: `Restored previous selection: ${match.projectName} (port ${match.port})`,
        };
      } else {
        debugLog(`autoSelect: persisted project "${persisted.projectName}" not found among running instances — ignoring`);
      }
    }
  }

  if (!agentSelected) {
    _agentSelectionRequired.set(_currentAgentId, true);
    debugLog(`autoSelect: agent ${_currentAgentId} → ${instances.length} instances found, selection required`);
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
