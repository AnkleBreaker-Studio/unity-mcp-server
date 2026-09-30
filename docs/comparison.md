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
| Version drift between editors | Queue capability cached per endpoint; older plugins retain synchronous routing | Mixed-plugin protocol test |
| Observability | Agent logs, queue depth, ticket state, separate wait and processing timings | Plugin queue and session classes |
| Package coverage | Optional ProBuilder, UMA, Amplify, Shader Graph and other integrations | Tool definitions and plugin handlers |

## Current alternatives

Checked on 2026-09-30. This is a documentation comparison, not a benchmark of competing products.

- **Coplay Unity MCP** documents multiple instances, per-call instance selection and transport choices for multiple clients. Those are shared capabilities, not exclusive AnkleBreaker features. See its [multi-instance guide](https://coplaydev.github.io/unity-mcp/guides/multi-instance) and [transport documentation](https://github.com/CoplayDev/unity-mcp/blob/beta/website/docs/architecture/transports.md).
- **Unity's own AI tooling** documents external-agent access and MCP integration. Availability and packaging vary with the Unity AI version; inspect the current [AI overview](https://unity.com/blog/unity-ai-how-to-get-started) and [Assistant gateway documentation](https://docs.unity.cn/Packages/com.unity.ai.assistant%402.9/manual/integration/ai-gateway-intro.html).

AnkleBreaker is particularly relevant when you want its broad tool catalog together with explicit request routing, fair editor scheduling, multiplayer scenario controls, agent history, per-action undo and Unity Hub operations. Evaluate those together in your own project. We do not claim that other products lack a feature based solely on its absence from a README, or claim a speed advantage without comparable measurements.
