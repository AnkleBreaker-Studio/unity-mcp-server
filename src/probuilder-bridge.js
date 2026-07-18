// ProBuilder Bridge Functions
// Optional integration: the C# side is wrapped in #if PROBUILDER_INSTALLED, so calls
// return a clear "not installed" error when com.unity.probuilder is absent from the project.
import { sendCommand } from "./unity-editor-bridge.js";

export async function probuilderCreateShape(params) {
  return sendCommand("probuilder/create-shape", params);
}

export async function probuilderInfo(params) {
  return sendCommand("probuilder/info", params);
}

export async function probuilderExtrudeFaces(params) {
  return sendCommand("probuilder/extrude-faces", params);
}

export async function probuilderBevelEdges(params) {
  return sendCommand("probuilder/bevel-edges", params);
}

export async function probuilderSubdivide(params) {
  return sendCommand("probuilder/subdivide", params);
}

export async function probuilderDeleteFaces(params) {
  return sendCommand("probuilder/delete-faces", params);
}

export async function probuilderTranslateFaces(params) {
  return sendCommand("probuilder/translate-faces", params);
}

export async function probuilderFlipNormals(params) {
  return sendCommand("probuilder/flip-normals", params);
}

export async function probuilderSetFaceMaterial(params) {
  return sendCommand("probuilder/set-face-material", params);
}

export async function probuilderBoolean(params) {
  return sendCommand("probuilder/boolean", params);
}

export async function probuilderCombine(params) {
  return sendCommand("probuilder/combine", params);
}

export async function probuilderProBuilderize(params) {
  return sendCommand("probuilder/probuilderize", params);
}

export async function probuilderCenterPivot(params) {
  return sendCommand("probuilder/center-pivot", params);
}

export async function probuilderExportMesh(params) {
  return sendCommand("probuilder/export-mesh", params);
}
