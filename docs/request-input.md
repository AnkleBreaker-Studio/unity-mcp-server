# Request input and dispatch

The Unity plugin validates HTTP request bodies before creating a queue ticket or calling a command. A malformed JSON suffix can no longer be ignored while the valid prefix changes the project. Queue envelopes and their embedded command JSON are checked separately, including the legacy synchronous and deferred command paths.

## Limits

| Boundary | Limit | Rejection |
|---|---|---|
| HTTP entity body | 33,554,432 bytes (32 MiB), including a byte-order mark | HTTP 413, `request_too_large` |
| Simultaneous body readers | 8 per editor | HTTP 503, `request_body_busy` |
| Reserved input bytes | 67,108,864 bytes (64 MiB) across active body readers | HTTP 503, `request_body_busy` |
| Body read duration | 30 seconds from the start of reading, including pauses | HTTP 408, `request_body_timeout` |
| HTTP body framing | Complete declared length or complete chunked message | HTTP 400, `incomplete_request_body` |
| JSON nesting | 64 object/array levels, including the root object | HTTP 413, `json_depth_limit` |
| JSON traversal | 1,000,000 values and property names per parsed document | HTTP 413, `json_value_limit` |
| JSON syntax | A complete JSON object, or the existing empty-body convention | HTTP 400, `invalid_json` or `invalid_request` |

The existing 32 MiB request limit counts bytes from the entity stream before character decoding. `Content-Length` permits immediate rejection, and actual stream reads enforce the same limit for chunked transfers. The bounded reader consumes at most the limit plus one byte to detect overflow; native HTTP/socket buffering is separate. Input and early origin/method/path refusals close their connections so the listener does not drain unread bodies for connection reuse.

Admission reserves the declared body size, or the full 32 MiB allowance for unknown-length/chunked input. Thus two unknown-length uploads can occupy the byte budget even when their actual payloads are small. The reservation is released after reading/decoding, including exceptions and worker interruption. Bodyless monitoring and ticket polls need no reservation. The deadline is absolute: sending occasional bytes does not restart it. These additive gauges, peaks and refusal/timeout counts appear in [HTTP monitoring](http-monitoring.md) and the Dashboard.

The queue envelope contains the command body as a JSON string, so its escaping and metadata count toward the HTTP limit. These limits differ from the [plugin response, Node download and MCP output limits](response-limits.md).

The plugin advertises `maxRequestBodyBytes` in `queue/info`. The current server checks the fully serialized envelope's UTF-8 byte count against that negotiated limit before uploading it. A local refusal returns `requestAccepted: false`, `code: "request_too_large"`, `requestBytes` and `limitBytes`; no command is submitted and no retry is needed. Missing or invalid metadata retains the previous behavior, so older plugins keep their own validation contract. The check is specific to the negotiated editor and does not impose its limit on another project. Original MCP input and JSON string allocations still occur before this check.

Depth and value limits bound parser recursion and object creation. Body admission bounds simultaneous readers and their reserved input bytes; it does not cap total editor memory, decoded/queued arguments, all HTTP workers, native buffering, response writes or connections still sending headers. Decoded strings and dictionaries allocate additional memory. This change adds no authentication or execution cancellation.

Unity's Mono listener needs an explicit read deadline because its [entity-body timeout properties are unimplemented](https://github.com/mono/mono/blob/main/mcs/class/System/System.Net/HttpListenerTimeoutManager.cs). Its [chunked stream](https://github.com/mono/mono/blob/main/mcs/class/System/System.Net/ChunkedInputStream.cs) can return zero decoded bytes for both partial framing and socket EOF. On that known implementation, the reader temporarily observes the underlying stream and checks the decoder's completion state. Fragmented final chunks/trailers remain valid; a socket EOF before completion cannot dispatch even if the received JSON is valid. The original stream is restored on exit. If that Mono layout changes, chunked input returns HTTP 503 `chunk_validation_unavailable`, with a suggestion to send `Content-Length`; other runtime stream types use their native framing behavior.

## Compatibility and errors

Decoded arguments retained by HTTP command tickets have a separate count/cost budget after parsing. A full budget returns `command_queue_busy` with `requestAccepted: false`; this differs from an incomplete body or invalid JSON. See [command admission](command-admission.md) for its scope and recovery behavior.

Valid existing request shapes remain: empty command bodies, objects, nested arrays, strings, booleans, null member values and finite numbers. Integer values retain their `int`/`long` representation where possible, with `double` used for other supported numbers. Duplicate object names retain the existing last-value behavior. The existing encoding selection and BOM detection are retained; UTF-8 is the companion server's normal encoding.

Invalid separators, incomplete strings/escapes, extra trailing content, invalid numbers and non-object roots are rejected. Numbers outside the supported finite range are rejected rather than passed to Unity as a default value or infinity. Property/argument schema checks inside individual commands remain separate. The JSON grammar and permission to limit size, nesting and numeric range are described in [RFC 8259](https://www.rfc-editor.org/rfc/rfc8259).

Input rejections return `error`, a machine-readable `code` and `requestAccepted: false`. They issue no ticket and do not reserve a guarded submission's request identity. A valid corrected request can therefore use that unconsumed identity; accepted duplicate submissions keep their existing ticket semantics. Browser/host and HTTP-method checks still run before input parsing.

An HTTP client can lose the rejection response when the connection closes during an upload. The current companion transport preserves an explicit boolean `requestAccepted: false`, including a busy HTTP 503. Protected submissions retain their original identity when using the existing transient-retry policy; legacy/unprotected submissions gain no blind retry. A previous ambiguous attempt still makes the final outcome uncertain: non-acceptance describes this particular response, not any earlier request. Inspect Unity or the original ticket after an unknown outcome. Do not treat every HTTP 413 as input rejection: oversized **responses** can occur after execution.

`MCPRequestInput` is isolated from the existing `MiniJson.Deserialize` readers used for asset files and optional integrations. The dispatcher receives the parsed argument dictionary, so it does not repeat JSON parsing on Unity's main thread. No route, tool name or argument schema is removed.

## Validation

The newer [body admission and framing report](validation/unity66-request-body.json) records two passing compatibility controls and six failing baseline requirements. The missing baseline admission gauges are not evidence of a leak. Twelve final controlled checks pass, including truncated declared/chunked requests with no ticket created, fragmented trailers, eight held readers with responsive bodyless monitoring, 64 MiB reservations, stalled/trickling uploads refused after approximately 30 seconds, and cleanup after interruption. The original 35 input and 14 HTTP checks, Dashboard and shutdown regressions also pass. Four live current/released-server runs on Node 18/22 verify the additive counters and their reset through actual domain reloads. All 74 production sources in the minimum-version check compile against Unity 2021.3 assemblies; actual older-editor execution remains deferred.

The server suite now has 202 passing ordinary tests. Seven new retry checks cover definite refusal and preservation of earlier uncertainty; four failures reproduce against the preceding server. A controlled 20-iteration buffered-reader comparison adds CPU cost (about 182 to 220 ms for 1 MiB bodies); it is not an HTTP throughput benchmark. Its allocation counter fails the positive control, so no allocated-byte claim is made. The 360 px Dashboard captures confirm that the new uploads line wraps and bottom controls remain accessible.

Published checkpoints: plugin `0e450a9`, server `b75df00`, retry fixture `d28f162`. The [338-route plugin CI](https://github.com/AnkleBreaker-Studio/unity-mcp-plugin/actions/runs/36820586759) and all eight [Node 18/20/22/24 Windows/Linux jobs](https://github.com/AnkleBreaker-Studio/unity-mcp-server/actions/runs/36820953662) pass. The initial CI exposed a fixture racing its shortened deadline; it now exhausts all five retry attempts within the normal window while asserting each refusal. The report retains that failure and correction. Runtime retry semantics are unchanged by the fixture adjustment.

Run `-Suite RequestBody` with the plugin validation runner below for the admission/framing fixture. It uses its own loopback listener in a disposable project, includes a 30-second timeout check, and writes `Library/UnityMcpRequestBodyValidation.json`.

The [report](validation/unity66-request-input.json) records 17 failing baseline checks and seven unchanged controls, followed by the expanded controlled suite. It covers byte boundaries, split Unicode sequences, BOMs, grammar, depth/value budgets, actual legacy writes, ordinary/guarded queue submission, deferred rejection, origin rejection and a real oversized chunked body. The chunked test reads the response while uploading so an early 413 need not wait for the client to finish sending.

Ten server checks include three reproduced failures and seven compatibility controls: UTF-8/envelope byte counts, exact boundaries, refusal before submission, follow-up recovery and simultaneous editors with different limits. Live runs distinguish the current server's local preflight refusal from a released server's HTTP rejection or upload connection failure; all verify that the rejected command did not execute.

Run the plugin suite in a marked disposable project:

```powershell
./tools~/validate-unity.ps1 -EditorPath 'C:/Program Files/Unity/Hub/Editor/6000.6.2f1/Editor/Unity.exe' -ProjectPath 'C:/UnityMcpValidation/Input' -Suite RequestInput
```

The companion live suite requires an open marked validation project outside Play Mode, with no compilation or unsaved scene changes:

```powershell
$env:UNITY_MCP_INPUT_PROJECT = 'C:/UnityMcpValidation/Input'
npm run test:input
```

It selects and verifies the actual project path, explicitly routes every operation, checks valid Unicode and deferred package-list requests, and verifies that deep/oversized inputs do not execute a temporary session counter. It removes that counter and writes `Library/UnityMcpRequestInput.json`. Set `UNITY_MCP_INPUT_SERVER_ENTRY` to another checkout's `src/index.js` for server compatibility testing. Without the project variable, the suite skips without contacting Unity.
