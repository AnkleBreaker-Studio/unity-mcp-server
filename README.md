<p align="center">
  <img src="docs/hero.svg" alt="AnkleBreaker Unity MCP: one workflow, many Unity worlds. Multiple agents, independent editors and multiplayer tools." width="960" />
</p>

# AnkleBreaker Unity MCP

**Your AI assistants, connected to the whole Unity workflow.** Build scenes, inspect running games, coordinate multiplayer scenarios, manage packages and profile projects through Model Context Protocol. Built by [AnkleBreaker Studio](https://github.com/AnkleBreaker-Studio).

[Get started](#get-started) · [Multi-project workflows](#multiple-projects-multiple-agents) · [Tools & demos](docs/features.md) · [Configuration](docs/configuration.md) · [Architecture](docs/architecture.md) · [Changelog](CHANGELOG.md)

| 347 named operations | 80 exposed MCP tools | 269 advanced tools on demand |
|:---:|:---:|:---:|
| Editor, Hub and integrations | Small initial discovery surface | Search a category, fetch one schema, run it |

Counts reflect the checked-in definitions; optional tools require their corresponding Unity packages. The advanced proxy also discovers routes advertised by newer plugins.

## Built for demanding Unity workflows

| Your workflow | What AnkleBreaker provides |
|---|---|
| **Several projects and agents** | Independent request routing, explicit project selection and a fair queue for each editor. [Architecture](docs/architecture.md) |
| **Multiplayer iteration** | MPPM scenario/player controls and parent/virtual-player discovery, plus ParrelSync identity. [Workflow and live tests](docs/multiplayer.md) |
| **Work you can inspect** | Agent history, named undo for supported actions, queue timings, command errors and the Unity Dashboard. [Monitoring](docs/queue-monitoring.md) |
| **Mixed versions and interrupted calls** | Per-editor capability detection, legacy fallback and protected retries when both components support them. [Compatibility](docs/compatibility.md) / [Retry contract](docs/queue-protocol.md) |
| **A full production toolset** | Scene authoring, builds, profiling, packages and optional integrations, with advanced schemas discovered on demand. [Tool guide](docs/features.md) |

The combination is the strength: routing, scheduling, multiplayer controls and observable results in one workflow. See [choosing a Unity integration](docs/comparison.md) for a sourced comparison.

## Get started

**Development preview:** this README describes `Development-Unity66-Modernization`, which has not been released. The commands below install that branch in both repositories. For the existing release line, use the [default-branch instructions](https://github.com/AnkleBreaker-Studio/unity-mcp-server).

### 1. Add the Unity plugin

In Unity, open **Window → Package Manager → Add package from git URL**:

```text
https://github.com/AnkleBreaker-Studio/unity-mcp-plugin.git#Development-Unity66-Modernization
```

The plugin dashboard is at **Window → AB Unity MCP → Dashboard**. Verify the bridge is running there.

### 2. Install the server

Use Node.js 18 or newer; a maintained Node.js LTS is recommended.

```bash
git clone --branch Development-Unity66-Modernization https://github.com/AnkleBreaker-Studio/unity-mcp-server.git
cd unity-mcp-server
npm ci
```

### 3. Connect your assistant

For clients that accept an `mcpServers` JSON configuration:

```json
{
  "mcpServers": {
    "unity": {
      "command": "node",
      "args": ["C:/path/to/unity-mcp-server/src/index.js"]
    }
  }
}
```

Use the absolute path to your checkout. On macOS and Linux, use its Unix path. Clients with another configuration format need the same command and arguments. Restart or reconnect the client's MCP session after editing the configuration.

Editor discovery is automatic. Unity Hub is only needed for Hub commands; set `UNITY_HUB_PATH` if it is installed elsewhere. See [all configuration options](docs/configuration.md).

### 4. Try a complete workflow

> List my running Unity projects. Select my prototype, inspect its scene and compilation errors, create a platform, then capture the scene so I can review it.

> Find the multiplayer tools. List my MPPM scenarios and the players configured in the selected project.

> Inspect the scene's memory use and largest objects, then show me the actions performed by each agent.

## Multiple projects, multiple agents

1. Call `unity_list_instances` and identify the project by name and path.
2. Call `unity_select_instance` with `projectName` or a discovered `port`.
3. Include that `port` on editor calls when coordinating simultaneous tasks.
4. Discover again after an editor restart: ports are dynamic.

Discovery checks the live Unity identity before adopting a port, including registry and default-port fallbacks. [Identity checks and compatibility](docs/discovery.md).

```json
{"name":"unity_editor_state","arguments":{"port":7891}}
```

`7891` is an example; use the port returned by discovery. MCP callers can pass `_meta.agentId` (or the compatible `_meta.agent_id`) to keep agent selections and queue attribution separate. Each stdio process has its own default identity.

Within an editor, the plugin serializes writes and batches up to five reads per update. Different editor processes have independent queues. Simultaneous agents can still make conflicting edits to the same object, so assign clear ownership for shared scene work.

## Explore the editor

| Build & edit | Inspect & verify | Extend & coordinate |
|---|---|---|
| Scenes, GameObjects, components | Console and compilation errors | Multiplayer Play Mode |
| Prefabs, materials, ScriptableObjects | EditMode / PlayMode test jobs | ParrelSync instances |
| Animation curves and controllers | Physics queries, scene statistics | [Unity Hub editors and modules](docs/hub.md) |
| Terrain, navigation, particles | Profiler, memory, Frame Debugger | ProBuilder, UMA, Amplify |
| UI, audio, input actions | Screenshots and action history | [Project-specific context resources](docs/resources.md) |

Discover advanced capabilities with `unity_list_advanced_tools`. Filter by category or search, retrieve the schema for the tool you need, then call it through `unity_advanced_tool`. [Full category guide and examples →](docs/features.md)

<details>
<summary><strong>Watch a scene-building demo</strong></summary>

<p align="center">
  <img src="docs/unity-mcp-showcase-village.gif" alt="Existing demonstration of a village created through Unity MCP, with houses, terrain and environment details" width="800" />
</p>

[More demonstrations: brick breaker, village and castle](docs/features.md).

</details>

## Compatibility and validation

The plugin declares **Unity 2021.3.18f1+** support. Server and plugin versions advance independently and do not need matching version numbers. Current live validation uses **Unity 6000.6.2f1 on Windows**; minimum-version C# compilation also passes. Actual older-editor execution is deferred.

| Verified workflow | Evidence and limits |
|---|---|
| Released/current components | All four server-plugin pairs on Node 18 and 22, plus concurrent agents across mixed plugin versions. [Version matrix](docs/compatibility.md) |
| Multiple editors and reloads | Overlapping calls to two editors, four Play Mode reload configurations and lost-result handling after script reload. [Validation record](docs/modernization.md) |
| Multiplayer Play Mode 3.0 | Host/Client launch, separate agent routing and shared script recompilation. Game networking and ParrelSync lifecycle need separate validation. [Multiplayer guide](docs/multiplayer.md) |
| Scene and asset editing | Enums, references, prefabs, rejected-write preservation and Scene capture cleanup. [Editor workflows](docs/editor-workflows.md) |
| Package Manager | Requests yield between editor updates and remain sequential; list/search/info and local add/remove pass with current and released servers. [Package guide](docs/packages.md) |
| Code results | Valid JSON for non-finite/Unicode values, bounded conversion and HTTP output, and no replay after response failure. [Execution guide](docs/code-execution.md) |
| HTTP downloads | Bounded response reads, including compressed bodies and older plugins; overflow never repeats a command. [Response limits](docs/response-limits.md) |
| Undo across agents | Native stack checks, explicit cascade handling, accurate Undo/Redo eligibility and identity preserved through script reload. [Undo guide](docs/undo.md) |
| Test Runner | Failure cleanup, native cancellation, accurate results and retained job details through script reload. [Testing guide](docs/testing.md) |
| Unity 6.6 builds | Five Windows Mono builds verify managed diagnostics and restoration of project settings. Other platforms and IL2CPP remain untested. [Build guide](docs/builds.md) |
| UMA V3.1f1 | Asset creation, race changes and recipe renames, with the integration isolated from the core bridge. [UMA guide](docs/uma.md) |

Run the server's ordinary regression suite:

```bash
npm ci
npm test
```

These tests run the real MCP stdio process against isolated mock bridges. The companion plugin's Unity runner and the server's opt-in live suites are documented with their prerequisites and results in the linked guides. [Full evidence and remaining work](docs/modernization.md).

## Monitor and troubleshoot

The plugin Dashboard puts queue activity, agent sessions and recent actions first. Agent cards update in place, sections remember their state, and long request text stays readable through tooltips. [Dashboard behavior and measured refresh costs](docs/dashboard.md).

Code execution reuses bounded compiler metadata and reports cache activity in `unity_editor_state.codeExecution`. A local Unity 6.6 benchmark of twenty small calls fell from 15.85 s to 1.01 s; this measures one workload, not every Unity operation. [Execution behavior, measurements and limits](docs/code-execution.md).

- **No editor found:** check the plugin dashboard, console and discovered project path. See [connection troubleshooting](docs/configuration.md#troubleshooting).
- **Slow calls:** inspect `unity_queue_info`, `unity_agents_list` and `unity_agent_log`. Ticket status separates queue wait and processing time; queue info also exposes inactive-session retention and evictions. [Monitoring fields and measurements →](docs/queue-monitoring.md)
- **Compilation in progress:** wait for `isCompiling: false`, then inspect compilation errors. An empty error list during compilation is inconclusive.
- **Tool unavailable:** check category switches and optional packages in the dashboard. Advanced route discovery supports newer plugins without expanding the initial tool list.
- **Response too large:** request smaller read results; inspect the effects before repeating a write. [Response budgets and image handling](docs/response-limits.md).
- **Stopped a request:** the server stops waiting and polling; accepted Unity work can still finish. [Cancellation behavior](docs/cancellation.md).
- **Client registry limit:** set `UNITY_MCP_COMPACT_TOOLS=1`. Full parameter documentation remains available through advanced discovery.

## Support and license

Support development through [GitHub Sponsors](https://github.com/sponsors/AnkleBreaker-Studio) or [Patreon](https://www.patreon.com/AnkleBreakerStudio). Report reproducible issues with the server version, plugin version, Unity version and the affected tool.

[Companion Unity plugin](https://github.com/AnkleBreaker-Studio/unity-mcp-plugin) · [Model Context Protocol](https://modelcontextprotocol.io) · [AnkleBreaker Studio](https://github.com/AnkleBreaker-Studio)

Distributed under the **AnkleBreaker Open License v1.0**. See [LICENSE](LICENSE) for the full terms, including attribution and restrictions on reselling the tool. AI client and model usage costs are separate.
