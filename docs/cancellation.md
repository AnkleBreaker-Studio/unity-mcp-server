# Request cancellation

The server now carries the MCP SDK's per-request cancellation signal through editor discovery, HTTP requests and polling waits. Clients request cancellation with `notifications/cancelled` and the original JSON-RPC request ID. The [MCP cancellation contract](https://modelcontextprotocol.io/specification/2025-06-18/basic/utilities/cancellation) is asynchronous: a response can race with the notification, and clients should discard a response they no longer want.

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/cancelled",
  "params": { "requestId": 12, "reason": "The user stopped waiting" }
}
```

Use the ID of an in-progress request, not a tool name or Unity ticket. Do not cancel `initialize`. Ordinary tool names, schemas, success results and legacy plugin support are unchanged.

## What stops

| Phase when cancellation is received | Server behavior |
|---|---|
| Discovery or queue capability negotiation | Stop this caller's wait; do not subsequently submit its command |
| A bridge HTTP request or response body is in flight | Abort the local request and release its deadline timer |
| Waiting to retry a protected submission | End the backoff; do not make another submission |
| Watching an accepted queue ticket | Stop status polling without resubmitting work |
| Watching a Unity test job | Stop the server's follow-up polling; the Unity test job can continue |
| Reading context or fetching automatic context | Stop the HTTP read; cancelled automatic context remains available to a later call |

The SDK suppresses the response after its request signal is cancelled. There is no cancellation-success result proving that Unity stopped. A request that completes before cancellation can still have delivered its normal response.

**Cancellation stops observation, not an accepted Unity operation.** Once a POST has started, the plugin may have accepted the command even if its acknowledgement never reaches the server. Queued or executing commands, tests, builds and arbitrary code can finish after the MCP caller stops waiting. This change adds no plugin cancellation endpoint and performs no automatic undo. Inspect the project, history or original ticket before repeating a write; a new tool call is a new operation.

Unity Hub processes retain their existing process deadlines. Cancelling a client request does not kill an already-started Hub installer. See [Hub outcomes and process limits](hub.md). The server also cannot interrupt synchronous JavaScript work while it occupies the event loop.

## Shared work and project selection

Concurrent calls can share one capability negotiation per editor endpoint or one initial discovery per agent. Each caller has its own cancellation signal. The shared operation remains active while any caller still needs it; cancelling its last observer aborts the operation and removes it from the pending cache. A later call starts fresh work. Completion of an abandoned operation cannot evict a newer operation using the same key.

Cancelling a validation ping is not evidence that the selected editor disappeared. The existing selection is preserved, and a subsequent call can validate it again. Cancellation is kept distinct from the normal timeout, unavailable-editor and wrong-project paths.

HTTP deadlines remain active through full body reads. Timers and abort subscriptions are removed when waits finish. Parallel operations share one listener on a request signal, avoiding listener-limit warnings during wide scans or batches.

## Evidence and reproduction

The [validation report](validation/cancellation.json) records **15 failing behavior checks** against unmodified server `57376530b06cf78fd923f1334d7de0a4b8616b1f`. A control for unknown/completed cancellation IDs already passed. After correction, all 16 behavior checks and three cleanup/cache checks pass. The full ordinary suite has **137 passing tests** locally on Node 18.20.8 and 22.18.0.

The regressions use real MCP stdio requests against isolated mock bridges. They cover old/new queue protocols, legacy synchronous responses, stalled bodies, retry backoff, shared negotiation/discovery, selected-project validation, resources, automatic context and test-job observation. They also verify that other callers remain functional and cancelled commands are not submitted after discovery completes.

Live checks use Unity 6000.6.2f1 on Windows with Node 18 and 22. After a queue ticket is accepted, the client cancels observation of a small snippet that increments a uniquely named `SessionState` counter. On each run, the cancelled ticket's status-request count stays at **one**, the counter becomes **one**, the cancelled response stays suppressed and another client can read the result. The fixture counter is erased afterward; scene/assets/settings are unchanged. A test-only server entry point passively logs its real status requests on stderr; it does not replace or bypass the transport.

Run ordinary regressions with `npm test`. For live validation, use an open disposable project containing `.unity-mcp-validation`, outside Play Mode and compilation:

```powershell
$env:UNITY_MCP_CANCEL_PROJECT = 'C:/UnityMcpValidation/Queue66'
npm run test:cancellation
```

The suite checks the canonical project path, selects the discovered editor and passes its port explicitly. The snippet briefly waits for 800 ms on the editor thread to leave time for cancellation. Results are written to `Library/UnityMcpCancellation.json`. Without the environment variable, the suite skips without contacting Unity.

This evidence covers MCP cancellation delivered through the pinned SDK and server-owned editor I/O. It does not certify cancellation behavior in every client, older-editor runtime execution, rollback of Unity work or termination of external installers.
