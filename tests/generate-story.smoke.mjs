// Smoke test for vrse_generate_story's pure logic (buildStoryReport) + tool registration.
// Offline: no Unity. The expected Data strings below mirror build_story.py byte-for-byte (key order +
// compact serialization) — this is the parity guard against silently reordered Data keys.
import { buildStoryReport, vrseStageTools } from "../src/tools/vrse-stage-tools.js";

const assert = (c, m) => { if (!c) { console.error("ASSERT FAIL:", m); process.exit(1); } };

assert(vrseStageTools.find((t) => t.name === "vrse_generate_story"), "vrse_generate_story registered in vrseStageTools");

// Collect every node across a story (for cross-cutting asserts).
function allNodes(story) {
  const nodes = [];
  for (const ch of story.chapters) for (const m of ch.moments) {
    for (const slot of [m.onAwake, m.onStart, m.onFirstWarning, m.onLastWarning, m.onEnd]) nodes.push(...(slot.actions || []));
    for (const set of m.onRight.triggerActionSets) { nodes.push(set.trigger); nodes.push(...set.actions); }
    for (const set of m.onWrong) { nodes.push(set.trigger); nodes.push(...set.actions); }
  }
  return nodes;
}
const byQuery = (nodes, q) => nodes.find((n) => n.Query === q);

const idMap = { SpawnA: 11, CountDownTimer: 22, SFXPlayer: 33, Lever: 44, Key: 55 };
const momentTable = {
  module: "TestModule",
  defaults: { firstWarningTimer: 30, lastWarningTimer: 50 }, // dict -> stringified compact
  chapters: [
    { name: "Chapter One", moments: [
      { name: "M1", momentIndex: 0,
        onStart: [
          { action: "VoiceOver", text: "Hello" },
          { action: "Highlight", target: "Key" },
          { action: "Highlight", target: ["A", "B"] },     // list -> 2 nodes
          { action: "Timer", seconds: 10 },                 // a_timer EMBEDS CountDownTimer#$id
          { action: "SFX", clip: "ding" },
          { action: "Teleport", target: "SpawnA" },
          { action: "GuidanceArrow", target: "Lever" },
        ],
        onRight: { mode: "InOrder", sets: [
          { trigger: { type: "Grab", target: "Key" }, actions: [{ action: "VoiceOver", text: "Good" }] },
          { trigger: { type: "Place", target: "Tray", grabbable: "Key" }, actions: [] },
          { trigger: { type: "Timer", seconds: 5 }, actions: [] },   // t_timer bare CountDownTimer
        ] },
        onWrong: [{ trigger: { type: "Touch", target: "Btn" }, actions: [{ action: "ToastMessage", text: "No" }] }],
      },
    ] },
  ],
};

// 1) Happy path — structure + byte-parity Data strings + the a_timer/t_timer asymmetry.
{
  const rep = buildStoryReport(momentTable, idMap);
  console.log("happy:", { ok: rep.ok, stats: rep.stats });
  assert(rep.ok && !rep.halt, "happy: ok/no halt");
  const s = rep.produced.story;

  // shape
  assert(s.name === "TestModule", "shape: name=module");
  assert(s.formatVersion === 2.0 && typeof s.formatVersion === "number", "shape: formatVersion numeric 2.0");
  assert(s.defaults === '{"firstWarningTimer":30,"lastWarningTimer":50}', "shape: top defaults dict -> compact string");
  const ch = s.chapters[0];
  assert(ch.chapterIndex === 0 && ch.studio.id === "" && ch.defaults === "", "shape: chapter index/studio/defaults('')");
  const m = ch.moments[0];
  assert(m.studio.id === "" && m.momentIndex === 0, "shape: moment studio/index");
  assert(Array.isArray(m.onWrong), "shape: onWrong is a BARE array");
  assert(Array.isArray(m.onRight.triggerActionSets) && m.onRight.triggerActionSets.length === 3, "shape: onRight.triggerActionSets");
  assert(m.onAwake && m.onStart.actions.length === 8, "shape: onStart flattened to 8 nodes (incl. list-highlight x2)");

  const nodes = allNodes(s);
  // action Data byte-parity
  const vo = nodes.find((n) => n.Name === "VoiceOver" && n.Data.includes("Hello"));
  assert(vo.Query === "" && vo.Option === "Play" && vo.ID === -1 && vo.Type === 0, "vo: act fields");
  assert(vo.Data === '{"text":"Hello","waitForCompletion":true}', "vo: Data byte-parity");
  assert(byQuery(nodes, "Key").Data === '{"Outline":true}' && byQuery(nodes, "Key").Option === "SetActive", "highlight: SetActive Outline:true");
  assert(byQuery(nodes, "CountDownTimer#$22").Data === '{"duration":10,"waitForCompletion":true}', "a_timer: EMBEDS CountDownTimer#$22 + Data");
  assert(byQuery(nodes, "SFXPlayer#$33").Data === '{"audioClipName":"ding"}', "sfx: Query SFXPlayer#$33 + Data");
  const tp = nodes.find((n) => n.Option === "Teleport");
  assert(tp.Query === "" && tp.Data === '{"targetTransform":"SpawnA#$11"}', "teleport: Data targetTransform#$id");
  const ga = byQuery(nodes, "TriggerQueryObjectGuider");
  assert(ga.Option === "Override" && ga.Data === '{"targetGameObject":"Lever#$44","waitForCompletion":true}', "guidance: Override Data");

  // trigger Data byte-parity + asymmetry
  const grab = nodes.find((n) => n.Name === "GrabbableTrigger" && n.Option === "Grab");
  assert(grab.Type === 1 && grab.Data === '{"handOption":"Any","targetRoleSetId":0}', "t_grab: Type1 + Data key order");
  const place = nodes.find((n) => n.Name === "PlacePointTrigger");
  assert(place.Data === '{"grabbableName":"Key#$55"}', "t_place: grabbableName#$id");
  const ttimer = nodes.find((n) => n.Name === "Timer");
  assert(ttimer.Query === "CountDownTimer" && ttimer.Data === '{"duration":5}', "t_timer: BARE Query CountDownTimer (asymmetry vs a_timer)");

  // stats
  assert(rep.stats.chapters === 1 && rep.stats.moments === 1 && rep.stats.triggers === 4 && rep.stats.actions === 10, "stats counts");
  assert(rep.stats.hasVoiceOver === true, "stats: hasVoiceOver");
  assert(/UNVOICED|unvoiced/.test(rep.next), "next: warns narration unvoiced when vo not set");
}

// 2) Data-is-string invariant (guards the #1 apply-time deserialize failure: Data emitted as object).
{
  const s = buildStoryReport(momentTable, idMap).produced.story;
  for (const n of allNodes(s)) {
    assert(typeof n.Data === "string", `Data must be a string for ${n.Name}`);
    if (n.Data !== "") { try { JSON.parse(n.Data); } catch { assert(false, `Data must be parseable JSON for ${n.Name}: ${n.Data}`); } }
  }
  // empty-Data cases (touch/button/mcq) emit "" exactly (build_story.py parity).
  const tbl = { module: "M", chapters: [{ name: "C", moments: [{ name: "m", momentIndex: 0, onRight: { mode: "InOrder", sets: [
    { trigger: { type: "Touch", target: "B" }, actions: [] },
    { trigger: { type: "Button", target: "U" }, actions: [] },
    { trigger: { type: "MCQ" }, actions: [] },
  ] } }] }] };
  const nodes = allNodes(buildStoryReport(tbl, {}).produced.story);
  assert(nodes.filter((n) => n.Type === 1).every((n) => n.Data === ""), "empty-Data: touch/button/mcq emit Data:'' ");
  console.log("data-string + empty-data: ok");
}

// 3) HALT: unresolved id (Teleport target not in idMap) — aggregate, no scene mutation.
{
  const rep = buildStoryReport({ module: "M", chapters: [{ name: "C", moments: [{ name: "m", momentIndex: 0, onStart: [{ action: "Teleport", target: "Ghost" }] }] }] }, {});
  assert(rep.ok === false && rep.halt === true, "missing-id: halts");
  assert(rep.missing.some((x) => x.kind === "ID_NOT_FOUND" && x.name === "Ghost"), "missing-id: ID_NOT_FOUND Ghost");
}

// 4) HALT: unknown action + unknown trigger keywords.
{
  const rep = buildStoryReport({ module: "M", chapters: [{ name: "C", moments: [{ name: "m", momentIndex: 0,
    onStart: [{ action: "Frobnicate" }],
    onRight: { mode: "InOrder", sets: [{ trigger: { type: "Wiggle", target: "X" }, actions: [] }] },
  }] }] }, {});
  assert(rep.halt && rep.missing.some((x) => x.kind === "UNKNOWN_ACTION") && rep.missing.some((x) => x.kind === "UNKNOWN_TRIGGER"), "unknown: both keywords flagged");
}

// 5) HALT: ambiguous (duplicate-name) id reference — needs duplicates[] from harvest.
{
  const rep = buildStoryReport(
    { module: "M", chapters: [{ name: "C", moments: [{ name: "m", momentIndex: 0, onStart: [{ action: "Teleport", target: "Key" }] }] }] },
    { Key: 55 },
    { duplicates: [{ name: "Key", ids: [55, 66] }] }
  );
  assert(rep.halt && rep.missing.some((x) => x.kind === "AMBIGUOUS_REF" && x.name === "Key"), "ambiguous: AMBIGUOUS_REF flagged");
}

// 6) No moment table → graceful halt.
{
  const rep = buildStoryReport(null);
  assert(rep.ok === false && rep.missing.some((x) => x.kind === "NO_MOMENT_TABLE"), "no-table: NO_MOMENT_TABLE");
}

console.error("GENERATE-STORY SMOKE OK: all assertions passed.");
