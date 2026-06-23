// Smoke test for vrse_translate_storyboard's pure logic (storyboardToMomentTable + the line parsers) and
// the translate→generate round-trip. Offline: no Unity, no LLM (deterministic structured path only).
import {
  storyboardToMomentTable, buildMomentTable, parseActionLine, parseTriggerLine,
  buildStoryReport, KNOWN_ACTIONS, KNOWN_TRIGGERS, vrseStageTools,
} from "../src/tools/vrse-stage-tools.js";

const assert = (c, m) => { if (!c) { console.error("ASSERT FAIL:", m); process.exit(1); } };

assert(vrseStageTools.find((t) => t.name === "vrse_translate_storyboard"), "vrse_translate_storyboard registered");
assert(KNOWN_ACTIONS.has("VoiceOver") && KNOWN_TRIGGERS.has("Grab"), "KNOWN sets exported from emitters");

// ── unit: action line parser ──
{
  assert(JSON.stringify(parseActionLine('VoiceOver: "Pick it up."')) === JSON.stringify({ action: "VoiceOver", text: "Pick it up." }), "act: VoiceOver");
  const hl = parseActionLine("Highlight: Fuse [color: #00FF00] [width: 5]");
  assert(hl.action === "Highlight" && hl.target === "Fuse" && hl.color === "#00FF00" && hl.width === 5, "act: Highlight + mods");
  const multi = parseActionLine("Highlight: [A, B, C]");
  assert(Array.isArray(multi.target) && multi.target.join(",") === "A,B,C", "act: Highlight multi-target list preserved");
  assert(parseActionLine("Timer: 10s").seconds === 10, "act: Timer seconds");
  const anim = parseActionLine("Animation: ScrewRemove on Screw1");
  assert(anim.clip === "ScrewRemove" && anim.target === "Screw1", "act: Animation clip on target");
  const gu = parseActionLine("GrabUnlock: Tool [forceRelease]");
  assert(gu.action === "GrabUnlock" && gu.forceRelease === true, "act: GrabUnlock forceRelease");
  const hmi = parseActionLine("HMISwap: ScreenA → ScreenB");
  assert(Array.isArray(hmi) && hmi[0].action === "Despawn" && hmi[0].target === "ScreenA" && hmi[1].action === "Spawn" && hmi[1].target === "ScreenB", "act: HMISwap → Despawn+Spawn");
  assert(parseActionLine("MoveObject: X to Y").unknown, "act: unsupported keyword → unknown");
  assert(parseActionLine("GuidanceArrow: disable").disable === true, "act: GuidanceArrow disable");
}

// ── unit: trigger line parser ──
{
  const g = parseTriggerLine("User grabs Fuse [right hand] [op2]");
  assert(g.type === "Grab" && g.target === "Fuse" && g.hand === "Right" && g.targetRoleSetId === 2, "trig: Grab hand+op");
  const pl = parseTriggerLine("User places Fuse into Tray [disableGrabOnPlace]");
  assert(pl.type === "Place" && pl.grabbable === "Fuse" && pl.target === "Tray" && pl.disableGrabOnPlace === true, "trig: Place grabbable→placepoint");
  const col = parseTriggerLine("AllenKey enters Screw1 [isTrigger]");
  assert(col.type === "Collision" && col.target === "Screw1" && col.other === "AllenKey" && col.isTrigger === true, "trig: tool enters target");
  assert(parseTriggerLine("User enters Zone").other === "Player", "trig: user enters → Player collision");
  const piv = parseTriggerLine("User rotates Valve to max [lockOnReach]");
  assert(piv.type === "Pivot" && piv.limit === "Max" && piv.lockOnReach === true, "trig: Pivot max lockOnReach");
  assert(parseTriggerLine("Timer 5s elapsed").type === "Timer", "trig: Timer elapsed");
  assert(parseTriggerLine("Frobnicate the whatsit").unknown, "trig: unknown phrase → unknown");
}

// ── structured storyboard → momentTable (deterministic), + round-trip into generate_story ──
const STORYBOARD = `---
module: "Translator Test"
project: "TT"
---

# Chapter 1 - Setup

## Objects
- Fuse (grabbable) [source: Fuse]
- Tray (placepoint) [allows: Fuse]

### Moment 1 - Pick up the fuse

**OnAwake**
- Spawn: Fuse

**OnStart**
- VoiceOver: "Pick up the fuse."
- Highlight: Fuse [color: #00FF00]

**OnRight** (InOrder)
- Trigger: User grabs Fuse
  - Unhighlight: Fuse
  - VoiceOver: "Good."
- Trigger: User places Fuse into Tray
  - VoiceOver: "Perfect."

**OnWrong**
- Trigger: User grabs Tray
  - VoiceOver: "That's the tray, grab the fuse."

**OnEnd**
- Despawn: Fuse
`;
{
  const out = storyboardToMomentTable(STORYBOARD);
  console.log("translate:", { errors: out.stats.errors, stats: out.stats });
  assert(out.stats.errors === 0, "structured: no error gaps");
  assert(out.momentTable.module === "Translator Test", "structured: module");
  const m = out.momentTable.chapters[0].moments[0];
  assert(m.onAwake.length === 1 && m.onAwake[0].action === "Spawn" && m.onAwake[0].target === "Fuse", "structured: onAwake Spawn");
  assert(m.onStart.length === 2 && m.onStart[1].action === "Highlight" && m.onStart[1].color === "#00FF00", "structured: onStart VO+Highlight");
  assert(m.onRight.mode === "InOrder" && m.onRight.sets.length === 2, "structured: onRight 2 sets InOrder");
  assert(m.onRight.sets[0].trigger.type === "Grab" && m.onRight.sets[0].actions.length === 2, "structured: set0 Grab + 2 actions");
  assert(m.onRight.sets[1].trigger.type === "Place" && m.onRight.sets[1].trigger.grabbable === "Fuse", "structured: set1 Place(Fuse→Tray)");
  assert(Array.isArray(m.onWrong) && m.onWrong.length === 1 && m.onWrong[0].trigger.target === "Tray", "structured: onWrong bare array w/ trigger");
  assert(m.onEnd.length === 1 && m.onEnd[0].action === "Despawn", "structured: onEnd Despawn");

  // round-trip: momentTable → generate_story builder (with the ids it references) → valid story.
  const rep = buildStoryReport(out.momentTable, { Fuse: 1, Tray: 2 });
  console.log("round-trip:", { ok: rep.ok, stats: rep.stats });
  assert(rep.ok === true && rep.halt === false, "round-trip: translate→generate produces a valid story");
  assert(rep.stats.triggers === 3 && rep.stats.chapters === 1, "round-trip: 3 triggers (2 onRight + 1 onWrong)");
}

// ── gap path: unknown/unsupported keyword in a structured storyboard → error gap, ok:false ──
{
  const bad = `---
module: "Bad"
---
# Chapter 1 - X
### Moment 1 - M
**OnStart**
- Frobnicate: Thing
- MoveObject: A to B
`;
  const out = storyboardToMomentTable(bad);
  console.log("gaps:", out.gaps.map((g) => g.kind));
  assert(out.stats.errors >= 2 && out.gaps.some((g) => g.kind === "UNKNOWN_ACTION"), "gaps: unknown/unsupported actions flagged");
}

// ── empty/garbage model → graceful (no chapters) ──
{
  const out = buildMomentTable({ module: "", chapters: [] });
  assert(out.gaps.some((g) => g.kind === "NO_MODULE_NAME") && out.gaps.some((g) => g.kind === "NO_CHAPTERS"), "empty: NO_MODULE_NAME + NO_CHAPTERS");
}

console.error("TRANSLATE-STORYBOARD SMOKE OK: all assertions passed.");
