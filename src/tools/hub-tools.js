// AnkleBreaker Unity MCP — Tool definitions for Unity Hub operations
import * as hub from "../unity-hub.js";

export const hubTools = [
  {
    name: "unity_hub_list_editors",
    description: "List all Unity Editor versions currently installed via Unity Hub, including their installation paths.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async () => {
      const result = await hub.listInstalledEditors();
      return JSON.stringify(result, null, 2);
    },
  },
  {
    name: "unity_hub_available_releases",
    description: "List Unity Editor versions available for download from Unity Hub.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async () => {
      const result = await hub.listAvailableReleases();
      return JSON.stringify(result, null, 2);
    },
  },
  {
    name: "unity_hub_install_editor",
    description: "Install a specific Unity Editor version. Optionally include platform modules (android, ios, webgl, linux, macos, windows-il2cpp).",
    inputSchema: {
      type: "object",
      properties: {
        version: { type: "string", description: "Unity version to install (e.g. '2022.3.20f1', '6000.3.7f1')" },
        modules: {
          type: "array",
          items: { type: "string" },
          description: "Optional modules to install: android, android-sdk-ndk-tools, android-open-jdk, ios, webgl, linux-il2cpp, mac-il2cpp, windows-il2cpp, etc.",
        },
      },
      required: ["version"],
    },
    handler: async ({ version, modules }) => {
      const result = await hub.installEditor(version, modules || []);
      return JSON.stringify(result, null, 2);
    },
  },
  {
    name: "unity_hub_install_modules",
    description: "Install additional platform modules to an already-installed Unity Editor version.",
    inputSchema: {
      type: "object",
      properties: {
        version: { type: "string", description: "Target Unity version" },
        modules: {
          type: "array",
          items: { type: "string" },
          description: "Modules to add: android, ios, webgl, etc.",
        },
      },
      required: ["version", "modules"],
    },
    handler: async ({ version, modules }) => {
      const result = await hub.installModules(version, modules);
      return JSON.stringify(result, null, 2);
    },
  },
  {
    name: "unity_hub_get_install_path",
    description: "Get the current default installation path for Unity Editors.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async () => {
      const result = await hub.getInstallPath();
      return JSON.stringify(result, null, 2);
    },
  },
  {
    name: "unity_hub_set_install_path",
    description: "Set the default installation directory for Unity Editors.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "New installation directory path" },
      },
      required: ["path"],
    },
    handler: async ({ path }) => {
      const result = await hub.setInstallPath(path);
      return JSON.stringify(result, null, 2);
    },
  },
];
