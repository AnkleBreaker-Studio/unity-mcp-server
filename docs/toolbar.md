# Toolbar status and menu access

The plugin installs an **MCP** status dropdown in Unity's main toolbar. It reports the bridge state, active-agent count and available news. Hover for the active port, automatic/manual port mode, clone identity and self-test warnings. Stopping the bridge leaves the indicator available so it can be started again.

## Automatic visibility

On Unity **6000.3 and newer**, the plugin registers `MCP/Status` through Unity's native main-toolbar API. On first use in a project, it waits for the toolbar and shows its existing overlay even if the saved layout initially hides it. It reuses that overlay instead of creating a second control. Initialization is skipped in batch mode.

The successful first display is remembered per project path. A later manual **Hide** choice is respected across script reloads. To restore the indicator, choose **Show Toolbar Status** under either menu root below, or from the Dashboard's MCP menu. This does not reset the rest of the Unity layout or change the bridge's Auto-Start setting.

Unity's public API covers registration and refresh; changing the saved overlay visibility currently requires a guarded lookup of Unity's internal `TryGetOverlay` method. Startup retries are limited to 120 one-second attempts. If that internal API changes, the plugin leaves its normal menus available and reports the restore command. [Unity toolbar API](https://docs.unity.com/en-us/engine/6000.3/script-reference/unityeditor/toolbars/maintoolbar).

Before Unity 6000.3, the legacy control waits for the toolbar, checks again after layout replacement, and removes stale controls before reattaching. An attached control does not trigger repeated toolbar scans. The fallback supports keyboard activation with Enter or Space. This path passes the Unity 2021.3 API compiler check; actual older-editor execution remains deferred.

## Reach the same tools from every entry point

| Entry point | Access |
|---|---|
| Main Unity toolbar | Click **MCP** to open the complete dropdown. |
| **Window → AB Unity MCP** | Dashboard, Welcome, Action History, MCP Menu, Settings, Show Toolbar Status, self-tests and documentation. |
| **Tools → AnkleBreaker → Unity MCP** | The same primary destinations, alongside the canonical Welcome. |
| Dashboard | **MCP Menu ▼** at the top opens the shared dropdown. |
| Action History | **MCP ▼** in its navigation row opens the shared dropdown. |
| Canonical Welcome | Its existing Dashboard and Action History actions still resolve. |
| Asset Store CLICKME | The existing `Tools/AnkleBreaker/MCP For Unity/Dashboard` target resolves to the same Dashboard. |

The dropdown includes bridge controls, category toggles, self-tests, settings, updates and news. It also links directly to queue activity, agents, HTTP activity, recent actions, project context and feature categories in the Dashboard. Section links expand and scroll to their destination. Only eight agent previews appear in the dropdown; **View All Agents** opens the complete Dashboard section.

`Window/AB Unity MCP/Welcome` is a compatibility alias for `Tools/AnkleBreaker/Unity MCP/Welcome`. The generated Welcome stays in its independent assembly and is not duplicated or rewritten by the core plugin.

## Verification

The [toolbar report](validation/unity66-toolbar.json) records native Unity 6000.6.2f1 checks for both menu roots, actionable shared navigation, an idempotent keyboard-focusable Dashboard button, first-use visibility, preservation of manual hiding, restoration without duplication and actual tooltip changes. A separate real script reload preserves the hidden choice and allows explicit restoration afterward. The existing Dashboard regression suite and the 78-source Unity 2021.3 API compiler check provide additional coverage.

Plugin checkpoint `39dbc9d` passes the [338-route CI check](https://github.com/AnkleBreaker-Studio/unity-mcp-plugin/actions/runs/36889933179). Both owned validation editors are closed and the copied toolbar fixture is removed. The server runtime is unchanged by this follow-up.

To reproduce the focused checks, copy the plugin's `tools~/ToolbarValidation.cs` to `Assets/Editor/` in a marked disposable project, refresh and wait for compilation to finish, then call `UnityMcpToolbarValidation.Run()` through the MCP code-execution tool. The fixture restores the toolbar visibility and preferences it changes and writes `Library/UnityMcpToolbarValidation.json`. It does not open external documentation or run self-tests that mutate the scene. Remove the copied fixture when finished.

The reload check uses the native overlay's visibility, a session marker and `EditorUtility.RequestScriptReload()`. Rediscover the owned editor afterward before verifying or restoring it: the original queue ticket can disappear during a reload, so never repeat the reload request simply because polling failed. Older Unity execution, every editor operating system and every custom toolbar preset are outside this evidence.

## Upstream synchronization

Plugin `main` at `ce5a57f` was merged into `Development-Unity66-Modernization`, preserving the canonical Welcome changes, Unity 6000.5+ fixes, catalogue, theme relocation and upstream **2.40.1** version. The sole merge conflict was the changelog; both histories were retained. The server already contained all fetched `main` changes. No modernization changes were merged into `main`, and no release was created by this work.
