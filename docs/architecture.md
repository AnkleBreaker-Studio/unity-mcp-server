# Server and plugin architecture

The Node server and Unity package are independently versioned components. The MCP client speaks JSON-RPC over stdio to Node. Node invokes the local editor bridge; editor operations go through a ticket queue and execute on Unity's main thread. Unity Hub commands use a separate CLI path.

![Routing and execution](workflow.svg)

## Request lifecycle

1. `src/index.js` registers MCP tool and project-context resource handlers. It exposes core tools plus two advanced discovery/dispatch tools.
2. A tool call creates an `AsyncLocalStorage` context. The default agent ID is unique to the server process; `_meta.agentId` and `_meta.agent_id` remain supported. `arguments.port` takes precedence over `_meta.port`.
3. `instance-discovery.js` reads the shared registry and probes the configured port range. Selection is stored per agent. Concurrent discovery for the same agent shares a promise; an editor target is pinned for the operation after selection checks.
4. `tool-tiers.js` either dispatches a known handler or derives an advanced route. Route overrides preserve names whose public tool name differs from the plugin endpoint. Optional integrations have their own bridge modules.
5. `unity-editor-bridge.js` captures the target and agent for queue submission and all subsequent polls. Queue support is cached by endpoint, allowing old and new plugin versions to coexist.
6. The plugin's `MCPBridgeServer` accepts HTTP on a loopback listener. Its request guards run before dispatch. It handles queue control endpoints separately; ordinary operations enter `MCPRequestQueue`, including legacy synchronous calls.
7. `EditorApplication.update` drains one write or up to five reads. Agent queues are FIFO and visited in round-robin order. Work executes outside the queue lock, on Unity's main thread. The queue lock protects indexes and scheduling state.
8. Completed tickets remain available for polling. Deferred Unity APIs complete through callbacks. Node translates results into MCP text or image blocks and marks recognized logical failures with `isError`.

## State ownership

| State | Owner and lifetime |
|---|---|
| Agent ID, explicit port, pinned bridge URL | One asynchronous MCP call |
| Selected editor and selection requirement | Agent within a Node process |
| Automatic context injection | Agent + target URL + known project path |
| Queue protocol support | Bridge endpoint within a Node process |
| Registry entries, heartbeat, port affinity | Editor instance / shared machine registry |
| Pending, executing and completed tickets | Editor process; domain reload recreates static state |
| Action history | Plugin memory plus its existing persistence implementation |
| Test jobs and compilation diagnostics | Dedicated plugin command classes |

Stdio does **not** serialize handler completion. Handlers overlap whenever they await I/O. Agent/port globals are therefore unsuitable for carrying request identity. The regression suite overlaps two real MCP calls and checks the returned project, injected context and polling headers.

## Plugin subsystems

| Subsystem | Main source files | Important behavior |
|---|---|---|
| Listener, dispatch, reload lifecycle | `MCPBridgeServer.cs`, `MCPBridgeServer.Routes.g.cs` | Queue and legacy entry paths, route category checks, startup/stop/restart. The generated route list has a drift check. |
| Scheduling and observability | `MCPRequestQueue.cs`, `MCPAgentSession.cs` | Ticket indexes, read batching, fair writes, sessions, timing and retention. |
| Undo and history | `MCPActionHistory.cs`, `MCPActionRecord.cs`, `MCPUndoCommands.cs` | Supported synchronous writes get named groups; deferred operations do not collapse interleaved groups. |
| Discovery | `MCPInstanceRegistry.cs` | Cross-process registry locking, identity, port affinity, clone metadata and heartbeat. |
| Settings and diagnostics UI | `MCPSettingsManager.cs`, dashboard/toolbar/self-test classes | Categories, startup policy, agent visibility and safe feature probes. |
| Multiplayer | `MCPScenarioCommands.cs` | Package-dependent scenario and player APIs resolved at runtime; MPPM virtual-player startup policy. |
| Unity API compatibility | `MCPObjectId.cs`, version-gated command implementations | Decimal string identity on the wire; EntityId APIs on newer Unity and instance-ID APIs on older Unity. |
| Feature families | `MCP*Commands.cs` | Scenes, assets, code, animation, rendering, builds, packages, tests and optional integrations. These still require individual runtime coverage. |

## Compatibility contracts

- Keep public tool names, parameter names, string object IDs, result envelopes and legacy route behavior.
- Use capability checks or version guards for additions; do not require server/plugin version equality.
- Preserve the meaning of existing fields. `executionTimeMs` includes queue wait; new `queueWaitMs` and `processingTimeMs` separate the two using a monotonic clock.
- Keep diagnostics off stdout, which is reserved for MCP framing.
- Keep optional integrations optional and test missing-package behavior.
- A polling failure does not prove a command failed to execute. Submission retries and domain-reload recovery require particular care for writes.

## What the current checks prove

The Node suite validates public MCP framing, schemas, byte budgets, response formatting, discovery and selected error/recovery behaviors against mock plugins. It does not run Unity code.

The plugin batch runner compiles the actual package and exercises object IDs, scheduling, deferred completion and synchronous waiters inside Unity 6.6.2. Its polling measurements cover status lookup and serialization, not HTTP latency, scene execution or total editor responsiveness.

See [modernization evidence and remaining work](modernization.md) before interpreting either suite as complete product coverage.
