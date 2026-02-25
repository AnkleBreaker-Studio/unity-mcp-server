#!/usr/bin/env node

// Unity MCP Server — Main entry point
// Provides tools for Unity Hub management and Unity Editor control via MCP protocol

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { hubTools } from "./tools/hub-tools.js";
import { editorTools } from "./tools/editor-tools.js";
import { setAgentId } from "./unity-editor-bridge.js";

// ─── Combine all tools ───
const ALL_TOOLS = [...hubTools, ...editorTools];

// ─── Create MCP Server ───
const server = new Server(
  {
    name: "unity-mcp-server",
    version: "2.0.0",
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
    // Extract agent identity from MCP request metadata (if provided by the client)
    const meta = request.params._meta || {};
    const agentId = meta.agentId || meta.agent_id || "default";
    setAgentId(agentId);

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
  console.error("Unity MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
