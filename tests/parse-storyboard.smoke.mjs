// Smoke test for vrse_parse_storyboard (smart front door: auto-detect storyboard vs SOP).
// No real LLM: forces the agent-delegation fallback for the SOP path.
import { vrseStageTools } from "../src/tools/vrse-stage-tools.js";

// Force the delegate path: no sampler wired here, and clear any env keys.
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;

const ingest = vrseStageTools.find((t) => t.name === "vrse_parse_storyboard");
const assert = (c, m) => { if (!c) { console.error("ASSERT FAIL:", m); process.exit(1); } };
assert(ingest, "vrse_parse_storyboard (smart) registered");

// 1) Already a storyboard → deterministic, no LLM.
const sb = `---
module: "X"
---
# Chapter 1 - A
## Objects
- Key (grabbable) [source: GRB_Key]
### Step 1 - Grab
- Trigger: User grabs Key
`;
const r1 = JSON.parse(await ingest.handler({ text: sb }));
console.log("storyboard-path:", { mode: r1.mode, via: r1.via, objects: r1.stats.objects });
assert(r1.mode === "storyboard" && r1.via === "deterministic", "storyboard detected + parsed deterministically");
assert(r1.stats.objects === 1, "one object parsed from storyboard");

// 2) Raw SOP, no LLM reachable → delegate with conversion prompt.
const sop = `Procedure 1: Remove the outer cover.
Step 1. Remove the two screws holding the banana cover using the 3mm Allen key.
CAUTION: Do not use the 2.5mm Allen key — it will strip the screw heads.
Step 2. Lift the banana cover off and place it on the trolley.`;
const r2 = JSON.parse(await ingest.handler({
  text: sop, module: "Demo", project: "DemoProj",
  artScene: "Assets/Art.unity", devScene: "Assets/Dev.unity", storyJson: "Assets/Story.json",
}));
console.log("sop-path:", { mode: r2.mode, via: r2.via, needsLLM: r2.needsLLM, rulesSource: r2.rulesSource });
assert(r2.mode === "sop", "SOP routed to sop mode");
assert(r2.via === "delegate" && r2.needsLLM === true, "no LLM → delegate fallback");
assert(r2.conversionPrompt && typeof r2.conversionPrompt.system === "string" && r2.conversionPrompt.user.includes("<sop>"), "conversion prompt returned for the agent");
assert(r2.conversionPrompt.system.includes('module: "Demo"'), "user frontmatter injected into the prompt");
assert(/grabbable \| touchable|## Objects|storyboard/i.test(r2.conversionPrompt.system), "embedded SOP/storyboard rules present (skills or fallback)");

console.error("INGEST SMOKE OK: all assertions passed.");
