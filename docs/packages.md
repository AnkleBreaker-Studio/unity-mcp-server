# Package Manager requests

The five existing package tools keep their names, arguments and successful response fields: `unity_packages_list`, `unity_packages_info`, `unity_packages_search`, `unity_packages_add` and `unity_packages_remove`.

The plugin now starts and observes Unity Package Manager requests across editor updates. It no longer sleeps on the editor's main thread while waiting for a request. Other agents can continue using the editor while a package request is pending. Importing assets or compiling installed scripts can still occupy Unity; this change does not make those native operations asynchronous.

## Scheduling and compatibility

- MCP package requests run sequentially inside each editor. This preserves the older API's ordering requirement; Unity warns that overlapping Client operations can have nondeterministic results. [Unity 2021.3 Client documentation](https://docs.unity3d.com/2021.3/Documentation/ScriptReference/PackageManager.Client.html).
- The normal asynchronous queue retains its ticket, result and history contracts. A legacy synchronous caller waits on its HTTP worker while Unity updates remain available. Its existing 30-second deadline remains; deferred queue execution retains its 120-second deadline.
- Deferred processing time includes waiting behind an earlier package request. A native request that never completes can keep later package requests waiting until they expire or the editor reloads; unrelated routes remain available.
- Pending package work checks whether its ticket is still active before starting. If a started request outlives its ticket, Unity may still finish it. The scheduler retains that request's slot until completion, discards its late result and does not replay it. A domain reload still loses the original ticket; inspect the installed packages before repeating a mutation.
- The Package Manager category switch now guards all five routes. The route prefix `packages` is mapped to the settings category `packagemanager`. Deferred test discovery also respects its category switch.
- Polling unsubscribes when idle and is cleared before assembly reload or editor shutdown. Dashboard self-tests use the registered-package snapshot because their probes run synchronously; registry access and asynchronous package commands are covered separately by the live suite.

This follows Unity's documented `EditorApplication.update` polling pattern. [Package Manager scripting examples](https://docs.unity3d.com/6000.6/Documentation/Manual/upm-api.html).

## Evidence

On Windows/Unity 6000.6.2f1, the previous handlers blocked the main thread for 61.67 ms during an offline list and 185.28 ms during a registry search, with zero editor updates inside either call. The revised handlers returned after 1.27 ms and 0.39 ms; results arrived after 118.91 ms and 216.45 ms, with editor updates in between. These are single-run handler measurements, not end-to-end speedups or frame-cost guarantees. The registry search's total elapsed time did not improve.

The [validation report](validation/unity66-packages.json) records seven deterministic scheduler/lifecycle checks, the full queue/HTTP regression suite, and real list/info/search/local-add/local-remove calls on Node 18 and 22. The marked project's manifest is restored and compilation finishes without errors. The released server `826af5c` also passes the package workflow sequentially on both Node versions. Its shared request routing still fails an overlapping-call probe; the new plugin does not repair old server-side routing.

All 70 editor sources compile against the Unity 2021.3.18f1 API. Actual execution on that editor remains deferred by maintainer direction. Script-bearing package reloads, registry/Git installation failures, other editor platforms and package operations initiated outside this MCP scheduler need separate coverage.

## Reproduce

Use an open, disposable Unity project containing `.unity-mcp-validation`. The live test temporarily adds a unique local text-only package, then removes it:

```powershell
$env:UNITY_MCP_PACKAGE_PROJECT = 'C:/validation/Health66'
npm run test:packages
```

The test discovers and selects the project by canonical path. Set `UNITY_MCP_PACKAGE_SERVER_ENTRY` to another server's absolute `src/index.js` path and `UNITY_MCP_PACKAGE_SERIAL=1` for sequential compatibility checks with a released server.

From the plugin repository, the deterministic suite runs in a closed disposable project:

```powershell
./tools~/validate-unity.ps1 -EditorPath 'C:/Unity/Editor/Unity.exe' `
  -ProjectPath 'C:/validation/Packages66' -Suite Packages
```
