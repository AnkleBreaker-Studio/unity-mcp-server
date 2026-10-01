# Code execution: compilation, monitoring and limits

`unity_execute_code` compiles a C# method body and executes it on Unity's editor thread. Each successful compilation still creates a fresh assembly and executes once. Ordinary result shapes are retained; compilation caching does not reuse command results or compiled user methods. Result serialization now also has the explicit limits below.

The compiler now emits to memory. Compilation failures and user exceptions leave no generated DLL on disk, and diagnostics report line numbers relative to the submitted body. A snippet's generated assembly no longer has a temporary DLL location. Error responses still include the original submitted code and compiler messages, or the user exception and stack trace.

## Result preparation and errors

Finite primitives, anonymous objects, dictionaries, lists, vectors and colors keep their existing JSON shapes. Top-level lists retain `result` and `count`; the existing 1,000-item per-container cap and truncation marker remain. The existing depth-four fallback also remains. Shared references are allowed.

A per-result budget now limits conversion to **100,000 visited values**, including containers and scalar/null values. Per-container caps alone allowed branching graphs to expand far beyond 1,000 items. Exhaustion returns `code: "execution_result_limit"`, an error message, `executionCompleted: true`, `serializedValues`, `maxSerializedValues` and a recovery hint. An iterator failure during result preparation similarly returns `execution_result_serialization_failed` with `executionCompleted: true`. These errors discard the incomplete result; they do not rerun the snippet or undo its effects. Query those effects separately before retrying a write.

Non-finite floating-point values are represented by the JSON strings `"NaN"`, `"Infinity"` and `"-Infinity"`, including vector/color components. The old bare tokens were invalid JSON. Finite values remain numbers. The shared JSON writer also formats integers independently of the editor culture and escapes unpaired UTF-16 surrogates, preserving string code units over UTF-8 transport.

The HTTP writer counts escaped UTF-8 bytes while serializing and stops at its existing 16 MiB hard limit, before creating the final string/byte buffer for an oversized response. Its separate cycle/depth/value guards and failure contract are described in [response limits](response-limits.md#unity-http-serialization). Result objects can already occupy memory before conversion, and arbitrary getters, iterators or `ToString` methods can still block or allocate internally; the budgets do not interrupt user code or cap total editor memory.

The [serialization report](validation/unity66-serialization.json) records seven reproduced failures/absent guards, two passing controls, sixteen corrected checks and real stdio runs using current/released servers on Node 18/22. SessionState counters verify exactly one execution when conversion fails or an oversized HTTP response is refused. The compiler/cache regression suite and Unity 2021 API compilation also pass.

Use `-Suite Serialization` with the plugin's closed-project validation launcher for controlled serializer, result-conversion and owned-loopback HTTP checks. For an open marked project, set `UNITY_MCP_SERIALIZATION_PROJECT` and run `npm run test:serialization`; optionally set `UNITY_MCP_SERIALIZATION_SERVER_ENTRY` to a released server's entry point. This uses unique temporary SessionState markers and removes them afterward.

## Reference cache

Roslyn metadata references are reused for unchanged assembly files instead of rebuilding them for every request. Each collection checks the current loaded assemblies and validates file length and last-write time. Changed files get new metadata. The cache retains at most **512 references** and **128 MiB of referenced file images**, evicting the oldest entries when either bound is reached. Larger files remain usable but are not retained in the cache.

The byte limit measures source image file sizes; it is not a measurement or cap of the editor's total managed/native memory. Generated snippet assemblies remain loaded until Unity unloads their code context/domain. Loading code into memory does not make arbitrary snippets unloadable after each call. Long-running snippets still occupy the editor thread, and queue timeouts cannot interrupt code already running.

`unity_editor_state` adds a `codeExecution` object:

| Field | Meaning |
|---|---|
| `metadataCacheEntries` | Currently retained references |
| `metadataReferenceImageBytes` | Sum of their source file sizes |
| `maxMetadataCacheEntries` / `maxMetadataReferenceImageBytes` | Retention bounds |
| `metadataCacheHits` / `metadataCacheMisses` | Reference reuse and creation counters |
| `loadedSnippetAssembliesSinceReload` | Assemblies successfully loaded by this execution path |

These values belong to the current editor's loaded plugin state and reset when that state reloads. They are independent of per-agent queue/history counters.

## Unity version handling

On Unity 6.6+, the implementation uses Unity's `CurrentAssemblies` APIs for enumeration/loading and `GetLoadedAssemblyPath` for metadata discovery. Unity documents [in-memory assembly loading](https://docs.unity.com/en-us/engine/6000.6/script-reference/unityengine/assemblies/currentassemblies/loadfrombytes) as compatible with its code-reload context. Older Unity versions retain the existing runtime assembly enumeration/path APIs and load the generated bytes with `Assembly.Load`.

The actual Unity 6000.6.2f1 editor tested here reports **Mono 6.13.0**. Analyzer warnings about CoreCLR behavior did not demonstrate a failure on that runtime. The new Unity API path is exercised on Mono; an actual CoreCLR editor, macOS and Linux execution remain unverified. Compilation against the Unity 2021.3.18f1 API still passes, with actual older-editor execution deferred.

## Measurements and reproduction

The [raw execution report](validation/unity66-execution.json) records the reproduced DLL leftovers and misleading diagnostic line, plus corrected behavior. Twenty small repeated calls in the same marked Windows project took **15.85 s before** and **1.01 s after**; twenty metadata collections took **2.15 s before** and **0.46 s after**. These are local microbenchmarks, not general latency guarantees or competitor comparisons. The measured compiler workload uses 201–204 references; project/package size and filesystem behavior affect the result.

The focused suite verifies fresh execution/assembly identity on each call, result shapes, exceptions, unchanged-reference reuse, timestamp invalidation, eviction after exceeding the entry limit, a reference larger than the byte limit, successful execution after eviction and fixture cleanup. The live scene/component/asset/prefab/capture suite separately checks the stdio MCP path across actual project script recompilation.

From the plugin repository, with a closed disposable project:

```powershell
./tools~/validate-unity.ps1 -EditorPath 'C:/Program Files/Unity/Hub/Editor/6000.6.2f1/Editor/Unity.exe' -ProjectPath 'C:/UnityMcpValidation/Execution66' -Suite Execution
```

The launcher isolates the child editor's temporary directory in `ExecutionTemp`. Results are written to `Library/UnityMcpExecutionValidation.json`. The temporary reference files used to exercise cache pressure are removed by the suite. As with the other batch suites, the launcher creates a minimal marked project or requires the existing validation marker; it is not intended for a production project.
