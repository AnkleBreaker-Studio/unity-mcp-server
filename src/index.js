#!/usr/bin/env node

// AnkleBreaker Unity MCP Server — Main entry point
// Provides tools for Unity Hub management and Unity Editor control via MCP protocol
//
// Multi-agent support:
//   Each MCP stdio process gets a unique agent ID (pid-based + random suffix).
//   This lets the Unity plugin's queue system differentiate between agents for
//   fair round-robin scheduling and session tracking.
//
// Multi-instance support:
//   Discovers all running Unity Editor instances (via shared registry + port scanning).
//   On first tool call, auto-selects if only one instance is found.
//   If multiple instances are running, prompts the user to select one.
//
// Project Context:
//   Exposes project-specific documentation via MCP Resources and a dedicated tool.
//   Auto-injects context summary on the first tool call per session so agents
//   receive project knowledge without needing to explicitly request it.

import { randomBytes } from "crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { hubTools } from "./tools/hub-tools.js";
import { editorTools } from "./tools/editor-tools.js";
import { contextTools } from "./tools/context-tools.js";
import { instanceTools } from "./tools/instance-tools.js";
import { splitToolTiers } from "./tool-tiers.js";
import { setAgentId, getProjectContext } from "./unity-editor-bridge.js";
import {
  autoSelectInstance,
  getSelectedInstance,
  isInstanceSelectionRequired,
} from "./instance-discovery.js";
import { persistState, loadState, debugLog } from "./state-persistence.js";

// ─── Per-process agent identity ───
// Each MCP stdio process = one Cowork agent.
// Generate a unique ID so the Unity plugin can track and schedule fairly.
const PROCESS_AGENT_ID = `agent-${process.pid}-${randomBytes(3).toString("hex")}`;
setAgentId(PROCESS_AGENT_ID);

// ─── Combine all tools (two-tier system) ───
// Split editor tools into core (always exposed) and advanced (on-demand via meta-tool).
// This keeps the tool count under ~70, preventing MCP client rejection caused by
// oversized tool lists (268 tools / 125KB was ~5x beyond what clients handle).
const { coreTools, metaTools, advancedCount, coreCount } =
  splitToolTiers(editorTools);
const ALL_TOOLS = [
  ...instanceTools,
  ...hubTools,
  ...coreTools,
  ...metaTools,
  ...contextTools,
];
console.error(
  `[MCP] Tool tiers: ${coreCount} core + ${advancedCount} advanced (via unity_advanced_tool) = ${coreCount + advancedCount} total, ${ALL_TOOLS.length} exposed`
);

// ─── Context auto-inject state ───
// On the first tool call per session, we prepend project context into the response.
// This ensures agents receive project knowledge without explicitly calling the context tool.
let _contextInjected = false;
let _contextCache = null;

// ─── Instance auto-discovery state ───
// On the very first tool call, we discover instances and auto-select if possible.
// If multiple are found, we inject a prompt asking the user to select one.
// State is persisted to disk because the MCP host may restart this process between tool calls.
let _instanceDiscoveryDone = false;

// Restore persisted discovery state on module load
(function restoreDiscoveryState() {
  const persistedDone = loadState("instanceDiscoveryDone");
  const hasSelectedInstance = getSelectedInstance();
  if (persistedDone && hasSelectedInstance) {
    _instanceDiscoveryDone = true;
    debugLog(`Restored _instanceDiscoveryDone=true (selected port=${hasSelectedInstance.port})`);
  }
})();

async function getContextSummaryOnce() {
  if (_contextInjected) return null;
  _contextInjected = true;

  try {
    if (!_contextCache) {
      _contextCache = await getProjectContext();
    }

    // Only inject if context is enabled and has content
    if (
      !_contextCache ||
      !_contextCache.enabled ||
      !_contextCache.categories ||
      _contextCache.categories.length === 0
    ) {
      return null;
    }

    let summary =
      "=== PROJECT CONTEXT (auto-provided by AB Unity MCP) ===\n\n";
    for (const entry of _contextCache.categories) {
      summary += `--- ${entry.category} ---\n`;
      // Truncate very long files for auto-inject
      let content = entry.content || "";
      if (content.length > 2000) {
        content =
          content.substring(0, 2000) +
          "\n... [truncated — use unity_get_project_context for full content]";
      }
      summary += content + "\n\n";
    }
    summary += "=== END PROJECT CONTEXT ===";
    return summary;
  } catch {
    // Context fetch failed (Unity not connected yet, etc.) — silently skip
    return null;
  }
}

/**
 * Perform instance discovery on first tool call.
 * Returns a prompt string if user needs to select an instance, or null.
 */
async function ensureInstanceDiscovery() {
  debugLog(`ensureInstanceDiscovery: _instanceDiscoveryDone=${_instanceDiscoveryDone}, selectedPort=${getSelectedInstance()?.port || 'null'}, selectionRequired=${isInstanceSelectionRequired()}`);
  if (_instanceDiscoveryDone) return null;
  _instanceDiscoveryDone = true;
  persistState("instanceDiscoveryDone", true);

  try {
    const result = await autoSelectInstance();

    if (result.autoSelected) {
      // Single instance found and auto-selected
      const inst = result.instance;
      const cloneInfo = inst.isClone ? ` (ParrelSync clone #${inst.cloneIndex})` : "";
      return (
        `=== UNITY INSTANCE (auto-connected) ===\n` +
        `Project: ${inst.projectName}${cloneInfo}\n` +
        `Port: ${inst.port}\n` +
        `Unity: ${inst.unityVersion || "unknown"}\n` +
        `Path: ${inst.projectPath || "unknown"}\n` +
        `=== END INSTANCE INFO ===`
      );
    }

    if (result.instances.length === 0) {
      return (
        `=== UNITY MCP WARNING ===\n` +
        `No Unity Editor instances were detected.\n` +
        `Make sure Unity is running with the MCP plugin enabled.\n` +
        `You can still use Unity Hub tools (unity_hub_*).\n` +
        `=== END WARNING ===`
      );
    }

    // Multiple instances found — check if one is already selected
    const alreadySelected = getSelectedInstance();
    if (alreadySelected) {
      // User already selected an instance before discovery ran — just confirm
      const cloneInfo = alreadySelected.isClone ? ` (ParrelSync clone #${alreadySelected.cloneIndex})` : "";
      return (
        `=== UNITY INSTANCE (user-selected) ===\n` +
        `Project: ${alreadySelected.projectName}${cloneInfo}\n` +
        `Port: ${alreadySelected.port}\n` +
        `Unity: ${alreadySelected.unityVersion || "unknown"}\n` +
        `Path: ${alreadySelected.projectPath || "unknown"}\n` +
        `(${result.instances.length} instances available — use unity_select_instance to switch)\n` +
        `=== END INSTANCE INFO ===`
      );
    }

    // No instance selected yet — prompt user to select
    let prompt =
      `=== MULTIPLE UNITY INSTANCES DETECTED ===\n` +
      `Found ${result.instances.length} running Unity Editor instances.\n` +
      `You MUST ask the user which instance to work with before proceeding.\n\n` +
      `Available instances:\n`;

    for (const inst of result.instances) {
      const cloneInfo = inst.isClone ? ` [ParrelSync clone #${inst.cloneIndex}]` : "";
      prompt += `  • Port ${inst.port}: ${inst.projectName}${cloneInfo} (Unity ${inst.unityVersion || "?"})\n`;
      if (inst.projectPath) {
        prompt += `    Path: ${inst.projectPath}\n`;
      }
    }

    prompt +=
      `\nCall unity_select_instance with the port number once the user has chosen.\n` +
      `=== END INSTANCE SELECTION REQUIRED ===`;

    return prompt;
  } catch (err) {
    console.error(`[MCP] Instance discovery failed: ${err.message}`);
    return null;
  }
}

// ─── Create MCP Server ───
const server = new Server(
  {
    name: "unity-mcp",
    version: "2.16.3",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
    instructions: [
      "IMPORTANT: Always use the MCP tools provided by this server (unity_*) to interact with Unity.",
      "NEVER call the Unity HTTP bridge directly (e.g. http://127.0.0.1:7890/api/...).",
      "The bridge is an internal communication layer between this MCP server and the Unity Editor plugin.",
      "Direct HTTP calls bypass the multi-agent queue, agent tracking, and safety mechanisms.",
      "Use the unity_* MCP tools for all Unity operations — they handle queuing, retries, and agent identity automatically.",
      "",
      "MULTI-INSTANCE: This MCP server supports multiple Unity Editor instances running simultaneously.",
      "On your first tool call, instances are auto-discovered. If multiple instances are found,",
      "you MUST ask the user which instance to work with and call unity_select_instance before proceeding.",
      "Use unity_list_instances to see all available instances at any time.",
    ].join(" "),
  }
);

// ─── List Tools Handler ───
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: ALL_TOOLS.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    })),
  };
});

// ─── Call Tool Handler ───
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  const tool = ALL_TOOLS.find((t) => t.name === name);
  if (!tool) {
    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }

  try {
    // Allow per-request agent ID override from MCP metadata, but default to
    // the process-level ID which is more reliable for multi-agent scheduling.
    const meta = request.params._meta || {};
    if (meta.agentId || meta.agent_id) {
      setAgentId(meta.agentId || meta.agent_id);
    }

    // Auto-discover instances on first tool call (unless it's an instance tool itself)
    let instancePrompt = null;
    if (name !== "unity_list_instances" && name !== "unity_select_instance") {
      instancePrompt = await ensureInstanceDiscovery();
    }

    // If instance selection is required and this isn't an instance/hub tool, warn
    const _selReq = isInstanceSelectionRequired();
    const _selInst = getSelectedInstance();
    debugLog(`Tool=${name}, selectionRequired=${_selReq}, selectedPort=${_selInst?.port || 'null'}, instancePrompt=${instancePrompt ? 'SET' : 'null'}, discoveryDone=${_instanceDiscoveryDone}`);
    if (
      _selReq &&
      !name.startsWith("unity_hub_") &&
      name !== "unity_list_instances" &&
      name !== "unity_select_instance" &&
      name !== "unity_get_project_context"
    ) {
      debugLog(`BLOCKING tool ${name} due to selectionRequired=true`);
      return {
        content: [
          {
            type: "text",
            text:
              instancePrompt ||
              "Multiple Unity instances are running. You must call unity_list_instances and then unity_select_instance before using other Unity tools.",
          },
        ],
        isError: true,
      };
    }

    const result = await tool.handler(args || {});

    // Build response content blocks
    const contentBlocks = [];

    // Instance info (first call only)
    if (instancePrompt) {
      contentBlocks.push({ type: "text", text: instancePrompt });
    }

    // Auto-inject project context on the first successful tool call
    const contextSummary = await getContextSummaryOnce();
    if (contextSummary) {
      contentBlocks.push({ type: "text", text: contextSummary });
    }

    // Support content block arrays (for image-returning tools like graphics/*)
    if (Array.isArray(result)) {
      contentBlocks.push(...result);
    } else {
      contentBlocks.push({ type: "text", text: result });
    }

    return { content: contentBlocks };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error executing ${name}: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

// ─── MCP Resources: Expose project context files ───

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  try {
    const contextData = await getProjectContext();

    if (
      !contextData ||
      !contextData.enabled ||
      !contextData.categories
    ) {
      return { resources: [] };
    }

    return {
      resources: contextData.categories.map((entry) => ({
        uri: `unity-context://${encodeURIComponent(entry.category)}`,
        name: `Project Context: ${entry.category}`,
        description: `Project-specific documentation for ${entry.category}`,
        mimeType: "text/markdown",
      })),
    };
  } catch {
    return { resources: [] };
  }
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  const match = uri.match(/^unity-context:\/\/(.+)$/);

  if (!match) {
    throw new Error(`Unknown resource URI: ${uri}`);
  }

  const category = decodeURIComponent(match[1]);
  const contextData = await getProjectContext(category);

  if (contextData.error) {
    throw new Error(contextData.error);
  }

  return {
    contents: [
      {
        uri,
        mimeType: "text/markdown",
        text: contextData.content || "",
      },
    ],
  };
});

// ─── Start Server ───
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  debugLog(`=== SERVER START === v2.16.3, agent=${PROCESS_AGENT_ID}, discoveryDone=${_instanceDiscoveryDone}, selectedPort=${getSelectedInstance()?.port || 'null'}`);
  console.error(
    `Unity MCP Server running on stdio (agent: ${PROCESS_AGENT_ID})`
  );
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
