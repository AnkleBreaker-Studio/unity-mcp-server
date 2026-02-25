#!/usr/bin/env node

// Unity MCP Server — Main entry point
// Provides tools for Unity Hub management and Unity Editor control via MCP protocol
//
// Multi-agent support:
//   Each MCP stdio process gets a unique agent ID (pid-based + random suffix).
//   This lets the Unity plugin's queue system differentiate between agents for
//   fair round-robin scheduling and session tracking.

import { randomBytes } from "crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { hubTools } from "./tools/hub-tools.js";
import { editorTools } from "./tools/editor-tools.js";
import { setAgentId } from "./unity-editor-bridge.js";

// ─── Per-process agent identity ───
// Each MCP stdio process = one Cowork agent.
// Generate a unique ID so the Unity plugin can track and schedule fairly.
const PROCESS_AGENT_ID = `agent-${process.pid}-${randomBytes(3).toString("hex")}`;
setAgentId(PROCESS_AGENT_ID);

// ─── Combine all tools ───
const ALL_TOOLS = [...hubTools, ...editorTools];

// ─── Create MCP Server ───
const server = new Server(
  {
    name: "unity-mcp-server",
    version: "2.8.0",
  },
  {
    capabilities: {
      tools: {},
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
    return {
      content: [{ type: "text", text: result }],
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error executing ${name}: ${error.message}` }],
      isError: true,
    };
  }
});

// ─── Start Server ───
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Unity MCP Server running on stdio (agent: ${PROCESS_AGENT_ID})`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
