// Unity Editor HTTP Bridge Client
// Communicates with the C# plugin running inside Unity Editor
import { CONFIG } from "./config.js";

const BRIDGE_URL = `http://${CONFIG.editorBridgeHost}:${CONFIG.editorBridgePort}`;

// Agent identity — tracks which AI agent is making requests
let _currentAgentId = "default";

/**
 * Set the current agent ID. All subsequent sendCommand calls include this as X-Agent-Id header.
 */
export function setAgentId(agentId) {
  _currentAgentId = agentId || "default";
}

/**
 * Send a command to the Unity Editor bridge
 */
export async function sendCommand(command, params = {}) {
  const url = `${BRIDGE_URL}/api/${command}`;
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

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: `HTTP ${response.status}: ${text}` };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    clearTimeout(timeout);
    if (error.name === "AbortError") {
      return { success: false, error: "Request timed out. Is Unity Editor running with the MCP Bridge plugin?" };
    }
    return { success: false, error: `Connection failed: ${error.message}. Is Unity Editor running with the MCP Bridge plugin?` };
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

// ─── Agent Management ───

export async function listAgents(params) {
  return sendCommand("agents/list", params);
}

export async function getAgentLog(params) {
  return sendCommand("agents/log", params);
}
