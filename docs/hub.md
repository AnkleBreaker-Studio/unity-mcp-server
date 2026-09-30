# Unity Hub commands and failure handling

The six `unity_hub_*` tools call the Hub executable configured by `UNITY_HUB_PATH`. They do not need an open Unity Editor or use the plugin's ticket queue. Existing tool names, arguments and successful result fields are retained.

Each tool call starts **one** headless Hub process with separate arguments and no shell. The prefix is `-- --headless` on Windows/macOS and `--headless` on Linux, matching the [Hub CLI documentation](https://docs.unity.com/en-us/hub/cli-overview). A failed or silent invocation is never repeated with another prefix.

## Results and diagnostics

- An exit status of zero is a successful process result, including commands that produce no output. Ordinary stderr output does not turn that success into an error.
- A nonzero exit, failed launch, timeout or output-buffer failure produces `success: false` and an MCP `isError` result. Progress text on stdout cannot override the failure.
- Failures retain `error`, `stdout` and `stderr`, plus additive `code`, `exitCode`, `signal`, `timedOut` and `outcomeUnknown` fields. `code` identifies Node/process errors such as `ENOENT`; `exitCode` is the numeric exit status when available. List tools also retain diagnostic output in `raw`.
- `outcomeUnknown` is true after a failed mutating command unless the failure establishes that the process never started. Inspect the Hub's installations or settings before retrying. Killing the CLI after a timeout does not establish that its installer work was rolled back or stopped.
- Editor and release lists retain text from both output streams. Installed-editor parsing ignores surrounding whitespace and deduplicates identical version/path pairs while preserving different installations of the same version.

The wrapper uses the process exit status; it does not interpret every Hub log message or prove that all requested installation work completed. Unity documents that some Hub errors are hidden unless `--errors` is enabled in supported versions. Raw output remains available for diagnosis. See the [Hub CLI reference](https://docs.unity.com/en-us/hub/hub-cli-reference).

| Operation | Existing process timeout |
|---|---:|
| List editors/releases; read or set installation path | 30 seconds |
| Install an Editor | 10 minutes |
| Install modules | 5 minutes |

The output limit remains 10 MiB per stream. An exceeded buffer is reported separately from a timeout. The MCP client's own request deadline may be shorter than these process timeouts; disconnecting a client does not guarantee cancellation of installer work.

## Compatibility and validation

The [validation report](validation/hub-cli.json) records reproduced failures before the change and the corrected results. `tests/hub.test.mjs` runs the actual MCP stdio server with its Hub process launch redirected to a fixture child process. The child emits controlled output, exits, waits for a real process timeout or exceeds a reduced test buffer. No fixture performs an installation or changes Hub settings.

The suite checks all six successful tool shapes, the existing installation timeout values, nonzero exits with progress output, silent success, failed writes, timeouts, buffer limits, missing executables, both output streams and literal arguments containing spaces/metacharacters. It is part of `npm test`.

Separate read-only checks against **Unity Hub 3.16.2 on Windows** preserve the actual installation path and installed Unity 6000.6.2f1 result before/after the change. Installation failures are validated with fixtures; no new real installation, module download or path change was attempted for this review. Other Hub versions and real macOS/Linux Hub execution remain outside this evidence.

Unity now documents the Hub CLI as deprecated from Hub 3.18.0 and recommends the standalone Unity CLI for new automation. These tools retain the existing Hub contract; they do not silently switch executables or migrate user settings. [Current Unity CLI and Hub overview](https://docs.unity.com/en-us/hub/cli-overview).
