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

The same budget covers normal results, unknown-tool errors, selection errors and exceptions. It includes injected project-context blocks. The limiter runs after the tool has returned and the result has been assembled; it does not bound Unity allocations, the upstream HTTP response, or peak memory used while serializing that result.

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
