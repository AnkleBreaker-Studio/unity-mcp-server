# Debug logging during long sessions

Set `UNITY_MCP_DEBUG=1` before starting the server to write diagnostic entries to `mcp-debug.log` beside the configured instance registry. Logging stays disabled by default. Normal entries retain their timestamp, process ID and text; MCP protocol output stays on stdout.

The logger now checks the file size before every append. If the entry would cross 5 MiB, it moves the current log to `mcp-debug.log.old`, replacing the previous generation. A single process writing fresh files stays within that threshold. An already oversized historical log is preserved as the previous generation until a later rotation replaces it.

Each entry is limited to 64 KiB, including its prefix and newline. Oversized text ends with `[truncated]` on a complete UTF-8 character boundary. Encoding only examines a bounded prefix of the supplied string; it does not undo allocations already made by the caller.

If formatting, rotation or writing fails, that entry is skipped. The logger emits a short stderr diagnostic and waits at least one second before attempting another entry. Calls during that interval return immediately. A later call can recover after the filesystem problem is resolved. Even a failing diagnostic sink cannot turn logging into a tool failure.

## Concurrent processes and limits

Processes still share the existing file names. Rotation is best effort: size checks and appends are not a cross-process transaction, so simultaneous writers can transiently exceed the threshold or replace a rotated generation. There is no global disk quota or guaranteed audit-log delivery. Four-process tests verify valid UTF-8 output, rotating files and no stdout contamination on the tested platforms.

Enabled logging still performs synchronous filesystem work. The additional size check enforces ongoing rotation; no throughput improvement is claimed. Disabled logging returns before formatting, file operations or clock checks. The logger does not bound per-agent routing state, queued arguments or total process memory.

## Evidence and reproduction

The [report](validation/debug-logging.json) records seven failures and three passing controls against the previous logger, followed by twelve passing checks on Node 18 and 22. Tests cover sustained and repeated rotation, oversized Unicode entries, several multibyte cut positions, preserved historical logs, failed rotation, recovery, bounded stderr, conversion failures and concurrent writers. A real MCP stdio process also returns two successful editor responses through an isolated mock bridge when its log path is unusable.

The existing lifetime diagnostic previously produced one 6,295,296-byte file from 96 messages. The corrected run produces a 1,048,576-byte active log and a 5,242,880-byte previous generation. The same run still retains all 4,096 completed agent selections: that separate lifecycle finding remains open.

```bash
node --test tests/debug-logging.test.mjs
node tests/diagnostics/state-retention-audit.mjs /absolute/path/to/report.json
```

The focused checks are included in `npm test`. They use temporary directories and mock bridges; they do not contact a running Unity Editor. Server/plugin wire contracts and the plugin implementation are unchanged.
