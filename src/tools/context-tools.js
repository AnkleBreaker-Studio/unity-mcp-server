// AnkleBreaker Unity MCP — Tool definitions for Project Context
// These tools give agents access to project-specific documentation and guidelines
// stored in the Unity project's Assets/MCP/Context/ folder.

import * as bridge from "../unity-editor-bridge.js";
import { formatResult } from "../response-format.js";

export const contextTools = [
  {
    name: "unity_get_project_context",
    description:
      "Get the project docs/guidelines the team prepared for AI agents (from Assets/MCP/Context/). " +
      "No args = all context; pass a category for one document. Call early in a session.",
    inputSchema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description:
            "Optional: specific context category to fetch (e.g. 'ProjectGuidelines', 'Architecture', " +
            "'GameDesign', 'NetworkingGuidelines', 'NetworkingCSP', or any custom category). " +
            "Omit to get all available context.",
        },
      },
    },
    handler: async ({ category } = {}) => {
      const data = await bridge.getProjectContext(category || null);
      return formatResult(data);
    },
  },
];
