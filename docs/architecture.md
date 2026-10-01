# Server and plugin architecture

The Node server and Unity package are independently versioned components. The MCP client speaks JSON-RPC over stdio to Node. Node invokes the local editor bridge; editor operations go through a ticket queue and execute on Unity's main thread. Unity Hub commands use a separate CLI path.

![Routing and execution](workflow.svg)

## Request lifecycle

1. `src/index.js` registers MCP tool and project-context resource handlers. It exposes core tools plus two advanced discovery/dispatch tools.
2. Tool calls and project-resource requests create an `AsyncLocalStorage` context. The default agent ID is unique to the server process; `_meta.agentId` and `_meta.agent_id` remain supported. Tools accept `arguments.port` ahead of `_meta.port`; resources accept `_meta.port`.
3. `instance-discovery.js` reads the shared registry and probes the configured port range. Selection is stored per agent. Concurrent discovery for the same agent shares a promise; an editor target is pinned for the operation after selection checks. Named selection retains the resolved identity through a fresh recheck, and pending selection/validation cannot overwrite a newer choice. [Concurrency contract](discovery.md#selection-and-recovery).
4. `tool-tiers.js` either dispatches a known handler or derives an advanced route. Route overrides preserve names whose public tool name differs from the plugin endpoint. Optional integrations have their own bridge modules.
5. `unity-editor-bridge.js` captures the target and agent; `queue-transport.js` negotiates protocol-2 protection through queue info, submits and polls on that target. Queue support is cached by endpoint, allowing old and new plugin versions to coexist. Protected retries retain one request ID and deadline; scoped polling refuses a different editor queue session.
6. The plugin's `MCPBridgeServer` accepts HTTP on a loopback listener. Request guards and bounded JSON input validation run before ticket creation; parsed arguments then reach the main-thread dispatcher. It handles queue control endpoints separately; ordinary operations enter `MCPRequestQueue`, including legacy synchronous calls. The server checks the full envelope against an advertised input byte limit before upload. See [request input](request-input.md).
7. `EditorApplication.update` drains one write or up to five reads. Agent queues are FIFO and visited in round-robin order. Work executes outside the queue lock, on Unity's main thread. The queue lock protects indexes and scheduling state.
8. Deferred Unity APIs complete through callbacks. A shared transition under the queue lock finalizes tickets exactly once within the current editor domain, updates session counters, releases work closures and signals legacy waiters. Duplicate or late callbacks cannot replace a terminal result. Node translates results into MCP text or image blocks and marks recognized logical failures with `isError`.

Legacy waiters expire after 30 seconds. Unstarted work is removed or skipped; an already-started operation cannot be canceled. Deferred execution expires after 120 seconds measured from its start when cleanup runs. Completed/failed results are retained for 60 seconds, timed-out results for 30 seconds, until periodic cleanup. Deadlines and retention use monotonic time. The [retry protocol](queue-protocol.md) adds bounded deduplication within a queue session and reports uncertain outcomes when that session or its result is lost; it does not provide durable execution across reloads.

## State ownership

| State | Owner and lifetime |
|---|---|
| Agent ID, explicit port, pinned bridge URL, cancellation signal | One asynchronous MCP call |
| Selected editor, discovery and selection requirement | Bounded agent store within a Node process; active requests pin records |
| Automatic context injection | Up to 16 hashed target URL/project-path markers per retained agent |
| Queue protocol support | Bridge endpoint within a Node process |
| Registry entries, heartbeat, port affinity | Editor instance / shared machine registry |
| Pending, executing and completed tickets | Editor process; domain reload recreates static state |
| Action history | Plugin memory plus its existing persistence implementation |
| Test jobs and compilation diagnostics | Dedicated plugin command classes |

Stdio does **not** serialize handler completion. Handlers overlap whenever they await I/O. Agent/port globals are therefore unsuitable for carrying request identity. The regression suite overlaps two real MCP calls and checks the returned project, injected context and polling headers.

`agent-state.js` bounds retained agent count and serialized identity bytes. Inactive records can be evicted under pressure; afterward, unknown IDs require explicit selection. Request scopes and underlying shared work release their leases when settled. See [state admission and routing](agent-state.md).

Project-context resources use the same routing isolation while retaining their category-relative URIs. A missing selection cannot read another project's default-port context; a vanished selected project keeps requiring explicit reselection. See [resource semantics and validation](resources.md).

Per-request cancellation reaches editor HTTP reads and observation loops. Shared discovery/negotiation remains active for other observers and is aborted when none remain. See [cancellation and accepted-operation semantics](cancellation.md).

The shared HTTP reader bounds incoming decompressed bodies before UTF-8 decoding/JSON parsing. Oversize stops transport retries and reports unknown outcomes after submission, preserving known recovery identifiers. The default 32 MiB download cap is independent of plugin serialization and MCP output budgets. See [response limits](response-limits.md#node-http-downloads).

Discovery distinguishes recognized identities, unavailable endpoints and unrecognized successful responses. Only unavailable endpoints retain fresh-registry recovery; per-attempt probe reuse avoids duplicate checks. [Identity and compatibility contract](discovery.md).

## Plugin subsystems

| Subsystem | Main source files | Important behavior |
|---|---|---|
| Listener, dispatch, reload lifecycle | `MCPBridgeServer.cs`, `MCPBridgeServer.Routes.g.cs` | Queue and legacy entry paths, route category checks, startup/stop/restart. The generated route list has a drift check. |
| Scheduling and observability | `MCPRequestQueue.cs`, `MCPAgentSession.cs` | Ticket indexes, read batching, fair writes, sessions, timing and retention. |
| Package operations | `MCPPackageManagerCommands.cs` | Sequential native requests polled on editor updates; expired pending work is dropped while started work retains its slot. [Contracts and validation](packages.md). |
| Test jobs | `MCPTestRunnerCommands.cs`, `MCPTestRunnerPersistence.cs` | One active job per editor, callbacks bound to its identity, native cleanup admission and restoration of Play Mode settings. [Failure, cancellation and reload limits](testing.md). |
| Result serialization | `MiniJson.cs`, `MCPEditorCommands.cs` | Global conversion/traversal bounds, early HTTP byte limits and explicit failures after execution. [Contracts](code-execution.md) |
| Undo and history | `MCPActionHistory.cs`, `MCPActionRecord.cs`, `MCPUndoCommands.cs`, `MCPUndoState.cs` | Native group/session checks, explicit cascade consent and sealed synchronous groups; deferred operations do not collapse interleaved groups. [Undo contract](undo.md) |
| Discovery | `MCPInstanceRegistry.cs` | Cross-process registry locking, identity, port affinity, clone metadata and heartbeat. |
| Settings and diagnostics UI | `MCPSettingsManager.cs`, dashboard/toolbar/self-test classes | Categories, startup policy, agent visibility and safe feature probes. |
| Multiplayer | `MCPScenarioCommands.cs` | Package-dependent scenario and player APIs resolved at runtime; MPPM virtual-player startup policy. |
| Unity API compatibility | `MCPObjectId.cs`, version-gated command implementations | Decimal string identity on the wire; EntityId APIs on newer Unity and instance-ID APIs on older Unity. |
| Read/write policy | `MCPCommandPolicy.cs` | Explicit eligibility for read batching; unknown commands stay on the write path. |
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

The plugin batch runner compiles the actual package and exercises object IDs, scheduling, duplicate/late callbacks, deferred expiration and retention, normal synchronous calls and real 30-second timeout races inside Unity 6.6.2. It also checks dashboard labels for running-only activity and failure/timing metrics. This is a state check, not an interactive visual review. Its polling measurements cover dictionary construction for status responses, not HTTP latency, scene execution or total editor responsiveness.

Separate opt-in stdio suites drive two actual Unity editors, four Play Mode reload configurations, and script reload with a lost result. Build validation inspects constants in Windows Mono player assemblies and verifies restoration of project settings. These use disposable marked projects and are not part of ordinary mock-based CI.

The [multiplayer suite](multiplayer.md) adds real MPPM 3.0 parent/virtual-player processes on Unity 6.6, native scenario selection, Host/Client roles, per-agent routing and shared script recompilation. This verifies editor orchestration; networking inside a game remains separate.

The plugin's `-Suite Health` checks inactive-session eviction, preservation of outstanding work, read/write scheduling and empty queue allocation counts with a positive control. See [queue monitoring](queue-monitoring.md) for the measurements and their scope.

See [modernization evidence and remaining work](modernization.md) before interpreting either suite as complete product coverage.
