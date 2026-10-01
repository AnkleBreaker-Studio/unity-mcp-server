# Server agent state

Each MCP process keeps selected editors, discovery state and automatic-context markers in one bounded store. Defaults are 1,024 agents and 8 MiB of accounted UTF-8 identity data. Previously, changing agent IDs retained every completed agent indefinitely; the diagnostic retained 4,096 selections after 4,096 agents. It now retains 1,024, with no active leases after completion, on Node 18 and 22.

## Routing after eviction

The least recently used inactive record is removed only when admitting an agent or updating a selection would exceed a limit. Idle time alone does not discard a selection. Active tool/resource requests pin their record; shared discovery and capability negotiation retain an independent lease until the underlying operation settles, including after observer cancellation. If active records prevent admission, the request fails with `agent_state_capacity` before editor dispatch.

Once any record has been evicted, all unknown IDs require an explicit selection for the rest of that MCP process, including genuinely new IDs. This conservative rule avoids keeping an unbounded list of forgotten IDs. Returning agents must never silently switch to whichever editor happens to be available. Remembered selections retain their existing routing behavior.

Use `unity_list_instances`, then `unity_select_instance` with the intended port or unique project name. An explicit tool `port` or resource `_meta.port` also works when admission succeeds; it routes that call without restoring a persistent selection. Process restart has the existing fresh-session behavior. IDs and aliases remain process-local routing identifiers, not authentication credentials.

Tools/list, Hub operations and instance listing do not admit new agent records. Instance listing can still inspect a remembered selection. Advanced-tool discovery retains its normal selected-editor behavior so plugin-provided dynamic routes remain discoverable.

## Limits and monitoring

| Setting or bound | Default | Behavior |
|---|---:|---|
| `UNITY_MCP_AGENT_STATE_LIMIT` | 1,024 | Integer from 1 to 65,536; invalid values use the default |
| `UNITY_MCP_AGENT_STATE_BYTES` | 8,388,608 | Sum of UTF-8 agent-ID bytes and serialized selected-instance metadata; minimum 1,024 |
| Agent ID | 1,024 UTF-8 bytes | Longer IDs return `agent_id_too_large`; never truncated into collisions |
| Selected-instance metadata | 65,536 UTF-8 bytes | Larger selections return `agent_state_metadata_too_large`; the previous selection remains committed |
| Context markers per agent | 16 | SHA-256 target keys; evicted markers permit context to be injected again |

`unity_queue_info` adds `serverAgentState` alongside the existing plugin response. It reports record and identity-byte limits, current counts, active agents/leases, pending selections, context markers, evictions and admission refusals. Its own request normally accounts for one active lease. A late failed context fetch cannot remove a newer marker for the same target.

Accounted identity bytes are **not heap usage**. Record overhead, bounded markers, active request payloads, SDK parsing, transport buffers and plugin memory are separate. These limits bound retained agent bookkeeping; they are not a total process memory quota or an end-to-end throughput claim. No timer or TTL cleanup loop is added.

## Validation

The [report](validation/agent-state.json) records fourteen new regression checks, the 4,096-agent diagnostic and real Unity 6000.6.2f1 checks using the current and released plugin checkouts. Seven of the initial eight regression cases fail before the change; the unchanged single-editor control passes. The full ordinary suite passes 243 tests locally on Node 22.

The two-editor suite runs on Node 18 and 22 with a two-agent cap. It covers pressure eviction, unknown/returning agents, explicit routing, reselection, twelve overlapping reads, telemetry and clean final project states. It uses MCP stdio and does not mutate scene content. Existing concurrent-selection, cancellation, resource and protocol regressions remain in the ordinary suite.

```bash
node --test tests/agent-state.test.mjs tests/unit/agent-state.test.mjs
node tests/diagnostics/state-retention-audit.mjs /absolute/path/to/report.json
# UNITY_MCP_AGENT_STATE_PROJECTS contains two absolute paths to marked, open validation projects.
npm run test:agent-state
```

The Unity plugin and published versions are unchanged by this server correction. Actual Unity 2021 execution remains deferred at the maintainer's request.
