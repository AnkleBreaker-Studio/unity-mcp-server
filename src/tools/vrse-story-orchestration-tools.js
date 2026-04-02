import * as bridge from "../unity-editor-bridge.js";

export const vrseStoryOrchestrationTools = [
  {
    name: "unity_vrse_story_add_trigger_set",
    description: "Add a default trigger set to a story moment's onWrong or onRight section.",
    inputSchema: {
      type: "object",
      properties: {
        storyCreatorName: { type: "string", description: "Optional StoryCreator GameObject name override" },
        chapterIndex: { type: "number", description: "Chapter index" },
        momentIndex: { type: "number", description: "Moment index" },
        section: { type: "string", description: "onWrong or onRight" },
        mode: { type: "string", description: "Optional onRight mode override, e.g. InOrder" },
        port: { type: "number", description: "Target Unity instance port." }
      },
      required: ["chapterIndex", "momentIndex", "section"]
    },
    handler: async (params) => JSON.stringify(await bridge.sendCommand("vrse/story-add-trigger-set", params), null, 2),
  },
  {
    name: "unity_vrse_story_add_action",
    description: "Add a default action node to a story moment section or to a specific trigger set.",
    inputSchema: {
      type: "object",
      properties: {
        storyCreatorName: { type: "string", description: "Optional StoryCreator GameObject name override" },
        chapterIndex: { type: "number", description: "Chapter index" },
        momentIndex: { type: "number", description: "Moment index" },
        section: { type: "string", description: "onAwake, onStart, onFirstWarning, onLastWarning, onEnd, onWrong, or onRight" },
        triggerSetIndex: { type: "number", description: "Required when section is onWrong or onRight" },
        port: { type: "number", description: "Target Unity instance port." }
      },
      required: ["chapterIndex", "momentIndex", "section"]
    },
    handler: async (params) => JSON.stringify(await bridge.sendCommand("vrse/story-add-action", params), null, 2),
  },
  {
    name: "unity_vrse_story_update_node",
    description: "Update a story node's name, option, query, data payload, type, or target object.",
    inputSchema: {
      type: "object",
      properties: {
        storyCreatorName: { type: "string", description: "Optional StoryCreator GameObject name override" },
        chapterIndex: { type: "number", description: "Chapter index" },
        momentIndex: { type: "number", description: "Moment index" },
        section: { type: "string", description: "Target section name" },
        triggerSetIndex: { type: "number", description: "Required when targeting onWrong or onRight" },
        nodeIndex: { type: "number", description: "Action node index within the section or trigger set" },
        nodeKind: { type: "string", description: "For onWrong/onRight: trigger or action" },
        name: { type: "string", description: "New node name" },
        option: { type: "string", description: "New node option" },
        query: { type: "string", description: "New node query string" },
        data: { type: "string", description: "New raw JSON data payload string" },
        type: { description: "Optional node type override: Action, Trigger, 0, or 1" },
        targetGameObjectName: { type: "string", description: "Scene GameObject name to assign as TargetGameObject" },
        targetGameObjectPath: { type: "string", description: "Scene hierarchy path to assign as TargetGameObject" },
        clearTargetGameObject: { type: "boolean", description: "Clear the current target object and query" },
        port: { type: "number", description: "Target Unity instance port." }
      },
      required: ["chapterIndex", "momentIndex", "section"]
    },
    handler: async (params) => JSON.stringify(await bridge.sendCommand("vrse/story-update-node", params), null, 2),
  },
  {
    name: "unity_vrse_story_save",
    description: "Save the active StoryCreator story back to its JSON file.",
    inputSchema: {
      type: "object",
      properties: {
        storyCreatorName: { type: "string", description: "Optional StoryCreator GameObject name override" },
        port: { type: "number", description: "Target Unity instance port." }
      }
    },
    handler: async (params) => JSON.stringify(await bridge.sendCommand("vrse/story-save", params), null, 2),
  },
  {
    name: "unity_vrse_story_validate",
    description: "Run the VRseBuilder story flow validator against the active StoryCreator and return the issues it finds.",
    inputSchema: {
      type: "object",
      properties: {
        storyCreatorName: { type: "string", description: "Optional StoryCreator GameObject name override" },
        autoAssignDefaultTargets: { type: "boolean", description: "Auto-assign default target objects before validation (default: true)" },
        port: { type: "number", description: "Target Unity instance port." }
      }
    },
    handler: async (params) => JSON.stringify(await bridge.sendCommand("vrse/story-validate", params), null, 2),
  },
  {
    name: "unity_vrse_story_remove_node_by_name",
    description: "Remove actions with a given node name from a story moment section or trigger set.",
    inputSchema: {
      type: "object",
      properties: {
        storyCreatorName: { type: "string", description: "Optional StoryCreator GameObject name override" },
        chapterIndex: { type: "number", description: "Chapter index" },
        momentIndex: { type: "number", description: "Moment index" },
        section: { type: "string", description: "Section name (onAwake, onStart, onFirstWarning, onLastWarning, onEnd, onWrong, or onRight)" },
        triggerSetIndex: { type: "number", description: "Required when removing from onWrong or onRight" },
        nodeName: { type: "string", description: "Name of the node to remove" },
        port: { type: "number", description: "Target Unity instance port." }
      },
      required: ["chapterIndex", "momentIndex", "section", "nodeName"]
    },
    handler: async (params) => JSON.stringify(await bridge.sendCommand("vrse/story-remove-node-by-name", params), null, 2),
  },
  {
    name: "unity_vrse_apply_moment_weightage",
    description: "Set weightage and wrong-reduction defaults on a story moment.",
    inputSchema: {
      type: "object",
      properties: {
        storyCreatorName: { type: "string", description: "Optional StoryCreator GameObject name override" },
        chapterIndex: { type: "number", description: "Chapter index" },
        momentIndex: { type: "number", description: "Moment index" },
        weightage: { type: "number", description: "New weightage value" },
        wrongReduction: { type: "number", description: "New wrong-reduction value" },
        port: { type: "number", description: "Target Unity instance port." }
      },
      required: ["chapterIndex", "momentIndex"]
    },
    handler: async (params) => JSON.stringify(await bridge.sendCommand("vrse/apply-moment-weightage", params), null, 2),
  },
  {
    name: "unity_vrse_story_has_pending_vo",
    description: "Check whether the active story has pending VO lines to generate.",
    inputSchema: {
      type: "object",
      properties: {
        storyCreatorName: { type: "string", description: "Optional StoryCreator GameObject name override" },
        port: { type: "number", description: "Target Unity instance port." }
      }
    },
    handler: async (params) => JSON.stringify(await bridge.sendCommand("vrse/story-has-pending-vo", params), null, 2),
  },
  {
    name: "unity_vrse_create_evaluation_from_training",
    description: "Use the evaluation automation tool to create an evaluation scene from the current or selected training experience.",
    inputSchema: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "Optional project name override" },
        moduleId: { type: "string", description: "Module ID" },
        moduleName: { type: "string", description: "Module name" },
        experienceId: { type: "string", description: "Training experience ID" },
        experienceName: { type: "string", description: "Training experience name" },
        evaluationSceneName: { type: "string", description: "Override evaluation scene name" },
        evaluationStoryName: { type: "string", description: "Override evaluation story name" },
        storyDefaults: { type: "string", description: "JSON defaults to write to the evaluation story" },
        evaluationType: { type: "string", description: "Enums.EvaluationType name" },
        showAutoToastForWrongAction: { type: "boolean" },
        showAutoToastForRightAction: { type: "boolean" },
        rightActionToastMessageDisplayTime: { type: "number" },
        mistakeCoolDownTime: { type: "number" },
        debugMistakesCountToPass: { type: "number" },
        port: { type: "number", description: "Target Unity instance port." }
      }
    },
    handler: async (params) => JSON.stringify(await bridge.sendCommand("vrse/create-evaluation-from-training", params), null, 2),
  },
  {
    name: "unity_vrse_story_read",
    description: "Read the full story structure from the active StoryCreator. Returns chapters, moments, sections, and action/trigger nodes. Use optional filters to narrow the response to a specific chapter, moment, or section.",
    inputSchema: {
      type: "object",
      properties: {
        storyCreatorName: { type: "string", description: "Optional StoryCreator GameObject name override" },
        chapterIndex: { type: "number", description: "Optional: only return this chapter (0-based)" },
        momentIndex: { type: "number", description: "Optional: only return this moment (0-based, requires chapterIndex)" },
        section: { type: "string", description: "Optional: only return this section (onAwake, onStart, onFirstWarning, onLastWarning, onEnd, onWrong, onRight)" },
        maxNodes: { type: "number", description: "Maximum nodes to return (default: 500)" },
        port: { type: "number", description: "Target Unity instance port." }
      }
    },
    handler: async (params) => JSON.stringify(await bridge.sendCommand("vrse/story-read", params), null, 2),
  },
  {
    name: "unity_vrse_story_list_node_templates",
    description: "List all available action and trigger node templates. Returns each template's name, type, description, options, and parameter schemas. Use this to discover what node types and options are available when adding or updating story nodes.",
    inputSchema: {
      type: "object",
      properties: {
        port: { type: "number", description: "Target Unity instance port." }
      }
    },
    handler: async (params) => JSON.stringify(await bridge.sendCommand("vrse/story-list-node-templates", params), null, 2),
  },
  {
    name: "unity_vrse_story_search_node_templates",
    description: "Search for node templates by name using fuzzy matching. Returns ranked results matching the query across template names, descriptions, backend IDs, and option names. Much faster than listing all templates when you know what you're looking for.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (e.g. 'voice', 'grab', 'teleport', 'collision'). Supports multi-word fuzzy matching." },
        type: { type: "string", description: "Optional: filter by 'action' or 'trigger'. Leave empty to search both." },
        maxResults: { type: "number", description: "Maximum results to return (default: 20)" },
        port: { type: "number", description: "Target Unity instance port." }
      },
      required: ["query"]
    },
    handler: async (params) => JSON.stringify(await bridge.sendCommand("vrse/story-search-node-templates", params), null, 2),
  },
  {
    name: "unity_vrse_story_generate_vo",
    description: "Generate voice-over audio files for all pending VoiceOver action nodes in the active story. Uses the configured TTS provider (OpenAI or VRBApi). First use unity_vrse_story_has_pending_vo to check if there are pending VOs.",
    inputSchema: {
      type: "object",
      properties: {
        clearAndRegenerate: { type: "boolean", description: "If true, deletes all existing VO files and regenerates everything from scratch. Default: false (only generates missing VOs)." },
        port: { type: "number", description: "Target Unity instance port." }
      }
    },
    handler: async (params) => JSON.stringify(await bridge.sendCommand("vrse/story-generate-vo", params), null, 2),
  },
  {
    name: "unity_vrse_query_objects_list",
    description: "List all registered queryable scene objects (GameObjectQuery components) in the loaded scenes. Returns each object's query name, ID, hierarchy path, active state, and VRse component markers (Grabbable, PlacePoint, etc.). Essential for knowing what objects can be wired to story nodes.",
    inputSchema: {
      type: "object",
      properties: {
        port: { type: "number", description: "Target Unity instance port." }
      }
    },
    handler: async (params) => JSON.stringify(await bridge.sendCommand("vrse/query-objects-list", params), null, 2),
  },
  {
    name: "unity_vrse_story_add_chapter",
    description: "Create a new chapter at the end of the story or inserted at a specific index.",
    inputSchema: {
      type: "object",
      properties: {
        storyCreatorName: { type: "string", description: "Optional StoryCreator GameObject name override" },
        name: { type: "string", description: "Name of the new chapter (default: 'New Chapter')" },
        index: { type: "number", description: "Optional zero-based index to insert at. If omitted, appends to the end." },
        port: { type: "number", description: "Target Unity instance port." }
      }
    },
    handler: async (params) => JSON.stringify(await bridge.sendCommand("vrse/story-add-chapter", params), null, 2),
  },
  {
    name: "unity_vrse_story_rename_chapter",
    description: "Rename an existing chapter.",
    inputSchema: {
      type: "object",
      properties: {
        storyCreatorName: { type: "string", description: "Optional StoryCreator GameObject name override" },
        chapterIndex: { type: "number", description: "Index of the chapter to rename" },
        newName: { type: "string", description: "New name for the chapter" },
        port: { type: "number", description: "Target Unity instance port." }
      },
      required: ["chapterIndex", "newName"]
    },
    handler: async (params) => JSON.stringify(await bridge.sendCommand("vrse/story-rename-chapter", params), null, 2),
  },
  {
    name: "unity_vrse_story_remove_chapter",
    description: "Remove a chapter and all its moments by index.",
    inputSchema: {
      type: "object",
      properties: {
        storyCreatorName: { type: "string", description: "Optional StoryCreator GameObject name override" },
        chapterIndex: { type: "number", description: "Index of the chapter to remove" },
        port: { type: "number", description: "Target Unity instance port." }
      },
      required: ["chapterIndex"]
    },
    handler: async (params) => JSON.stringify(await bridge.sendCommand("vrse/story-remove-chapter", params), null, 2),
  },
  {
    name: "unity_vrse_story_add_moment",
    description: "Create a new moment inside a specific chapter.",
    inputSchema: {
      type: "object",
      properties: {
        storyCreatorName: { type: "string", description: "Optional StoryCreator GameObject name override" },
        chapterIndex: { type: "number", description: "Index of the chapter to add the moment to" },
        name: { type: "string", description: "Name of the new moment (default: 'New Moment')" },
        index: { type: "number", description: "Optional zero-based index to insert at. If omitted, appends to the end of the chapter." },
        port: { type: "number", description: "Target Unity instance port." }
      },
      required: ["chapterIndex"]
    },
    handler: async (params) => JSON.stringify(await bridge.sendCommand("vrse/story-add-moment", params), null, 2),
  },
  {
    name: "unity_vrse_story_rename_moment",
    description: "Rename an existing moment.",
    inputSchema: {
      type: "object",
      properties: {
        storyCreatorName: { type: "string", description: "Optional StoryCreator GameObject name override" },
        chapterIndex: { type: "number", description: "Index of the chapter containing the moment" },
        momentIndex: { type: "number", description: "Index of the moment to rename" },
        newName: { type: "string", description: "New name for the moment" },
        port: { type: "number", description: "Target Unity instance port." }
      },
      required: ["chapterIndex", "momentIndex", "newName"]
    },
    handler: async (params) => JSON.stringify(await bridge.sendCommand("vrse/story-rename-moment", params), null, 2),
  },
  {
    name: "unity_vrse_story_remove_moment",
    description: "Remove a moment by index.",
    inputSchema: {
      type: "object",
      properties: {
        storyCreatorName: { type: "string", description: "Optional StoryCreator GameObject name override" },
        chapterIndex: { type: "number", description: "Index of the chapter containing the moment" },
        momentIndex: { type: "number", description: "Index of the moment to remove" },
        port: { type: "number", description: "Target Unity instance port." }
      },
      required: ["chapterIndex", "momentIndex"]
    },
    handler: async (params) => JSON.stringify(await bridge.sendCommand("vrse/story-remove-moment", params), null, 2),
  },
  {
    name: "unity_vrse_story_remove_action",
    description: "Remove an action node by its index within a moment section or trigger set. Returns the removed node for confirmation.",
    inputSchema: {
      type: "object",
      properties: {
        storyCreatorName: { type: "string", description: "Optional StoryCreator GameObject name override" },
        chapterIndex: { type: "number", description: "Chapter index" },
        momentIndex: { type: "number", description: "Moment index" },
        section: { type: "string", description: "onAwake, onStart, onFirstWarning, onLastWarning, onEnd, onWrong, or onRight" },
        triggerSetIndex: { type: "number", description: "Required when section is onWrong or onRight" },
        nodeIndex: { type: "number", description: "Action index to remove" },
        port: { type: "number", description: "Target Unity instance port." }
      },
      required: ["chapterIndex", "momentIndex", "section", "nodeIndex"]
    },
    handler: async (params) => JSON.stringify(await bridge.sendCommand("vrse/story-remove-action", params), null, 2),
  },
  {
    name: "unity_vrse_story_move_action",
    description: "Reorder an action within a moment section or trigger set.",
    inputSchema: {
      type: "object",
      properties: {
        storyCreatorName: { type: "string", description: "Optional StoryCreator GameObject name override" },
        chapterIndex: { type: "number", description: "Chapter index" },
        momentIndex: { type: "number", description: "Moment index" },
        section: { type: "string", description: "onAwake, onStart, onFirstWarning, onLastWarning, onEnd, onWrong, or onRight" },
        triggerSetIndex: { type: "number", description: "Required when section is onWrong or onRight" },
        fromIndex: { type: "number", description: "Current action index" },
        toIndex: { type: "number", description: "Destination action index" },
        port: { type: "number", description: "Target Unity instance port." }
      },
      required: ["chapterIndex", "momentIndex", "section", "fromIndex", "toIndex"]
    },
    handler: async (params) => JSON.stringify(await bridge.sendCommand("vrse/story-move-action", params), null, 2),
  },
  {
    name: "unity_vrse_story_duplicate_action",
    description: "Duplicate an action in-place within a moment section or trigger set.",
    inputSchema: {
      type: "object",
      properties: {
        storyCreatorName: { type: "string", description: "Optional StoryCreator GameObject name override" },
        chapterIndex: { type: "number", description: "Chapter index" },
        momentIndex: { type: "number", description: "Moment index" },
        section: { type: "string", description: "onAwake, onStart, onFirstWarning, onLastWarning, onEnd, onWrong, or onRight" },
        triggerSetIndex: { type: "number", description: "Required when section is onWrong or onRight" },
        nodeIndex: { type: "number", description: "Action index to duplicate" },
        port: { type: "number", description: "Target Unity instance port." }
      },
      required: ["chapterIndex", "momentIndex", "section", "nodeIndex"]
    },
    handler: async (params) => JSON.stringify(await bridge.sendCommand("vrse/story-duplicate-action", params), null, 2),
  },
  {
    name: "unity_vrse_story_apply_action_to_multiple_moments",
    description: "Copy one action node to multiple target moments.",
    inputSchema: {
      type: "object",
      properties: {
        storyCreatorName: { type: "string", description: "Optional StoryCreator GameObject name override" },
        chapterIndex: { type: "number", description: "Source chapter index" },
        momentIndex: { type: "number", description: "Source moment index" },
        section: { type: "string", description: "Source section" },
        triggerSetIndex: { type: "number", description: "Source trigger set index when using onWrong or onRight" },
        nodeIndex: { type: "number", description: "Source action index" },
        targets: {
          type: "array",
          description: "Target moments. Each entry may override section and triggerSetIndex; otherwise the source values are reused.",
          items: {
            type: "object",
            properties: {
              chapterIndex: { type: "number" },
              momentIndex: { type: "number" },
              section: { type: "string" },
              triggerSetIndex: { type: "number" }
            },
            required: ["chapterIndex", "momentIndex"]
          }
        },
        port: { type: "number", description: "Target Unity instance port." }
      },
      required: ["chapterIndex", "momentIndex", "section", "nodeIndex", "targets"]
    },
    handler: async (params) => JSON.stringify(await bridge.sendCommand("vrse/story-apply-action-to-multiple-moments", params), null, 2),
  },
  {
    name: "unity_vrse_story_defaults_get",
    description: "Get the global story defaults (interaction rules, UI configs, warning definitions).",
    inputSchema: { 
      type: "object", 
      properties: {
        projectName: { type: "string", description: "Optional project name override" },
        port: { type: "number", description: "Target Unity instance port for parallel-safe routing." }
      } 
    },
    handler: async (params) => JSON.stringify(await bridge.sendCommand("vrse/story-defaults-get", params), null, 2),
  },

  // ─── NEW STORY ORCHESTRATION TOOLS ───
  {
    name: "vrse_apply_story_json",
    description: "Applies a full story JSON to the active StoryCreator.",
    inputSchema: {
      type: "object",
      properties: {
        storyCreatorName: { type: "string", description: "Optional StoryCreator GameObject name override" },
        storyJson: { type: "string", description: "Full story JSON content to apply" },
        port: { type: "number", description: "Target Unity instance port." }
      },
      required: ["storyJson"]
    },
    handler: async (params) => JSON.stringify(await bridge.sendCommand("vrse/story-apply-json", params), null, 2),
  },
  {
    name: "vrse_patch_story",
    description: "Applies partial standard changes to moments/nodes.",
    inputSchema: {
      type: "object",
      properties: {
        storyCreatorName: { type: "string", description: "Optional StoryCreator GameObject name override" },
        patch: { type: "object", description: "Partial story data to apply" },
        port: { type: "number", description: "Target Unity instance port." }
      },
      required: ["patch"]
    },
    handler: async (params) => JSON.stringify(await bridge.sendCommand("vrse/story-patch", params), null, 2),
  },
  {
    name: "vrse_get_story_info",
    description: "Reads and returns high-level story data and node states.",
    inputSchema: {
      type: "object",
      properties: {
        storyCreatorName: { type: "string", description: "Optional StoryCreator GameObject name override" },
        port: { type: "number", description: "Target Unity instance port." }
      }
    },
    handler: async (params) => JSON.stringify(await bridge.sendCommand("vrse/story-get-info", params), null, 2),
  },
  {
    name: "vrse_undo_story_write",
    description: "Reverts the last JSON apply/patch operation to ensure fault tolerance.",
    inputSchema: {
      type: "object",
      properties: {
        storyCreatorName: { type: "string", description: "Optional StoryCreator GameObject name override" },
        port: { type: "number", description: "Target Unity instance port." }
      }
    },
    handler: async (params) => JSON.stringify(await bridge.sendCommand("vrse/story-undo-write", params), null, 2),
  }
];
