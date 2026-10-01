# Request input and dispatch

The Unity plugin validates HTTP request bodies before creating a queue ticket or calling a command. A malformed JSON suffix can no longer be ignored while the valid prefix changes the project. Queue envelopes and their embedded command JSON are checked separately, including the legacy synchronous and deferred command paths.

## Limits

| Boundary | Limit | Rejection |
|---|---|---|
| HTTP entity body | 33,554,432 bytes (32 MiB), including a byte-order mark | HTTP 413, `request_too_large` |
| JSON nesting | 64 object/array levels, including the root object | HTTP 413, `json_depth_limit` |
| JSON traversal | 1,000,000 values and property names per parsed document | HTTP 413, `json_value_limit` |
| JSON syntax | A complete JSON object, or the existing empty-body convention | HTTP 400, `invalid_json` or `invalid_request` |

The existing 32 MiB request limit now counts bytes from the entity stream before character decoding. `Content-Length` permits immediate rejection, and actual stream reads enforce the same limit for chunked transfers. The bounded reader consumes at most the limit plus one byte to detect overflow; native HTTP/socket buffering is separate. An oversized upload closes its connection so the listener does not drain the remaining body for connection reuse.

The queue envelope contains the command body as a JSON string, so its escaping and metadata count toward the HTTP limit. These limits differ from the [plugin response, Node download and MCP output limits](response-limits.md).

The plugin advertises `maxRequestBodyBytes` in `queue/info`. The current server checks the fully serialized envelope's UTF-8 byte count against that negotiated limit before uploading it. A local refusal returns `requestAccepted: false`, `code: "request_too_large"`, `requestBytes` and `limitBytes`; no command is submitted and no retry is needed. Missing or invalid metadata retains the previous behavior, so older plugins keep their own validation contract. The check is specific to the negotiated editor and does not impose its limit on another project. Original MCP input and JSON string allocations still occur before this check.

Depth and value limits bound parser recursion and object creation. They do not cap total editor memory, concurrent requests, retained queue arguments, native buffering or the time taken by a slow sender. Decoded strings and dictionaries still allocate memory within the admitted body. This change adds no authentication or execution cancellation.

## Compatibility and errors

Valid existing request shapes remain: empty command bodies, objects, nested arrays, strings, booleans, null member values and finite numbers. Integer values retain their `int`/`long` representation where possible, with `double` used for other supported numbers. Duplicate object names retain the existing last-value behavior. The existing encoding selection and BOM detection are retained; UTF-8 is the companion server's normal encoding.

Invalid separators, incomplete strings/escapes, extra trailing content, invalid numbers and non-object roots are rejected. Numbers outside the supported finite range are rejected rather than passed to Unity as a default value or infinity. Property/argument schema checks inside individual commands remain separate. The JSON grammar and permission to limit size, nesting and numeric range are described in [RFC 8259](https://www.rfc-editor.org/rfc/rfc8259).

Input rejections return `error`, a machine-readable `code` and `requestAccepted: false`. They issue no ticket and do not reserve a guarded submission's request identity. A valid corrected request can therefore use that unconsumed identity; accepted duplicate submissions keep their existing ticket semantics. Browser/host and HTTP-method checks still run before input parsing.

An HTTP client can lose the rejection response when the connection closes during an upload. The companion transport retains its conservative unknown-outcome behavior after a previous ambiguous attempt; `requestAccepted: false` describes this particular response, not any earlier request. Inspect Unity or the original ticket after an unknown outcome. Do not treat every HTTP 413 as input rejection: oversized **responses** can occur after execution.

`MCPRequestInput` is isolated from the existing `MiniJson.Deserialize` readers used for asset files and optional integrations. The dispatcher receives the parsed argument dictionary, so it does not repeat JSON parsing on Unity's main thread. No route, tool name or argument schema is removed.

## Validation

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
