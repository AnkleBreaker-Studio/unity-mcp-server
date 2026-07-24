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
      "List running Unity Editor instances (name, port, version, clone flag, pluginVersion). " +
      "With multiple instances, select one with unity_select_instance next.",
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
      "Identify it by projectName (stable) or port (dynamic — can change across editor restarts). " +
      "PARALLEL SAFETY: after selecting, include port on every unity_* call when multiple agents " +
      "share this MCP process.",
    inputSchema: {
      type: "object",
      properties: {
        port: {
          type: "number",
          description: "Port of the instance to select (from unity_list_instances).",
        },
        projectName: {
          type: "string",
          description: "Project name to select (stable across restarts, unlike ports).",
        },
      },
    },
    handler: async ({ port, projectName }) => {
      if ((!port || typeof port !== "number") && (!projectName || typeof projectName !== "string")) {
        return formatResult({
          success: false,
          error:
            "Provide port or projectName. Use unity_list_instances to see available instances.",
        });
      }

      // Resolve a project name to its current port (names are stable, ports are not).
      if (!port) {
        const instances = await discoverInstances();
        const needle = projectName.toLowerCase();
        const matches = instances.filter((i) => (i.projectName || "").toLowerCase() === needle);
        if (matches.length === 0) {
          return formatResult({
            success: false,
            error: `No running instance named "${projectName}". Available: ${instances.map((i) => i.projectName).join(", ") || "none"}.`,
          });
        }
        if (matches.length > 1) {
          return formatResult({
            success: false,
            error: `${matches.length} instances named "${projectName}" (ports ${matches.map((i) => i.port).join(", ")}). Select by port instead.`,
          });
        }
        port = matches[0].port;
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
