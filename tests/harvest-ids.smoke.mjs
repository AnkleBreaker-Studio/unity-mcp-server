// Smoke test for vrse_harvest_ids' pure logic (buildHarvestReport) + tool registration.
// Offline: feeds canned vrse/harvest-ids route results — no Unity Editor needed.
import { buildHarvestReport, unwrap, vrseStageTools } from "../src/tools/vrse-stage-tools.js";

const assert = (c, m) => { if (!c) { console.error("ASSERT FAIL:", m); process.exit(1); } };

assert(vrseStageTools.find((t) => t.name === "vrse_harvest_ids"), "vrse_harvest_ids registered in vrseStageTools");

// 1) Happy path (delivered AS THE BRIDGE WRAPS IT) → idMap built, ok, no halt, no invalid/duplicates.
{
  const wrapped = { success: true, data: { success: true, total: 2, valid: 2, invalid: 0, results: [
    { name: "Fuse", queryName: "Fuse", id: 351995, isIDValid: true, path: "QueryObjects/.../Fuse", vrseComponents: ["Grabbable"] },
    { name: "Tray_PP", queryName: "Tray_PP", id: 351996, isIDValid: true, path: "QueryObjects/.../Tray_PP", vrseComponents: ["PlacePoint"] },
  ] } };
  const rep = buildHarvestReport(unwrap(wrapped));
  console.log("happy:", { ok: rep.ok, idMap: rep.produced.idMap, stats: rep.stats });
  assert(rep.ok === true && rep.halt === false, "happy: ok=true, halt=false");
  assert(rep.produced.idMap.Fuse === 351995 && rep.produced.idMap.Tray_PP === 351996, "happy: idMap name->id");
  assert(rep.stats.valid === 2 && rep.stats.invalid === 0 && rep.stats.duplicates === 0, "happy: stats");
  assert(/vrse_generate_story/.test(rep.next), "happy: next points to generate_story");
  assert(!rep.invalid && !rep.duplicates, "happy: no invalid/duplicates arrays when none");
}

// 2) Invalid id (unassigned, id<=0 or isIDValid=false) → invalid[], ok=false, halt=true, INVALID_GOQ_ID.
{
  const rep = buildHarvestReport({ success: true, results: [
    { name: "Good", id: 10, isIDValid: true },
    { name: "Unsaved", id: -1, isIDValid: false },
    { name: "ZeroId", id: 0, isIDValid: true },
  ] });
  console.log("invalid:", { ok: rep.ok, invalid: rep.invalid.map((i) => i.name), stats: rep.stats });
  assert(rep.ok === false && rep.halt === true, "invalid: halts the pipeline");
  assert(rep.invalid.length === 2 && rep.invalid.some((i) => i.name === "Unsaved") && rep.invalid.some((i) => i.name === "ZeroId"), "invalid: both bad ids captured");
  assert(rep.produced.idMap.Good === 10 && !("Unsaved" in rep.produced.idMap), "invalid: only valid ids in idMap");
  assert(rep.missing.some((m) => m.kind === "INVALID_GOQ_ID" && m.name === "Unsaved"), "invalid: INVALID_GOQ_ID reason");
  assert(/save:true/.test(rep.next), "invalid: next suggests save:true re-harvest");
}

// 3) Empty scope → NO_GOQ_FOUND, ok=false.
{
  const rep = buildHarvestReport({ success: true, results: [] });
  assert(rep.ok === false && rep.objects.length === 0, "empty: ok=false");
  assert(rep.missing.some((m) => m.kind === "NO_GOQ_FOUND"), "empty: NO_GOQ_FOUND reason");
}

// 4) Duplicate names (ambiguous references) → duplicates[] surfaced; first id wins in idMap; still ok.
{
  const rep = buildHarvestReport({ success: true, results: [
    { name: "Bolt", id: 100, isIDValid: true },
    { name: "Bolt", id: 200, isIDValid: true },
    { name: "Wheel", id: 300, isIDValid: true },
  ] });
  console.log("dup:", { duplicates: rep.duplicates, idMap: rep.produced.idMap });
  assert(rep.ok === true, "dup: valid ids → still ok (dups are a warning, not a halt)");
  assert(rep.duplicates.length === 1 && rep.duplicates[0].name === "Bolt" && rep.duplicates[0].ids.join(",") === "100,200", "dup: collision recorded with all ids");
  assert(rep.produced.idMap.Bolt === 100, "dup: first id wins in idMap");
  assert(/duplicate names/i.test(rep.next), "dup: next warns about ambiguity");
}

// 5) Bridge-level error (no data/results) → ROUTE_ERROR surfaces, ok=false.
{
  const rep = buildHarvestReport(unwrap({ success: false, error: "connection refused" }));
  assert(rep.ok === false, "route-error: ok=false");
  assert(rep.missing.some((m) => m.kind === "ROUTE_ERROR" && /connection refused/.test(m.detail)), "route-error: ROUTE_ERROR surfaced");
}

console.error("HARVEST-IDS SMOKE OK: all assertions passed.");
