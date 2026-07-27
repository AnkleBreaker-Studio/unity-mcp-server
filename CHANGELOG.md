# Changelog

All notable changes to this package will be documented in this file.

## [2.35.6] - 2026-07-27

Companion to plugin **2.39.5** (community-reported fixes).

### Added
- **`unity_animation_set_object_reference_curve`** (issue #30 by @VM233) — object-reference (PPtr) animation curves, i.e. 2D sprite-frame animation of `SpriteRenderer.m_Sprite`. `unity_animation_set_clip_curve` is float-only and cannot express an object reference, so this workflow previously required hand-writing `.anim` YAML. Keyframes take `{ time, assetPath, name? }`, where `name` selects one `Sprite` sub-asset out of a sliced sheet; `type` and `propertyName` default to `SpriteRenderer` / `m_Sprite`. The plugin fails closed on any unresolvable keyframe.
- `unity_animation_clip_info` now also returns `objectReferenceCurveCount` / `objectReferenceCurves` — a correct sprite clip previously reported `curveCount: 0` and appeared empty through the MCP.

### Changed
- Advanced tier 268 → **269** tools (347 total). Updated in the pinned tier test and in `manifest.json`, which states the count in four places.

## [2.35.5] - 2026-07-24

Findings from a 33-dimension + 10-blind-spot audit (127 + 40 agents, every CRITICAL/HIGH adversarially verified). Companion plugin: **2.39.4**.

### Fixed
- **Every Unity-side error message was being thrown away.** The queue ticket carries the exception in `errorMessage` (`MCPRequestQueue.TicketToDict`) but the poller read `statusData.error`, which never exists on that shape — so EVERY failure across all 337 routes collapsed to the generic `"Queue processing failed"`, and agents retried non-idempotent writes blind. **This also silently broke two other features** that detect old plugins by reading `"Unknown API endpoint"` out of the error text: the advanced-tool *did-you-mean* suggestions and the `component_batch_wire` graceful degrade. All three are repaired by reading the right field.
  - The mock bridge emitted the wrong field name too, which is why a 59-test suite never caught it — it now mirrors `TicketToDict` exactly. The regression test that accepted `success:false` as an alternative (letting the real message vanish unnoticed) now asserts the verbatim text, and is proven to fail without the fix.
- **A vanished project no longer silently redirects writes to a different one.** When an agent's selected instance disappeared, the code cleared the selection AND set the "selection required" gate to `false`, so the same tool call fell through to the default port — a *different* live Unity in any multi-project session, reporting success the whole way. It now fails closed and demands re-selection.
- **A transient failure no longer permanently downgrades the session.** Any lingering submit error (editor not up yet, a domain reload longer than the retry window) latched `_useQueueMode = false` for the entire process, losing agent attribution, per-action undo grouping and read-batching, with nothing to ever reset it. Only a definitive HTTP 404 now proves the plugin lacks queue mode; transient failures fall back for that one call and re-probe next time.

### Added
- `unity_asset_delete` exposes `recursive` and `permanent`; `unity_scene_open` / `unity_scene_new` expose `saveFirst` and `discardUnsavedChanges` — the opt-ins for the plugin's new data-loss guards. (`openScene`/`newScene` previously dropped everything but `path`.)
- `unity_scene_save` takes an optional `path` — **required** for a scene that has never been saved, and doubling as Save-As. Without it the plugin had to raise Unity's interactive Save dialog from the request pump, which hangs an unattended editor. (`saveScene` forwarded no params at all before.)

### Changed
- License declared as `SEE LICENSE IN LICENSE` in `package.json` (it declared none) and `manifest.json` (it declared `MIT`) — the shipped LICENSE is the AnkleBreaker Open License v1.0. `manifest.json` version was also stale at 2.35.2 and is now synced.
- Rich-mode `tools/list` budget 47KB → 48KB for the four new data-safety params (~47.5KB actual, still ~60% under the 120KB ceiling).

## [2.35.4] - 2026-07-23

### Fixed (Discord ProBuilder report — tool-surface gaps; companion `unity-mcp-plugin` 2.39.3)
- **B4 — `unity_probuilder_boolean` now exposes `name` and `deleteSources`.** The plugin has honored both since 2.39.0 (custom result name; keep-sources opt-out), but the server schema didn't declare them — so agents couldn't discover them and every boolean landed as `PB_Boolean_<op>` with both sources deleted. Both are now in the schema (the bridge passes params straight through, so no bridge change was needed).
- **B8 — `unity_probuilder_create_shape` declares `layer`, `addCollider`, `parent`.** Surfaces the new plugin params so a created object gets its project-convention layer / MeshCollider / hierarchy parent in one call instead of a follow-up per omission.
- **B2 — `material` docs clarified** on `create_shape` and `set_face_material`: both now accept a full asset path OR a bare material name, and an unresolved name on `create_shape` is reported as `materialWarning` (no more silent fallback to the default).
- **A1 — `unity_gameobject_delete` gains `force`** to override the new plugin shared-mesh guard (which refuses to delete an object whose runtime mesh is shared by ProBuilder clones, reporting `sharedWith`).

### Notes
- Rich-mode `tools/list` diet gate raised 46.5KB → 47KB to fit the `unity_gameobject_delete` shared-mesh guard description + `force` param — a real data-safety capability, still ~61% under the 120KB hard ceiling. `UNITY_MCP_COMPACT_TOOLS=1` is unaffected. All 59 protocol/unit tests green; route registry unchanged (337 routes).

## [2.35.3] - 2026-07-23

### Fixed (pre-merge multi-expert audit)
- **5 advanced tools had untyped `value`/`defaultValue` schema properties** (`unity_animation_add_parameter`, `unity_shadergraph_set_node_property`, `unity_scriptableobject_set_field`, `unity_editorprefs_set`, `unity_playerprefs_set`) — a strict-schema validator could reject them. All now carry an explicit `type` union, matching the fix already applied to the core setter tools. A new unit test enforces explicit type-shaping across the **whole** tool surface (all tiers), not just the exposed core tools the protocol test sees.
- **`unity_list_advanced_tools` validates its string filters** — a non-string `search`/`category`/`tool` now returns a clean "must be a string" error instead of a raw `TypeError` from `.toLowerCase()` (covered by a protocol test).
- **`unity_component_batch_wire` degrade path pipelines its calls** — the old-plugin fallback awaited each `set-reference` sequentially; it now runs them via `Promise.all` (order preserved), bounding wall-clock by the slowest call instead of their sum.

## [2.35.2] - 2026-07-22

### Fixed (Discord battle-test report, BUG 5)
- **`unity_play_mode` false negative during the play-mode domain reload** — entering/exiting play reloads the domain and evicts queue tickets, so the status poll returned `HTTP 404 Ticket not found or expired` while the mode switch actually happened. On that specific failure signature the tool now verifies the live editor state: if it matches the requested action, it returns success with `verifiedViaEditorState: true` (and the current `isPlaying`/`isPaused`) instead of the misleading error. Covered by a protocol test using a new mock-bridge ticket-eviction mode, plus float-parameter and boolean-`sourcesDeleted` regressions in the live ProBuilder suite (companion `unity-mcp-plugin` 2.39.0).

## [2.35.1] - 2026-07-19

### Added
- **Live ProBuilder level-build test suite** (`tests/live-probuilder-level.test.mjs`, part of `npm run test:live`) — drives this server over real MCP stdio against a running Unity editor and builds a small level through the multi-agent queue: parametric shapes, face extrusion, boolean CSG (with a placement regression assert), per-face materials, combine, per-action undo, dense hierarchy + lazy discovery. Self-cleaning (`__mcp_lvl_` probes); ProBuilder-less projects skip the ProBuilder steps. Found three real plugin bugs on its first run (fixed in `unity-mcp-plugin` 2.37.1).

### Fixed
- **12 core tools were unreachable through `unity_advanced_tool`'s lazy proxy** — the name→route derivation missed their real endpoints (e.g. `unity_material_create` → `asset/create-material`, `unity_execute_code` → `editor/execute-code`, `unity_get_compilation_errors` → `compilation/errors`, gameobject duplicate/set-active/reparent → `prefab/*`). All now in `ROUTE_OVERRIDES`, making the advanced-tool proxy a reliable escape hatch when a client's cached schema predates a new parameter.

## [2.35.0] - 2026-07-19

### Changed (context efficiency — three-level lazy discovery)
- **`unity_list_advanced_tools` redesigned so finding one tool never costs a schema dump.** Measured on the real registry: no-args summary **9.7KB → 0.7KB** (category names + counts, was every tool name); category view **12–22KB → 3–6KB** (per tool: name, one-line brief, parameter names + required — was full schemas); new **`search=`** keyword lookup across advanced + core + plugin lazy-loaded tools (~0.2KB, name-hits ranked first); new **`tool=`** fetch of exactly ONE full parameter schema (~0.8KB, did-you-mean on a miss). A complete discovery flow (search → schema → call) drops from ~30KB to ~1KB of context. `includeSchemas:true` restores the old full-schema category echo for one-round-trip callers, so no capability is lost. Plugin lazy-loaded routes (from `_meta/routes`) now appear in every view — summary counts, category listings, search results, and `tool=` (which reports the derived route).
- **Meta-tool descriptions are computed at registration** — `unity_advanced_tool` no longer hardcodes a tool count that drifts (was stale twice already).
- **`unity_scene_hierarchy` declares the new `verbose` parameter** and documents the dense default (companion to `unity-mcp-plugin` 2.37.0's dense hierarchy — absent per-node fields mean the default value).
- `firstSentence`/`stripSchemaDescriptions` moved to `response-format.js` (shared by compact tools/list mode and the catalog's lean views).

## [2.34.0] - 2026-07-18

### Added
- **`unity_undo_last` (core tool)** — companion to `unity-mcp-plugin` 2.36.0's per-action undo. Reverts the most recent undoable MCP action as a whole; `agentId` targets a specific agent's last action; `force` opts into Unity's linear cascade (revert newer actions stacked on top). Core tier count 68 → 69.

### Changed
- **`unity_undo_history` is now an action log** — surfaces the plugin's per-agent action history (newest first, `count`/`agentId` filters) with undoable flags and the current undo group, instead of just the current group name. New `agentId`/`count` params.
- **`unity_undo` description clarified** — it's the single-step global undo (Ctrl+Z); `unity_undo_last` is the per-action/per-agent revert. Rich-mode `tools/list` diet budget nudged 45KB → 46.5KB to fit the new core tool (still ~61% under the 120KB hard ceiling; compact mode unchanged at ~22KB).

### Added
- **ProBuilder tool suite (14 advanced-tier tools)** — companion to `unity-mcp-plugin` 2.35.0's ProBuilder integration. New `unity_probuilder_*` tools reachable via `unity_advanced_tool` under the `probuilder` category: `create_shape`, `info`, `extrude_faces`, `bevel_edges`, `subdivide`, `delete_faces`, `translate_faces`, `flip_normals`, `set_face_material`, `boolean`, `combine`, `probuilderize`, `center_pivot`, `export_mesh`. Each ships a full parameter schema (shape parameters, face-index selection, boolean operands, export path). New `probuilder-bridge.js` + `probuilder-tools.js` follow the existing UMA optional-integration pattern; tool names derive to the plugin's `probuilder/*` routes so the lazy-load fallback works even against an unlisted plugin build. Advanced-tier count 254 → 268.

## [2.32.0] - 2026-07-18

### Added
- **`overwrite` parameter on the asset-creator tools** — companion to the `unity-mcp-plugin` 2.34.0 data-safety guards. `unity_script_create`, `unity_material_create`, `unity_asset_import`, `unity_scriptableobject_create`, `unity_animation_create_controller`, `unity_animation_create_clip`, `unity_terrain_create`, and `unity_shadergraph_create` now refuse to replace an existing asset by default; pass `overwrite: true` to intentionally replace it. **Behavior change:** flows that re-created an asset over an existing one (e.g. re-running a material/import setup) now need `overwrite: true`. This prevents the plugin from silently destroying a tuned asset and every reference to it.

### Fixed
- **Queue-poll duplicate execution** — a single transient poll error (`ECONNRESET` / "fetch failed" / `AbortError`) during a domain-reload window failed the command while Unity still finished the ticket, so the client retried a non-idempotent operation that had already run. The poll loop now retries through transient errors to the deadline (matching the submit path); only non-transient errors fail fast.
- **Plugin-side `TimedOut` now surfaced as terminal** — previously unrecognized, so a timed-out ticket was polled ~30-60s until eviction and then read back as a misleading HTTP 404; it now returns a clear timeout error immediately.
- **`unity_testing_get_job` `waitTimeout` never short-circuited** — it read `status` off the top-level result but the value is under the bridge's `data` envelope, so it always polled the full timeout (up to ~56s) even when the run finished in seconds. Fixed here and in `unity_testing_run_tests`' early-feedback branch.
- **Per-request `_meta.agentId` override leaked into later requests** — the reset path restored the discovery agent but not the bridge `X-Agent-Id` header, so a prior override's id stuck on every subsequent request (wrong queue attribution).
- **`UNITY_QUEUE_POLL_MAX` was silently clamped to 1000ms** — `Math.min(1000, ...)` capped the documented env var and the 1500ms default; the configured maximum is now honored.

## [2.31.0] - 2026-07-18

### Added
- **Test suite + CI** — protocol-level integration harness (mock Unity bridge + MCP stdio client): tools/list size budgets and strict-schema gates, queue/legacy/multi-instance round-trips, stdout protocol purity, 4MB-guard, isError semantics, version-skew scenarios. `npm test` (41 tests), env-gated `npm run test:live` live-bridge smoke, GitHub Actions on push/PR (ubuntu+windows, Node 20/22). The publish workflow is no longer the only automation.
- **Compact JSON responses by default** — all ~338 tool-result sites now serialize compact (the C# plugin already sends compact; Node-side pretty-printing inflated every structured response 20–50% in tokens). `UNITY_MCP_PRETTY_JSON=1` restores indentation. (Idea credit: PR [#31](https://github.com/AnkleBreaker-Studio/unity-mcp-server/pull/31) by @D3vCrow.)
- **`UNITY_MCP_COMPACT_TOOLS=1`** — minimal tools/list (~21.5KB vs ~43KB) keeping ALL 79 tools and strict schema structure while dropping per-parameter prose; for clients with registry size limits (fixes Codex Desktop on Windows losing the whole MCP surface, issue [#27](https://github.com/AnkleBreaker-Studio/unity-mcp-server/issues/27) `spawn ENAMETOOLONG`). Rich mode dieted from ~50.6KB to ~43KB with full parameter docs retained; both modes are CI-gated.
- **MCP `isError` on logical failures** — the bridge returns HTTP 200 for logical failures ({success:false}, {error}, {ok:false}, enveloped variants); the CallTool seam now sets `isError` so clients stop reading failures as successes. (Idea credit: PR #31 by @D3vCrow.)
- **Capability handshake (server half)** — discovery captures `protocolVersion`/`pluginVersion` from ping (registry validation, port scan, default port); `unity_list_instances` surfaces `pluginVersion`; `unity_component_batch_wire` degrades gracefully to single `component/set-reference` calls on plugins without the route. Pairs with plugin 2.33.0. (Idea credit: PR [#32](https://github.com/AnkleBreaker-Studio/unity-mcp-server/pull/32) by @D3vCrow.)
- **Console stack-trace shaping** — `unity_console_log` gains `includeStackTrace` (`errors` default / `all` / `none`) + `maxStackFrames` (default 6). Traces were ~80% of a typical console payload; error-like entries keep a trimmed trace, everything else drops it, full traces stay one parameter away. Works against every plugin version (server-side).
- **Select instance by name** — `unity_select_instance` accepts `projectName` (stable across restarts) as an alternative to `port` (dynamic); helpful errors list available instances.
- **Advanced-tool schema echo + did-you-mean** — `unity_list_advanced_tools` category view includes each tool's `inputSchema`; failed lazy routes suggest the closest tool names (Levenshtein top-3). (Idea credit: PR #31 by @D3vCrow.)

### Fixed
- **`serverInfo.version` drift** — MCP initialize advertised a hardcoded `2.26.0` four releases behind (issue #27); the version now comes from package.json (single source). `manifest.json` synced too (was 2.18.0 with stale counts).
- **Base64 token-bomb in four graphics handlers** — `unity_graphics_asset_preview` / `prefab_render` read the image at the wrong envelope depth (broken image block) and `material_info` / `texture_info` never image-ified enveloped previews; in all four the full PNG base64 leaked into the text metadata (hundreds of KB of tokens per call). All six graphics handlers now share one envelope-aware helper; regression-tested.
- **Queue-ticket metadata leak** — tickets completing without a result returned the whole ticket object (ticketId, agentId) as tool output; now a minimal status object.
- **Dynamic route discovery never merged** — the plugin's `_meta/routes` list was read at the wrong envelope depth (`.routes` instead of `.data.routes`), so lazily-added plugin routes never appeared in `unity_list_advanced_tools`.
- **Strict-client schemas** — both untyped `value` params (`component_set_property`, `prefab_set_property`) now declare an explicit type union; the two `referenceInstanceId` params (`component_set_reference` and `component_batch_wire` entries) that were still `number` (the sites the 2.28.3 64-bit string sweep missed) are now decimal strings. A recursive strict-schema CI gate prevents regressions (issue #27).
- **Unconditional debug log** — the file debug log wrote on every tool call with no gate and no rotation (unbounded growth + sync I/O); now opt-in via `UNITY_MCP_DEBUG=1` with 5MB rotation, matching the README.

### Changed
- **Default `unity_console_log` output changed** (behavior change, capability preserved) — info/warning entries no longer include `stackTrace` and error traces are capped at 6 frames by default. Existing callers that read `stackTrace` off non-error entries now find it absent; pass `includeStackTrace:"all"` (and `maxStackFrames`) to restore the previous full output. Motivated by traces being ~80% of a typical console payload.
- Dead code removed (never-wired state persistence, unused exports/config); `unity_list_instances`' `refresh` param documented honestly; README env table corrected (`UNITY_BRIDGE_TIMEOUT` 60000, real `UNITY_MCP_DEBUG` semantics, new env vars); tool counts corrected to 331 (68 core + 254 advanced + hub/instance/context).

## [2.30.0] - 2026-06-02

### Added
- **`unity_screenshot_editor_window` tool** — capture any Editor window (Inspector, Project, Console, custom windows) to a PNG file. Unlike `unity_screenshot_game` / `unity_screenshot_scene` (which render a camera), it grabs the actual editor UI via the Win32 `PrintWindow` API, so it works even when the window is hidden behind others, without raising it or stealing focus. **Windows editor only** — returns a clear unsupported-platform error on macOS/Linux. Defaults to `Assets/Screenshots/`, accepts any user-chosen `.png` path; args `window` (required), `path`, `maxDimension`. Companion to the `unity-mcp-plugin` 2.32.0 change.

## [2.29.0] - 2026-05-21

### Added
- **MPPM virtual player & scenario tools** — `unity_mppm_list_players`, `unity_mppm_activate_player`, `unity_mppm_deactivate_player` (manage Multiplayer Play Mode virtual players) and `unity_mppm_create_scenario` (create a ScenarioConfig asset). Companion to the `unity-mcp-plugin` 2.31.0 MPPM changes; the existing `unity_mppm_*` scenario tools also got clearer descriptions.

## [2.28.3] - 2026-05-21

### Changed
- **`instanceId` tool parameters declared as `string`** — Unity 6.5 entity ids are 64-bit values that exceed JavaScript's safe-integer range; sent as JSON numbers they were rounded, breaking object-by-`instanceId` resolution. All 26 `instanceId` input schemas in `editor-tools.js` are now `string`. Companion to the `unity-mcp-plugin` 2.28.0 change. Fixes [#24](https://github.com/AnkleBreaker-Studio/unity-mcp-server/issues/24).

## [2.28.2] - 2026-04-22

### Fixed
- **MCP JSON-RPC framing corrupted by debug logs on stdout** — Two `console.debug(...)` call sites in `src/unity-editor-bridge.js` and `src/tool-tiers.js` wrote diagnostic lines to stdout, which the MCP stdio transport reserves exclusively for JSON-RPC messages. Strict clients (Codex CLI) closed the transport on the first non-JSON chunk; lenient clients (Claude Desktop, Claude Code) tolerated it, which is why the bug escaped earlier detection. Both call sites now use `console.error(...)` so logs go to stderr. Fixes [#11](https://github.com/AnkleBreaker-Studio/unity-mcp-server/issues/11).

## [2.28.1] - 2026-04-02

### Fixed
- **npm publish workflow** — Added `--allow-same-version` to `npm version` command to prevent CI failure when `package.json` already matches the release tag

## [2.28.0] - 2026-04-02

### Added
- **SpriteAtlas tools** — 7 new tools for Unity SpriteAtlas management (contributed by [@zaferdace](https://github.com/zaferdace)):
  - `spriteatlas/create` — Create a new SpriteAtlas asset
  - `spriteatlas/info` — Get SpriteAtlas details (packed sprites, settings)
  - `spriteatlas/add` — Add sprites/folders to a SpriteAtlas
  - `spriteatlas/remove` — Remove entries from a SpriteAtlas
  - `spriteatlas/settings` — Configure packing, texture, and platform settings
  - `spriteatlas/delete` — Delete a SpriteAtlas asset
  - `spriteatlas/list` — List all SpriteAtlases in the project
- New `spriteatlas-bridge.js` and `spriteatlas-tools.js` modules

### Added
- **npm auto-publish** — GitHub Action that automatically publishes to npm whenever a new GitHub release is created (contributed by [@vatanaksoytezer](https://github.com/vatanaksoytezer) in [#8](https://github.com/AnkleBreaker-Studio/unity-mcp-server/pull/8))

### Changed
- **npm package renamed** — Package renamed from `unity-mcp-server` to `anklebreaker-unity-mcp` to avoid name conflict on npm. Install via `npx anklebreaker-unity-mcp@latest`

### Fixed
- **UTF-8 encoding** — Fixed mojibake characters (corrupted em-dashes, arrows, section headers) across all comments in `unity-editor-bridge.js`; removed stale BOM
- **package-lock.json** — Synced version field to 2.27.0

## [2.27.0] - 2026-03-25

### Added
- **UMA (Unity Multipurpose Avatar) integration** — 13 new tools for the complete UMA asset pipeline:
  - `uma/inspect-fbx` — Inspect FBX meshes for UMA compatibility
  - `uma/create-slot` — Create SlotDataAsset from mesh data
  - `uma/create-overlay` — Create OverlayDataAsset with texture assignments
  - `uma/create-wardrobe-recipe` — Create WardrobeRecipe combining slots and overlays
  - `uma/create-wardrobe-from-fbx` — Atomic FBX-to-wardrobe pipeline (inspect → slot → overlay → recipe in one call)
  - `uma/wardrobe-equip` — Equip/unequip wardrobe items on DynamicCharacterAvatar
  - `uma/list-global-library` — Browse the UMA Global Library contents
  - `uma/list-wardrobe-slots` — List available wardrobe slots
  - `uma/list-uma-materials` — List UMA-compatible materials
  - `uma/get-project-config` — Get UMA project configuration
  - `uma/verify-recipe` — Validate a WardrobeRecipe for missing references
  - `uma/rebuild-global-library` — Force rebuild the Global Library index
  - `uma/register-assets` — Register Slot/Overlay/Recipe assets in the Global Library
- New `uma-bridge.js` module — UMA bridge functions extracted into a dedicated module
- New `uma-tools.js` — Full tool definitions and schemas for all UMA tools

## [2.26.0] - 2026-03-25

### Added
- **Compilation error detection** — New `unity_get_compilation_errors` tool retrieves C# compilation errors and warnings via `CompilationPipeline` API, independent of console log buffer
- **Test Runner integration** — Run EditMode/PlayMode tests, poll results, list available tests via Unity Test Runner API

## [2.25.0] - 2026-03-09

### Added
- **Parallel-safe instance routing** — Per-request `port` parameter on every `unity_*` tool call for multi-agent safety
- **Per-request port override** — Stateless routing mechanism bypassing shared per-agent state
- **Schema injection** — Optional `port` parameter auto-injected into every `unity_*` tool schema
- **Enhanced select_instance response** — Explicit routing instructions for AI assistants
