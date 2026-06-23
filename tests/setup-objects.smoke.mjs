// Smoke test for vrse_setup_objects' pure logic (resolveObjectContainers + buildSetupObjectsReport).
// Offline: feeds canned scene/hierarchy trees and route results — no Unity Editor needed.
import { resolveObjectContainers, buildSetupObjectsReport, unwrap, vrseStageTools } from "../src/tools/vrse-stage-tools.js";

const assert = (c, m) => { if (!c) { console.error("ASSERT FAIL:", m); process.exit(1); } };

assert(vrseStageTools.find((t) => t.name === "vrse_setup_objects"), "vrse_setup_objects registered in vrseStageTools");

// Canned hierarchies (mirror scene/hierarchy node shape: { name, children }, no path field).
const typeHierarchy = {
  name: "QueryObjects",
  children: [
    { name: "#h2 Interactables", children: [
      { name: "#h3 Grabbable", children: [ { name: "#h4 Common", children: [] }, { name: "#h4 Chapter 1", children: [] } ] },
      { name: "#h3 Touchable", children: [ { name: "#h4 Chapter 1", children: [] } ] },
      { name: "#h3 Placepoint", children: [] },
    ] },
  ],
};
const chapterHierarchy = {
  name: "QueryObjects",
  children: [ { name: "CHAPTER 1 - PICKUP", children: [] }, { name: "CHAPTER 2 - USE", children: [] } ],
};

// 1) Type-based resolution: each type lands in its #h3 column; shared→Common, exclusive→Chapter N.
{
  const { layout, objects } = resolveObjectContainers([
    { type: "grabbable", source: "GRB_Key", name: "Key", chapter: 1 },
    { type: "grabbable", source: "GRB_Wheel", name: "Wheel", shared: true },
    { type: "touchable", source: "TCH_Btn", name: "Btn", chapter: 1 },
  ], typeHierarchy);
  console.log("type:", layout, objects.map((o) => `${o.name}->${o.parent}`));
  assert(layout === "type", "type: layout detected as type-based");
  assert(objects[0].parent === "QueryObjects/#h2 Interactables/#h3 Grabbable/#h4 Chapter 1", "type: exclusive grabbable → #h4 Chapter 1 (existing path discovered)");
  assert(objects[0].lazy === false, "type: existing leaf not flagged lazy");
  assert(objects[1].parent === "QueryObjects/#h2 Interactables/#h3 Grabbable/#h4 Common", "type: shared grabbable → #h4 Common");
  assert(objects[2].parent === "QueryObjects/#h2 Interactables/#h3 Touchable/#h4 Chapter 1", "type: touchable → its own column");
}

// 2) Type-based, missing leaf → best-effort path under the discovered column, flagged lazy.
{
  const { objects } = resolveObjectContainers([
    { type: "grabbable", source: "GRB_X", name: "X", chapter: 5 }, // no #h4 Chapter 5 in canned tree
  ], typeHierarchy);
  assert(objects[0].parent === "QueryObjects/#h2 Interactables/#h3 Grabbable/#h4 Chapter 5", "lazy: best-effort leaf under existing column");
  assert(objects[0].lazy === true, "lazy: missing leaf flagged for lazy creation");
}

// 3) Chapter-based resolution: exclusive→CHAPTER container (existing), shared→QueryObjects root.
{
  const { layout, objects } = resolveObjectContainers([
    { type: "grabbable", source: "GRB_Key", name: "Key", chapter: 1, chapterName: "Pickup" },
    { type: "simple", source: "Prop", name: "Prop", shared: true },
    { type: "touchable", source: "TCH", name: "T", chapter: 3, chapterName: "New" }, // chapter 3 not in tree
  ], chapterHierarchy);
  console.log("chapter:", layout, objects.map((o) => `${o.name}->${o.parent} lazy=${o.lazy}`));
  assert(layout === "chapter", "chapter: layout detected as chapter-based");
  assert(objects[0].parent === "QueryObjects/CHAPTER 1 - PICKUP", "chapter: exclusive → existing CHAPTER container");
  assert(objects[0].lazy === false, "chapter: existing container not lazy");
  assert(objects[1].parent === "QueryObjects", "chapter: shared → QueryObjects root");
  assert(objects[2].parent === "QueryObjects/CHAPTER 3 - NEW" && objects[2].lazy === true, "chapter: missing chapter → lazy CHAPTER container");
}

// 4) Explicit parent override wins over resolution.
{
  const { objects } = resolveObjectContainers([
    { type: "grabbable", source: "S", name: "N", chapter: 1, parent: "QueryObjects/Custom/Spot" },
  ], typeHierarchy);
  assert(objects[0].parent === "QueryObjects/Custom/Spot", "override: explicit parent used verbatim");
}

// 5) No hierarchy discovered (null) → defaults to chapter layout, lazy paths under QueryObjects.
{
  const { layout, objects } = resolveObjectContainers([{ type: "grabbable", source: "S", name: "N", chapter: 2, chapterName: "Two" }], null);
  assert(layout === "chapter", "null-hierarchy: defaults to chapter layout");
  assert(objects[0].parent === "QueryObjects/CHAPTER 2 - TWO" && objects[0].lazy === true, "null-hierarchy: lazy CHAPTER container under QueryObjects");
}

// 6) Report assembly: converted / skipped / failed partition + produced.objectPaths + ok/halt/next.
{
  const resolved = [
    { name: "Key", parent: "QueryObjects/CHAPTER 1 - PICKUP" },
    { name: "Old", parent: "QueryObjects/CHAPTER 1 - PICKUP" },
    { name: "Bad", parent: "QueryObjects/CHAPTER 1 - PICKUP" },
  ];
  const routeResult = { success: false, results: [
    { name: "Key", ok: true, skipped: false, path: "QueryObjects/CHAPTER 1 - PICKUP/Key", nameOk: true, hasMeshChild: true },
    { name: "Old", ok: true, skipped: true, path: "QueryObjects/CHAPTER 1 - PICKUP/Old" },
    { name: "Bad", ok: false, error: "source 'GRB_Bad' not found" },
  ] };
  const rep = buildSetupObjectsReport(resolved, routeResult);
  console.log("report:", { ok: rep.ok, stats: rep.stats });
  assert(rep.objects.converted.length === 1 && rep.objects.converted[0].name === "Key", "report: 1 converted (Key)");
  assert(rep.objects.skipped.length === 1 && rep.objects.skipped[0].name === "Old", "report: 1 skipped (Old)");
  assert(rep.objects.failed.length === 1 && rep.objects.failed[0].name === "Bad", "report: 1 failed (Bad)");
  assert(rep.produced.objectPaths.length === 1 && rep.produced.objectPaths[0].includes("/Key"), "report: produced.objectPaths has Key");
  assert(rep.ok === false && rep.halt === true, "report: failure → ok=false, halt=true");
  assert(rep.missing.some((m) => m.kind === "OBJECT_FAILED" && m.name === "Bad"), "report: OBJECT_FAILED reason for Bad");
}

// 7) Report all-success → ok=true, next points downstream.
{
  const resolved = [{ name: "Key", parent: "p" }];
  const rep = buildSetupObjectsReport(resolved, { success: true, results: [{ name: "Key", ok: true, skipped: false, path: "p/Key", nameOk: true, hasMeshChild: true }] });
  assert(rep.ok === true && rep.halt === false, "report-ok: ok=true");
  assert(/vrse_harvest_ids|vrse_place_objects/.test(rep.next), "report-ok: next points downstream");
}

// 8) Placepoint resolves into the #h3 Placepoint column (type-based) + allows passes through.
{
  const { objects } = resolveObjectContainers([
    { type: "placepoint", name: "Tray", chapter: 1, allows: "Key", force_place: true },
  ], typeHierarchy);
  console.log("placepoint:", objects[0].parent, "allows=", objects[0].allows, "force_place=", objects[0].force_place);
  assert(objects[0].parent === "QueryObjects/#h2 Interactables/#h3 Placepoint/#h4 Chapter 1", "placepoint: → #h3 Placepoint column");
  assert(objects[0].allows === "Key", "placepoint: allows passed through");
  assert(objects[0].force_place === true, "placepoint: force_place passed through to route");
}

// 9) place_objects: tool registered + on/inside pass through resolution to the route.
{
  assert(vrseStageTools.find((t) => t.name === "vrse_place_objects"), "vrse_place_objects registered");
  const { objects } = resolveObjectContainers([
    { type: "placepoint", name: "Tray", chapter: 1, allows: "Key", on: "Workbench" },
  ], typeHierarchy);
  console.log("place:", objects[0].parent, "on=", objects[0].on, "inside=", JSON.stringify(objects[0].inside));
  assert(objects[0].on === "Workbench", "place: `on` passed through to route");
  assert(objects[0].inside === "", "place: `inside` defaulted empty");
  assert(objects[0].parent === "QueryObjects/#h2 Interactables/#h3 Placepoint/#h4 Chapter 1", "place: placepoint → #h3 Placepoint column");
}

// 10) place_objects spawnpoint: resolves to a #h3 Spawnpoints column + near/facing pass through.
{
  const { objects } = resolveObjectContainers([
    { type: "spawnpoint", name: "Bench_SP", chapter: 1, near: "Workbench,Vise", facing: "away" },
  ], typeHierarchy);
  console.log("spawn:", objects[0].parent, "near=", objects[0].near, "facing=", objects[0].facing);
  assert(/#h3 Spawnpoints\/#h4 Chapter 1$/.test(objects[0].parent), "spawn: → #h3 Spawnpoints column");
  assert(objects[0].near === "Workbench,Vise", "spawn: near passed through");
  assert(objects[0].facing === "away", "spawn: facing passed through");
}

// 11) Bridge-wrapper unwrap: the LIVE bridge returns { success, data:<route result> }. The handler must
//     unwrap(.data) before buildSetupObjectsReport, else every object reads as "no result returned for
//     object" (the spawn/teleport regression). This guards that exact path.
{
  // unwrap pulls out the nested route result; bridge errors (no .data) pass through unchanged.
  assert(unwrap({ success: true, data: { success: true, results: [{ name: "X", ok: true }] } }).results.length === 1, "unwrap: nested route result extracted");
  assert(unwrap({ success: false, error: "conn refused" }).error === "conn refused", "unwrap: bridge error (no .data) passes through");
  assert(unwrap(null) === null, "unwrap: null safe");

  // Success route, AS THE BRIDGE DELIVERS IT (wrapped). Must report converted, not "no result returned".
  const resolved = [{ name: "Tray", parent: "QueryObjects/CHAPTER 1 - PICKUP" }];
  const wrappedOk = { success: true, data: { success: true, placed: 1, failed: 0, results: [{ name: "Tray", ok: true, skipped: false, path: "QueryObjects/CHAPTER 1 - PICKUP/Tray", nameOk: true }] } };
  const repOk = buildSetupObjectsReport(resolved, unwrap(wrappedOk));
  assert(repOk.ok === true && repOk.objects.converted.length === 1, "unwrap+report: wrapped success → converted (not failed)");
  assert(!repOk.objects.failed.some((f) => /no result returned/.test(f.error || "")), "unwrap+report: no bogus 'no result returned'");

  // Failure route (e.g. spatial ring-search found no stand position): the diagnostic must survive, NOT be
  // masked by the generic 'no result returned for object'.
  const wrappedFail = { success: true, data: { success: false, placed: 0, failed: 1, results: [{ name: "Tray", ok: false, skipped: false, path: "p", error: "no clear stand position around focus after ring search" }] } };
  const repFail = buildSetupObjectsReport(resolved, unwrap(wrappedFail));
  assert(repFail.objects.failed.length === 1 && /ring search/.test(repFail.objects.failed[0].error), "unwrap+report: spatial diagnostic survives to the failed[] entry");
  console.log("unwrap:", { convertedOk: repOk.objects.converted.length, failDetail: repFail.objects.failed[0].error });
}

// 12) Non-fatal sizing warning: a placepoint whose `allows` object wasn't found is still created (ok:true)
//     but carries a route `warning` — it must surface on the converted entry AND in report.warnings, NOT be
//     treated as a failure. This is the standalone-use guard (collider sized by fallback, loudly).
{
  const resolved = [{ name: "Tray", parent: "QueryObjects/#h3 Placepoint" }];
  const wrapped = { success: true, data: { success: true, placed: 1, failed: 0, results: [
    { name: "Tray", ok: true, skipped: false, path: "QueryObjects/#h3 Placepoint/Tray", nameOk: true,
      warning: "placepoint collider was NOT sized from 'Fuse' — no object with that name ... fallback size was used." },
  ] } };
  const rep = buildSetupObjectsReport(resolved, unwrap(wrapped));
  console.log("warning:", { ok: rep.ok, warnings: rep.stats.warnings });
  assert(rep.ok === true && rep.objects.failed.length === 0, "warning: warned object is converted, not failed");
  assert(rep.objects.converted[0].warning && /NOT sized/.test(rep.objects.converted[0].warning), "warning: warning on the converted entry");
  assert(Array.isArray(rep.warnings) && rep.warnings.length === 1 && rep.warnings[0].name === "Tray", "warning: collected into report.warnings[]");
  assert(rep.stats.warnings === 1, "warning: counted in stats.warnings");
}

console.error("SETUP-OBJECTS SMOKE OK: all assertions passed.");
