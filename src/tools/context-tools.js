// AnkleBreaker Unity MCP — Tool definitions for Project Context
// These tools give agents access to project-specific documentation and guidelines
// stored in the Unity project's Assets/MCP/Context/ folder.

import * as bridge from "../unity-editor-bridge.js";

export const contextTools = [
  {
    name: "unity_get_project_context",
    description:
      "Get project-specific context and documentation that the team has prepared for AI agents. " +
      "This includes project guidelines, architecture docs, game design documents, networking rules, " +
      "and any other project knowledge stored in Assets/MCP/Context/. " +
      "Call this without arguments to get ALL context, or specify a category for a specific document. " +
      "IMPORTANT: Call this early in your session to understand the project's conventions and architecture.",
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
      return JSON.stringify(data, null, 2);
    },
  },
];
