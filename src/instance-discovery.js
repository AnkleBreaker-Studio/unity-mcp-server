// Unity MCP — Multi-Instance Discovery
// Discovers running Unity Editor instances via:
//   1. Shared registry file (%LOCALAPPDATA%/UnityMCP/instances.json)
//   2. Port scanning fallback (7890-7899)
//
// Also manages instance selection state for the current MCP session.

import { readFileSync } from "fs";
import { CONFIG } from "./config.js";
import { debugLog } from "./state-persistence.js";
import { requestFetch, throwIfRequestCancelled } from "./request-cancellation.js";

import { getRequestContext, getCurrentAgentId, getAgentState } from "./request-context.js";

import { agentState } from "./agent-state.js";

function selectionChanged() {
  return Object.assign(new Error("Unity selection changed or was superseded while discovering an editor. Retry with the intended editor's explicit port."), { code: "selection_changed" });
}

function assertSelectionUnchanged(selected) {
  throwIfRequestCancelled();
  if (getSelectedInstance() !== selected || getAgentState(false)?.pendingSelection) throw selectionChanged();
}

export function setPortOverride(port) {
  getRequestContext().portOverride = port;
}

export function clearPortOverride() {
  getRequestContext().portOverride = null;
}

export function setCurrentAgent(agentId) {
  getRequestContext().agentId = agentId || "default";
}

/**
 * Get the currently selected Unity instance for the current agent.
 * @returns {object|null} Selected instance info, or null if none selected.
 */
export function getSelectedInstance() {
  return getAgentState(false)?.selectedInstance || null;
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
  const currentInstance = getAgentState(false)?.selectedInstance;
  if (!currentInstance) {
    return null;
  }

  const saved = currentInstance;
  assertSelectionUnchanged(saved);
  const savedPath = saved.projectPath;
  const savedPort = saved.port;

  // Ping the saved port and check what project is actually there
  const probes = new Map();
  const probe = await probeInstance(savedPort, probes);
  assertSelectionUnchanged(saved);
  const info = probe.info;
  if (info) {
    if (sameProject(info, saved)) {
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
  } else if (probe.status === "unavailable") {
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

  // Find the selected project's current port before considering registry recovery.
  const instances = await discoverInstances(probes);
  assertSelectionUnchanged(saved);
  const match = instances.find(
    (inst) => sameProject(inst, saved)
  );

  if (match) {
    debugLog(`Re-selected ${saved.projectName} on new port ${match.port} (was ${savedPort})`);
    agentState.select(getAgentState(), match);
    getAgentState().selectionRequired = false;
    return match;
  }

  // Last resort: check if the registry has our project on ANY port (could be compiling on a new port)
  const registryFallback = readRegistryFile().find(
    (entry) => entry.projectPath && entry.projectPath === savedPath
  );
  if (registryFallback && registryFallback.port) {
    const fallbackProbe = await probeInstance(registryFallback.port, probes);
    assertSelectionUnchanged(saved);
    const knownConflict = fallbackProbe.status === "unrecognized"
      || (fallbackProbe.info && !sameProject(fallbackProbe.info, saved));
    if (knownConflict) {
      debugLog(`Registry fallback for "${saved.projectName}" conflicts with the live editor identity. Requiring re-selection.`);
    } else if (isRegistryEntryStale(registryFallback)) {
      debugLog(
        `Project "${saved.projectName}" found in registry but entry is STALE. Clearing selection.`
      );
    } else {
      debugLog(
        `Project "${saved.projectName}" found in registry on port ${registryFallback.port} (fresh) — likely compiling. Keeping selection.`
      );
      const updated = { ...saved, port: registryFallback.port };
      agentState.select(getAgentState(), updated);
      return updated;
    }
  }

  // Project truly gone — not responding AND not in registry.
  // FAIL CLOSED: this agent explicitly had a project selected and that project vanished.
  // Clearing the flag to false let the very same tool call fall through to the default port,
  // which in any multi-project session is a DIFFERENT live Unity — so a write intended for
  // project A silently landed in project B and still reported success. Require an explicit
  // re-selection instead.
  debugLog(`Project "${saved.projectName}" no longer found. Clearing selection for agent ${getCurrentAgentId()} and requiring re-selection.`);
  agentState.select(getAgentState(), null);
  getAgentState().selectionRequired = true;
  return null;
}

/**
 * Check whether the session still needs the user to select an instance.
 */
export function isInstanceSelectionRequired() {
  return getAgentState(false)?.selectionRequired ?? agentState.requiresExplicitSelectionForUnknownAgents;
}

/**
 * Mark that instance selection is required (multiple instances found, none selected).
 */
export function setInstanceSelectionRequired(required) {
  getAgentState().selectionRequired = required;
}

/** Select by explicit port or unique case-insensitive name; only the latest attempt may change this agent's selection. */
export async function selectInstance(port, projectName) {
  const agentId = getCurrentAgentId(), state = getAgentState(), attempt = {};
  state.pendingSelection = attempt;
  const assertCurrent = () => {
    throwIfRequestCancelled();
    if (state.pendingSelection !== attempt) throw selectionChanged();
  };
  try {
    const instances = await discoverInstances();
    assertCurrent();
    let match;
    if (port) match = instances.find(inst => inst.port === port);
    else {
      const needle = projectName.toLowerCase();
      const matches = instances.filter(inst => (inst.projectName || "").toLowerCase() === needle);
      if (matches.length === 0) return {
        success: false,
        error: `No running instance named "${projectName}". Available: ${instances.map(inst => inst.projectName).join(", ") || "none"}.`,
      };
      if (matches.length > 1) return {
        success: false,
        error: `${matches.length} instances named "${projectName}" (ports ${matches.map(inst => inst.port).join(", ")}). Select by port instead.`,
      };
      match = matches[0]; port = match.port;
    }

    if (!match) return {
      success: false,
      error: `No Unity instance found on port ${port}. Use unity_list_instances to see available instances.`,
    };

    // Keep the resolved identity through verification; a second scan could silently replace a named project.
    const verified = await probeInstance(port);
    assertCurrent();
    if (!verified.info || !sameProject(verified.info, match)) return {
      success: false,
      error: `Unity instance on port ${port} (${match.projectName}) is unavailable or its identity changed. Discover instances again before selecting it.`,
    };

    agentState.select(state, match);
    state.selectionRequired = false;
    debugLog(`selectInstance: agent ${agentId} selected port ${port} (${match.projectName})`);

    return {
      success: true,
      message: `Selected Unity instance: ${match.projectName} (port ${port})`,
      instance: match,
    };
  } finally {
    if (state.pendingSelection === attempt) state.pendingSelection = null;
  }
}

/**
 * Get the bridge URL for the currently selected instance.
 * Priority: per-request port override > per-agent selection > default CONFIG port.
 * @returns {string} The base URL for HTTP bridge commands.
 */
export function getActiveBridgeUrl() {
  const { bridgeUrl, portOverride } = getRequestContext();
  if (bridgeUrl) return bridgeUrl;
  const host = CONFIG.editorBridgeHost;
  // Per-request override takes highest priority (stateless routing for parallel agents)
  if (portOverride !== null) {
    return `http://${host}:${portOverride}`;
  }
  const selected = getAgentState(false)?.selectedInstance;
  if (selected) {
    return `http://${host}:${selected.port}`;
  }
  return `http://${host}:${CONFIG.editorBridgePort}`;
}


/**
 * Discover all running Unity instances.
 * Reads the shared registry file first, then validates each entry is alive.
 * Falls back to port scanning if the registry is empty/missing.
 *
 * @returns {Array<object>} List of discovered instances with their metadata.
 */
export async function discoverInstances(probes = new Map()) {
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

          // Validation ping doubles as capability capture: the ping body carries
          // protocolVersion/pluginVersion on newer plugins (absent = pre-handshake).
          const { info } = await probeInstance(port, probes);
          if (!info) return null;
          return {
            ...entry,
            projectName: info.projectName || `Unknown (port ${port})`,
            projectPath: info.projectPath || "",
            unityVersion: info.unityVersion,
            isClone: info.isClone,
            cloneIndex: info.cloneIndex,
            isVirtualPlayer: info.isVirtualPlayer,
            mainProjectPath: info.mainProjectPath,
            virtualPlayerId: info.virtualPlayerId,
            protocolVersion: info.protocolVersion,
            pluginVersion: info.pluginVersion,
            alive: true,
            source: "registry",
          };
        })
      );

      instances = validated.filter((inst) => inst !== null);
    }
  } catch (err) {
    throwIfRequestCancelled();
    console.error(`[MCP Discovery] Error reading registry: ${err.message}`);
  }

  // Step 2: Port scan fallback (find instances not in registry)
  const registeredPorts = new Set(instances.map((i) => i.port));

  const scanPromises = [];
  for (let port = CONFIG.portRangeStart; port <= CONFIG.portRangeEnd; port++) {
    if (registeredPorts.has(port)) continue; // Already found via registry

    scanPromises.push(
      (async () => {
        const { info } = await probeInstance(port, probes);
        if (info) {
          return {
            port,
            projectName: info?.projectName || `Unknown (port ${port})`,
            projectPath: info?.projectPath || "",
            unityVersion: info?.unityVersion || "",
            isClone: info?.isClone || false,
            cloneIndex: info?.cloneIndex ?? -1,
            isVirtualPlayer: info?.isVirtualPlayer,
            mainProjectPath: info?.mainProjectPath,
            virtualPlayerId: info?.virtualPlayerId,
            protocolVersion: info?.protocolVersion,
            pluginVersion: info?.pluginVersion,
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
 * Auto-select an instance if exactly one is available and no other registered editor is busy.
 * If multiple are found, or one plus a busy editor, marks selection as required.
 * If none are found, tries the default port.
 * @returns {object} Result with auto-selected instance or selection requirement.
 */
export async function autoSelectInstance() {
  const state = getAgentState();
  if (!state.selectedInstance && state.selectionRequired) return { autoSelected: false, instances: [], selectionRequired: true };
  const selected = getSelectedInstance();
  assertSelectionUnchanged(selected);
  const probes = new Map();
  const instances = await discoverInstances(probes);
  assertSelectionUnchanged(selected);

  if (instances.length === 0) {
    // No instances found — try default port as last resort
    const { info } = await probeInstance(CONFIG.editorBridgePort, probes);
    assertSelectionUnchanged(selected);
    if (info) {
      const defaultInstance = {
        port: CONFIG.editorBridgePort,
        projectName: info?.projectName || "Unity Editor",
        projectPath: info?.projectPath || "",
        unityVersion: info?.unityVersion || "",
        isClone: info.isClone,
        cloneIndex: info.cloneIndex,
        isVirtualPlayer: info.isVirtualPlayer,
        mainProjectPath: info.mainProjectPath,
        virtualPlayerId: info.virtualPlayerId,
        protocolVersion: info?.protocolVersion,
        pluginVersion: info?.pluginVersion,
        alive: true,
        source: "default",
      };
      agentState.select(state, defaultInstance);
      getAgentState().selectionRequired = false;
      debugLog(`autoSelect: agent ${getCurrentAgentId()} → single default instance on port ${CONFIG.editorBridgePort}`);
      return {
        autoSelected: true,
        instance: defaultInstance,
        instances: [defaultInstance],
        message: `Auto-connected to Unity Editor: ${defaultInstance.projectName} (port ${CONFIG.editorBridgePort})`,
      };
    }

    getAgentState().selectionRequired = false;
    return {
      autoSelected: false,
      instances: [],
      message: "No Unity Editor instances found. Make sure Unity is running with the MCP plugin enabled.",
    };
  }

  // A fresh registry entry that did not answer is likely another editor that is compiling, reloading or busy.
  const busyInstances = await findBusyRegistryEntries(instances, probes);
  assertSelectionUnchanged(selected);

  if (instances.length === 1 && busyInstances.length === 0) {
    // Exactly one instance — auto-select it
    agentState.select(state, instances[0]);
    getAgentState().selectionRequired = false;
    debugLog(`autoSelect: agent ${getCurrentAgentId()} → single instance on port ${instances[0].port}`);
    return {
      autoSelected: true,
      instance: instances[0],
      instances,
      message: `Auto-connected to Unity Editor: ${instances[0].projectName} (port ${instances[0].port})`,
    };
  }

  // Multiple instances, or one plus a busy editor — require user selection (but only if none already selected for this agent)
  const agentSelected = getAgentState(false)?.selectedInstance;
  if (!agentSelected) {
    getAgentState().selectionRequired = true;
    debugLog(`autoSelect: agent ${getCurrentAgentId()} → ${instances.length} instances found, ${busyInstances.length} busy, selection required`);
  }
  const busyNote = busyInstances.length > 0
    ? ` and ${busyInstances.length} registered editor(s) that are busy or compiling`
    : "";
  return {
    autoSelected: false,
    instances,
    busyInstances,
    message: `Found ${instances.length} Unity Editor instance(s)${busyNote}. Please use unity_select_instance to choose which one to work with.`,
  };
}

// ─── Internal helpers ───

/**
 * Registry entries for editors that did not answer this discovery attempt's ping but are still fresh.
 * Same project on a new port, stale entries and unrelated services are not counted.
 * They are listed for the user but stay unselectable until a ping verifies them.
 * @param {Array<object>} instances - Responsive instances from the same attempt.
 * @param {Map} probes - That attempt's probes, reused so no port is pinged twice.
 * @returns {Promise<Array<object>>} Busy registry entries.
 */
async function findBusyRegistryEntries(instances, probes) {
  const candidates = readRegistryFile().filter((entry) =>
    entry.port &&
    !instances.some((inst) => inst.port === entry.port || (entry.projectPath && inst.projectPath === entry.projectPath)) &&
    !isRegistryEntryStale(entry)
  );
  const probed = await Promise.all(candidates.map((entry) => probeInstance(entry.port, probes)));
  return candidates.filter((entry, index) => probed[index].status === "unavailable");
}

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
    // Older Unity plugins write a UTF-8 marker; JSON.parse rejects it before any registry entry can be read.
    const data = JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw);
    if (Array.isArray(data)) return data;
    return [];
  } catch {
    // File doesn't exist or can't be parsed — that's fine
    return [];
  }
}

function identityText(value) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function bridgeIdentity(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if ((data.status !== undefined && data.status !== "ok") || data.success === false || data.error) return null;
  const projectName = identityText(data.projectName) || identityText(data.project);
  const projectPath = identityText(data.projectPath);
  const unityVersion = identityText(data.unityVersion) || identityText(data.version);
  // Original plugins provide project identity and Unity version, without protocol or plugin-version fields.
  if (!unityVersion || (!projectName && !projectPath)) return null;
  return {
    projectName,
    projectPath,
    unityVersion,
    isClone: data.isClone === true,
    cloneIndex: Number.isInteger(data.cloneIndex) ? data.cloneIndex : -1,
    isVirtualPlayer: typeof data.isVirtualPlayer === "boolean" ? data.isVirtualPlayer : undefined,
    mainProjectPath: identityText(data.mainProjectPath) ?? undefined,
    virtualPlayerId: identityText(data.virtualPlayerId) ?? undefined,
    protocolVersion: Number.isInteger(data.protocolVersion) ? data.protocolVersion : undefined,
    pluginVersion: identityText(data.pluginVersion) ?? undefined,
  };
}

function sameProject(info, selected) {
  if (info.projectPath && selected.projectPath) return info.projectPath === selected.projectPath;
  return !!info.projectName && info.projectName === selected.projectName;
}

function probeInstance(port, probes = new Map()) {
  // Reuse observations within one discovery attempt; later calls probe again.
  if (probes.has(port)) return probes.get(port);
  const pending = (async () => {
    let response;
    try {
      const url = `http://${CONFIG.editorBridgeHost}:${port}/api/ping`;
      response = await requestFetch(url, { method: "GET" }, 2000);
    } catch {
      throwIfRequestCancelled();
      return { status: "unavailable", info: null };
    }
    if (!response.ok) return { status: "unavailable", info: null };
    let info;
    try { info = bridgeIdentity(JSON.parse(response.text)); } catch { info = null; }
    // An unrelated successful response must not gain an editor identity from an old registry entry.
    return { status: info ? "bridge" : "unrecognized", info };
  })();
  probes.set(port, pending);
  return pending;
}
