# Unity MCP Server

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that gives AI assistants like Claude full control over **Unity Hub** and **Unity Editor**. Built by [AnkleBreaker Studio](https://github.com/AnkleBreaker-Studio).

## Features

**30+ tools** covering the full Unity workflow:

| Category | Tools |
|----------|-------|
| **Unity Hub** | List/install editors, manage modules, set install paths |
| **Scenes** | Open, save, create, get hierarchy |
| **GameObjects** | Create, delete, inspect, transform |
| **Components** | Add, remove, get/set properties |
| **Assets** | List, import, delete, prefabs, materials |
| **Scripts** | Create, read, update C# scripts |
| **Builds** | Multi-platform builds |
| **Console** | Read/clear Unity console logs |
| **Play Mode** | Play, pause, stop |
| **Editor** | Execute menu items, run code, get state |
| **Project** | Full project info, packages, settings |

## Architecture

```
Claude Desktop ←→ MCP Server (this repo) ←→ Unity Editor Plugin (HTTP bridge)
                         ↕
                   Unity Hub CLI
```

This server communicates with:
- **Unity Hub** via its CLI (`--headless` mode)
- **Unity Editor** via the companion [unity-mcp-plugin](https://github.com/AnkleBreaker-Studio/unity-mcp-plugin) which runs an HTTP API inside the editor

## Quick Start

### 1. Install the Unity Plugin

In Unity: **Window → Package Manager → + → Add package from git URL:**
```
https://github.com/AnkleBreaker-Studio/unity-mcp-plugin.git
```

### 2. Install this MCP Server

```bash
git clone https://github.com/AnkleBreaker-Studio/unity-mcp-server.git
cd unity-mcp-server
npm install
```

### 3. Add to Claude Desktop

Open Claude Desktop → Settings → Developer → Edit Config, and add:

```json
{
  "mcpServers": {
    "unity": {
      "command": "node",
      "args": ["C:/path/to/unity-mcp-server/src/index.js"],
      "env": {
        "UNITY_HUB_PATH": "C:\\Program Files\\Unity Hub\\Unity Hub.exe",
        "UNITY_BRIDGE_PORT": "7890"
      }
    }
  }
}
```

Restart Claude Desktop. Done!

### 4. Try It

- *"List my installed Unity editors"*
- *"Show me the scene hierarchy"*
- *"Create a red cube at position (0, 2, 0) and add a Rigidbody"*
- *"Build my project for Windows"*

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `UNITY_HUB_PATH` | `C:\Program Files\Unity Hub\Unity Hub.exe` | Unity Hub executable path |
| `UNITY_BRIDGE_HOST` | `127.0.0.1` | Editor bridge host |
| `UNITY_BRIDGE_PORT` | `7890` | Editor bridge port |
| `UNITY_BRIDGE_TIMEOUT` | `30000` | Request timeout in ms |

## Requirements

- Node.js 18+
- Unity Hub (for Hub tools)
- Unity Editor with [unity-mcp-plugin](https://github.com/AnkleBreaker-Studio/unity-mcp-plugin) installed (for Editor tools)

## Troubleshooting

**"Connection failed" errors** — Make sure Unity Editor is open and the plugin is installed. Check the Unity Console for `[MCP Bridge] Server started on port 7890`.

**"Unity Hub not found"** — Update `UNITY_HUB_PATH` in your config to match your installation.

**Port conflicts** — Change `UNITY_BRIDGE_PORT` in both the Claude config and `MCPBridgeServer.cs`.

## License

MIT — see [LICENSE](LICENSE)
