# Configuration and integrations

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `UNITY_HUB_PATH` | `C:\Program Files\Unity Hub\Unity Hub.exe` | Unity Hub executable path |
| `UNITY_BRIDGE_HOST` | `127.0.0.1` | Editor bridge host |
| `UNITY_BRIDGE_PORT` | `7890` | Editor bridge port (auto-discovered when using multi-instance) |
| `UNITY_BRIDGE_TIMEOUT` | `60000` | Request timeout in ms |
| `UNITY_HTTP_RESPONSE_LIMIT` | `33554432` | Maximum decompressed HTTP response body per editor request; minimum 1024 bytes; abort reading on overflow |
| `UNITY_PORT_RANGE_START` | `7890` | Start of port scan range for multi-instance discovery |
| `UNITY_PORT_RANGE_END` | `7899` | End of port scan range |
| `UNITY_INSTANCE_REGISTRY` | OS-specific UnityMCP directory | Override the shared registry file path |
| `UNITY_QUEUE_POLL_INTERVAL` | `150` | Initial ticket polling interval in ms |
| `UNITY_QUEUE_POLL_MAX` | `1500` | Maximum polling interval in ms |
| `UNITY_QUEUE_POLL_TIMEOUT` | `120000` | Total ticket observation timeout in ms; expiration does not undo a command |
| `UNITY_REGISTRY_STALENESS_TIMEOUT` | `300000` | Registry entry staleness timeout in ms (crash detection) |
| `UNITY_RESPONSE_SOFT_LIMIT` | `2097152` | Serialized UTF-8 tool-result warning threshold; minimum 1 byte |
| `UNITY_RESPONSE_HARD_LIMIT` | `4194304` | Serialized UTF-8 tool/resource-result limit; minimum 1024 bytes; oversized results fail explicitly |
| `UNITY_MCP_DEBUG` | unset | Set to `1` for diagnostic logging; 5 MiB rotation threshold, one previous generation and 64 KiB entries. [Behavior and limits](debug-logging.md) |
| `UNITY_MCP_PRETTY_JSON` | unset | Set to `1` to pretty-print tool responses (default is compact JSON — 20-50% fewer tokens) |
| `UNITY_MCP_COMPACT_TOOLS` | unset | Set to `1` for a smaller tool registry: keeps all 80 exposed tools and schema structure, drops per-parameter prose. For clients with registry size limits. |

The Unity plugin also has its own settings accessible via the Dashboard (`Window > AB Unity MCP > Dashboard`) for port, auto-start, and per-category feature toggles.

Project-context resources follow the selected editor and optional agent/port request metadata. Their existing category URIs remain relative to that selection. See [resource routing and multi-project behavior](resources.md).

Response budgets include JSON escaping and metadata. Invalid values fall back to defaults; the soft limit is clamped to the hard limit. See [response limits, image results and recovery](response-limits.md).

The separate HTTP limit bounds each incoming editor response before JSON parsing, including older plugins, discovery and context reads. It does not raise the MCP result limits or cap total process memory. A limit failure after submission does not undo the Unity operation.

Discovery validates successful ping bodies before adopting editor ports; a registry entry cannot turn an unrelated service into a Unity instance. See [identity checks and routing limits](discovery.md).

## Optional Package Support

Some tools activate automatically when their packages are detected in the Unity project:

| Package / Asset | Features Unlocked |
|----------------|-------------------|
| `com.unity.memoryprofiler` | Memory snapshot capture via MemoryProfiler API |
| `com.unity.shadergraph` | Shader Graph creation, inspection, opening |
| `com.unity.visualeffectgraph` | VFX Graph listing and opening |
| `com.unity.inputsystem` | Input Action map and binding inspection |
| `com.unity.multiplayer.playmode` | MPPM scenario listing, activation, start/stop, player info |
| Amplify Shader Editor (Asset Store) | Amplify shader listing, inspection, opening |
| UMA 2 (Asset Store) | UMA SlotDataAsset/OverlayDataAsset creation, WardrobeRecipe pipeline, Global Library management, DCA wardrobe equip/unequip |

Features for uninstalled packages return helpful messages explaining what to install.

## Requirements

- Node.js 18+
- Unity Hub (for Hub tools)
- Unity Editor with [unity-mcp-plugin](https://github.com/AnkleBreaker-Studio/unity-mcp-plugin) installed (for Editor tools)

## Troubleshooting

**"response_too_large"** - The result could not be delivered within the configured byte limit. Inspect the effects before repeating a write; request smaller results for reads. See [response handling](response-limits.md).

**"request_too_large"** - Reduce the request payload. The plugin enforces its existing 32 MiB input limit; the current server checks the advertised limit before uploading. This input rejection differs from a response failure after execution. See [request input](request-input.md).

**"http_response_too_large"** - The server stopped reading an editor HTTP response above `UNITY_HTTP_RESPONSE_LIMIT`. It does not retry that response or resubmit the command. Inspect the original ticket/project before repeating a write; reduce the scope of reads.

**"Outcome unknown"** - An Editor command may already have executed: inspect the project or original ticket before issuing it again. Updating both components enables protected submission retries; see the [retry and session contract](queue-protocol.md). For a Hub command, inspect Hub installations/settings before retrying; Hub operations run once and have [separate process diagnostics](hub.md).

**"Connection failed" errors** — Make sure Unity Editor is open and the plugin is installed. Check the Unity Console for `[MCP Bridge] Server started on port 7890`.

**"Unity Hub not found"** — Update `UNITY_HUB_PATH` in your config to match your installation.

**"Category disabled" errors** — A feature category may be toggled off. Open `Window > AB Unity MCP > Dashboard` in Unity to check category settings.

**Port conflicts** — Change `UNITY_BRIDGE_PORT` in your Claude config and update the port in Unity's MCP Dashboard settings.

