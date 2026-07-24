// AnkleBreaker Unity MCP - ProBuilder tool definitions
// These tools are only functional when ProBuilder (com.unity.probuilder) is installed.
// The C# side is wrapped in #if PROBUILDER_INSTALLED - calls return a clear "not installed"
// error if ProBuilder is absent. All tools live in the advanced tier (unity_probuilder_*),
// reachable via unity_advanced_tool and listed under the "probuilder" category.
import * as bridge from "../probuilder-bridge.js";
import { formatResult } from "../response-format.js";

// Every edit/inspect tool resolves its target the same way: by hierarchy `path` or by
// `instanceId` (the string id returned by create-shape / gameobject tools). Shared here so
// each schema stays DRY and consistent.
const TARGET_PROPS = {
  path: {
    type: "string",
    description: "Hierarchy path of the ProBuilder GameObject (e.g. 'PB_cube'). Provide this OR instanceId.",
  },
  instanceId: {
    type: "string",
    description: "Instance id of the target (string form, as returned by create-shape). Provide this OR path.",
  },
};

const FACE_INDICES_PROP = {
  type: "array",
  description: "Face indices to operate on. Use unity_probuilder_info to get the face count. Indices are 0-based.",
  items: { type: "number" },
};

const VEC3_PROP = (desc) => ({
  type: "object",
  description: desc,
  properties: {
    x: { type: "number" },
    y: { type: "number" },
    z: { type: "number" },
  },
});

export const probuilderTools = [
  {
    name: "unity_probuilder_create_shape",
    description:
      "Create a parametric ProBuilder shape as a new, fully-editable mesh GameObject. " +
      "Shapes: cube, plane, cylinder, prism, stair, cone, door, pipe, arch, sphere, torus. " +
      "The result is a real ProBuilder object you can further edit (extrude, bevel, boolean, ...).\n\n" +
      "Common params: width/height/depth (size), name, position {x,y,z}, material (name or asset path), layer, addCollider, parent. " +
      "Shape-specific: sides (cylinder/cone/pipe/arch), heightSegments (cylinder/pipe), steps (stair), " +
      "ledge/legWidth (door), thickness (pipe/arch), angle (arch), subdivisions (sphere), " +
      "rows/columns/tubeRadius (torus), widthSegments/lengthSegments (plane).\n\n" +
      'EXAMPLE: { "shape": "stair", "width": 2, "height": 3, "depth": 4, "steps": 8, "name": "Staircase" }',
    inputSchema: {
      type: "object",
      properties: {
        shape: {
          type: "string",
          description: "Shape type (default: cube).",
          enum: ["cube", "plane", "cylinder", "prism", "stair", "cone", "door", "pipe", "arch", "sphere", "torus"],
        },
        width: { type: "number", description: "Width / X size (default 1)." },
        height: { type: "number", description: "Height / Y size (default 1)." },
        depth: { type: "number", description: "Depth / Z size (default 1)." },
        name: { type: "string", description: "GameObject name (default 'PB_<shape>')." },
        position: VEC3_PROP("World position for the new object (default origin)."),
        material: { type: "string", description: "Optional material for all faces — full asset path ('Assets/Materials/Brick.mat') OR a bare material name ('Brick'). A name that can't be resolved is reported as materialWarning (no more silent fallback to the default)." },
        layer: { type: "string", description: "Optional layer for the new object — a layer NAME or a numeric index. An unknown layer is reported as layerWarning." },
        addCollider: { type: "boolean", description: "Add a MeshCollider matching the generated mesh (default false)." },
        parent: { type: "string", description: "Optional hierarchy path to parent the new object under (world position kept). An unknown path is reported as parentWarning." },
        sides: { type: "number", description: "Side count for cylinder/cone/pipe/arch." },
        heightSegments: { type: "number", description: "Vertical segments for cylinder/pipe." },
        steps: { type: "number", description: "Step count for stair (default 6)." },
        ledge: { type: "number", description: "Door ledge thickness (default 0.15)." },
        legWidth: { type: "number", description: "Door leg width (default 0.25)." },
        thickness: { type: "number", description: "Wall thickness for pipe/arch." },
        angle: { type: "number", description: "Arch sweep angle in degrees (default 180)." },
        subdivisions: { type: "number", description: "Sphere (icosphere) subdivision level (default 2)." },
        rows: { type: "number", description: "Torus rows (default 12)." },
        columns: { type: "number", description: "Torus columns (default 16)." },
        tubeRadius: { type: "number", description: "Torus tube radius (default 0.2)." },
        widthSegments: { type: "number", description: "Plane width segments (default 1)." },
        lengthSegments: { type: "number", description: "Plane length segments (default 1)." },
      },
    },
    handler: async (params) => formatResult(await bridge.probuilderCreateShape(params)),
  },
  {
    name: "unity_probuilder_info",
    description:
      "Inspect a ProBuilder object: face/vertex/edge/shared-vertex counts, submesh count, and bounds. " +
      "Call this before face-editing ops to know the valid face-index range.",
    inputSchema: {
      type: "object",
      properties: { ...TARGET_PROPS },
    },
    handler: async (params) => formatResult(await bridge.probuilderInfo(params)),
  },
  {
    name: "unity_probuilder_extrude_faces",
    description:
      "Extrude selected faces outward along their normals (or as individual faces). " +
      "Adds side faces and moves the selected faces by `distance`.",
    inputSchema: {
      type: "object",
      properties: {
        ...TARGET_PROPS,
        faceIndices: FACE_INDICES_PROP,
        distance: { type: "number", description: "Extrude distance (default 0.5, may be negative to inset)." },
        method: {
          type: "string",
          description: "Extrude method (default faceNormal).",
          enum: ["faceNormal", "individualFaces", "vertexNormal"],
        },
      },
      required: ["faceIndices"],
    },
    handler: async (params) => formatResult(await bridge.probuilderExtrudeFaces(params)),
  },
  {
    name: "unity_probuilder_bevel_edges",
    description:
      "Bevel (chamfer) the edges of the selected faces by `amount`. A face-driven bevel: every edge " +
      "belonging to the given faces is beveled.",
    inputSchema: {
      type: "object",
      properties: {
        ...TARGET_PROPS,
        faceIndices: FACE_INDICES_PROP,
        amount: { type: "number", description: "Bevel amount (default 0.1)." },
      },
      required: ["faceIndices"],
    },
    handler: async (params) => formatResult(await bridge.probuilderBevelEdges(params)),
  },
  {
    name: "unity_probuilder_subdivide",
    description:
      "Subdivide faces (connect edge midpoints), increasing mesh density. " +
      "Omit faceIndices to subdivide the whole mesh.",
    inputSchema: {
      type: "object",
      properties: {
        ...TARGET_PROPS,
        faceIndices: { ...FACE_INDICES_PROP, description: "Faces to subdivide. Omit to subdivide all faces." },
      },
    },
    handler: async (params) => formatResult(await bridge.probuilderSubdivide(params)),
  },
  {
    name: "unity_probuilder_delete_faces",
    description:
      "Delete the selected faces from the mesh (creates holes / open geometry). " +
      "Refuses to delete every face (that would empty the mesh — delete the GameObject instead).",
    inputSchema: {
      type: "object",
      properties: {
        ...TARGET_PROPS,
        faceIndices: FACE_INDICES_PROP,
      },
      required: ["faceIndices"],
    },
    handler: async (params) => formatResult(await bridge.probuilderDeleteFaces(params)),
  },
  {
    name: "unity_probuilder_translate_faces",
    description: "Move the vertices of the selected faces by a translation vector (in local space).",
    inputSchema: {
      type: "object",
      properties: {
        ...TARGET_PROPS,
        faceIndices: FACE_INDICES_PROP,
        translation: VEC3_PROP("Translation to apply to the selected faces' vertices."),
      },
      required: ["faceIndices", "translation"],
    },
    handler: async (params) => formatResult(await bridge.probuilderTranslateFaces(params)),
  },
  {
    name: "unity_probuilder_flip_normals",
    description: "Flip (reverse) the winding of every face so the mesh renders inside-out. Useful for skyboxes / interior shells.",
    inputSchema: {
      type: "object",
      properties: { ...TARGET_PROPS },
    },
    handler: async (params) => formatResult(await bridge.probuilderFlipNormals(params)),
  },
  {
    name: "unity_probuilder_set_face_material",
    description:
      "Assign a material to specific faces (creates a submesh per material). " +
      "Omit faceIndices to apply the material to every face.",
    inputSchema: {
      type: "object",
      properties: {
        ...TARGET_PROPS,
        material: { type: "string", description: "Material to assign — full asset path ('Assets/Materials/Brick.mat') OR a bare material name ('Brick')." },
        faceIndices: { ...FACE_INDICES_PROP, description: "Faces to assign the material to. Omit for all faces." },
      },
      required: ["material"],
    },
    handler: async (params) => formatResult(await bridge.probuilderSetFaceMaterial(params)),
  },
  {
    name: "unity_probuilder_boolean",
    description:
      "Boolean CSG operation between two solid meshes, producing a new editable ProBuilder object. " +
      "Both objects need a MeshFilter (ProBuilder or plain mesh). The result is placed at the target's position.\n\n" +
      'EXAMPLE: { "operation": "subtract", "targetInstanceId": "-1234", "otherInstanceId": "-5678" }',
    inputSchema: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          description: "union (merge), subtract (target minus other), or intersect (overlap only).",
          enum: ["union", "subtract", "intersect"],
        },
        targetPath: { type: "string", description: "Hierarchy path of the first (target) object. Provide this OR targetInstanceId." },
        targetInstanceId: { type: "string", description: "Instance id of the first (target) object. Provide this OR targetPath." },
        otherPath: { type: "string", description: "Hierarchy path of the second object. Provide this OR otherInstanceId." },
        otherInstanceId: { type: "string", description: "Instance id of the second object. Provide this OR otherPath." },
        name: { type: "string", description: "Name for the result object (default 'PB_Boolean_<operation>')." },
        deleteSources: { type: "boolean", description: "Delete the two source objects after the op (default true — the result replaces their combined volume). Pass false to keep them." },
      },
      required: ["operation"],
    },
    handler: async (params) => formatResult(await bridge.probuilderBoolean(params)),
  },
  {
    name: "unity_probuilder_combine",
    description:
      "Merge two or more ProBuilder objects into a single ProBuilder mesh (the first object). " +
      "The other objects are consumed. All must already be ProBuilder objects (probuilderize plain meshes first).",
    inputSchema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          description: "Hierarchy paths of >= 2 ProBuilder objects to merge. The first is kept; the rest are merged into it and removed.",
          items: { type: "string" },
        },
      },
      required: ["paths"],
    },
    handler: async (params) => formatResult(await bridge.probuilderCombine(params)),
  },
  {
    name: "unity_probuilder_probuilderize",
    description:
      "Convert a plain mesh GameObject (with a MeshFilter) into an editable ProBuilder object, " +
      "so it can be extruded, beveled, boolean'd, etc.",
    inputSchema: {
      type: "object",
      properties: { ...TARGET_PROPS },
    },
    handler: async (params) => formatResult(await bridge.probuilderProBuilderize(params)),
  },
  {
    name: "unity_probuilder_center_pivot",
    description: "Recenter the object's pivot to the center of its geometry.",
    inputSchema: {
      type: "object",
      properties: { ...TARGET_PROPS },
    },
    handler: async (params) => formatResult(await bridge.probuilderCenterPivot(params)),
  },
  {
    name: "unity_probuilder_export_mesh",
    description:
      "Export the object's current mesh to a Unity .asset file (a standard Mesh you can reuse elsewhere). " +
      "The source object is resolved by path/instanceId; the export target is `outputPath`.",
    inputSchema: {
      type: "object",
      properties: {
        ...TARGET_PROPS,
        outputPath: {
          type: "string",
          description: "Asset path for the exported mesh (e.g. 'Assets/Meshes/MyMesh.asset'). '.asset' is appended if missing. Must be under Assets/.",
        },
        overwrite: {
          type: "boolean",
          description: "Allow overwriting an existing asset at outputPath (default false — refuses to clobber).",
        },
      },
      required: ["outputPath"],
    },
    handler: async (params) => formatResult(await bridge.probuilderExportMesh(params)),
  },
];
