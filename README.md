# Unity MCP Server

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that gives AI assistants like Claude full control over **Unity Hub** and **Unity Editor**. Built by [AnkleBreaker Studio](https://github.com/AnkleBreaker-Studio).

## Features

**145+ tools** covering the full Unity workflow:

| Category | Tools |
|----------|-------|
| **Unity Hub** | List/install editors, manage modules, set install paths |
| **Scenes** | Open, save, create scenes, get full hierarchy tree |
| **GameObjects** | Create (primitives/empty), delete, inspect, transform (world/local) |
| **Components** | Add, remove, get/set any serialized property |
| **Assets** | List, import, delete, create prefabs, create & assign materials |
| **Scripts** | Create, read, update C# scripts |
| **Builds** | Multi-platform builds (Windows, macOS, Linux, Android, iOS, WebGL) |
| **Console** | Read/clear Unity console logs (errors, warnings, info) |
| **Play Mode** | Play, pause, stop |
| **Editor** | Execute menu items, run C# code, get editor state |
| **Project** | Project info, packages, render pipeline, build settings |
| **Animation** | List clips & controllers, get parameters, play animations |
| **Prefab** | Open/close prefab mode, get overrides, apply/revert changes |
| **Physics** | Raycasts, sphere/box casts, overlap tests, physics settings |
| **Lighting** | Manage lights, environment, skybox, lightmap baking, reflection probes |
| **Audio** | AudioSources, AudioListeners, AudioMixers, play/stop, mixer params |
| **Tags & Layers** | List/add/remove tags, assign tags & layers |
| **Selection** | Get/set editor selection, find by name/tag/component |
| **Input Actions** | Action maps, actions, bindings (Input System package) |
| **Assembly Defs** | List, inspect, create, update .asmdef files |
| **Profiler** | Start/stop profiling, stats, deep profiles, save profiler data |
| **Frame Debugger** | Enable/disable, draw call list & details, render targets |
| **Memory Profiler** | Memory breakdown, top consumers, snapshots (`com.unity.memoryprofiler`) |
| **Shader Graph** | List, inspect, create, open Shader Graphs & Sub Graphs; VFX Graphs |
| **Amplify Shader** | List, inspect, open Amplify shaders & functions (if installed) |
| **Multi-Agent** | List active agents, get agent action logs |

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

In Unity: **Window > Package Manager > + > Add package from git URL:**
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

Open Claude Desktop > Settings > Developer > Edit Config, and add:

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
- *"Profile my scene and show the top memory consumers"*
- *"List all Shader Graphs in my project"*
- *"Build my project for Windows"*
- *"Show me the active agent sessions"*

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `UNITY_HUB_PATH` | `C:\Program Files\Unity Hub\Unity Hub.exe` | Unity Hub executable path |
| `UNITY_BRIDGE_HOST` | `127.0.0.1` | Editor bridge host |
| `UNITY_BRIDGE_PORT` | `7890` | Editor bridge port |
| `UNITY_BRIDGE_TIMEOUT` | `30000` | Request timeout in ms |

The Unity plugin also has its own settings accessible via the Dashboard (`Window > MCP Dashboard`) for port, auto-start, and per-category feature toggles.

## Optional Package Support

Some tools activate automatically when their packages are detected in the Unity project:

| Package / Asset | Features Unlocked |
|----------------|-------------------|
| `com.unity.memoryprofiler` | Memory snapshot capture via MemoryProfiler API |
| `com.unity.shadergraph` | Shader Graph creation, inspection, opening |
| `com.unity.visualeffectgraph` | VFX Graph listing and opening |
| `com.unity.inputsystem` | Input Action map and binding inspection |
| Amplify Shader Editor (Asset Store) | Amplify shader listing, inspection, opening |

Features for uninstalled packages return helpful messages explaining what to install.

## Requirements

- Node.js 18+
- Unity Hub (for Hub tools)
- Unity Editor with [unity-mcp-plugin](https://github.com/AnkleBreaker-Studio/unity-mcp-plugin) installed (for Editor tools)

## Troubleshooting

**"Connection failed" errors** — Make sure Unity Editor is open and the plugin is installed. Check the Unity Console for `[MCP Bridge] Server started on port 7890`.

**"Unity Hub not found"** — Update `UNITY_HUB_PATH` in your config to match your installation.

**"Category disabled" errors** — A feature category may be toggled off. Open `Window > MCP Dashboard` in Unity to check category settings.

**Port conflicts** — Change `UNITY_BRIDGE_PORT` in your Claude config and update the port in Unity's MCP Dashboard settings.

## Support the Project

If Unity MCP helps your workflow, consider supporting its development! Your support helps fund new features, bug fixes, documentation, and more open-source game dev tools.

<a href="https://github.com/sponsors/AnkleBreaker-Studio">
  <img src="https://img.shields.io/badge/Sponsor-GitHub%20Sponsors-ea4aaa?logo=github&style=for-the-badge" alt="GitHub Sponsors" />
</a>
<a href="https://www.patreon.com/AnkleBreakerStudio">
  <img src="https://img.shields.io/badge/Support-Patreon-f96854?logo=patreon&style=for-the-badge" alt="Patreon" />
</a>

**Sponsor tiers include priority feature requests** — your ideas get bumped up the roadmap! Check out the tiers on [GitHub Sponsors](https://github.com/sponsors/AnkleBreaker-Studio) or [Patreon](https://www.patreon.com/AnkleBreakerStudio).

## License

MIT with Attribution Requirement — see [LICENSE](LICENSE)

Any product built with Unity MCP must display **"Made with AnkleBreaker MCP"** (or "Powered by AnkleBreaker MCP") with the logo. Personal/educational use is exempt.
