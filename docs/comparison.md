# Choosing a Unity integration

Compare the workflows you will actually use: several editors, several agents, multiplayer iteration, undo, diagnostic visibility and the size of the tool surface sent to your model.

| Evaluation criterion | AnkleBreaker implementation | Evidence to inspect |
|---|---|---|
| Overlapping requests to different projects | Request-local routing and agent identity, target pinned through polling | `tests/concurrency.test.mjs`, `src/request-context.js` |
| Lost submission responses | Protocol-2 retries recover the original ticket within one session and retry window; old plugins return uncertainty without write replay | `tests/retry-safety.test.mjs`, [wire contract](queue-protocol.md), actual Unity HTTP validation |
| Agents sharing an editor | Per-agent FIFO and fair round-robin execution, grouped reads | Plugin `MCPRequestQueue.cs`, Unity validation runner |
| Multiplayer workflows | MPPM scenarios and virtual player operations, ParrelSync clone discovery | Plugin `MCPScenarioCommands.cs`, `MCPInstanceRegistry.cs` |
| Reversible scene work | Supported write operations receive named undo groups and action records | Plugin queue, `MCPActionHistory.cs`, `MCPUndoCommands.cs` |
| Context cost | 80 tools initially exposed; 269 advanced tools discovered on demand | Tool registry tests and byte-size gates |
| Version drift between editors | Per-editor capability detection and legacy routing | [Four live released/current pairs](compatibility.md), plus concurrent agents across mixed plugin versions |
| Observability | Agent logs, queue depth, separate wait/processing timings and distinct error/exception/timeout outcomes | [End-to-end monitoring checks](queue-monitoring.md) and [Dashboard measurements](dashboard.md) |
| Package coverage | Optional ProBuilder, UMA, Amplify, Shader Graph and other integrations | [Tool guide](features.md); [UMA V3.1f1 live workflows](uma.md). Other integrations have different validation coverage. |

## Current alternatives

Routing, transport and Assistant gateway sources rechecked on 2026-10-01. This is a documentation comparison, not a benchmark of competing products.

- **Coplay Unity MCP** documents multiple instances, per-call instance selection and transport choices for multiple clients. Those are shared capabilities, not exclusive AnkleBreaker features. See its [multi-instance guide](https://coplaydev.github.io/unity-mcp/guides/multi-instance) and [transport documentation](https://coplaydev.github.io/unity-mcp/architecture/transports).
- **Unity's own AI tooling** documents external-agent access and MCP integration. Availability and packaging vary with the Unity AI version; inspect the current [AI overview](https://unity.com/blog/unity-ai-how-to-get-started) and [Assistant gateway documentation](https://docs.unity.cn/Packages/com.unity.ai.assistant%402.9/manual/integration/ai-gateway-intro.html).

Two concrete design choices are worth evaluating under concurrent work:

- **Scheduling within an editor.** AnkleBreaker maintains a FIFO queue per agent and visits those queues in round-robin order, processing one write or up to five classified reads per update. [Scheduling tests and limits](queue-monitoring.md). Coplay's guide describes a serial receive loop that awaits each command before reading the next. This is a difference in the documented scheduling mechanisms; it is not a measured latency advantage. [Coplay multi-agent behavior](https://coplaydev.github.io/unity-mcp/guides/multi-instance#running-several-agents-against-one-editor).
- **A lost submission acknowledgement.** With both updated AnkleBreaker components, a retry with the same request ID recovers the original ticket within the same queue session and retry window. Reloads and expired results can still leave an unknown outcome. [Retry contract and tests](queue-protocol.md). Coplay's guide states that its requests have no idempotency key and advises checking an operation's effects before retrying after execution has begun. [Coplay retry behavior](https://coplaydev.github.io/unity-mcp/guides/multi-instance#running-several-agents-against-one-editor).

AnkleBreaker is particularly relevant when you want its broad tool catalog together with explicit request routing, fair editor scheduling, multiplayer scenario controls, agent history, per-action undo and Unity Hub operations. Evaluate those together in your own project. We do not claim that other products lack a feature based solely on its absence from a README, or claim a speed advantage without comparable measurements.
