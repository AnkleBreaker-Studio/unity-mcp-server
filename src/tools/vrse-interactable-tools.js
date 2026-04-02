import * as bridge from "../unity-editor-bridge.js";

async function callConverter(methodName, targetHint, objectPath, reasoning) {
  const result = await bridge.sendCommand("vrse/interactable_convert", {
    methodName: methodName,
    targetHint: targetHint || "",
    objectPath: objectPath || ""
  });

  if (!result || !result.success) {
    return JSON.stringify({ success: false, error: result?.error || "Unity connection failed", methodCalled: methodName }, null, 2);
  }

  return JSON.stringify({
    success: true,
    resolvedObject: result.resolvedObject,
    methodCalled: methodName,
    message: result.message,
    reasoning
  }, null, 2);
}

export const vrseInteractableTools = [
  {
    name: "vrse_convert_to_vrse_object",
    description: "Convert a scene object to a simple VRse Object by adding a GameObjectQuery component.",
    inputSchema: {
      type: "object",
      properties: {
        targetHint: { type: "string", description: "User text/name describing the target object. Leave empty to use selected." },
        objectPath: { type: "string", description: "Explicit hierarchy path override." },
        reasoning: { type: "string" }
      },
      required: []
    },
    handler: async ({ targetHint = "", objectPath = "", reasoning = "" }) => callConverter("ConvertToVRseObject", targetHint, objectPath, reasoning)
  },
  {
    name: "vrse_convert_to_touch_object",
    description: "Convert a scene object to a Touch Object by adding HandTouchDetectable and BoxCollider.",
    inputSchema: {
      type: "object",
      properties: {
        targetHint: { type: "string", description: "User text/name describing the target object." },
        objectPath: { type: "string", description: "Explicit hierarchy path override." },
        reasoning: { type: "string" }
      },
      required: []
    },
    handler: async ({ targetHint = "", objectPath = "", reasoning = "" }) => callConverter("ConvertToTouchObject", targetHint, objectPath, reasoning)
  },
  {
    name: "vrse_convert_to_grabbable",
    description: "Convert a scene mesh into a fully functional Network Grabbable.",
    inputSchema: {
      type: "object",
      properties: {
        targetHint: { type: "string", description: "User text/name describing the target object." },
        objectPath: { type: "string", description: "Explicit hierarchy path override." },
        reasoning: { type: "string" }
      },
      required: []
    },
    handler: async ({ targetHint = "", objectPath = "", reasoning = "" }) => callConverter("ConvertToGrabbable", targetHint, objectPath, reasoning)
  },
  {
    name: "vrse_convert_to_placepoint",
    description: "Convert an existing scene object into a Network PlacePoint.",
    inputSchema: {
      type: "object",
      properties: {
        targetHint: { type: "string", description: "User text/name describing the target object." },
        objectPath: { type: "string", description: "Explicit hierarchy path override." },
        reasoning: { type: "string" }
      },
      required: []
    },
    handler: async ({ targetHint = "", objectPath = "", reasoning = "" }) => callConverter("ConvertToPlacePoint", targetHint, objectPath, reasoning)
  },
  {
    name: "vrse_create_placepoint",
    description: "Create a NEW Network PlacePoint at the position of the selected/target object.",
    inputSchema: {
      type: "object",
      properties: {
        targetHint: { type: "string", description: "User text/name describing the target object." },
        objectPath: { type: "string", description: "Explicit hierarchy path override." },
        reasoning: { type: "string" }
      },
      required: []
    },
    handler: async ({ targetHint = "", objectPath = "", reasoning = "" }) => callConverter("CreatePlacePoint", targetHint, objectPath, reasoning)
  },
  {
    name: "vrse_convert_to_ray_interactable",
    description: "Convert a scene object into a Ray Interactable.",
    inputSchema: {
      type: "object",
      properties: {
        targetHint: { type: "string", description: "User text/name describing the target object." },
        objectPath: { type: "string", description: "Explicit hierarchy path override." },
        reasoning: { type: "string" }
      },
      required: []
    },
    handler: async ({ targetHint = "", objectPath = "", reasoning = "" }) => callConverter("ConvertToRayInteractable", targetHint, objectPath, reasoning)
  }
];
