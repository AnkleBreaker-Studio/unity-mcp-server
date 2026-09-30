# Queue retries and session identity

Protocol version 2 adds protected submission and polling to the existing local bridge. Protocol 3 retains that contract and adds recognition of the [managed build variant](builds.md) option. These changes are available on the modernization branch; server and plugin release numbers remain independent. Public MCP tool names and result envelopes are unchanged.

## Compatibility

| Server / plugin | Behavior |
|---|---|
| New server + protocol 2 or newer plugin | Retry a submission with the same request ID, payload, deadline and queue session; recover its original ticket. |
| New server + older queue plugin | Submit normally. An ambiguous failure returns `outcomeUnknown` instead of repeating the command. |
| New server + plugin without queue endpoints | Fall back after an initial queue-submit 404. Only a refused connection can retry a legacy POST. |
| Older server + new plugin | Existing queue and synchronous endpoints remain available. The older server's retry behavior is unchanged. |

Both updated components are needed for protected submission retries. A timeout never proves that a started command made no changes.

The [live compatibility matrix](compatibility.md) verifies routine workflows with all four released/current server-plugin combinations on Unity 6.6, plus simultaneous commands to editors using different plugin versions. It preserves the older server's retry limitations and does not imply older-Unity runtime coverage.

MCP client cancellation ends server-owned observation, pending retry delays and HTTP reads. It does not remove an accepted Unity ticket or roll back its effects. Shared capability negotiation remains alive for other callers. See [cancellation behavior and tests](cancellation.md).

## Handshake and endpoints

`GET /api/queue/info` advertises `protocolVersion` (at least 2; currently 3), a 32-character `queueSessionId`, monotonic `queueSessionTimeMs`, and `queueRetryWindowMs: 120000`. It runs on the listener thread. The server performs this read before each queued operation and shares concurrent negotiations for one endpoint. This adds one local read, allowing a fresh session/deadline without waiting for Unity's main thread.

| Endpoint | Contract |
|---|---|
| `POST /api/queue/submit-once` | Requires the existing `apiPath`, `body`, `agentId` fields plus `requestId`, `queueSessionId`, `expiresAtMs`. |
| `GET /api/queue/status-scoped` | Requires `ticketId` and `queueSessionId`; refuses a different session before looking up the ticket. |
| Existing `queue/submit`, `queue/status` | Remain compatible with callers that do not provide the new fields. |

Separate endpoint names matter: an older plugin ignores unknown JSON fields and query parameters. Reusing only the old paths would let a protected retry execute after a downgrade, or return an unrelated ticket with a reused number.

Each logical command gets a fresh GUID in `N` format (32 hexadecimal characters). All retries keep that identity, agent, payload and deadline. The deadline is an absolute time in the queue session's monotonic clock, never a UTC timestamp. The server allows a one-second margin within the advertised retry window.

## Atomic admission and retention

The plugin checks the session and deadline before admission. Under the queue lock it checks the agent/request identity and a SHA-256 fingerprint of the route and body, then creates exactly one ticket. Concurrent duplicates return that ticket. Another agent may independently use the same request ID.

The replay record retains only hashes, the ticket ID and deadline. It does not retain the request body, work closure or result. The cache holds at most 10,000 records and rejects new protected submissions when full. Expired records are removed periodically and when capacity is reached. Replays with the original expired deadline remain rejected after eviction.

Result retention is separate: a completed ticket lasts 60 seconds, a timed-out ticket 30 seconds, until cleanup. If its replay record remains but the result was evicted, the plugin returns 410 and does not execute the request again. Domain reload creates a new session; these records are not persisted across it.

| HTTP status / code | Meaning |
|---|---|
| 202 | New ticket or the same ticket returned to a retry. |
| 400 / `invalid_retry_guard`, `invalid_request_id`, `invalid_expiration` | Missing, malformed or unbounded protection fields; no admission. |
| 409 / `queue_session_changed` | Target session changed; the old operation's outcome may be unknown. |
| 409 / `request_conflict` | This agent/request ID already names a different payload or deadline. |
| 410 / `request_expired`, `result_expired` | Retry deadline or result retention elapsed; inspect the original outcome. |
| 429 / `retry_cache_full` | No replay capacity; new work was not admitted. |

Agent IDs and session IDs route and scope operations; they are not authentication credentials. Existing loopback, browser and request-size guards still apply.

## Failure behavior

Only the protected endpoint retries ambiguous submissions, with a bounded attempt count and deadline. On older endpoints, a reset, aborted response, invalid response body or HTTP server error can follow execution; the server reports an unknown outcome. A refused TCP connection can retry because no request was delivered.

After receiving a ticket, the server only polls that ticket. Transient polling errors retry the GET, never the command. Each response-body read is included in its timeout, and each poll is bounded by the remaining overall deadline. Session changes, lost results and exhausted deadlines include recovery identifiers where available and instruct the caller to inspect Unity before issuing another command. Queue-control errors cannot trigger the unknown-command compatibility fallback.

The guarantees apply to retries of one logical call in one queue session and retry window. They do not provide durable execution across reloads, cancellation of running Unity work, transactional scene edits, or deduplication of a newly issued tool call.

Play and Stop have a specific recovery path: if their result is lost, the server reads editor state and reports success only when it matches the requested mode. It never repeats the mutation. Pause toggles a value, so an ambiguous Pause result stays unknown. Arbitrary commands also retain their unknown-outcome error even if the editor reconnects.

## Evidence

The Node fault suite reproduces duplicate writes on the prior transport and checks lost acknowledgements, downgrade, session/ticket reuse, polling recovery and stalled bodies. The [Unity report](validation/unity66-retries.json) covers concurrent atomic admission, conflicts, expired results and bounded capacity. Its real HTTP dispatcher test creates one GameObject from repeated protected submissions and checks both older queue and synchronous contracts. The [live editor report](validation/unity66-editor-lifecycle.json) adds actual script reload, lost-result handling and four Play Mode configurations on Unity 6.6. The wider cross-version/multiplayer matrix remains in [the modernization work](modernization.md).
