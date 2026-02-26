#!/usr/bin/env node

// AnkleBreaker Unity MCP Server — Main entry point
// Provides tools for Unity Hub management and Unity Editor control via MCP protocol
//
// Multi-agent support:
//   Each MCP stdio process gets a unique agent ID (pid-based + random suffix).
//   This lets the Unity plugin's queue system differentiate between agents for
//   fair round-robin scheduling and session tracking.
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
import { setAgentId, getProjectContext } from "./unity-editor-bridge.js";

// ─── Per-process agent identity ───
// Each MCP stdio process = one Cowork agent.
// Generate a unique ID so the Unity plugin can track and schedule fairly.
const PROCESS_AGENT_ID = `agent-${process.pid}-${randomBytes(3).toString("hex")}`;
setAgentId(PROCESS_AGENT_ID);

// ─── Combine all tools ───
const ALL_TOOLS = [...hubTools, ...editorTools, ...contextTools];

// ─── Context auto-inject state ───
// On the first tool call per session, we prepend project context into the response.
// This ensures agents receive project knowledge without explicitly calling the context tool.
let _contextInjected = false;
let _contextCache = null;

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

// ─── Create MCP Server ───
const server = new Server(
  {
    name: "anklebreaker-unity-mcp-server",
    version: "2.9.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
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

    const result = await tool.handler(args || {});

    // Auto-inject project context on the first successful tool call
    const contextSummary = await getContextSummaryOnce();
    if (contextSummary) {
      return {
        content: [
          { type: "text", text: contextSummary },
          { type: "text", text: result },
        ],
      };
    }

    return {
      content: [{ type: "text", text: result }],
    };
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
  console.error(
    `AB Unity MCP Server running on stdio (agent: ${PROCESS_AGENT_ID})`
  );
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
