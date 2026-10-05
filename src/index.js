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
import { readFileSync } from "fs";
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
import { umaTools } from "./tools/uma-tools.js";
import { probuilderTools } from "./tools/probuilder-tools.js";
import { contextTools } from "./tools/context-tools.js";
import { instanceTools } from "./tools/instance-tools.js";
import { splitToolTiers } from "./tool-tiers.js";
import { setAgentId, getProjectContext } from "./unity-editor-bridge.js";
import {
  autoSelectInstance,
  getSelectedInstance,
  isInstanceSelectionRequired,
  validateSelectedInstance,
  setPortOverride,
  getActiveBridgeUrl,
} from "./instance-discovery.js";
import { agentState, validateAgentId } from "./agent-state.js";
import { debugLog } from "./state-persistence.js";
import { isErrorText, firstSentence, stripSchemaDescriptions } from "./response-format.js";
import { getRequestContext, getCurrentAgentId, getAgentState, runWithRequestContext } from "./request-context.js";
import { limitToolResponse, checkResourceResponse } from "./response-limits.js";
import { shareRequestWork, throwIfRequestCancelled } from "./request-cancellation.js";

// ─── Per-process agent identity ───
// Each MCP stdio process = one Cowork agent.
// Generate a unique ID so the Unity plugin can track and schedule fairly.
const PROCESS_AGENT_ID = `agent-${process.pid}-${randomBytes(3).toString("hex")}`;
setAgentId(PROCESS_AGENT_ID);

const cloneLabel = instance => `ParrelSync clone${Number.isInteger(instance.cloneIndex) && instance.cloneIndex >= 0 ? ` #${instance.cloneIndex}` : ""}`;

// ─── Combine all tools (two-tier system) ───
// Split editor tools into core (always exposed) and advanced (on-demand via meta-tool).
// This keeps the tool count under ~70, preventing MCP client rejection caused by
// oversized tool lists (268 tools / 125KB was ~5x beyond what clients handle).
const { coreTools, metaTools, advancedCount, coreCount } =
  splitToolTiers([...editorTools, ...umaTools, ...probuilderTools]);
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

// ─── Per-Agent Session State ───
// A SINGLE MCP process serves ALL agents/tasks in the same Claude Desktop session.
// Without per-agent state, Agent A's context injection would prevent Agent B from
// getting its own context, and Agent A's instance discovery would be skipped for Agent B.
// We key state by agent ID to prevent cross-agent contamination.

async function getContextSummaryOnce() {
  const state = getAgentState();
  const marker = agentState.beginContext(state, [getActiveBridgeUrl(), getSelectedInstance()?.projectPath]);
  if (!marker) return null;

  try {
    const _contextCache = await getProjectContext();
    if (_contextCache?.error) agentState.forgetContext(state, marker);

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
    agentState.forgetContext(state, marker);
    // Context fetch failed (Unity not connected yet, etc.) — silently skip
    return null;
  }
}

/**
 * Perform instance discovery on first tool call.
 * Returns a prompt string if user needs to select an instance, or null.
 */
async function ensureInstanceDiscovery() {
  const state = getAgentState();
  return shareRequestWork(state.pendingDiscovery, "discovery", async () => {
    try {
      return await discoverForCurrentAgent();
    } catch (error) {
      state.discoveryDone = false;
      throw error;
    }
  });
}

async function discoverForCurrentAgent() {
  const _instanceDiscoveryDone = getAgentState(false)?.discoveryDone || false;
  debugLog(`ensureInstanceDiscovery: _instanceDiscoveryDone=${_instanceDiscoveryDone}, selectedPort=${getSelectedInstance()?.port || 'null'}, selectionRequired=${isInstanceSelectionRequired()}`);

  // A manually selected custom-port editor may be absent from the registry and scan range.
  if (!_instanceDiscoveryDone && getSelectedInstance()) {
    getAgentState().discoveryDone = true;
    await validateSelectedInstance();
    return null;
  }
  if (!getSelectedInstance() && isInstanceSelectionRequired()) return null;

  if (_instanceDiscoveryDone) {
    // Discovery already done (likely restored from persistence).
    // Validate that the persisted instance selection still points to the correct project.
    // This detects port swaps: e.g. ProjectA was on port 7891 but now ProjectB is there.
    const validated = await validateSelectedInstance();
    if (validated) {
      debugLog(`Persisted selection validated OK: ${validated.projectName} on port ${validated.port}`);
    } else if (getSelectedInstance() === null) {
      // Validation cleared the selection (project no longer running).
      // Re-run discovery on next call.
      debugLog(`Persisted selection invalidated — project no longer found. Will re-discover.`);
      getAgentState().discoveryDone = false;
    }
    return null;
  }

  getAgentState().discoveryDone = true;

  try {
    const result = await autoSelectInstance();

    if (result.autoSelected) {
      // Single instance found and auto-selected
      const inst = result.instance;
      const cloneInfo = inst.isClone ? ` (${cloneLabel(inst)})` : "";
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
      getAgentState().discoveryDone = false;
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
      const cloneInfo = alreadySelected.isClone ? ` (${cloneLabel(alreadySelected)})` : "";
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
    const busy = result.busyInstances || [];
    const busyNote = busy.length > 0 ? ` and ${busy.length} registered editor(s) that are busy or compiling` : "";
    let prompt =
      `=== MULTIPLE UNITY INSTANCES DETECTED ===\n` +
      `Found ${result.instances.length} running Unity Editor instance(s)${busyNote}.\n` +
      `You MUST ask the user which instance to work with before proceeding.\n\n` +
      `Available instances:\n`;

    for (const inst of result.instances) {
      const cloneInfo = inst.isClone ? ` [${cloneLabel(inst)}]` : "";
      prompt += `  • Port ${inst.port}: ${inst.projectName}${cloneInfo} (Unity ${inst.unityVersion || "?"})\n`;
      if (inst.projectPath) {
        prompt += `    Path: ${inst.projectPath}\n`;
      }
    }

    // Registered but not answering: listed so the user can choose, not selectable until a ping verifies them.
    if (busy.length > 0) {
      prompt += `\nBusy or compiling (registered, not responding yet):\n`;
      for (const entry of busy) {
        prompt += `  • Port ${entry.port}: ${entry.projectName || "Unknown project"} (busy or compiling)\n`;
        if (entry.projectPath) {
          prompt += `    Path: ${entry.projectPath}\n`;
        }
      }
      prompt += `If the user chooses a busy editor, retry unity_select_instance once it responds.\n`;
    }

    prompt +=
      `\nCall unity_select_instance with the port number once the user has chosen.\n` +
      `=== END INSTANCE SELECTION REQUIRED ===`;

    return prompt;
  } catch (err) {
    throwIfRequestCancelled();
    console.error(`[MCP] Instance discovery failed: ${err.message}`);
    if (err.code === "selection_changed" || err.code?.startsWith("agent_state_")) throw err;
    return null;
  }
}

// ─── Create MCP Server ───
// Single source of truth for the server version: package.json. A hardcoded copy
// here once drifted four releases behind (2.26.0 vs 2.30.0 — issue #27).
const PACKAGE_VERSION = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8")
).version;

const server = new Server(
  {
    name: "unity-mcp",
    version: PACKAGE_VERSION,
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
// Inject an optional `port` parameter into every unity_* tool schema (except
// unity_select_instance which already owns it, unity_list_instances which lists
// all instances, and unity_hub_* which talk to Unity Hub not an Editor instance).
// This lets agents pass `port` on every call for parallel-safe routing without
// having to modify each tool definition file individually.
const TOOLS_SKIP_PORT_INJECT = new Set([
  "unity_select_instance",
  "unity_list_instances",
]);

// ─── Compact tool registry mode (UNITY_MCP_COMPACT_TOOLS=1) ───
// Some clients pass the aggregate tools/list payload through size-limited process
// boundaries (Codex Desktop on Windows dies with spawn ENAMETOOLONG — issue #27).
// Compact mode keeps every tool and its full schema STRUCTURE (types, required,
// enums stay — strict clients still validate) but drops per-property prose and
// trims tool descriptions to their first sentence. Full parameter documentation
// remains available on demand via unity_list_advanced_tools' schema echo.
const COMPACT_TOOLS = process.env.UNITY_MCP_COMPACT_TOOLS === "1";

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: ALL_TOOLS.map(({ name, description, inputSchema }) => {
      let schema = inputSchema;
      // Inject port into unity_* tools that target an Editor instance
      if (
        name.startsWith("unity_") &&
        !name.startsWith("unity_hub_") &&
        !TOOLS_SKIP_PORT_INJECT.has(name)
      ) {
        schema = {
          ...schema,
          properties: {
            ...(schema.properties || {}),
            port: {
              type: "number",
              description:
                "Unity instance port (from unity_select_instance). Always include it when multiple instances run.",
            },
          },
        };
      }
      if (COMPACT_TOOLS) {
        return { name, description: firstSentence(description), inputSchema: stripSchemaDescriptions(schema) };
      }
      return { name, description, inputSchema: schema };
    }),
  };
});

function configureRequestRouting(request, requestedPort) {
  const meta = request.params?._meta || {};
  const agentId = meta.agentId || meta.agent_id || PROCESS_AGENT_ID;
  validateAgentId(agentId);
  setAgentId(agentId);

  const port = requestedPort ?? meta.port ?? null;
  if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new Error("port must be an integer between 1 and 65535");
  }
  if (port) setPortOverride(port);
  return port;
}

async function prepareResourceTarget(port) {
  getAgentState();
  if (!port) {
    await ensureInstanceDiscovery();
    if (isInstanceSelectionRequired() || !getSelectedInstance()) {
      throw new Error("Select a Unity instance with unity_select_instance before reading project resources.");
    }
  }
  throwIfRequestCancelled();
  getRequestContext().bridgeUrl = getActiveBridgeUrl();
}

// ─── Call Tool Handler ───
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => runWithRequestContext({ agentId: PROCESS_AGENT_ID, signal: extra.signal }, async () => {
  const { name, arguments: args } = request.params;
  const finish = response => limitToolResponse(response, name);

  const tool = ALL_TOOLS.find((t) => t.name === name);
  if (!tool) {
    return finish({
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    });
  }

  try {
    const portOverride = configureRequestRouting(request, args?.port);
    const withoutEditor = name.startsWith("unity_hub_") || name === "unity_list_instances";
    getAgentState(!withoutEditor);

    if (portOverride) {
      debugLog(`Port override active: ${portOverride} for tool ${name}`);
    }

    // Auto-discover instances on first tool call (unless it's an instance tool itself)
    // Skip auto-discovery when port override is active — the caller already knows where to route.
    let instancePrompt = null;
    if (!portOverride && !withoutEditor && !TOOLS_SKIP_PORT_INJECT.has(name)) {
      instancePrompt = await ensureInstanceDiscovery();
    }

    // If instance selection is required and this isn't an instance/hub tool, warn
    // Skip this check when port override is active — the caller is explicitly routing.
    const _selReq = !portOverride && isInstanceSelectionRequired();
    const _selInst = getSelectedInstance();
    debugLog(`Tool=${name}, portOverride=${portOverride || 'null'}, selectionRequired=${_selReq}, selectedPort=${_selInst?.port || 'null'}, instancePrompt=${instancePrompt ? 'SET' : 'null'}, discoveryDone=${getAgentState(false)?.discoveryDone || false}`);
    if (
      _selReq &&
      !name.startsWith("unity_hub_") &&
      name !== "unity_list_instances" &&
      name !== "unity_list_advanced_tools" &&
      name !== "unity_select_instance"
    ) {
      debugLog(`BLOCKING tool ${name} due to selectionRequired=true`);
      return finish({
        content: [
          {
            type: "text",
            text:
              instancePrompt ||
              "Select a Unity instance with unity_select_instance before using other Unity tools. Use unity_list_instances to see available projects.",
          },
        ],
        isError: true,
      });
    }

    const diagnosticWithoutEditor = name === "unity_list_advanced_tools" || name === "unity_editor_ping";
    if (!portOverride && !name.startsWith("unity_hub_") && !TOOLS_SKIP_PORT_INJECT.has(name)
        && !diagnosticWithoutEditor && !getSelectedInstance()) {
      return finish({
        content: [{ type: "text", text: "No verified Unity Editor is selected. Start the plugin, then use unity_list_instances and unity_select_instance." }],
        isError: true,
      });
    }

    // Strip the `port` parameter before passing to the tool handler
    // so tool implementations don't see unexpected params.
    // Exception: unity_select_instance uses `port` as its own legitimate parameter.
    const handlerArgs = args ? { ...args } : {};
    if (handlerArgs.port !== undefined && name !== "unity_select_instance") {
      delete handlerArgs.port;
    }

    // Freeze this call's target even if another call switches the same agent's selection.
    if (name !== "unity_select_instance") getRequestContext().bridgeUrl = getActiveBridgeUrl();
    throwIfRequestCancelled();
    const result = await tool.handler(handlerArgs);
    throwIfRequestCancelled();
    const resultHasError = Array.isArray(result)
      ? result.some(block => block.type === "text" && isErrorText(block.text))
      : isErrorText(result);

    // Build response content blocks
    const contentBlocks = [];

    // Instance info (first call only)
    if (instancePrompt) {
      contentBlocks.push({ type: "text", text: instancePrompt });
    }

    // Auto-inject project context on the first successful tool call
    const contextSummary = !resultHasError && (portOverride || getSelectedInstance())
      && !withoutEditor && !TOOLS_SKIP_PORT_INJECT.has(name)
      ? await getContextSummaryOnce() : null;
    if (contextSummary) {
      contentBlocks.push({ type: "text", text: contextSummary });
    }

    // Support content block arrays (for image-returning tools like graphics/*)
    if (Array.isArray(result)) {
      contentBlocks.push(...result);
    } else {
      contentBlocks.push({ type: "text", text: result });
    }

    // Logical failures come back as HTTP 200 payloads ({success:false}, {error}, ...)
    // — surface them through the MCP isError flag so clients don't read them as success.
    const response = { content: contentBlocks };
    if (resultHasError) {
      response.isError = true;
    }
    return finish(response);

  } catch (error) {
    throwIfRequestCancelled();
    return finish({
      content: [
        {
          type: "text",
          text: `Error executing ${name}: ${error.message}`,
        },
      ],
      isError: true,
    });
  }
}));

// ─── MCP Resources: Expose project context files ───

server.setRequestHandler(ListResourcesRequestSchema, async (request, extra) => runWithRequestContext({ agentId: PROCESS_AGENT_ID, signal: extra.signal }, async () => {
  const port = configureRequestRouting(request);
  try {
    await prepareResourceTarget(port);
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
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request, extra) => runWithRequestContext({ agentId: PROCESS_AGENT_ID, signal: extra.signal }, async () => {
  const port = configureRequestRouting(request);
  const uri = request.params.uri;
  const match = uri.match(/^unity-context:\/\/(.+)$/);

  if (!match) {
    throw new Error(`Unknown resource URI: ${uri}`);
  }

  const category = decodeURIComponent(match[1]);
  await prepareResourceTarget(port);
  const contextData = await getProjectContext(category);

  if (contextData.error) {
    throw new Error(contextData.error);
  }

  return checkResourceResponse({
    contents: [
      {
        uri,
        mimeType: "text/markdown",
        text: contextData.content || "",
      },
    ],
  });
}));

// ─── Start Server ───
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  debugLog(`=== SERVER START === v${PACKAGE_VERSION}, agent=${PROCESS_AGENT_ID}, discoveryDone=${getAgentState(false)?.discoveryDone || false}, selectedPort=${getSelectedInstance()?.port || 'null'}`);
  console.error(
    `Unity MCP Server running on stdio (agent: ${PROCESS_AGENT_ID})`
  );
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
