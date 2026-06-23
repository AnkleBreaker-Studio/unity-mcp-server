// Smoke test for vrse_prepare_scene's pure report assembly (buildPreflightReport).
// Offline: feeds canned scene-open + list-loaded-scenes results — no Unity Editor needed.
import { buildPreflightReport, vrseStageTools } from "../src/tools/vrse-stage-tools.js";

const assert = (c, m) => { if (!c) { console.error("ASSERT FAIL:", m); process.exit(1); } };

assert(vrseStageTools.find((t) => t.name === "vrse_prepare_scene"), "vrse_prepare_scene registered in vrseStageTools");

// 1) Happy path — both scenes open, all sources found exactly once; substring noise ignored.
{
  const r = buildPreflightReport(
    { devScenePath: "Assets/Dev.unity", artScenePath: "Assets/Art.unity", sources: ["Bottle", "Tray"], mode: "path" },
    { dev: { ok: true, name: "Dev", path: "Assets/Dev.unity" }, art: { ok: true, name: "Art", path: "Assets/Art.unity" } },
    {
      Bottle: [{ name: "Bottle", sceneName: "Art" }],
      // "TrayHandle" is a SUBSTRING match that must NOT count as a Tray match.
      Tray: [{ name: "Tray", sceneName: "Art" }, { name: "TrayHandle", sceneName: "Art" }],
    }
  );
  console.log("happy:", { ok: r.ok, found: r.stats.found, notFound: r.stats.notFound, dup: r.stats.duplicates });
  assert(r.ok === true && r.halt === false, "happy: ok=true, halt=false");
  assert(r.inventory.found.length === 2 && r.inventory.notFound.length === 0, "happy: both sources found, none missing");
  assert(r.inventory.found.find((f) => f.source === "Tray").count === 1, "happy: substring 'TrayHandle' ignored → Tray count=1");
  assert(r.inventory.duplicates.length === 0, "happy: no duplicates");
  assert(r.missing.length === 0, "happy: no precondition reasons");
  assert(r.scenesLoaded.dev.ok === true && r.scenesLoaded.art.ok === true, "happy: both scenes report ok");
  assert(/setup_chapters/.test(r.next), "happy: next points to setup_chapters");
}

// 2) A declared source is missing → halts with an actionable reason.
{
  const r = buildPreflightReport(
    { devScenePath: "Assets/Dev.unity", artScenePath: "Assets/Art.unity", sources: ["Bottle", "Ghost"], mode: "path" },
    { dev: { ok: true, name: "Dev" }, art: { ok: true, name: "Art" } },
    { Bottle: [{ name: "Bottle", sceneName: "Art" }], Ghost: [] }
  );
  console.log("missing:", { ok: r.ok, notFound: r.inventory.notFound });
  assert(r.ok === false && r.halt === true, "missing: ok=false, halt=true");
  assert(r.inventory.notFound.includes("Ghost"), "missing: Ghost in inventory.notFound");
  assert(r.missing.some((m) => m.kind === "SOURCE_NOT_FOUND" && m.source === "Ghost"), "missing: SOURCE_NOT_FOUND reason present");
  assert(/re-run vrse_prepare_scene/.test(r.next), "missing: next is actionable");
}

// 3) Duplicate (ambiguous) source — surfaced in inventory but NON-blocking.
{
  const r = buildPreflightReport(
    { devScenePath: "Assets/Dev.unity", artScenePath: "Assets/Art.unity", sources: ["Bottle"], mode: "path" },
    { dev: { ok: true }, art: { ok: true } },
    { Bottle: [{ name: "Bottle", sceneName: "Art" }, { name: "Bottle", sceneName: "Art" }] }
  );
  console.log("dup:", { ok: r.ok, duplicates: r.inventory.duplicates });
  assert(r.inventory.duplicates.some((d) => d.source === "Bottle" && d.count === 2), "dup: Bottle flagged as duplicate (count=2)");
  assert(r.ok === true, "dup: duplicates are non-blocking (ok stays true)");
  assert(/disambiguate/i.test(r.next), "dup: next warns to disambiguate");
}

// 4) Dev scene failed to open → halts with DEV_SCENE_NOT_OPEN; no art expected.
{
  const r = buildPreflightReport(
    { devScenePath: "Assets/Missing.unity", artScenePath: "", sources: [], mode: "path" },
    { dev: { ok: false, error: "path not found" } },
    {}
  );
  console.log("devfail:", { ok: r.ok, missing: r.missing.map((m) => m.kind) });
  assert(r.ok === false, "devfail: ok=false");
  assert(r.missing.some((m) => m.kind === "DEV_SCENE_NOT_OPEN"), "devfail: DEV_SCENE_NOT_OPEN reason");
  assert(r.scenesLoaded.dev.ok === false && r.scenesLoaded.art === null, "devfail: dev not ok, art null (none expected)");
}

// 5) Art scene expected but failed → halts with ART_SCENE_NOT_LOADED.
{
  const r = buildPreflightReport(
    { devScenePath: "Assets/Dev.unity", artScenePath: "Assets/Art.unity", sources: [], mode: "path" },
    { dev: { ok: true }, art: { ok: false, error: "art path not found" } },
    {}
  );
  assert(r.ok === false && r.missing.some((m) => m.kind === "ART_SCENE_NOT_LOADED"), "artfail: ART_SCENE_NOT_LOADED reason");
}

// 6) validateMarkers → reports which <source>_PP / <source>_SP exist.
{
  const r = buildPreflightReport(
    { devScenePath: "Assets/Dev.unity", sources: ["Cup"], validateMarkers: true, mode: "path" },
    { dev: { ok: true } },
    { Cup: [{ name: "Cup", sceneName: "Dev" }] },
    { "Cup_PP": [{ name: "Cup_PP", sceneName: "Art" }], "Cup_SP": [] }
  );
  console.log("markers:", r.markers);
  assert(Array.isArray(r.markers) && r.markers.length === 1, "markers: present when validateMarkers=true");
  assert(r.markers[0].pp === true && r.markers[0].sp === false, "markers: Cup pp=true, sp=false");
}

console.error("PREPARE-SCENE SMOKE OK: all assertions passed.");
