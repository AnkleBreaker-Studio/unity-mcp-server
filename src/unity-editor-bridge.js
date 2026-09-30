// Unity Editor HTTP bridge wrappers.
import { getRequestContext, getCurrentAgentId } from "./request-context.js";
import { CONFIG } from "./config.js";
import { getActiveBridgeUrl, bridgeIdentity } from "./instance-discovery.js";
import { sendQueuedCommand } from "./queue-transport.js";
import { pluginSupports } from "./capabilities.js";
import { requestFetch, throwIfRequestCancelled } from "./request-cancellation.js";

function getBridgeUrl() { return getActiveBridgeUrl(); }

export function setAgentId(agentId) {
  getRequestContext().agentId = agentId || "default";
}

export async function sendCommand(command, params = {}) {
  return sendQueuedCommand(command, params, getBridgeUrl(), getCurrentAgentId());
}

/**
 * Get queue information and stats.
 * GET /api/queue/info
 */
export async function getQueueInfo() {
  try {
    const url = `${getBridgeUrl()}/api/queue/info`;
    const response = await requestFetch(url, {
      method: "GET",
      headers: {
        "X-Agent-Id": getCurrentAgentId(),
      },
    }, CONFIG.editorBridgeTimeout);

    if (!response.ok) {
      const text = response.text;
      return { success: false, error: `HTTP ${response.status}: ${text}` };
    }

    const data = JSON.parse(response.text);
    return { success: true, data };
  } catch (error) {
    throwIfRequestCancelled();
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
    const url = `${getBridgeUrl()}/api/queue/status?ticketId=${ticketId}`;
    const response = await requestFetch(url, {
      method: "GET",
      headers: {
        "X-Agent-Id": getCurrentAgentId(),
      },
    }, CONFIG.editorBridgeTimeout);

    if (!response.ok) {
      const text = response.text;
      return { success: false, error: `HTTP ${response.status}: ${text}` };
    }

    const data = JSON.parse(response.text);
    return { success: true, data };
  } catch (error) {
    throwIfRequestCancelled();
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
    const response = await requestFetch(`${getBridgeUrl()}/api/ping`, {
      method: "GET",
    }, 3000);
    if (response.ok) {
      const data = JSON.parse(response.text);
      if (!bridgeIdentity(data)) return { connected: false, error: "The endpoint did not identify a Unity Editor bridge" };
      return { connected: true, ...data };
    }
    return { connected: false, error: `HTTP ${response.status}` };
  } catch {
    throwIfRequestCancelled();
    return { connected: false, error: "Unity Editor bridge not reachable" };
  }
}

// â"€â"€â"€ Convenience wrappers for common Editor operations â"€â"€â"€

export async function getSceneInfo() {
  return sendCommand("scene/info");
}

export async function openScene(params) {
  // Accepts the full param object so the unsaved-changes opt-ins (saveFirst /
  // discardUnsavedChanges) reach the plugin; a bare string stays supported for callers
  // that only pass a path.
  return sendCommand("scene/open", typeof params === "string" ? { path: params } : params);
}

export async function saveScene(params = {}) {
  return sendCommand("scene/save", params);
}

export async function newScene(params = {}) {
  return sendCommand("scene/new", params);
}

export async function getHierarchy(params) {
  return sendCommand("scene/hierarchy", params);
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

export async function setComponentReference(params) {
  return sendCommand("component/set-reference", params);
}

export async function batchWireReferences(params) {
  return sendCommand("component/batch-wire", params);
}

export async function getReferenceableObjects(params) {
  return sendCommand("component/get-referenceable", params);
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
  if (params?.managedCodeVariant !== undefined) {
    const info = await getQueueInfo();
    if (!info.success) return info;
    if (!pluginSupports(info.data, "MANAGED_CODE_VARIANT"))
      return { success: false, error: "managedCodeVariant requires a plugin supporting protocol 3 or newer. Update the plugin before building with this option." };
  }
  return sendCommand("build/start", params);
}

export async function getConsoleLog(params) {
  return sendCommand("console/log", params);
}

export async function clearConsoleLog() {
  return sendCommand("console/clear");
}

export async function getCompilationErrors(params) {
  return sendCommand("compilation/errors", params);
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

// â"€â"€â"€ Animation â"€â"€â"€

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

export async function setAnimationObjectReferenceCurve(params) {
  return sendCommand("animation/set-object-reference-curve", params);
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

// â"€â"€â"€ Prefab (Advanced) â"€â"€â"€

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

// â"€â"€â"€ Prefab Asset (Direct Editing) â"€â"€â"€

export async function getPrefabAssetHierarchy(params) {
  return sendCommand("prefab-asset/hierarchy", params);
}

export async function getPrefabAssetProperties(params) {
  return sendCommand("prefab-asset/get-properties", params);
}

export async function setPrefabAssetProperty(params) {
  return sendCommand("prefab-asset/set-property", params);
}

export async function addPrefabAssetComponent(params) {
  return sendCommand("prefab-asset/add-component", params);
}

export async function removePrefabAssetComponent(params) {
  return sendCommand("prefab-asset/remove-component", params);
}

export async function setPrefabAssetReference(params) {
  return sendCommand("prefab-asset/set-reference", params);
}

export async function addPrefabAssetGameObject(params) {
  return sendCommand("prefab-asset/add-gameobject", params);
}

export async function removePrefabAssetGameObject(params) {
  return sendCommand("prefab-asset/remove-gameobject", params);
}

// â"€â"€â"€ Prefab Variant Management â"€â"€â"€

export async function getPrefabVariantInfo(params) {
  return sendCommand("prefab-asset/variant-info", params);
}

export async function comparePrefabVariantToBase(params) {
  return sendCommand("prefab-asset/compare-variant", params);
}

export async function applyPrefabVariantOverride(params) {
  return sendCommand("prefab-asset/apply-variant-override", params);
}

export async function revertPrefabVariantOverride(params) {
  return sendCommand("prefab-asset/revert-variant-override", params);
}

export async function transferPrefabVariantOverrides(params) {
  return sendCommand("prefab-asset/transfer-variant-overrides", params);
}

// â"€â"€â"€ Physics â"€â"€â"€

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

// â"€â"€â"€ Lighting â"€â"€â"€

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

// â"€â"€â"€ Audio â"€â"€â"€

export async function getAudioInfo(params) {
  return sendCommand("audio/info", params);
}

export async function createAudioSource(params) {
  return sendCommand("audio/create-source", params);
}

export async function setGlobalAudio(params) {
  return sendCommand("audio/set-global", params);
}

// â"€â"€â"€ Tags & Layers â"€â"€â"€

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

// â"€â"€â"€ Selection & Scene View â"€â"€â"€

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

// â"€â"€â"€ Input Actions â"€â"€â"€

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

// â"€â"€â"€ Assembly Definitions â"€â"€â"€

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

// â"€â"€â"€ Profiler â"€â"€â"€

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

// â"€â"€â"€ Frame Debugger â"€â"€â"€

export async function enableFrameDebugger(params) {
  return sendCommand("debugger/enable", params);
}

export async function getFrameDebuggerEvents(params) {
  return sendCommand("debugger/events", params);
}

export async function getFrameDebuggerEventDetails(params) {
  return sendCommand("debugger/event-details", params);
}

// â"€â"€â"€ Memory Profiler â"€â"€â"€

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

// â"€â"€â"€ Shader Graph â"€â"€â"€

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

// â"€â"€â"€ Amplify Shader Editor â"€â"€â"€

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

export async function addAmplifyNode(params) {
  return sendCommand("amplify/add-node", params);
}

export async function removeAmplifyNode(params) {
  return sendCommand("amplify/remove-node", params);
}

export async function connectAmplifyNodes(params) {
  return sendCommand("amplify/connect", params);
}

export async function disconnectAmplifyNodes(params) {
  return sendCommand("amplify/disconnect", params);
}

export async function getAmplifyNodeInfo(params) {
  return sendCommand("amplify/node-info", params);
}

export async function setAmplifyNodeProperty(params) {
  return sendCommand("amplify/set-node-property", params);
}

export async function moveAmplifyNode(params) {
  return sendCommand("amplify/move-node", params);
}

export async function saveAmplifyGraph(params) {
  return sendCommand("amplify/save", params);
}

export async function closeAmplifyEditor(params) {
  return sendCommand("amplify/close", params);
}

export async function createAmplifyFromTemplate(params) {
  return sendCommand("amplify/create-from-template", params);
}

export async function focusAmplifyNode(params) {
  return sendCommand("amplify/focus-node", params);
}

export async function getAmplifyMasterNodeInfo(params) {
  return sendCommand("amplify/master-node-info", params);
}

export async function disconnectAllAmplifyNode(params) {
  return sendCommand("amplify/disconnect-all", params);
}

export async function duplicateAmplifyNode(params) {
  return sendCommand("amplify/duplicate-node", params);
}

// â"€â"€â"€ Agent Management â"€â"€â"€

export async function listAgents(params) {
  return sendCommand("agents/list", params);
}

export async function getAgentLog(params) {
  return sendCommand("agents/log", params);
}

// â"€â"€â"€ Search â"€â"€â"€

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

// â"€â"€â"€ Project Settings â"€â"€â"€

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

// â"€â"€â"€ Undo â"€â"€â"€

export async function performUndo(params) {
  return sendCommand("undo/perform", params);
}

export async function undoLast(params) {
  return sendCommand("undo/last", params);
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

// â"€â"€â"€ Screenshot / Scene View â"€â"€â"€

export async function captureGameView(params) {
  return sendCommand("screenshot/game", params);
}

export async function captureSceneView(params) {
  return sendCommand("screenshot/scene", params);
}

export async function captureEditorWindow(params) {
  return sendCommand("screenshot/editor-window", params);
}

export async function getSceneViewInfo(params) {
  return sendCommand("sceneview/info", params);
}

export async function setSceneViewCamera(params) {
  return sendCommand("sceneview/set-camera", params);
}

// â"€â"€â"€ Graphics & Visuals â"€â"€â"€

export async function captureAssetPreview(params) {
  return sendCommand("graphics/asset-preview", params);
}

export async function captureSceneViewGraphics(params) {
  return sendCommand("graphics/scene-capture", params);
}

export async function captureGameViewGraphics(params) {
  return sendCommand("graphics/game-capture", params);
}

export async function renderPrefabPreview(params) {
  return sendCommand("graphics/prefab-render", params);
}

export async function getMeshInfo(params) {
  return sendCommand("graphics/mesh-info", params);
}

export async function getMaterialInfo(params) {
  return sendCommand("graphics/material-info", params);
}

export async function getTextureInfoGraphics(params) {
  return sendCommand("graphics/texture-info", params);
}

export async function getRendererInfo(params) {
  return sendCommand("graphics/renderer-info", params);
}

export async function getLightingSummary(params) {
  return sendCommand("graphics/lighting-summary", params);
}

// â"€â"€â"€ Terrain â"€â"€â"€

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

export async function listTerrains(params) {
  return sendCommand("terrain/list", params);
}

export async function raiseLowerTerrainHeight(params) {
  return sendCommand("terrain/raise-lower", params);
}

export async function smoothTerrainHeight(params) {
  return sendCommand("terrain/smooth", params);
}

export async function setTerrainNoise(params) {
  return sendCommand("terrain/noise", params);
}

export async function setTerrainHeightsRegion(params) {
  return sendCommand("terrain/set-heights-region", params);
}

export async function getTerrainHeightsRegion(params) {
  return sendCommand("terrain/get-heights-region", params);
}

export async function removeTerrainLayer(params) {
  return sendCommand("terrain/remove-layer", params);
}

export async function paintTerrainLayer(params) {
  return sendCommand("terrain/paint-layer", params);
}

export async function fillTerrainLayer(params) {
  return sendCommand("terrain/fill-layer", params);
}

export async function addTerrainTreePrototype(params) {
  return sendCommand("terrain/add-tree-prototype", params);
}

export async function removeTerrainTreePrototype(params) {
  return sendCommand("terrain/remove-tree-prototype", params);
}

export async function placeTerrainTrees(params) {
  return sendCommand("terrain/place-trees", params);
}

export async function clearTerrainTrees(params) {
  return sendCommand("terrain/clear-trees", params);
}

export async function getTerrainTreeInstances(params) {
  return sendCommand("terrain/get-tree-instances", params);
}

export async function addTerrainDetailPrototype(params) {
  return sendCommand("terrain/add-detail-prototype", params);
}

export async function paintTerrainDetail(params) {
  return sendCommand("terrain/paint-detail", params);
}

export async function scatterTerrainDetail(params) {
  return sendCommand("terrain/scatter-detail", params);
}

export async function clearTerrainDetail(params) {
  return sendCommand("terrain/clear-detail", params);
}

export async function setTerrainHoles(params) {
  return sendCommand("terrain/set-holes", params);
}

export async function setTerrainSettings(params) {
  return sendCommand("terrain/set-settings", params);
}

export async function resizeTerrain(params) {
  return sendCommand("terrain/resize", params);
}

export async function createTerrainGrid(params) {
  return sendCommand("terrain/create-grid", params);
}

export async function setTerrainNeighbors(params) {
  return sendCommand("terrain/set-neighbors", params);
}

export async function importTerrainHeightmap(params) {
  return sendCommand("terrain/import-heightmap", params);
}

export async function exportTerrainHeightmap(params) {
  return sendCommand("terrain/export-heightmap", params);
}

export async function getTerrainSteepness(params) {
  return sendCommand("terrain/get-steepness", params);
}

// â"€â"€â"€ Particle System â"€â"€â"€

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

// â"€â"€â"€ ScriptableObject â"€â"€â"€

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

// â"€â"€â"€ Texture â"€â"€â"€

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

// ─── Sprite Atlas ───

export async function createSpriteAtlas(params) {
  return sendCommand("spriteatlas/create", params);
}

export async function getSpriteAtlasInfo(params) {
  return sendCommand("spriteatlas/info", params);
}

export async function addToSpriteAtlas(params) {
  return sendCommand("spriteatlas/add", params);
}

export async function removeFromSpriteAtlas(params) {
  return sendCommand("spriteatlas/remove", params);
}

export async function setSpriteAtlasSettings(params) {
  return sendCommand("spriteatlas/settings", params);
}

export async function deleteSpriteAtlas(params) {
  return sendCommand("spriteatlas/delete", params);
}

export async function listSpriteAtlases(params) {
  return sendCommand("spriteatlas/list", params);
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

// â"€â"€â"€ UI â"€â"€â"€

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

// â"€â"€â"€ Package Manager â"€â"€â"€

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

// â"€â"€â"€ Constraints & LOD â"€â"€â"€

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

// â"€â"€â"€ Prefs â"€â"€â"€

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

// â"€â"€â"€ Project Context (direct HTTP, no queue) â"€â"€â"€

/**
 * Get project context files. Bypasses the command queue since it's read-only file I/O.
 * @param {string} [category] - Optional specific category to fetch. Omit for all.
 * @returns {object} Context data with categories and content.
 */
export async function getProjectContext(category = null) {
  const url = category
    ? `${getBridgeUrl()}/api/context/${encodeURIComponent(category)}`
    : `${getBridgeUrl()}/api/context`;

  const response = await requestFetch(url, {
    method: "GET",
    headers: { "X-Agent-Id": getCurrentAgentId() },
  }, 5000);

  if (!response.ok) {
    throw new Error(`Context request failed: HTTP ${response.status}`);
  }

  return JSON.parse(response.text);
}

// ─── Testing ───

export async function runTests(params) {
  return sendCommand("testing/run-tests", params);
}
export async function getTestJob(params) {
  return sendCommand("testing/get-job", params);
}
export async function listTests(params) {
  return sendCommand("testing/list-tests", params);
}
