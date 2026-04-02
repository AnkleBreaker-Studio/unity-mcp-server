// VRse Builder Advanced Mesh & Physics MCP Tools
// Two-tool AI flow: (1) Analyze mesh data → Agent reasons → (2) Create with explicit params
import * as bridge from "../unity-editor-bridge.js";

export const vrseAdvancedTools = [
  // ─── Tool 1: Gather mesh data for AI analysis ─────────────────────
  {
    name: "vrse_analyze_mesh_for_rotation",
    description:
      "Step 1 of 2: Gathers mesh hierarchy data from a scene GameObject so you can reason about how to set up a Pivot Rotate Limiter. " +
      "Returns JSON with ALL scene instances matching the name (use instanceId to pick the right one — multiple objects often share names). " +
      "Each instance includes: root mesh, all children with names/bounds/positions/vertices/rotations.\n\n" +

      "AFTER getting the data, you MUST reason about it before calling vrse_create_pivot_rotate_limiter. Here's how:\n\n" +

      "1. IDENTIFY THE OBJECT: What real-world thing is this? (telephone box, cabinet, lever, valve, etc.)\n" +
      "2. PICK THE RIGHT INSTANCE: If matchCount > 1, choose the instance with ALL expected children (e.g., an EmergencyTelephone should have both Cap and Phone children, not just Phone).\n" +
      "3. CLASSIFY EVERY MESH — nothing gets discarded, ever:\n" +
      "   - Root mesh is almost always STATIC (it's the housing/frame/body).\n" +
      "   - Children named 'Cap', 'Door', 'Lid', 'Handle', 'Lever', 'Flap', 'Cover' → likely ROTATING.\n" +
      "   - Children named 'Phone', 'Contents', 'Interior', 'Button', 'Label' → likely STATIC.\n" +
      "   - If a child already has localRotation != (0,0,0), that CONFIRMS it's the rotating part AND tells you which axis it rotates on.\n" +
      "4. DETERMINE ROTATION AXIS from the object type:\n" +
      "   - Doors, cabinet doors, gates → Y-axis (vertical hinge, swings horizontally)\n" +
      "   - Lids, flaps, mailbox doors → X-axis (horizontal hinge, opens up/down)\n" +
      "   - Dials, valves, wheels, levers → Z-axis (rotates in-plane)\n" +
      "   - Cross-check: if a child has non-zero Y rotation in localRotation, it confirms Y-axis rotation.\n" +
      "5. DETERMINE PIVOT/HINGE POSITION:\n" +
      "   - The pivot is where the hinge physically is — usually at one EDGE of the rotating mesh, not the center.\n" +
      "   - Look at the rotating mesh's boundsCenter offset: a large negative X offset (e.g., -0.108) means the mesh geometry is offset from its transform origin, and the hinge is near the transform origin (0,0,0).\n" +
      "   - For doors: hinge is at the edge closest to the frame. If boundsCenter.x is very negative, pivot is at (0,0,0).\n" +
      "   - For lids: hinge is at the back edge.\n" +
      "6. DETERMINE ANGLE RANGE:\n" +
      "   - Doors: 0° to 90-120° (standard door swing)\n" +
      "   - Lids/flaps: 0° to 90-110°\n" +
      "   - Levers: -30° to 30° or 0° to 45°\n" +
      "   - Dials/valves: 0° to 360° (or constrained subset)\n\n" +

      "RECOMMENDED WORKFLOW — use these companion tools for better results:\n" +
      "- BEFORE analyzing: Call unity_selection_set(path) then unity_selection_focus_scene_view() to focus camera on the object.\n" +
      "- BEFORE analyzing: Call unity_graphics_scene_capture or unity_screenshot_scene to VISUALLY SEE the object. Visual context helps you understand what it is (door vs lid vs lever) much better than mesh data alone.\n" +
      "- AFTER analyzing: If unsure about a child's role, call unity_gameobject_info(path) for more details.\n" +
      "- AFTER creating: Call unity_scene_hierarchy(parentPath, maxDepth=5) to verify the created hierarchy is correct.\n" +
      "- AFTER creating: Call unity_graphics_scene_capture to visually verify the result looks right.\n\n" +

      "Example reasoning for EmergencyTelephone (instanceId -77174, 2 children):\n" +
      "- Root mesh (1705 verts) = box housing → STATIC\n" +
      "- EmergencyTelephone_Cap (878 verts, localRotation Y=36.6°) = door/cap → ROTATES on Y-axis (confirmed by existing Y rotation)\n" +
      "- EmergencyTelephone_Phone (294 verts) = phone handset inside → STATIC\n" +
      "- Cap boundsCenter.x = -0.108 → hinge is at transform origin, pivot = (0,0,0)\n" +
      "- Door swing: 0° to 120°",
    inputSchema: {
      type: "object",
      properties: {
        gameObjectName: {
          type: "string",
          description:
            "Name of the root GameObject to analyze (e.g., 'EmergencyTelephone'). Returns ALL scene instances with this name.",
        },
      },
      required: ["gameObjectName"],
    },
    handler: async ({ gameObjectName }) => {
      try {
        const result = await bridge.executeCode(`
          var assembly = System.Reflection.Assembly.Load("VRseBuilder.Tools.Editor");
          var creatorType = assembly.GetType("VRseBuilder.Tools.Editor.PivotRotateLimiterCreator");
          var method = creatorType.GetMethod("GatherMeshData", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
          return (string)method.Invoke(null, new object[] { "${gameObjectName}" });
        `);

        if (result && result.success && result.result) {
          return result.result;
        }
        return JSON.stringify(result, null, 2);
      } catch (error) {
        return JSON.stringify({ error: true, message: `Failed to analyze mesh: ${error.message}` }, null, 2);
      }
    },
  },

  // ─── Tool 2: Create with AI-determined parameters ─────────────────
  {
    name: "vrse_create_pivot_rotate_limiter",
    description:
      "Step 2 of 2: Builds a fully functional Pivot Rotate Limiter in Unity from the reasoning you did in vrse_analyze_mesh_for_rotation. " +
      "Call vrse_analyze_mesh_for_rotation FIRST, then call this with your decisions.\n\n" +

      "HOW IT WORKS INTERNALLY:\n" +
      "Instantiates the real PivotRotateLimiter_Block prefab (which has ALL required components already correctly wired: " +
      "Grabbable, HandGrabInteractable, GrabInteractable, SnapInteractor, MetaXRGrabbableWrapper, NetworkGrabbableWrapper, NetworkObject, NetworkRigidbody3D) " +
      "then swaps in the user's meshes and sets the rotation config. This is the correct approach — never build from scratch.\n\n" +

      "CRITICAL RULES:\n" +
      "- NEVER discard any mesh. Every mesh from the original object must appear in the output.\n" +
      "- Static meshes (root housing + non-rotating children) go in '[Name]_Container'.\n" +
      "- The rotating mesh goes inside the Grabbable's mesh node — it rotates around the pivot.\n" +
      "- rootMeshIsStatic is almost always true (the root is the frame/housing that doesn't move).\n" +
      "- Always provide instanceId when matchCount > 1 to target the correct object.\n\n" +

      "Output hierarchy (from the real prefab):\n" +
      "  PivotRotateLimiter_[Name] (root)\n" +
      "  ├── [Name]_Container (static housing mesh + static children)\n" +
      "  └── [Name]_Grabbable (Rigidbody, Grabbable, HandGrabInteractable, GrabInteractable,\n" +
      "      │                  SnapInteractor, MetaXRGrabbableWrapper, NetworkGrabbableWrapper,\n" +
      "      │                  NetworkObject, NetworkRigidbody3D, MetaXRPivotRotateLimiter)\n" +
      "      └── Mesh\n" +
      "          ├── Pivot (the hinge point — positioned by pivotX/Y/Z)\n" +
      "          └── GameObject_Mesh (rotating mesh goes here)\n\n" +

      "AFTER CREATION — verify your work:\n" +
      "- Call unity_scene_hierarchy(parentPath='PivotRotateLimiter_[Name]', maxDepth=5) to confirm all meshes are present.\n" +
      "- Call unity_selection_set then unity_selection_focus_scene_view to focus on the result.\n" +
      "- Call unity_graphics_scene_capture to visually verify it looks correct.",
    inputSchema: {
      type: "object",
      properties: {
        instanceId: {
          type: "number",
          description: "Instance ID from vrse_analyze_mesh_for_rotation. REQUIRED when matchCount > 1 to target the correct object. Use the instance that has all expected children.",
        },
        parentObjectPath: {
          type: "string",
          description: "Fallback name/path if instanceId is 0. Only use when matchCount is 1.",
        },
        rotatingMeshName: {
          type: "string",
          description: "Name of the child that ROTATES. Identify by: name contains Cap/Door/Lid/Handle/Lever, OR has non-zero localRotation in the analysis data.",
        },
        staticMeshNames: {
          type: "string",
          description: "Comma-separated names of ALL non-rotating children. Every child not listed as rotating MUST be listed here. Nothing gets discarded.",
        },
        rootMeshIsStatic: {
          type: "boolean",
          description: "Almost always true. The root mesh is typically the housing/frame/body that stays fixed. Only false if the entire root object itself is the rotating part (rare).",
        },
        rotationAxis: {
          type: "string",
          enum: ["X", "Y", "Z"],
          description: "Y = vertical hinge (doors, cabinet doors, gates). X = horizontal hinge (lids, flaps, mailboxes). Z = in-plane rotation (dials, valves, levers). Cross-check with the rotating child's localRotation from analysis.",
        },
        minAngle: {
          type: "number",
          description: "Start angle in degrees. Almost always 0 (the resting/closed position). Use negative only for symmetric objects (e.g., lever at rest = 0, tilts -30 to +30).",
        },
        maxAngle: {
          type: "number",
          description: "End angle in degrees. Choose based on real-world physics of the object:\n" +
            "- Castle/heavy doors: 90-100° (heavy, doesn't open fully)\n" +
            "- Interior cabinet doors: 110-120° (lighter, opens wider)\n" +
            "- Telephone box / emergency cabinet doors: 100-120° (access panel, opens wide)\n" +
            "- Mailbox lids: 90-100° (flap drops down and stops)\n" +
            "- Chest/treasure box lid: 90-110° (lid opens back)\n" +
            "- Lever/handle: 30-60° (limited travel)\n" +
            "- Valve wheel: 180-360° (multi-turn)\n" +
            "- Book/folder cover: 170-180° (opens flat)\n" +
            "ALSO consider the mesh aspect ratio: a wide flat door opens wider than a narrow tall one.\n" +
            "ALSO consider if the rotating mesh's existing localRotation gives you a clue — if it's already at 36° it was probably placed partially open, meaning real range is 0-90° or 0-120°.",
        },
        pivotX: { type: "number", description: "Hinge X position. Check rotating mesh's boundsCenter — if boundsCenter.x is very negative, pivot.x should be near 0 (hinge is at transform origin edge)." },
        pivotY: { type: "number", description: "Hinge Y position. Usually 0 unless hinge is offset vertically." },
        pivotZ: { type: "number", description: "Hinge Z position. Usually 0 for doors. For lids, may be at the back edge of the mesh." },
        reasoning: {
          type: "string",
          description: "Your reasoning chain: what the object is → which part rotates and why → axis choice → pivot logic → angle range. This gets logged for debugging.",
        },
      },
      required: [
        "rotatingMeshName",
        "rotationAxis",
        "minAngle",
        "maxAngle",
        "pivotX",
        "pivotY",
        "pivotZ",
        "reasoning",
      ],
    },
    handler: async ({
      instanceId = 0,
      parentObjectPath = "",
      rotatingMeshName,
      staticMeshNames = "",
      rootMeshIsStatic = true,
      rotationAxis,
      minAngle,
      maxAngle,
      pivotX,
      pivotY,
      pivotZ,
      reasoning,
    }) => {
      try {
        const escapedReasoning = reasoning.replace(/"/g, '\\"').replace(/\n/g, "\\n");
        const escapedStaticNames = staticMeshNames.replace(/"/g, '\\"');
        const escapedRotatingName = rotatingMeshName.replace(/"/g, '\\"');
        const escapedParentPath = parentObjectPath.replace(/"/g, '\\"');

        const result = await bridge.executeCode(`
          var assembly = System.Reflection.Assembly.Load("VRseBuilder.Tools.Editor");
          var creatorType = assembly.GetType("VRseBuilder.Tools.Editor.PivotRotateLimiterCreator");
          var paramsType = creatorType.GetNestedType("AIParams");
          var resultType = creatorType.GetNestedType("CreationResult");

          var aiParams = System.Activator.CreateInstance(paramsType);
          paramsType.GetField("InstanceId").SetValue(aiParams, ${instanceId});
          paramsType.GetField("ParentObjectPath").SetValue(aiParams, "${escapedParentPath}");
          paramsType.GetField("RotatingMeshName").SetValue(aiParams, "${escapedRotatingName}");
          paramsType.GetField("StaticMeshNames").SetValue(aiParams, "${escapedStaticNames}");
          paramsType.GetField("RootMeshIsStatic").SetValue(aiParams, ${rootMeshIsStatic ? "true" : "false"});
          paramsType.GetField("RotationAxis").SetValue(aiParams, "${rotationAxis}");
          paramsType.GetField("MinAngle").SetValue(aiParams, ${minAngle}f);
          paramsType.GetField("MaxAngle").SetValue(aiParams, ${maxAngle}f);
          paramsType.GetField("PivotX").SetValue(aiParams, ${pivotX}f);
          paramsType.GetField("PivotY").SetValue(aiParams, ${pivotY}f);
          paramsType.GetField("PivotZ").SetValue(aiParams, ${pivotZ}f);
          paramsType.GetField("Reasoning").SetValue(aiParams, "${escapedReasoning}");

          var creator = System.Activator.CreateInstance(creatorType);
          var method = creatorType.GetMethod("CreateWithAIParams", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance);
          var result = method.Invoke(creator, new object[] { aiParams });

          bool success = (bool)resultType.GetField("Success").GetValue(result);
          string message = (string)resultType.GetField("Message").GetValue(result);
          var rootObj = resultType.GetField("RootGameObject").GetValue(result) as UnityEngine.GameObject;

          return success.ToString() + "|||" + message + "|||" + (rootObj != null ? rootObj.name : "N/A");
        `);

        if (result && result.success && result.result) {
          const parts = result.result.split("|||");
          return JSON.stringify({
            success: parts[0] === "True",
            message: parts[1] || "",
            rootObjectName: parts[2] || "N/A",
          }, null, 2);
        }
        return JSON.stringify(result, null, 2);
      } catch (error) {
        return JSON.stringify({ success: false, message: `Failed: ${error.message}` }, null, 2);
      }
    },
  },
];
