# Response limits and image results

Tool calls and project-context reads apply a byte budget before their results reach the MCP transport. The count is `Buffer.byteLength(JSON.stringify(result), "utf8")`: it includes text, image base64, metadata, UTF-8 encoding and JSON escaping. It excludes the JSON-RPC envelope, request ID and transport newline. It is not a token count.

| Setting | Default | Behavior |
|---|---|---|
| `UNITY_RESPONSE_SOFT_LIMIT` | 2,097,152 bytes (2 MiB) | Log a warning; prepend a warning block to tool results only when it also fits the hard limit |
| `UNITY_RESPONSE_HARD_LIMIT` | 4,194,304 bytes (4 MiB) | Omit an oversized tool result with a structured MCP error; reject an oversized resource read |

Values must be decimal safe integers. The hard minimum is 1,024 bytes; the soft minimum is 1 byte. Invalid values fall back to their defaults and produce a diagnostic on stderr. The soft limit is clamped to the effective hard limit. Existing environment variable names and default values are retained.

## Tool results

Small successful results keep their existing shape. Soft warnings precede the tool's content, preserving clients that parse the final text block as the structured result. If a warning would push a valid result over the hard limit, only the stderr warning is emitted.

An oversized result becomes `isError: true` with a JSON text block containing `success: false`, `code: "response_too_large"`, `error`, `tool`, `responseBytes`, `limitBytes` and `originalIsError`. The tool name is bounded. When the omitted result was itself an error, a bounded `originalError` can retain its outcome flag, code, ticket/request/session identifiers and an error-message prefix, as space permits.

**Omitting a response does not undo its operation.** This error does not establish whether a Unity write succeeded. Inspect its effects or the original ticket before repeating it. The size limiter never repeats the command. For reads, request smaller results: reduce hierarchy `maxNodes`/`maxDepth`, asset `maxResults`, image dimensions or the scope of the query. Discover each tool's schema for the parameters it supports.

The same budget covers normal results, unknown-tool errors, selection errors and exceptions. It includes injected project-context blocks. The limiter runs after the tool has returned and the result has been assembled; it does not itself bound Unity allocations, the upstream HTTP response, or peak memory used while serializing that result. The server's download limit and the plugin's bounded HTTP serializer are separate protections below.

## Node HTTP downloads

`UNITY_HTTP_RESPONSE_LIMIT` defaults to **33,554,432 bytes (32 MiB)** per incoming editor HTTP response, with a minimum of 1,024 bytes. It accepts decimal safe integers using the same validation/fallback rule as the MCP limits. The default is above the plugin's existing 16 MiB output limit, retaining normal mixed-version traffic. It is independent of the 4 MiB MCP result limit.

The shared HTTP reader counts body bytes **after HTTP decompression and before UTF-8 decoding**. It aborts when the first chunk crosses the budget, without appending that chunk or parsing a partial body. An exact-limit body fits. The count does not trust `Content-Length`: compressed and chunked responses follow the same bound. UTF-8 characters split across chunks, BOM removal and invalid-byte replacement retain the previous `Response.text()` behavior.

This covers success and error bodies in discovery, queue negotiation/submission/polling, legacy synchronous requests, queue diagnostics and project context. The failure message includes `http_response_too_large`, the configured limit and a lower bound on received bytes. Oversize is not a transient transport error: negotiation stops before submission; an oversized acknowledgement/result reports `outcomeUnknown` and retains any already-known ticket/request/session identifiers. Neither the HTTP response nor the Unity command is retried. Oversized resource reads fail explicitly; failed automatic-context reads leave the successful command intact and allow a later context injection.

Cancellation and timeouts remain active throughout the body read. Failure aborts the fetch, releases its reader and removes the timer/request observer. This is a **per-response body bound**, not a cap on total process memory: fetch/decompression may buffer ahead, a received chunk may exceed the remaining budget, text/JSON decoding has additional costs, and concurrent requests retain independent budgets. Incoming requests and original Unity result allocations remain separate.

The [HTTP download report](validation/http-response-limits.json) records 15 failures against server `c96e839`, four passing controls and three additional recovery/error checks. All 22 focused checks and 185 ordinary tests pass on Node 18.20.8 and 22.18.0. Real Unity 6.6 checks use both the current plugin and released `0b8e76f`: a 64 KiB result exceeds a deliberately reduced 16 KiB download cap, executes once, retains recovery information and leaves follow-up calls usable.

Run `npm test` for isolated HTTP/stdio regressions. For the live check, set `UNITY_MCP_HTTP_PROJECT` to an open disposable project with a `.unity-mcp-validation` marker, then run `npm run test:http-responses`. It uses MCP discovery, verifies the canonical project path, passes the selected port explicitly and removes its temporary SessionState counter. Evidence is written to `Library/UnityMcpHttpResponseLimit.json`; no scene/assets/settings are changed.

## Unity HTTP serialization

The current plugin retains its **8 MiB warning / 16 MiB hard** HTTP limits. The hard limit is now checked as escaped UTF-8 is appended, before allocating the complete oversized JSON string and UTF-8 buffer. Exact-limit output fits; the next byte fails. Valid surrogate pairs count as four UTF-8 bytes, and unpaired surrogates are escaped without losing their code units.

An oversized response still returns HTTP 413 with `error: "response_too_large"`, `size`, `limit` and a message. Because serialization stops early, `size` is now explicitly marked `sizeIsLowerBound: true`; it is the first required byte count that exceeds the budget, not the length of a fully traversed result. The response adds `reason: "byte_limit"`, `outcomeUnknown: true` and a hint to inspect the original operation before retrying.

The shared writer rejects reference cycles, more than 64 container levels and more than 1,000,000 visited values. Repeated references outside the current traversal path remain valid. Failed property getters retain the historical null behavior; failures while serializing a returned collection abort the response instead of leaving malformed partial JSON. These structural guards also apply to non-HTTP uses of MiniJson; its existing one-argument API remains available without the 16 MiB HTTP-specific byte budget.

Other serialization failures return HTTP 500 with `error: "response_serialization_failed"`, a bounded message, `reason`, `outcomeUnknown: true` and the recovery hint. The command may already have completed. Current server queue polling retains the original ticket/request/session identifiers and reports an unknown outcome; it does not resubmit the operation. Released-server execution-count checks pass too, without claiming it exposes all newer diagnostic fields.

These are serialized-output and traversal limits. They do not cap the original result graph, total managed/native memory, peak intermediate allocations, incoming request parsing or arbitrary property/iterator code. The Node download bound above also applies to older/other plugins.

The [serialization report](validation/unity66-serialization.json) includes strict JSON parsing, culture/non-finite cases, cycles, shared references, deep/wide trees, UTF-8 boundaries, global execution-result expansion, legacy list shapes and actual HTTP 413/500 responses. A repeated 4 MiB-string fixture stops while visiting its fourth of eight entries. Real current/released-server checks on Node 18/22 confirm valid Unicode/non-finite results and no replay after 17 MiB output is refused.

## Images and resources

Scene/Game captures called through `unity_advanced_tool` now use the same image blocks as their direct tools, with metadata in a separate text block. Additional parameters still pass through to the plugin. An image handler receiving no image reports failure, and logical errors in image metadata retain the MCP error flag.

`resources/read` returns its usual contents when they fit. An oversized read fails explicitly with a bounded protocol error; it does not return partial Markdown. Split large project-context files or categories before reading them again. Resource reads use the hard limit only. This change does not apply new limits to `tools/list` or `resources/list`.

## Evidence and reproduction

The [validation report](validation/response-limits.json) records 14 regressions failing against unmodified server `9b091e9a6ad28a301d717c82e0f9ac252049e3b8`, then passing after correction. They exercise the actual stdio server with isolated mock bridges: Unicode/escaping, warnings, error/recovery fields, invalid configuration, resource reads and direct/proxied images. All 118 ordinary tests pass locally on Node 18.20.8 and 22.18.0.

Live checks on Windows with Unity 6000.6.2f1 pass on both Node versions: a 1,400-character ASCII result remains parseable after a soft warning; a 3,000-character CJK result is omitted with a bounded error; a real 64 x 64 Scene capture returns an image block; a missing asset preview reports an error. Scene/assets/settings are unchanged. Game capture proxy behavior is covered by the mock regression, not a new live Game capture in this suite.

Run ordinary regressions with `npm test`. For the opt-in live suite, use an open disposable project containing the `.unity-mcp-validation` marker, outside Play Mode and compilation:

```powershell
$env:UNITY_MCP_RESPONSE_PROJECT = 'C:/UnityMcpValidation/Queue66'
npm run test:responses
```

The live suite verifies the canonical project path and uses its discovered port explicitly. It writes `Library/UnityMcpResponseLimits.json`. Without the environment variable, it skips without contacting Unity. Response limiting is separate from [request cancellation](cancellation.md); these checks do not certify every tool result on every Unity version.
