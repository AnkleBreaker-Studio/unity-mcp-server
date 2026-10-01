# Watch AnkleBreaker Unity MCP in action

These existing recordings show an AI assistant operating the Unity Editor through AnkleBreaker Unity MCP. Each GIF is a shortened, accelerated demonstration; its duration is not a development-time benchmark. The silent MP4 exports contain the same frames, with pause and seek available in a video player. They do not add resolution or audio to the source recording.

## Neon brick breaker

[![AI assistant and Unity Editor building a neon brick breaker](unity-mcp-showcase-brickbreaker.gif)](https://cdn.jsdelivr.net/gh/AnkleBreaker-Studio/unity-mcp-server@513fca2/docs/media/showcase-brickbreaker.mp4)

**[Open the 25-second MP4](https://cdn.jsdelivr.net/gh/AnkleBreaker-Studio/unity-mcp-server@513fca2/docs/media/showcase-brickbreaker.mp4)** · [Download video](https://raw.githubusercontent.com/AnkleBreaker-Studio/unity-mcp-server/Development-Unity66-Modernization/docs/media/showcase-brickbreaker.mp4)

Scene creation, brick layout, materials, C# gameplay scripts and visual iteration in one recorded workflow.

Try a similar prompt in a disposable prototype:

> Create a neon brick-breaker prototype in my selected project. Build the scene, paddle, ball and brick grid; add the gameplay scripts, check compilation, then run it and capture the result for review.

## Medieval village

[![AI assistant building a village with terrain, houses, trees and paths in Unity](unity-mcp-showcase-village.gif)](https://cdn.jsdelivr.net/gh/AnkleBreaker-Studio/unity-mcp-server@513fca2/docs/media/showcase-village.mp4)

**[Open the 25-second MP4](https://cdn.jsdelivr.net/gh/AnkleBreaker-Studio/unity-mcp-server@513fca2/docs/media/showcase-village.mp4)** · [Download video](https://raw.githubusercontent.com/AnkleBreaker-Studio/unity-mcp-server/Development-Unity66-Modernization/docs/media/showcase-village.mp4)

Terrain, repeated house construction, materials and environmental details, with the assistant inspecting and refining the scene.

> Build a small medieval village using primitives and reusable materials. Add houses, paths, fences and trees; organize the hierarchy and show me the scene before saving it.

## Castle and first-person walkthrough

[![AI assistant constructing and inspecting a castle in the Unity Editor](unity-mcp-showcase-castle.gif)](https://cdn.jsdelivr.net/gh/AnkleBreaker-Studio/unity-mcp-server@513fca2/docs/media/showcase-castle.mp4)

**[Open the 18-second MP4](https://cdn.jsdelivr.net/gh/AnkleBreaker-Studio/unity-mcp-server@513fca2/docs/media/showcase-castle.mp4)** · [Download video](https://raw.githubusercontent.com/AnkleBreaker-Studio/unity-mcp-server/Development-Unity66-Modernization/docs/media/showcase-castle.mp4)

Multi-room level construction, lighting adjustments and a playable walkthrough in the recorded project.

> Create a castle blockout with a courtyard and connected rooms. Add a first-person controller, check compilation, inspect the lighting and capture a walkthrough so I can review scale and navigation.

The prompts are starting points, not deterministic scripts. Results depend on the selected model, installed packages and project state. The recordings demonstrate authoring; the separate [validation record](modernization-audit.md) documents current-branch tests, compatibility and measured performance.

## Media formats and reproduction

The README Dashboard image is an unchanged native capture from the [attached-editor validation](validation/unity66-editor-render.json), using `dashboard-640-800-top.png`. It shows an owned validation project and intentionally long test strings. Its counters are historical test data, not a live status feed.

The MP4 files use H.264, YUV420p and a front-loaded MP4 index. They total about 1.9 MiB and are kept in `docs/media`; the plugin's copies live under `Documentation~/media`, which Unity excludes from package import. The **Open video** links serve those public repository files through jsDelivr, pinned to media commit `513fca2`, with the `video/mp4` content type so browsers offer playback controls. GitHub's raw endpoint downloads them instead. If the CDN is unavailable, use the adjacent GitHub download link and open the MP4 locally. Inline GIF previews do not depend on the video CDN.

With FFmpeg installed, reproduce an export from the existing GIF:

```bash
ffmpeg -i docs/unity-mcp-showcase-brickbreaker.gif -an -vf "pad=ceil(iw/2)*2:ceil(ih/2)*2,setsar=1" -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -movflags +faststart docs/media/showcase-brickbreaker.mp4
```

The one-pixel padding accommodates the original odd frame dimensions; square pixels preserve the GIF's displayed proportions. The export does not crop the recording. Repeat with `village` and `castle` for the other clips. GIF source files are unchanged.
