# HTTP activity and domain reloads

`unity_queue_info` now includes an additive `http` object. The plugin Dashboard shows the same aggregate counters in **HTTP Activity**, initially collapsed. Existing queue fields and agent-session command outcomes retain their meanings. Older servers can read the additional object without new tools or schemas; older plugins omit it.

HTTP activity includes discovery, submissions, ticket polls, direct requests and requests refused before ticket creation. One command can generate several HTTP requests. A completed HTTP handler does not imply that its command completed successfully: command errors commonly travel in HTTP 200 responses, and accepted asynchronous submissions return HTTP 202.

| Field | Meaning |
|---|---|
| `startedAtUtc` | Initialization time of the counters in the current managed domain. |
| `receivedRequests`, `activeRequests`, `peakActiveRequests` | Handlers entered, still running, and maximum simultaneous handlers. Counting starts when a worker enters `HandleRequest`; requests awaiting ThreadPool dispatch are excluded. |
| `completedRequests` | Handlers that exited, including refusals, exceptions and interruptions. |
| `responses2xx`, `responses4xx`, `responses5xx`, `otherResponses` | Final HTTP status after the response body was written and its output stream closed successfully. |
| `incompleteRequests` | Handlers that exited without that successful response completion. |
| `abortedRequests` | Handlers whose request-level catch observed `ThreadAbortException`; a subset of completed handlers. |
| `inputRejectedRequests` | Body admission, deadline, framing, read, byte, syntax, shape, depth or value-limit failures reported by the input reader/parser. Origin, method and retry-guard refusals remain in HTTP status counters. |
| `activeBodyReaders`, `peakBodyReaders` | Currently admitted body readers and their maximum simultaneous count. |
| `reservedBodyBytes`, `peakReservedBodyBytes` | Current and peak declared-byte reservations; each unknown-length upload reserves 32 MiB. Released after read/decode, before parsing/queueing; not retained payload memory. |
| `bodyReadTimeouts`, `bodyAdmissionRefusals` | Absolute body deadlines exceeded and requests refused by reader/byte admission. Updated when observed, before handler completion; included in input rejections when that handler exits. |
| `maxBodyReaders`, `maxReservedBodyBytes`, `bodyReadTimeoutMs` | Admission/deadline settings: 8 readers, 67,108,864 bytes and 30,000 ms. |
| `inputBytesRead`, `outputBytesWritten` | Body bytes read by the plugin's bounded reader and response-body bytes from successful `Write` calls, accumulated when the handler exits. Excludes headers, active handlers, native buffering/draining and partial failed writes. A successful write does not prove client receipt. |
| `responseSerializationFailures` | Bounded response serialization failures, including cycles and output-size limits. These can occur after a command executes; they are separate from rejected input. |
| `averageDurationMs`, `maxDurationMs` | Completed-handler durations, including input processing, queue waits, serialization and writes. Excludes time awaiting worker dispatch and end-to-end network latency. |
| `domainReloadCount` | Observed domain reloads since diagnostics were first loaded in this editor session. |
| `lastDomainReloadMs` | Time from the diagnostics before-reload hook to its initialization in the new domain. Excludes prior script compilation and does not measure bridge readiness. |
| `activeRequestsAtLastReload` | Active handlers sampled by that before-reload hook; does not prove their commands were cancelled. |

Snapshots are coherent: `receivedRequests = completedRequests + activeRequests`, and the four response classes plus incomplete requests sum to completed requests. A queue-info HTTP request includes itself as active in its returned snapshot. Timings and body volumes describe completed handlers only; unrelated discovery or polling can change totals between reads.

Body admission and snapshots share the same short lock. Gauge changes update the Dashboard revision even while a handler remains active. Input-byte totals count bytes delivered to the bounded reader; chunk framing, native buffers and a pending read that completes after its handler timed out are excluded. See [input limits](request-input.md) for admission, framing and deadline semantics.

HTTP counters reset on domain reload and survive bridge stop/start within the same domain. Reload metadata uses Unity's [SessionState](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/SessionState.html), which survives assembly reloading and is cleared when the editor exits. Reload hooks use [AssemblyReloadEvents](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/AssemblyReloadEvents.html); entering Play Mode without a domain reload does not increment this count. Aggregate state has fixed size and retains no request payloads, routes or identities. Per-request bookkeeping uses [thread-local fields](https://learn.microsoft.com/en-us/dotnet/api/system.threadstaticattribute), matching the bridge's synchronous worker lifetime, with a short lock when handlers enter/exit or a snapshot is copied.

## Validation

The [recorded report](validation/unity66-http-monitoring.json) covers Unity 6000.6.2f1 on Windows:

- Fourteen controlled checks exercise real `HandleRequest` calls through an owned listener, including HTTP 200/202/400/403/404/405/413/500, UTF-8 byte totals, parser rejection, cyclic/oversized output and counter invariants.
- A separate owned worker interrupted during its main-thread wait returns active counts to baseline, records one incomplete/aborted handler and emits no request-error log.
- Dashboard checks cover changing HTTP labels, control reuse, recreation and saved section preferences. The existing queue, input and command-monitoring regression suites also pass.
- Current and released servers pass the live MCP suite on Node 18.20.8 and 22.18.0: twelve overlapping editor calls, a command failure, pre-ticket depth rejection and an actual domain reload. Reload counts persist while HTTP totals reset.
- All 74 editor sources in the minimum-version check compile against Unity 2021.3.18f1 assemblies. Actual execution on that older editor remains deferred at the maintainer's request.

The unchanged queue and HTTP sections each record **zero allocation events over 100 warmed-up refreshes**, with a positive allocation control. For the complete unattached Dashboard, the idle case falls from **33,700 to 30,400 allocation events**; the changing-agent case falls from **35,100 to 31,800**. Queue refresh now reads a typed snapshot and reuses its comparison buffers instead of constructing the HTTP transport dictionary. These are local allocation-event measurements, not whole-editor CPU, memory, rendering or end-to-end latency claims. In this run idle elapsed time increased from 21.59 to 24.20 ms, so no idle speedup is claimed.

The current owned-listener fixtures send their small request in one stream write and read a bounded response; early refusals now close connections to avoid draining stalled uploads. Mono can still reset an upload before its client receives the rejection. Client receipt and native socket behavior remain distinct from the successful-write counters. The [body report](validation/unity66-request-body.json) adds 12 admission/framing checks, the 35 input and 14 HTTP regressions, interruption cleanup, real Dashboard rendering and four live compatibility runs with the new gauges.

Published checkpoints: plugin `e72cc8b` and server `581e35d`. The [plugin CI](https://github.com/AnkleBreaker-Studio/unity-mcp-plugin/actions/runs/36813150164) passes its 338-route check; the [server CI](https://github.com/AnkleBreaker-Studio/unity-mcp-server/actions/runs/36813155323) passes all eight Node 18/20/22/24 jobs on Windows/Linux, with 195 ordinary tests. Both persistent validation editors compile without errors and retain clean saved scenes outside Play Mode. The temporary live-test editor is closed. Package versions are unchanged; no release was published.

## Reproduce

In the plugin repository, use a closed disposable marked project:

```powershell
./tools~/validate-unity.ps1 -EditorPath 'C:/Program Files/Unity/Hub/Editor/6000.6.2f1/Editor/Unity.exe' -ProjectPath 'C:/UnityMcpValidation/Monitoring66' -Suite HttpDiagnostics
```

Use `-Suite RequestShutdown` and `-Suite Dashboard` for interruption and UI checks. The scripts write reports under `Library/` and exit the disposable editor. They do not contact a running bridge.

For the live MCP suite, open a marked disposable editor outside Play Mode with a clean scene, set `UNITY_MCP_HTTP_MONITOR_PROJECT` to its absolute path, then run `npm run test:http-monitoring` in the server repository. It resolves and verifies that project, requests a script reload and writes `Library/UnityMcpHttpMonitoring.json`. Set `UNITY_MCP_HTTP_MONITOR_SERVER_ENTRY` to test a different server checkout. This suite is opt-in and excluded from ordinary CI.
