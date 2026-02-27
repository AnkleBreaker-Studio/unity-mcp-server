// AnkleBreaker Unity MCP — Tool definitions for Multi-Instance Management
// These tools let agents discover, list, and select which Unity Editor instance to work with.

import {
  discoverInstances,
  selectInstance,
  getSelectedInstance,
  autoSelectInstance,
} from "../instance-discovery.js";

export const instanceTools = [
  {
    name: "unity_list_instances",
    description:
      "List all running Unity Editor instances that the MCP can connect to. " +
      "Returns each instance's project name, port, Unity version, and whether it's a ParrelSync clone. " +
      "Use this to see which Unity projects are currently open before selecting one to work with. " +
      "IMPORTANT: When multiple instances are detected, always call this first and then use " +
      "unity_select_instance to choose which project to target.",
    inputSchema: {
      type: "object",
      properties: {
        refresh: {
          type: "boolean",
          description:
            "Force a fresh discovery scan (default: true). Set to false to use cached results.",
        },
      },
    },
    handler: async ({ refresh = true } = {}) => {
      const instances = await discoverInstances();
      const selected = getSelectedInstance();

      const result = {
        instances: instances.map((inst) => ({
          port: inst.port,
          projectName: inst.projectName,
          projectPath: inst.projectPath,
          unityVersion: inst.unityVersion,
          isClone: inst.isClone,
          cloneIndex: inst.cloneIndex,
          source: inst.source,
          isSelected: selected ? selected.port === inst.port : false,
        })),
        totalCount: instances.length,
        selectedPort: selected?.port || null,
        selectedProject: selected?.projectName || null,
      };

      if (instances.length === 0) {
        result.message =
          "No Unity Editor instances found. Make sure Unity is running with the MCP plugin enabled.";
      } else if (!selected) {
        result.message = `Found ${instances.length} Unity instance(s). Use unity_select_instance to choose which project to work with.`;
      } else {
        result.message = `Found ${instances.length} Unity instance(s). Currently targeting: ${selected.projectName} (port ${selected.port})`;
      }

      return JSON.stringify(result, null, 2);
    },
  },

  {
    name: "unity_select_instance",
    description:
      "Select which Unity Editor instance to work with for this session. " +
      "All subsequent unity_* commands will be routed to the selected instance. " +
      "You must provide the port number of the instance (get it from unity_list_instances). " +
      "IMPORTANT: Call unity_list_instances first to see available instances and their ports.",
    inputSchema: {
      type: "object",
      properties: {
        port: {
          type: "number",
          description:
            "The port number of the Unity instance to select (from unity_list_instances output).",
        },
      },
      required: ["port"],
    },
    handler: async ({ port }) => {
      if (!port || typeof port !== "number") {
        return JSON.stringify(
          {
            success: false,
            error:
              "Port number is required. Use unity_list_instances to see available instances.",
          },
          null,
          2
        );
      }

      const result = await selectInstance(port);
      return JSON.stringify(result, null, 2);
    },
  },
];
