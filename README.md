# Unity MCP — Server

<p align="center">
  <strong>Multi-agent MCP server for Unity, designed for Claude Cowork</strong><br>
  <em>145+ tools across 21 categories — scenes, GameObjects, scripts, builds, profiling, and more</em>
</p>

<p align="center">
  <a href="https://github.com/AnkleBreaker-Studio/unity-mcp-server/releases"><img alt="Version" src="https://img.shields.io/badge/version-2.9.1-blue"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-green"></a>
  <a href="https://nodejs.org"><img alt="Node" src="https://img.shields.io/badge/Node.js-18%2B-green"></a>
</p>

<p align="center">
  A project by <a href="https://anklebreaker-consulting.com"><strong>AnkleBreaker Consulting</strong></a> & <a href="https://anklebreaker-studio.com"><strong>AnkleBreaker Studio</strong></a>
</p>

---

## How This Is Different From Typical MCP

Standard MCP servers assume **one AI assistant, one tool, request-response.** That works fine for simple tasks.

**Unity MCP is built for [Claude Cowork](https://claude.ai)**, where **multiple AI agents collaborate in parallel** on the same Unity project. When you ask Cowork to *"set up the level while writing the player controller and configuring physics"*, it spawns several agents — and they all need to talk to Unity at the same time.

Here's what makes this different:

- **Each MCP server process = one agent.** Claude Cowork spawns a separate `node` process per agent via stdio. Each process gets a unique agent identity automatically (`process.pid` + random hex).
- **Async queue mode.** Instead of blocking on Unity's single thread, agents submit requests to a ticket queue and poll for results. This means no agent blocks another.
- **Fair scheduling.** The Unity-side queue uses round-robin across agents so no single agent starves the others. Reads are batched (up to 5/frame), writes are serialized (1/frame).
- **Automatic fallback.** If the Unity plugin hasn't been updated to v2.8.0 yet, the server falls back to legacy sync mode transparently. No configuration needed.

> **TL;DR:** Multiple AI agents can build your game together without stepping on each other.

---

## Architecture

```
┌──────────────────────────────────────────────────┐
│                  Claude Cowork                    │
│                                                   │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐          │
│  │ Agent 1 │  │ Agent 2 │  │ Agent 3 │  ...      │
│  └────┬────┘  └────┬────┘  └────┬────┘          │
│       │stdio       │stdio       │stdio           │
└───────┼────────────┼────────────┼────────────────┘
        ▼            ▼            ▼
┌──────────┐  ┌──────────┐  ┌──────────┐
│ MCP srv  │  │ MCP srv  │  │ MCP srv  │  ← separate Node.js processes
│ (this    │  │ (this    │  │ (this    │     each with unique agent ID
│  repo)   │  │  repo)   │  │  repo)   │
└────┬─────┘  └────┬─────┘  └────┬─────┘
     │ HTTP        │ HTTP        │ HTTP
     └─────────────┼─────────────┘
                   ▼
        ┌─────────────────────┐
        │   Unity Editor      │
        │   ┌───────────────┐ │
        │   │ Unity MCP     │ │  ← HTTP bridge + async request queue
        │   │ Plugin        │ │     fair round-robin scheduling
        │   └───────────────┘ │
        └─────────────────────┘
```

The server also communicates directly with **Unity Hub** via its CLI for editor installation and management.

---

## Quick Start

> **Important:** This system has TWO parts that BOTH need to be installed:
> 1. **Unity Plugin** — installed in Unity Editor (provides the HTTP bridge)
> 2. **MCP Server** — installed on your machine (connects Claude to Unity)
>
> If either piece is missing, the connection won't work.

### 1. Install the Unity Plugin

In Unity: **Window > Package Manager > + > Add package from git URL:**
```
https://github.com/AnkleBreaker-Studio/unity-mcp-plugin.git
```

After installation, open **Window > Unity MCP** in Unity and verify the bridge server shows `Started on port 7890`.

### 2. Install the MCP Server

```bash
git clone https://github.com/AnkleBreaker-Studio/unity-mcp-server.git
cd unity-mcp-server
npm install
```

### 3. Configure Claude

#### For Claude Desktop

Open **Claude Desktop > Settings > Developer > Edit Config** and add:

```json
{
  "mcpServers": {
    "unity-mcp": {
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

> **Replace `C:/path/to/unity-mcp-server`** with the actual path where you cloned the repo. Use forward slashes.

#### For Claude Cowork

Cowork uses the **same configuration format** as Claude Desktop. Add the MCP server config in your Cowork settings:

1. Open **Claude Cowork** desktop app
2. Go to **Settings > Extensions / MCP Servers**
3. Add a new MCP server with these settings:
   - **Name:** `unity-mcp`
   - **Command:** `node`
   - **Args:** `["C:/path/to/unity-mcp-server/src/index.js"]`
   - **Env:** `UNITY_BRIDGE_PORT=7890`, `UNITY_HUB_PATH=C:\Program Files\Unity Hub\Unity Hub.exe`

Claude Cowork will spawn multiple instances of this server automatically — one per agent. Each instance gets its own unique agent ID. No special multi-agent configuration is needed; the queue system handles coordination transparently.

#### Verify It Works

After configuring, restart Claude (Desktop or Cowork). You should see `unity-mcp` listed as a connected MCP server. Then try asking:

*"Ping Unity and tell me the project name"*

If it fails, check the [Troubleshooting](#troubleshooting) section below.

### 4. Try It

- *"List my installed Unity editors"*
- *"Show me the scene hierarchy"*
- *"Create a red cube at (0, 2, 0) and add a Rigidbody"*
- *"Profile my scene and show top memory consumers"*
- *"Build my project for Windows"*
- *"Show me the active agent sessions and queue state"*

---

## Tools (145+)

| Category | Examples |
|----------|---------|
| **Unity Hub** | List/install editors, manage modules, set install paths |
| **Scenes** | Open, save, create, get hierarchy tree |
| **GameObjects** | Create, delete, inspect, transform (world/local) |
| **Components** | Add, remove, get/set serialized properties |
| **Assets** | List, import, delete, create prefabs & materials |
| **Scripts** | Create, read, update C# scripts |
| **Builds** | Multi-platform builds |
| **Console** | Read/clear logs |
| **Play Mode** | Play, pause, stop |
| **Editor** | Menu items, C# execution, state, project info |
| **Animation** | Clips, controllers, parameters |
| **Prefab** | Prefab mode, overrides, apply/revert |
| **Physics** | Raycasts, overlap tests, physics settings |
| **Lighting** | Lights, environment, lightmaps, reflection probes |
| **Audio** | Sources, listeners, mixers |
| **Tags & Layers** | Tag/layer management |
| **Selection** | Editor selection, find objects |
| **Input Actions** | Action maps, bindings (Input System) |
| **Assembly Defs** | .asmdef management |
| **Profiler** | Profiling, deep profiles |
| **Memory** | Memory breakdown, snapshots |
| **Shader Graph** | Create, inspect, open (requires package) |
| **Amplify** | Amplify shader management (requires asset) |
| **Queue Management** | Queue info, ticket status, agent list, agent logs |
| **Project Context** | Auto-injected project docs, MCP resources |

---

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `UNITY_HUB_PATH` | `C:\Program Files\Unity Hub\Unity Hub.exe` | Unity Hub executable |
| `UNITY_BRIDGE_HOST` | `127.0.0.1` | Editor bridge host |
| `UNITY_BRIDGE_PORT` | `7890` | Editor bridge port |
| `UNITY_BRIDGE_TIMEOUT` | `30000` | Request timeout (ms) — covers compilation waits |
| `UNITY_QUEUE_POLL_INTERVAL` | `150` | Queue polling start interval (ms) |
| `UNITY_QUEUE_POLL_MAX` | `1500` | Queue polling max interval (ms) |

The Unity plugin has its own settings via the Dashboard (**Window > Unity MCP**) for port, auto-start, and category toggles.

---

## Multi-Agent Queue System

When running with the v2.8.0+ plugin, the server uses an async ticket-based queue:

1. **Submit** — Agent POSTs to `/api/queue/submit` with the API path and body. Gets a ticket ID back immediately (HTTP 202).
2. **Poll** — Agent polls `/api/queue/status?ticketId=X` with exponential backoff (150ms → 1000ms).
3. **Complete** — When the ticket is processed, the poll returns the result.

If the plugin doesn't support queue mode (pre-2.8.0), the server falls back to legacy synchronous requests automatically.

### Queue Management Tools

| Tool | Description |
|------|-------------|
| `unity_queue_info` | Get queue state — total pending, active agents, per-agent depths |
| `unity_queue_ticket_status` | Check a specific ticket by ID |
| `unity_agents_list` | List all active agent sessions with stats |
| `unity_agent_log` | Get action log for a specific agent |

### Stress Testing

A built-in stress test simulates multiple concurrent agents:

```bash
# With real Unity running
node tests/multi-agent-stress-test.mjs --agents 5 --requests 8

# Mock mode (no Unity needed)
node tests/multi-agent-stress-test.mjs --mock --agents 5 --requests 8
```

---

## Troubleshooting

**"Connection failed" errors** — Make sure Unity is open and the plugin is installed. Check the Unity Console for `[Unity MCP] Server started on port 7890`.

**"Unity Hub not found"** — Set `UNITY_HUB_PATH` in your config to match your install location.

**"Category disabled" errors** — A feature category may be toggled off. Open **Window > Unity MCP** in Unity to check.

**Port conflicts** — Change `UNITY_BRIDGE_PORT` in your Claude config and update the port in Unity's MCP dashboard.

**Queue timeouts** — The default timeout is 30 seconds to accommodate Unity compilation. If you need longer, set `UNITY_BRIDGE_TIMEOUT` to a higher value (in ms).

**Cowork says "not seen" but extension is installed** — This usually means the MCP server config is missing or has the wrong path. Double-check:
1. The `args` path points to the actual `src/index.js` file on your machine
2. You used forward slashes in the path (even on Windows)
3. You ran `npm install` in the server directory
4. You restarted Claude Cowork after adding the config
5. Unity is open with the plugin installed and showing "Server started" in the console

**execute_code fails with "filename too long"** — This is a known issue on Windows where the Mono compiler's command line exceeds the OS limit when many assemblies are loaded. We're working on a fix.

---

## Requirements

- **Node.js 18+**
- **Unity Hub** (for Hub tools)
- **Unity Editor** with [Unity MCP Plugin](https://github.com/AnkleBreaker-Studio/unity-mcp-plugin) installed (for Editor tools)

---

## Contributing

Contributions are welcome! This is an open-source project by [AnkleBreaker Consulting](https://anklebreaker-consulting.com) & [AnkleBreaker Studio](https://anklebreaker-studio.com).

1. Fork the repo
2. Create a feature branch
3. Make your changes
4. Submit a pull request

Please also check out the companion plugin repo: [Unity MCP — Plugin](https://github.com/AnkleBreaker-Studio/unity-mcp-plugin)

---

## License

MIT License — Copyright (c) 2026 [AnkleBreaker Consulting](https://anklebreaker-consulting.com) & [AnkleBreaker Studio](https://anklebreaker-studio.com). All rights reserved.

See [LICENSE](LICENSE) for the full text.
