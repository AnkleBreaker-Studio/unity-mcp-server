// AnkleBreaker Unity MCP — Tool definitions for Multi-Instance Management
// These tools let agents discover, list, and select which Unity Editor instance to work with.

import {
  discoverInstances,
  selectInstance,
  getSelectedInstance,
  autoSelectInstance,
} from "../instance-discovery.js";
import { formatResult } from "../response-format.js";

export const instanceTools = [
  {
    name: "unity_list_instances",
    description:
      "List running Unity Editor instances (project name, port, Unity version, ParrelSync clone flag). " +
      "With multiple instances: call this first, then unity_select_instance to choose the target.",
    inputSchema: {
      type: "object",
      properties: {
        refresh: {
          type: "boolean",
          description:
            "Accepted for compatibility. Discovery always performs a fresh registry read + port scan.",
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
          pluginVersion: inst.pluginVersion,
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

      return formatResult(result);
    },
  },

  {
    name: "unity_select_instance",
    description:
      "Select the Unity Editor instance this session targets; subsequent unity_* calls route there. " +
      "Takes the port from unity_list_instances. PARALLEL SAFETY: after selecting, include port " +
      "on every unity_* call when multiple agents share this MCP process.",
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
        return formatResult({
          success: false,
          error:
            "Port number is required. Use unity_list_instances to see available instances.",
        });
      }

      const result = await selectInstance(port);

      // Enhance successful responses with parallel-safe routing instructions
      if (result.success) {
        result.routing = {
          port: port,
          instruction:
            `IMPORTANT — PARALLEL SAFETY: To guarantee your commands reach "${result.instance?.projectName || "this instance"}" ` +
            `(port ${port}), you MUST include  port: ${port}  as a parameter in ALL subsequent unity_* tool calls. ` +
            `This prevents cross-agent routing issues when multiple tasks run in parallel. ` +
            `Example: unity_execute_code({ code: "...", port: ${port} })`,
        };
      }

      return formatResult(result);
    },
  },
];
