# Action history persistence

The previous loader restored every saved entry regardless of the configured retention limit. A 1,000-entry file loaded all 1,000 entries with a limit of eight; zero retention was also ignored. A negative preference could throw during insertion. Invalid entries could partially replace existing history, an out-of-order record ID could be reused, and the next save could overwrite a damaged source file after a failed load.

The plugin now validates the complete snapshot before replacing in-memory history, retains only the newest configured entries, and restores the highest stored action ID, including discarded entries. Zero disables retention; invalid negative preferences use the existing default of 500. Positive custom limits remain supported. Insertion and saving also apply the configured limit.

## File format and recovery

Persistence remains optional and uses `Library/MCPActionHistory.json`. Existing reload/quit hooks still drain completed history before saving. The JSON keeps the same `records` array and field names; output is now compact UTF-8. Current error and Undo metadata, Unicode, timestamps and opaque target IDs round-trip. Old numeric target IDs remain exact strings, including 64-bit values. This numeric compatibility already passed on the baseline; it is preserved rather than newly introduced.

Missing legacy Undo session/signature fields remain unverified. A missing Undo group is unavailable (`-1`). Restoring metadata does not create a native Undo entry or make a previous editor session eligible. [Native Undo checks](undo.md) still govern rollback. Parameters remain excluded from the file, as before.

Input and output have a **32 MiB byte limit**. Parsing also uses the existing strict JSON limits of 64 container levels and 1,000,000 values/property names. Saving checks its generated value count before publishing, so an unusually large custom retention setting cannot produce a snapshot that the loader will reject for that count. These are serialized-file limits, not total heap limits; reading, decoding and validation require additional bounded snapshot/tree allocations.

A successful load swaps in its validated records. An invalid or oversized file leaves current history and the source unchanged, emits a warning, and blocks subsequent automatic saves. Copy the original file elsewhere before clearing history if it is needed for recovery. A successful repaired load or explicit Clear resumes saving; a failed Clear keeps saving blocked. A missing file at startup simply means there is no history to restore.

Saving writes a unique temporary file in the same directory, closes it, then uses `File.Replace` for an existing destination or `File.Move` for the first snapshot. It never deletes the previous snapshot as a replacement fallback. A failed write/replacement preserves the previous file and attempts to remove its own temporary file. The Windows/Mono fixture verifies a locked destination and successful retry after unlocking. This evidence does not establish power-loss durability or behavior on other filesystems/platforms.

## Diagnostics

`unity_queue_info.data.historyPersistence` adds:

| Field | Meaning |
|---|---|
| `maxFileBytes` | 33,554,432-byte input/output ceiling |
| `saveBlocked` | Failed restoration or deletion currently prevents automatic replacement |
| `warning` | Latest persistence failure, capped at 2,048 characters; cleared by successful save/load or explicit Clear |
| `loadedRecords`, `discardedOnLoad` | Retained and trimmed counts from the last successful load |
| `lastFileBytes` | Snapshot bytes observed on the last successful load/save |
| `loadFailures`, `saveFailures` | Failed load/save attempts in this domain; skipped blocked saves are not failures |

Counters reset on domain reload. The last-successful-load fields remain unchanged after a failed load or Clear. A save failure alone permits later retries; a failed-load block protects its source until recovery. These fields are additive and pass through released servers.

## Validation

The [report](validation/unity66-history-persistence.json) records six baseline failures and two compatibility controls, followed by eighteen passing checks in Unity 6000.6.2f1 on Windows/Mono. Additional cases cover input/output byte limits, failed replacement and temporary-file cleanup, invalid syntax/field types, recovery, old JsonUtility schema reads, UTF-8/UTF-16 BOMs, reduced limits at save time, and writer/reader value-budget agreement.

Existing monitoring, history-notification and queue suites also pass. Four real-editor Undo runs use current/released servers on Node 18/22. Each verifies actual script reload, preserved action identity and native Undo eligibility, successful targeted rollback, cross-agent protection, and readable persistence metrics. The minimum-version compiler check covers 77 sources against Unity 2021.3.18f1 APIs; actual older-editor execution remains deferred by maintainer direction. No published version changes.

From the plugin checkout, with a closed marked disposable project:

```powershell
./tools~/validate-unity.ps1 -EditorPath 'C:/Program Files/Unity/Hub/Editor/6000.6.2f1/Editor/Unity.exe' -ProjectPath 'C:/UnityMcpValidation/History66' -Suite HistoryPersistence
```

For real reload/Undo validation, open a marked disposable editor with an empty unsaved scene and empty Undo stack:

```powershell
$env:UNITY_MCP_UNDO_PROJECT = 'C:/UnityMcpValidation/History66'
npm run test:undo
```

Set `UNITY_MCP_UNDO_SERVER_ENTRY` to a released server's absolute `src/index.js` path for the companion compatibility run. This existing fixture clears disposable history/native Undo, removes its objects, restores the persistence preference and writes `Library/UnityMcpUndo.json`.
