# AnkleBreaker Unity MCP — Server

<p align="center">
  <strong>Multi-agent MCP server for Unity, designed for Claude Cowork</strong><br>
  <em>259 tools across 24 categories — 66 core + 193 advanced via two-tier system — scenes, GameObjects, prefab assets, prefab variants, graphics & visuals, scripts, builds, profiling, and more</em>
</p>

<p align="center">
  <a href="https://github.com/AnkleBreaker-Studio/unity-mcp-server/releases"><img alt="Version" src="https://img.shields.io/badge/version-2.16.0-blue"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-green"></a>
  <a href="https://nodejs.org"><img alt="Node" src="https://img.shields.io/badge/Node.js-18%2B-green"></a>
</p>

<p align="center">
  A project by <a href="https://anklebreaker-consulting.com"><strong>AnkleBreaker Consulting</strong></a> & <a href="https://anklebreaker-studio.com"><strong>AnkleBreaker Studio</strong></a>
</p>

---

## How This Is Different From Typical MCP

Standard MCP servers assume **one AI assistant, one tool, request-response.** That works fine for simple tasks.

**AnkleBreaker Unity MCP is built for [Claude Cowork](https://claude.ai)**, where **multiple AI agents collaborate in parallel** on the same Unity project. When you ask Cowork to *"set up the level while writing the player controller and configuring physics"*, it spawns several agents — and they all need to talk to Unity at the same time.

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
                   ▼  (routed to selected instance)
     ┌─────────────────────────────────────────┐
     │          Instance Registry               │
     │   %LOCALAPPDATA%/UnityMCP/instances.json │
     └────┬──────────────┬──────────────┬──────┘
          ▼              ▼              ▼
  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
  │ Unity Editor │ │ Unity Editor │ │ Unity Editor │
  │ Project A    │ │ Project B    │ │ Clone #0     │
  │ :7890        │ │ :7891        │ │ :7892        │
  └──────────────┘ └──────────────┘ └──────────────┘
```

The server discovers all running Unity instances via a shared registry file and port scanning. On first tool call, it auto-selects if only one instance is found, or prompts the agent to ask the user which project to target.

The server also communicates directly with **Unity Hub** via its CLI for editor installation and management.

---

## Quick Start

> **Important:** This system has TWO parts that BOTH need to be installed:
> 1. **Unity Plugin** — installed in Unity Editor (provides the HTTP bridge)
> 2. **MCP Server** — installed as a Desktop Extension or configured manually (connects Claude to Unity)
>
> If either piece is missing, the connection won't work.

### 1. Install the Unity Plugin

In Unity: **Window > Package Manager > + > Add package from git URL:**
```
https://github.com/AnkleBreaker-Studio/unity-mcp-plugin.git
```

After installation, open **Window > AB Unity MCP** in Unity and verify the bridge server shows as running. The port is auto-selected from the range 7890-7899 (shown in the dashboard).

### 2. Install the MCP Server

#### Option A: Desktop Extension (Recommended)

The easiest way to install — no git clone, no npm, no JSON config editing.

1. Download `unity-mcp.mcpb` from the [latest release](https://github.com/AnkleBreaker-Studio/unity-mcp-server/releases)
2. **Double-click** the `.mcpb` file (or drag it into Claude Desktop)
3. Review the extension details and click **Install**
4. Optionally configure the Unity Hub path and bridge port in the extension settings

That's it. Claude Desktop uses its built-in Node.js runtime to run the server — no separate Node.js installation required.

> **What's a `.mcpb`?** It's a [Desktop Extension](https://www.anthropic.com/engineering/desktop-extensions) — a packaged MCP server that installs in Claude with one click, similar to browser extensions. It bundles the server code and all dependencies.

#### Option B: Manual Setup (Advanced)

If you prefer manual configuration or need to modify the source:

```bash
git clone https://github.com/AnkleBreaker-Studio/unity-mcp-server.git
cd unity-mcp-server
npm install
```

Then add to your Claude config (**Settings > Developer > Edit Config**):

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

### 3. Verify It Works

After installing (either method), restart Claude. You should see `unity-mcp` listed as a connected extension. Then try asking:

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

## Tools (259 total — 66 core + 193 advanced)

The server uses a **two-tier tool system** to stay within MCP client limits while still providing full access to all 259 tools.

**Core tools** (~66) are always exposed as individual MCP tools — these cover the most common Unity operations. **Advanced tools** (~193) are accessed on-demand via the `unity_advanced_tool` meta-tool, which routes calls to any specialized tool by name. Use `unity_list_advanced_tools` to browse the full catalog.

| Category | Core | Advanced | Total |
|----------|------|----------|-------|
| **Unity Hub** | — | List/install editors, manage modules, set install paths | 6 |
| **Scenes** | Open, save, create, hierarchy, stats | New scene | 6 |
| **GameObjects** | Create, delete, inspect, transform, duplicate, active, reparent | — | 7 |
| **Components** | Add, remove, get/set properties, set reference, batch wire, get referenceable | — | 7 |
| **Assets** | List, import, delete, create prefab, instantiate prefab | — | 5 |
| **Scripts** | Create, read, update, execute code | — | 4 |
| **Materials** | Create, assign | — | 2 |
| **Builds & Play** | Build, play mode | — | 2 |
| **Console** | Read, clear | — | 2 |
| **Editor Actions** | Menu items, undo, redo, undo history | — | 4 |
| **Selection & Search** | Get/set selection, focus scene view, find by type/component/tag/layer/name, search assets, missing refs | — | 11 |
| **Screenshots** | Game capture, scene capture, screenshot game, screenshot scene | — | 4 |
| **Prefab** | Prefab info, set object reference | Hierarchy, properties, add/remove components, variants | 10+ |
| **Packages** | List, add, remove, search, info | — | 5 |
| **Queue & Agents** | Queue info, agents list, agent log | — | 3 |
| **Animation** | — | Clips, controllers, parameters | 8+ |
| **Physics** | — | Raycasts, overlap tests, settings | 6+ |
| **Lighting** | — | Lights, environment, lightmaps, probes | 8+ |
| **Audio** | — | Sources, listeners, mixers | 6+ |
| **Shader Graph** | — | Create, inspect, open | 5+ |
| **Amplify** | — | Full graph manipulation (23 tools) | 23 |
| **Graphics** | Scene/game capture | Asset preview, mesh/material/texture/renderer/lighting info | 9 |
| **Profiler & Memory** | — | Profiling, deep profiles, memory snapshots | 6+ |
| **Other** | — | Tags, layers, input actions, assembly defs, terrain, particles, navmesh, UI, LOD, constraints, ScriptableObjects, EditorPrefs, PlayerPrefs, VFX | 50+ |
| **Project Context** | Get project context | — | 1 |

---

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `UNITY_HUB_PATH` | `C:\Program Files\Unity Hub\Unity Hub.exe` | Unity Hub executable |
| `UNITY_BRIDGE_HOST` | `127.0.0.1` | Editor bridge host |
| `UNITY_BRIDGE_PORT` | `7890` | Default/fallback editor bridge port |
| `UNITY_BRIDGE_TIMEOUT` | `30000` | Request timeout (ms) — covers compilation waits |
| `UNITY_PORT_RANGE_START` | `7890` | Start of multi-instance port scan range |
| `UNITY_PORT_RANGE_END` | `7899` | End of multi-instance port scan range |
| `UNITY_INSTANCE_REGISTRY` | Platform-specific\* | Path to the shared instance registry JSON |
| `UNITY_QUEUE_POLL_INTERVAL` | `150` | Queue polling start interval (ms) |
| `UNITY_QUEUE_POLL_MAX` | `1500` | Queue polling max interval (ms) |

\* Registry default: `%LOCALAPPDATA%/UnityMCP/instances.json` on Windows, `~/.local/share/UnityMCP/instances.json` on macOS/Linux.

The Unity plugin has its own settings via the Dashboard (**Window > AB Unity MCP**) for port mode (auto/manual), auto-start, and category toggles.

---

## Multi-Instance Support

v2.15.0 adds support for **multiple Unity Editor instances running simultaneously**. This covers two main use cases:

1. **Multiple projects** — Working on different Unity projects at the same time
2. **ParrelSync clones** — Multiplayer game development with symlinked Unity instances (e.g., `ProjectName_clone_0`)

### How It Works

Each Unity Editor instance with the MCP plugin registers itself in a **shared instance registry** file on disk. Instances auto-select a port from the range 7890-7899.

On the first tool call, the MCP server:
- **1 instance found** → Auto-connects and proceeds normally
- **0 instances found** → Warns that no Unity is running (Hub tools still work)
- **Multiple instances found** → Asks the agent to prompt the user which project to target

### Instance Management Tools

| Tool | Description |
|------|-------------|
| `unity_list_instances` | List all running Unity instances with project name, port, Unity version, and ParrelSync clone status |
| `unity_select_instance` | Select which instance to target for this session (by port number) |

Once an instance is selected, all `unity_*` commands are automatically routed to that instance's port.

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

## Important: Use the MCP Connector, Not the Bridge

> **Do NOT call the Unity HTTP bridge directly** (e.g. `http://127.0.0.1:7890/api/...`).

The HTTP bridge on port 7890 is an **internal communication layer** between this MCP server and the Unity Editor plugin. It is not meant to be called directly by AI agents or scripts.

**Always use the `unity_*` MCP tools** provided by this connector. They handle:

- Multi-agent queuing and fair scheduling
- Agent identity and session tracking
- Automatic retries and timeout management
- Read batching and write serialization

Direct HTTP calls bypass all of these safety mechanisms and will cause issues in multi-agent scenarios.

The MCP server includes built-in instructions that tell agents to use the connector tools. If an agent still tries to call the bridge directly, it's likely a misconfiguration — make sure the `unity-mcp` connector is properly registered and visible in Claude's MCP server list.

---

## Troubleshooting

**"Connection failed" errors** — Make sure Unity is open and the plugin is installed. Check the Unity Console for `[AB-UMCP] Server started on port 7890`.

**"Unity Hub not found"** — Set `UNITY_HUB_PATH` in your config to match your install location.

**"Category disabled" errors** — A feature category may be toggled off. Open **Window > AB Unity MCP** in Unity to check.

**Port conflicts** — With v2.15.0+, ports are auto-selected from the range 7890-7899 so conflicts are rare. If you need a specific port, enable "Use Manual Port" in the Unity MCP dashboard and set `UNITY_BRIDGE_PORT` in your Claude config to match.

**Queue timeouts** — The default timeout is 30 seconds to accommodate Unity compilation. If you need longer, set `UNITY_BRIDGE_TIMEOUT` to a higher value (in ms).

**Unity tools not visible in Claude / Cowork** — If you're running an older server version (<2.16.0) that exposes all 268+ tools as individual MCP tools, the response payload (~125KB) exceeds what MCP clients can handle and they silently drop the entire tool list. Update to v2.16.0+ which uses the two-tier system to keep the payload under ~32KB.

**Extension not appearing after install** — Restart Claude Desktop after installing the `.mcpb` file. If using manual setup (Option B), double-check:
1. The `args` path points to the actual `src/index.js` file on your machine
2. You used forward slashes in the path (even on Windows)
3. You ran `npm install` in the server directory
4. You restarted Claude after adding the config
5. Unity is open with the plugin installed and showing "Server started" in the console

**execute_code fails with compilation errors on Unity 6000+** — Make sure you're running plugin v2.10.3+, which uses the Roslyn compiler instead of CodeDom/mcs. Roslyn handles .NET Standard type-forwarding natively and eliminates facade assembly conflicts on CoreCLR.

---

## Requirements

- **Unity Editor** with [AnkleBreaker Unity MCP — Plugin](https://github.com/AnkleBreaker-Studio/unity-mcp-plugin) installed (for Editor tools)
- **Unity Hub** (for Hub tools)
- **Node.js 18+** — only needed for manual setup (Option B). The Desktop Extension (Option A) uses Claude's built-in Node.js.

### Building the Desktop Extension

To build the `.mcpb` bundle from source:

```bash
npm run pack
```

This requires `@anthropic-ai/mcpb` (fetched automatically via npx).

---

## Contributing

Contributions are welcome! This is an open-source project by [AnkleBreaker Consulting](https://anklebreaker-consulting.com) & [AnkleBreaker Studio](https://anklebreaker-studio.com).

1. Fork the repo
2. Create a feature branch
3. Make your changes
4. Submit a pull request

Please also check out the companion plugin repo: [AnkleBreaker Unity MCP — Plugin](https://github.com/AnkleBreaker-Studio/unity-mcp-plugin)

---

## Changelog

### v2.16.0

- **Two-tier tool system** — Splits 259 tools into 66 core (always exposed) + 193 advanced (accessed via `unity_advanced_tool`). This reduces the MCP response payload from ~125KB to ~32KB, fixing silent tool registration failures in Claude Desktop and Cowork. Core tools cover the most common Unity operations; advanced tools for animation, physics, lighting, shaders, profiling, etc. are all still accessible on-demand.
- **New meta-tools**: `unity_list_advanced_tools` (browse the full catalog by category) and `unity_advanced_tool` (execute any advanced tool by name + params).
- **Fixed duplicate tool name** — Removed duplicate `unity_agents_list` definition that could cause MCP client rejection.
- **Cowork compatibility** — The server now works reliably in Claude Cowork mode, matching the response size profile of other working MCP servers (~30KB, ~70 tools).

### v2.15.0

- **Multi-instance support** — Discovers and connects to multiple Unity Editor instances running simultaneously. Auto-selects when only one instance is found; prompts for selection when multiple are detected. Supports any multi-instance workflow including ParrelSync clones for multiplayer development.
- **New tools**: `unity_list_instances` (discover running instances) and `unity_select_instance` (choose which project to target).
- **Dynamic port routing** — All bridge commands are routed through the selected instance's port instead of a hardcoded default.
- **Instance registry discovery** — Reads from a shared JSON registry written by each Unity instance, with fallback port scanning for robustness.
- Requires plugin v2.10.0+.

### v2.14.5

- **Non-Amplify project optimization** — Cached assembly scanning to prevent repeated reflection scans in projects without Amplify Shader Editor.
- Requires plugin v2.14.5+.

### v2.14.3

- **CloseAmplifyEditor save fix** — Default changed to `save=true` to prevent unsaved changes dialog. Smart path detection for `SaveAmplifyGraph` (auto-generates path from shader name, accepts optional `path` parameter).
- Requires plugin v2.14.3+.

### v2.14.2

- **Reflection type initialization fix** — Fixed "Object reference not set" errors when calling graph-dependent Amplify tools.
- Requires plugin v2.14.2+.

### v2.14.1

- **GetCurrentGraph rewrite** — Fixed graph retrieval to use correct ASE field names, resolving graph access failures.
- Requires plugin v2.14.1+.

### v2.14.0

- **14 new Amplify Shader Editor graph manipulation tools** — `unity_amplify_add_node`, `unity_amplify_remove_node`, `unity_amplify_connect`, `unity_amplify_disconnect`, `unity_amplify_node_info`, `unity_amplify_set_node_property`, `unity_amplify_move_node`, `unity_amplify_save`, `unity_amplify_close`, `unity_amplify_create_from_template`, `unity_amplify_focus_node`, `unity_amplify_master_node_info`, `unity_amplify_disconnect_all`, `unity_amplify_duplicate_node`. Full graph manipulation: add/remove/connect/disconnect/duplicate nodes, set node properties via reflection, move nodes, save/close editor, create shaders from templates (surface, unlit, URP lit, transparent, post-process), inspect master node, and focus view on nodes.
- Amplify toolset expanded from 9 to 23 tools, matching the comprehensive ShaderGraph toolset.
- Requires plugin v2.14.0+.

### v2.13.2

- **Prefab render stability fix** — `unity_graphics_prefab_render` now safely uses Unity's built-in AssetPreview system, preventing editor crashes on complex prefabs with runtime scripts.
- Requires plugin v2.13.2+.

### v2.13.0

- **9 new graphics & visual intelligence tools** — `unity_graphics_asset_preview`, `unity_graphics_scene_capture`, `unity_graphics_game_capture`, `unity_graphics_prefab_render`, `unity_graphics_mesh_info`, `unity_graphics_material_info`, `unity_graphics_texture_info`, `unity_graphics_renderer_info`, `unity_graphics_lighting_summary`. Get inline base64 PNG previews of assets, scenes, game view, and prefabs that Claude can see directly. Deep graphical metadata: mesh geometry stats, material shader properties, texture analysis, renderer settings, and lighting summaries.
- **MCP image content block support** — Tools that return images now use MCP `{ type: "image" }` content blocks for inline viewing instead of file paths.
- Requires plugin v2.13.0+.

### v2.12.0

- **5 new prefab variant management tools** — `unity_prefab_variant_info`, `unity_prefab_compare_variant`, `unity_prefab_apply_variant_override`, `unity_prefab_revert_variant_override`, `unity_prefab_transfer_variant_overrides`. Inspect variant/base relationships, compare overrides, apply overrides to base, revert variant to base, and transfer overrides between variants.
- Requires plugin v2.12.0+.

### v2.11.0

- **8 new prefab asset editing tools** — `unity_prefab_get_hierarchy`, `unity_prefab_get_properties`, `unity_prefab_set_property`, `unity_prefab_add_component`, `unity_prefab_remove_component`, `unity_prefab_set_reference`, `unity_prefab_add_gameobject`, `unity_prefab_remove_gameobject`. Edit prefab assets directly on disk — browse hierarchy, get/set properties, wire references, add/remove components and children — all without instantiating into a scene.
- Requires plugin v2.11.0+.

### v2.10.6

- **3 new reference wiring tools** — `unity_component_set_reference`, `unity_component_batch_wire`, `unity_component_get_referenceable` for wiring ObjectReference properties between components, GameObjects, and assets without writing custom scripts.
- **`execute_code` now uses Roslyn** — Requires plugin v2.10.3+. Fixes Windows path-length errors and .NET Standard facade conflicts on Unity 6000+ (CoreCLR).
- **`set_property` supports ObjectReference** — Pass `{"instanceId": ...}`, `{"assetPath": ...}`, `{"gameObject": ..., "componentType": ...}`, a plain asset path, or a scene object name.

### v2.9.1

- Multi-agent async queue system with ticket-based scheduling
- Agent identity tracking and session management
- Desktop Extension (.mcpb) packaging support
- 229 tools across 21 categories

---

## License

MIT License — Copyright (c) 2026 [AnkleBreaker Consulting](https://anklebreaker-consulting.com) & [AnkleBreaker Studio](https://anklebreaker-studio.com). All rights reserved.

See [LICENSE](LICENSE) for the full text.
