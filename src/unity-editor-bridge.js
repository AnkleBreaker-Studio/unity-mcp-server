// Unity Editor HTTP Bridge Client
// Communicates with the C# plugin running inside Unity Editor
// Supports both queue mode (async ticket-based) and legacy sync mode
import { CONFIG } from "./config.js";

const BRIDGE_URL = `http://${CONFIG.editorBridgeHost}:${CONFIG.editorBridgePort}`;

// Agent identity — tracks which AI agent is making requests
let _currentAgentId = "default";

// Mode detection — cached to avoid repeated 404 checks
let _useQueueMode = true;
let _queueModeDetermined = false;

/**
 * Set the current agent ID. All subsequent sendCommand calls include this as X-Agent-Id header.
 */
export function setAgentId(agentId) {
  _currentAgentId = agentId || "default";
}

// Retry settings — handles Unity domain reloads (1-3 sec server downtime)
const MAX_RETRIES = 4;
const RETRY_BASE_DELAY_MS = 800; // 800ms, 1600ms, 3200ms, 6400ms

/**
 * Sleep helper for retry backoff
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Returns true if the error looks like a transient connection issue
 * (server temporarily down during Unity domain reload).
 */
function isTransientError(error, response) {
  if (error) {
    // Connection refused / reset / aborted — server is restarting
    const msg = error.message || "";
    return (
      error.code === "ECONNREFUSED" ||
      error.code === "ECONNRESET" ||
      msg.includes("ECONNREFUSED") ||
      msg.includes("ECONNRESET") ||
      msg.includes("fetch failed") ||
      error.name === "AbortError"
    );
  }
  // HTTP 500/503 during domain reload (server half-alive)
  if (response && (response.status === 503 || response.status === 500)) {
    return true;
  }
  return false;
}

/**
 * Submit a command to the queue and get a ticket ID.
 * POST /api/queue/submit with {apiPath, method, body, agentId}
 */
async function submitToQueue(apiPath, bodyString) {
  const url = `${BRIDGE_URL}/api/queue/submit`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Agent-Id": _currentAgentId,
    },
    body: JSON.stringify({
      apiPath,
      method: "POST",
      body: bodyString,
      agentId: _currentAgentId,
    }),
    signal: AbortSignal.timeout(CONFIG.editorBridgeTimeout),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  const data = await response.json();
  return data; // { ticketId, queuePosition, ... }
}

/**
 * Poll the queue status for a ticket until completion.
 * GET /api/queue/status?ticketId=X
 */
async function pollQueueStatus(ticketId) {
  let pollIntervalMs = CONFIG.queuePollIntervalMs;
  const maxIntervalMs = Math.min(1000, CONFIG.queuePollMaxMs);
  const startTime = Date.now();
  const timeoutMs = CONFIG.editorBridgeTimeout;

  while (true) {
    // Check timeout
    if (Date.now() - startTime > timeoutMs) {
      return {
        success: false,
        error: `Queue polling timed out after ${timeoutMs}ms for ticket ${ticketId}`,
      };
    }

    // Poll status
    try {
      const url = `${BRIDGE_URL}/api/queue/status?ticketId=${ticketId}`;
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "X-Agent-Id": _currentAgentId,
        },
        signal: AbortSignal.timeout(CONFIG.editorBridgeTimeout),
      });

      if (!response.ok) {
        const text = await response.text();
        return {
          success: false,
          error: `Failed to poll queue status: HTTP ${response.status}: ${text}`,
        };
      }

      const statusData = await response.json();

      // Check completion status
      if (statusData.status === "Completed") {
        // Extract result — use explicit undefined check so falsy values (null, 0, false, "") pass through
        return {
          success: true,
          data: statusData.result !== undefined ? statusData.result : statusData,
        };
      } else if (statusData.status === "Failed") {
        return {
          success: false,
          error: statusData.error || "Queue processing failed",
        };
      }

      // Still processing — wait before polling again
      await sleep(pollIntervalMs);

      // Increase poll interval up to max
      pollIntervalMs = Math.min(
        Math.ceil(pollIntervalMs * 1.5),
        maxIntervalMs
      );
    } catch (error) {
      return {
        success: false,
        error: `Error polling queue: ${error.message}`,
      };
    }
  }
}

/**
 * Send command via legacy sync mode (direct POST).
 * Falls back to the original implementation.
 */
async function sendCommandLegacyMode(command, params = {}) {
  const url = `${BRIDGE_URL}/api/${command}`;
  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.editorBridgeTimeout);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Agent-Id": _currentAgentId,
        },
        body: JSON.stringify(params),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      // Transient server error — retry
      if (isTransientError(null, response) && attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        console.error(
          `[MCP Bridge] HTTP ${response.status} on ${command}, retrying in ${delay}ms (${attempt + 1}/${MAX_RETRIES})...`
        );
        await sleep(delay);
        continue;
      }

      if (!response.ok) {
        const text = await response.text();
        return { success: false, error: `HTTP ${response.status}: ${text}` };
      }

      const data = await response.json();

      // If we retried, log that we recovered
      if (attempt > 0) {
        console.error(
          `[MCP Bridge] Recovered after ${attempt} retries for ${command}`
        );
      }

      return { success: true, data };
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;

      // Transient connection error — retry with backoff
      if (isTransientError(error, null) && attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        console.error(
          `[MCP Bridge] ${error.code || error.name || "Error"} on ${command}, retrying in ${delay}ms (${attempt + 1}/${MAX_RETRIES})...`
        );
        await sleep(delay);
        continue;
      }
    }
  }

  // All retries exhausted
  if (lastError?.name === "AbortError") {
    return {
      success: false,
      error:
        "Request timed out after retries. Unity Editor may be in a long domain reload or not running.",
    };
  }
  return {
    success: false,
    error: `Connection failed after ${MAX_RETRIES} retries: ${lastError?.message}. Unity Editor may be reloading or not running.`,
  };
}

/**
 * Send a command to the Unity Editor bridge.
 * Tries queue mode first (async ticket-based), falls back to legacy sync mode if 404.
 * Automatically retries on transient failures (e.g. Unity domain reload)
 * with exponential backoff so multi-agent workflows stay resilient.
 */
export async function sendCommand(command, params = {}) {
  const bodyString = JSON.stringify(params);

  // If we've determined the plugin doesn't support queue mode, use legacy
  if (_queueModeDetermined && !_useQueueMode) {
    return sendCommandLegacyMode(command, params);
  }

  // Try queue mode (if not yet determined it's unavailable)
  if (!_queueModeDetermined || _useQueueMode) {
    try {
      // Submit to queue with retry logic
      let submitLastError = null;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const ticketData = await submitToQueue(command, bodyString);
          const ticketId = ticketData.ticketId;

          console.debug(`[MCP Bridge] Submitted ${command} to queue, ticket: ${ticketId}`);

          // Poll for completion
          const result = await pollQueueStatus(ticketId);

          // Queue submission succeeded (we got a ticket), so queue mode is confirmed
          _queueModeDetermined = true;
          _useQueueMode = true;
          return result;
        } catch (submitError) {
          submitLastError = submitError;

          // Check if it's a transient error worth retrying
          if (isTransientError(submitError, null) && attempt < MAX_RETRIES) {
            const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
            console.error(
              `[MCP Bridge] Error submitting to queue: ${submitError.message}, retrying in ${delay}ms (${attempt + 1}/${MAX_RETRIES})...`
            );
            await sleep(delay);
            continue;
          }

          // Check if it's a 404 (queue not supported) — match "HTTP 404" or raw status code
          if (submitError.status === 404 || (submitError.message && /HTTP\s*404/.test(submitError.message))) {
            console.warn(
              `[MCP Bridge] Queue mode not supported (HTTP 404), falling back to legacy sync mode`
            );
            _queueModeDetermined = true;
            _useQueueMode = false;
            return sendCommandLegacyMode(command, params);
          }

          // Other errors — don't retry, mark mode as undetermined and try legacy
          break;
        }
      }

      // If we get here, queue submit failed after retries
      if (submitLastError) {
        console.warn(
          `[MCP Bridge] Queue mode failed after retries, falling back to legacy sync mode: ${submitLastError.message}`
        );
        _queueModeDetermined = true;
        _useQueueMode = false;
        return sendCommandLegacyMode(command, params);
      }
    } catch (error) {
      console.warn(
        `[MCP Bridge] Unexpected error in queue mode, falling back to legacy: ${error.message}`
      );
      _queueModeDetermined = true;
      _useQueueMode = false;
      return sendCommandLegacyMode(command, params);
    }
  }

  // Fallback (should not reach here, but just in case)
  return sendCommandLegacyMode(command, params);
}

/**
 * Get queue information and stats.
 * GET /api/queue/info
 */
export async function getQueueInfo() {
  try {
    const url = `${BRIDGE_URL}/api/queue/info`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-Agent-Id": _currentAgentId,
      },
      signal: AbortSignal.timeout(CONFIG.editorBridgeTimeout),
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: `HTTP ${response.status}: ${text}` };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: `Failed to get queue info: ${error.message}`,
    };
  }
}

/**
 * Get status of a specific queue ticket.
 * GET /api/queue/status?ticketId=X
 */
export async function getTicketStatus(ticketId) {
  try {
    const url = `${BRIDGE_URL}/api/queue/status?ticketId=${ticketId}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-Agent-Id": _currentAgentId,
      },
      signal: AbortSignal.timeout(CONFIG.editorBridgeTimeout),
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: `HTTP ${response.status}: ${text}` };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: `Failed to get ticket status: ${error.message}`,
    };
  }
}

/**
 * Check if the Unity Editor bridge is reachable
 */
export async function ping() {
  try {
    const response = await fetch(`${BRIDGE_URL}/api/ping`, {
      method: "GET",
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok) {
      const data = await response.json();
      return { connected: true, ...data };
    }
    return { connected: false, error: `HTTP ${response.status}` };
  } catch {
    return { connected: false, error: "Unity Editor bridge not reachable" };
  }
}

// ─── Convenience wrappers for common Editor operations ───

export async function getSceneInfo() {
  return sendCommand("scene/info");
}

export async function openScene(scenePath) {
  return sendCommand("scene/open", { path: scenePath });
}

export async function saveScene() {
  return sendCommand("scene/save");
}

export async function newScene() {
  return sendCommand("scene/new");
}

export async function getHierarchy() {
  return sendCommand("scene/hierarchy");
}

export async function createGameObject(params) {
  return sendCommand("gameobject/create", params);
}

export async function deleteGameObject(params) {
  return sendCommand("gameobject/delete", params);
}

export async function getGameObjectInfo(params) {
  return sendCommand("gameobject/info", params);
}

export async function setTransform(params) {
  return sendCommand("gameobject/set-transform", params);
}

export async function addComponent(params) {
  return sendCommand("component/add", params);
}

export async function removeComponent(params) {
  return sendCommand("component/remove", params);
}

export async function setComponentProperty(params) {
  return sendCommand("component/set-property", params);
}

export async function getComponentProperties(params) {
  return sendCommand("component/get-properties", params);
}

export async function executeMenuItem(menuPath) {
  return sendCommand("editor/execute-menu-item", { menuPath });
}

export async function getProjectInfo() {
  return sendCommand("project/info");
}

export async function getAssetList(params) {
  return sendCommand("asset/list", params);
}

export async function importAsset(params) {
  return sendCommand("asset/import", params);
}

export async function deleteAsset(params) {
  return sendCommand("asset/delete", params);
}

export async function createScript(params) {
  return sendCommand("script/create", params);
}

export async function readScript(params) {
  return sendCommand("script/read", params);
}

export async function updateScript(params) {
  return sendCommand("script/update", params);
}

export async function buildProject(params) {
  return sendCommand("build/start", params);
}

export async function getConsoleLog(params) {
  return sendCommand("console/log", params);
}

export async function clearConsoleLog() {
  return sendCommand("console/clear");
}

export async function playMode(action) {
  return sendCommand("editor/play-mode", { action }); // "play", "pause", "stop"
}

export async function getEditorState() {
  return sendCommand("editor/state");
}

export async function executeCode(code) {
  return sendCommand("editor/execute-code", { code });
}

export async function createPrefab(params) {
  return sendCommand("asset/create-prefab", params);
}

export async function instantiatePrefab(params) {
  return sendCommand("asset/instantiate-prefab", params);
}

export async function setMaterial(params) {
  return sendCommand("renderer/set-material", params);
}

export async function createMaterial(params) {
  return sendCommand("asset/create-material", params);
}

// ─── Animation ───

export async function createAnimatorController(params) {
  return sendCommand("animation/create-controller", params);
}

export async function getAnimatorControllerInfo(params) {
  return sendCommand("animation/controller-info", params);
}

export async function addAnimationParameter(params) {
  return sendCommand("animation/add-parameter", params);
}

export async function removeAnimationParameter(params) {
  return sendCommand("animation/remove-parameter", params);
}

export async function addAnimationState(params) {
  return sendCommand("animation/add-state", params);
}

export async function removeAnimationState(params) {
  return sendCommand("animation/remove-state", params);
}

export async function addAnimationTransition(params) {
  return sendCommand("animation/add-transition", params);
}

export async function createAnimationClip(params) {
  return sendCommand("animation/create-clip", params);
}

export async function getAnimationClipInfo(params) {
  return sendCommand("animation/clip-info", params);
}

export async function setAnimationClipCurve(params) {
  return sendCommand("animation/set-clip-curve", params);
}

export async function addAnimationLayer(params) {
  return sendCommand("animation/add-layer", params);
}

export async function assignAnimatorController(params) {
  return sendCommand("animation/assign-controller", params);
}

export async function getCurveKeyframes(params) {
  return sendCommand("animation/get-curve-keyframes", params);
}

export async function removeCurve(params) {
  return sendCommand("animation/remove-curve", params);
}

export async function addKeyframe(params) {
  return sendCommand("animation/add-keyframe", params);
}

export async function removeKeyframe(params) {
  return sendCommand("animation/remove-keyframe", params);
}

export async function addAnimationEvent(params) {
  return sendCommand("animation/add-event", params);
}

export async function removeAnimationEvent(params) {
  return sendCommand("animation/remove-event", params);
}

export async function getAnimationEvents(params) {
  return sendCommand("animation/get-events", params);
}

export async function setClipSettings(params) {
  return sendCommand("animation/set-clip-settings", params);
}

export async function removeAnimationTransition(params) {
  return sendCommand("animation/remove-transition", params);
}

export async function removeAnimationLayer(params) {
  return sendCommand("animation/remove-layer", params);
}

export async function createBlendTree(params) {
  return sendCommand("animation/create-blend-tree", params);
}

export async function getBlendTreeInfo(params) {
  return sendCommand("animation/get-blend-tree", params);
}

// ─── Prefab (Advanced) ───

export async function getPrefabInfo(params) {
  return sendCommand("prefab/info", params);
}

export async function createPrefabVariant(params) {
  return sendCommand("prefab/create-variant", params);
}

export async function applyPrefabOverrides(params) {
  return sendCommand("prefab/apply-overrides", params);
}

export async function revertPrefabOverrides(params) {
  return sendCommand("prefab/revert-overrides", params);
}

export async function unpackPrefab(params) {
  return sendCommand("prefab/unpack", params);
}

export async function setObjectReference(params) {
  return sendCommand("prefab/set-object-reference", params);
}

export async function duplicateGameObject(params) {
  return sendCommand("prefab/duplicate", params);
}

export async function setGameObjectActive(params) {
  return sendCommand("prefab/set-active", params);
}

export async function reparentGameObject(params) {
  return sendCommand("prefab/reparent", params);
}

// ─── Physics ───

export async function physicsRaycast(params) {
  return sendCommand("physics/raycast", params);
}

export async function physicsOverlapSphere(params) {
  return sendCommand("physics/overlap-sphere", params);
}

export async function physicsOverlapBox(params) {
  return sendCommand("physics/overlap-box", params);
}

export async function getCollisionMatrix(params) {
  return sendCommand("physics/collision-matrix", params);
}

export async function setCollisionLayer(params) {
  return sendCommand("physics/set-collision-layer", params);
}

export async function setGravity(params) {
  return sendCommand("physics/set-gravity", params);
}

// ─── Lighting ───

export async function getLightingInfo(params) {
  return sendCommand("lighting/info", params);
}

export async function createLight(params) {
  return sendCommand("lighting/create", params);
}

export async function setEnvironment(params) {
  return sendCommand("lighting/set-environment", params);
}

export async function createReflectionProbe(params) {
  return sendCommand("lighting/create-reflection-probe", params);
}

export async function createLightProbeGroup(params) {
  return sendCommand("lighting/create-light-probe-group", params);
}

// ─── Audio ───

export async function getAudioInfo(params) {
  return sendCommand("audio/info", params);
}

export async function createAudioSource(params) {
  return sendCommand("audio/create-source", params);
}

export async function setGlobalAudio(params) {
  return sendCommand("audio/set-global", params);
}

// ─── Tags & Layers ───

export async function getTagsAndLayers(params) {
  return sendCommand("taglayer/info", params);
}

export async function addTag(params) {
  return sendCommand("taglayer/add-tag", params);
}

export async function setTag(params) {
  return sendCommand("taglayer/set-tag", params);
}

export async function setLayer(params) {
  return sendCommand("taglayer/set-layer", params);
}

export async function setStatic(params) {
  return sendCommand("taglayer/set-static", params);
}

// ─── Selection & Scene View ───

export async function getSelection(params) {
  return sendCommand("selection/get", params);
}

export async function setSelection(params) {
  return sendCommand("selection/set", params);
}

export async function focusSceneView(params) {
  return sendCommand("selection/focus-scene-view", params);
}

export async function findObjectsByType(params) {
  return sendCommand("selection/find-by-type", params);
}

// ─── Input Actions ───

export async function createInputActions(params) {
  return sendCommand("input/create", params);
}

export async function getInputActionsInfo(params) {
  return sendCommand("input/info", params);
}

export async function addInputActionMap(params) {
  return sendCommand("input/add-map", params);
}

export async function removeInputActionMap(params) {
  return sendCommand("input/remove-map", params);
}

export async function addInputAction(params) {
  return sendCommand("input/add-action", params);
}

export async function removeInputAction(params) {
  return sendCommand("input/remove-action", params);
}

export async function addInputBinding(params) {
  return sendCommand("input/add-binding", params);
}

export async function addInputCompositeBinding(params) {
  return sendCommand("input/add-composite-binding", params);
}

// ─── Assembly Definitions ───

export async function createAssemblyDef(params) {
  return sendCommand("asmdef/create", params);
}

export async function getAssemblyDefInfo(params) {
  return sendCommand("asmdef/info", params);
}

export async function listAssemblyDefs(params) {
  return sendCommand("asmdef/list", params);
}

export async function addAssemblyDefReferences(params) {
  return sendCommand("asmdef/add-references", params);
}

export async function removeAssemblyDefReferences(params) {
  return sendCommand("asmdef/remove-references", params);
}

export async function setAssemblyDefPlatforms(params) {
  return sendCommand("asmdef/set-platforms", params);
}

export async function updateAssemblyDefSettings(params) {
  return sendCommand("asmdef/update-settings", params);
}

export async function createAssemblyRef(params) {
  return sendCommand("asmdef/create-ref", params);
}

// ─── Profiler ───

export async function enableProfiler(params) {
  return sendCommand("profiler/enable", params);
}

export async function getRenderingStats(params) {
  return sendCommand("profiler/stats", params);
}

export async function getMemoryInfo(params) {
  return sendCommand("profiler/memory", params);
}

export async function getProfilerFrameData(params) {
  return sendCommand("profiler/frame-data", params);
}

export async function analyzePerformance(params) {
  return sendCommand("profiler/analyze", params);
}

// ─── Frame Debugger ───

export async function enableFrameDebugger(params) {
  return sendCommand("debugger/enable", params);
}

export async function getFrameDebuggerEvents(params) {
  return sendCommand("debugger/events", params);
}

export async function getFrameDebuggerEventDetails(params) {
  return sendCommand("debugger/event-details", params);
}

// ─── Memory Profiler ───

export async function getMemoryStatus(params) {
  return sendCommand("profiler/memory-status", params);
}

export async function getMemoryBreakdown(params) {
  return sendCommand("profiler/memory-breakdown", params);
}

export async function getTopMemoryConsumers(params) {
  return sendCommand("profiler/memory-top-assets", params);
}

export async function takeMemorySnapshot(params) {
  return sendCommand("profiler/memory-snapshot", params);
}

// ─── Shader Graph ───

export async function getShaderGraphStatus(params) {
  return sendCommand("shadergraph/status", params);
}

export async function listShaders(params) {
  return sendCommand("shadergraph/list-shaders", params);
}

export async function listShaderGraphs(params) {
  return sendCommand("shadergraph/list", params);
}

export async function getShaderGraphInfo(params) {
  return sendCommand("shadergraph/info", params);
}

export async function getShaderProperties(params) {
  return sendCommand("shadergraph/get-properties", params);
}

export async function createShaderGraph(params) {
  return sendCommand("shadergraph/create", params);
}

export async function openShaderGraph(params) {
  return sendCommand("shadergraph/open", params);
}

export async function listSubGraphs(params) {
  return sendCommand("shadergraph/list-subgraphs", params);
}

export async function listVFXGraphs(params) {
  return sendCommand("shadergraph/list-vfx", params);
}

export async function openVFXGraph(params) {
  return sendCommand("shadergraph/open-vfx", params);
}

export async function getShaderGraphNodes(params) {
  return sendCommand("shadergraph/get-nodes", params);
}

export async function getShaderGraphEdges(params) {
  return sendCommand("shadergraph/get-edges", params);
}

export async function addShaderGraphNode(params) {
  return sendCommand("shadergraph/add-node", params);
}

export async function removeShaderGraphNode(params) {
  return sendCommand("shadergraph/remove-node", params);
}

export async function connectShaderGraphNodes(params) {
  return sendCommand("shadergraph/connect", params);
}

export async function disconnectShaderGraphNodes(params) {
  return sendCommand("shadergraph/disconnect", params);
}

export async function setShaderGraphNodeProperty(params) {
  return sendCommand("shadergraph/set-node-property", params);
}

export async function getShaderGraphNodeTypes(params) {
  return sendCommand("shadergraph/get-node-types", params);
}

// ─── Amplify Shader Editor ───

export async function getAmplifyStatus(params) {
  return sendCommand("amplify/status", params);
}

export async function listAmplifyShaders(params) {
  return sendCommand("amplify/list", params);
}

export async function getAmplifyShaderInfo(params) {
  return sendCommand("amplify/info", params);
}

export async function openAmplifyShader(params) {
  return sendCommand("amplify/open", params);
}

export async function listAmplifyFunctions(params) {
  return sendCommand("amplify/list-functions", params);
}

export async function getAmplifyNodeTypes(params) {
  return sendCommand("amplify/get-node-types", params);
}

export async function getAmplifyGraphNodes(params) {
  return sendCommand("amplify/get-nodes", params);
}

export async function getAmplifyGraphConnections(params) {
  return sendCommand("amplify/get-connections", params);
}

export async function createAmplifyShader(params) {
  return sendCommand("amplify/create-shader", params);
}

// ─── Agent Management ───

export async function listAgents(params) {
  return sendCommand("agents/list", params);
}

export async function getAgentLog(params) {
  return sendCommand("agents/log", params);
}

// ─── Search ───

export async function findByComponent(params) {
  return sendCommand("search/by-component", params);
}

export async function findByTag(params) {
  return sendCommand("search/by-tag", params);
}

export async function findByLayer(params) {
  return sendCommand("search/by-layer", params);
}

export async function findByName(params) {
  return sendCommand("search/by-name", params);
}

export async function findByShader(params) {
  return sendCommand("search/by-shader", params);
}

export async function searchAssets(params) {
  return sendCommand("search/assets", params);
}

export async function findMissingReferences(params) {
  return sendCommand("search/missing-references", params);
}

export async function getSceneStats(params) {
  return sendCommand("search/scene-stats", params);
}

// ─── Project Settings ───

export async function getQualitySettings(params) {
  return sendCommand("settings/quality", params);
}

export async function setQualityLevel(params) {
  return sendCommand("settings/quality-level", params);
}

export async function getPhysicsSettings(params) {
  return sendCommand("settings/physics", params);
}

export async function setPhysicsSettings(params) {
  return sendCommand("settings/set-physics", params);
}

export async function getTimeSettings(params) {
  return sendCommand("settings/time", params);
}

export async function setTimeSettings(params) {
  return sendCommand("settings/set-time", params);
}

export async function getPlayerSettings(params) {
  return sendCommand("settings/player", params);
}

export async function setPlayerSettings(params) {
  return sendCommand("settings/set-player", params);
}

export async function getRenderPipelineInfo(params) {
  return sendCommand("settings/render-pipeline", params);
}

// ─── Undo ───

export async function performUndo(params) {
  return sendCommand("undo/perform", params);
}

export async function performRedo(params) {
  return sendCommand("undo/redo", params);
}

export async function getUndoHistory(params) {
  return sendCommand("undo/history", params);
}

export async function clearUndo(params) {
  return sendCommand("undo/clear", params);
}

// ─── Screenshot / Scene View ───

export async function captureGameView(params) {
  return sendCommand("screenshot/game", params);
}

export async function captureSceneView(params) {
  return sendCommand("screenshot/scene", params);
}

export async function getSceneViewInfo(params) {
  return sendCommand("sceneview/info", params);
}

export async function setSceneViewCamera(params) {
  return sendCommand("sceneview/set-camera", params);
}

// ─── Terrain ───

export async function createTerrain(params) {
  return sendCommand("terrain/create", params);
}

export async function getTerrainInfo(params) {
  return sendCommand("terrain/info", params);
}

export async function setTerrainHeight(params) {
  return sendCommand("terrain/set-height", params);
}

export async function flattenTerrain(params) {
  return sendCommand("terrain/flatten", params);
}

export async function addTerrainLayer(params) {
  return sendCommand("terrain/add-layer", params);
}

export async function getTerrainHeight(params) {
  return sendCommand("terrain/get-height", params);
}

// ─── Particle System ───

export async function createParticleSystem(params) {
  return sendCommand("particle/create", params);
}

export async function getParticleSystemInfo(params) {
  return sendCommand("particle/info", params);
}

export async function setParticleMainModule(params) {
  return sendCommand("particle/set-main", params);
}

export async function setParticleEmission(params) {
  return sendCommand("particle/set-emission", params);
}

export async function setParticleShape(params) {
  return sendCommand("particle/set-shape", params);
}

export async function particlePlayback(params) {
  return sendCommand("particle/playback", params);
}

// ─── ScriptableObject ───

export async function createScriptableObject(params) {
  return sendCommand("scriptableobject/create", params);
}

export async function getScriptableObjectInfo(params) {
  return sendCommand("scriptableobject/info", params);
}

export async function setScriptableObjectField(params) {
  return sendCommand("scriptableobject/set-field", params);
}

export async function listScriptableObjectTypes(params) {
  return sendCommand("scriptableobject/list-types", params);
}

// ─── Texture ───

export async function getTextureInfo(params) {
  return sendCommand("texture/info", params);
}

export async function setTextureImportSettings(params) {
  return sendCommand("texture/set-import", params);
}

export async function reimportTexture(params) {
  return sendCommand("texture/reimport", params);
}

export async function setTextureAsSprite(params) {
  return sendCommand("texture/set-sprite", params);
}

export async function setTextureAsNormalMap(params) {
  return sendCommand("texture/set-normalmap", params);
}

// ─── Navigation ───

export async function bakeNavMesh(params) {
  return sendCommand("navigation/bake", params);
}

export async function clearNavMesh(params) {
  return sendCommand("navigation/clear", params);
}

export async function addNavMeshAgent(params) {
  return sendCommand("navigation/add-agent", params);
}

export async function addNavMeshObstacle(params) {
  return sendCommand("navigation/add-obstacle", params);
}

export async function getNavMeshInfo(params) {
  return sendCommand("navigation/info", params);
}

export async function setAgentDestination(params) {
  return sendCommand("navigation/set-destination", params);
}

// ─── UI ───

export async function createCanvas(params) {
  return sendCommand("ui/create-canvas", params);
}

export async function createUIElement(params) {
  return sendCommand("ui/create-element", params);
}

export async function getUIInfo(params) {
  return sendCommand("ui/info", params);
}

export async function setUIText(params) {
  return sendCommand("ui/set-text", params);
}

export async function setUIImage(params) {
  return sendCommand("ui/set-image", params);
}

// ─── Package Manager ───

export async function listPackages(params) {
  return sendCommand("packages/list", params);
}

export async function addPackage(params) {
  return sendCommand("packages/add", params);
}

export async function removePackage(params) {
  return sendCommand("packages/remove", params);
}

export async function searchPackage(params) {
  return sendCommand("packages/search", params);
}

export async function getPackageInfo(params) {
  return sendCommand("packages/info", params);
}

// ─── Constraints & LOD ───

export async function addConstraint(params) {
  return sendCommand("constraint/add", params);
}

export async function getConstraintInfo(params) {
  return sendCommand("constraint/info", params);
}

export async function createLODGroup(params) {
  return sendCommand("lod/create", params);
}

export async function getLODGroupInfo(params) {
  return sendCommand("lod/info", params);
}

// ─── Prefs ───

export async function getEditorPref(params) {
  return sendCommand("editorprefs/get", params);
}

export async function setEditorPref(params) {
  return sendCommand("editorprefs/set", params);
}

export async function deleteEditorPref(params) {
  return sendCommand("editorprefs/delete", params);
}

export async function getPlayerPref(params) {
  return sendCommand("playerprefs/get", params);
}

export async function setPlayerPref(params) {
  return sendCommand("playerprefs/set", params);
}

export async function deletePlayerPref(params) {
  return sendCommand("playerprefs/delete", params);
}

export async function deleteAllPlayerPrefs(params) {
  return sendCommand("playerprefs/delete-all", params);
}

// ─── Project Context (direct HTTP, no queue) ───

/**
 * Get project context files. Bypasses the command queue since it's read-only file I/O.
 * @param {string} [category] - Optional specific category to fetch. Omit for all.
 * @returns {object} Context data with categories and content.
 */
export async function getProjectContext(category = null) {
  const url = category
    ? `${BRIDGE_URL}/api/context/${encodeURIComponent(category)}`
    : `${BRIDGE_URL}/api/context`;

  const response = await fetch(url, {
    method: "GET",
    headers: { "X-Agent-Id": _agentId },
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`Context request failed: HTTP ${response.status}`);
  }

  return response.json();
}
