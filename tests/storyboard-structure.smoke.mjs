// Smoke test for vrse_storyboard_structure (deterministic structural parse, no Unity, no LLM).
// Usage: node tests/storyboard-structure.smoke.mjs [path-to-storyboard.md]
import { vrseStageTools } from "../src/tools/vrse-stage-tools.js";

const tool = vrseStageTools.find((t) => t.name === "vrse_storyboard_structure");
if (!tool) {
  console.error("FAIL: vrse_storyboard_structure not found in vrseStageTools");
  process.exit(1);
}

const path = process.argv[2];

// Inline fixture so the test runs even without a path arg.
const inline = `---
module: "Smoke Test"
art_scene: "Assets/Art/Smoke.unity"
dev_scene: "Assets/Dev/Smoke.unity"
story_json: "Assets/StreamingAssets/Story Files/Smoke/Smoke.json"
story_json_mode: new
---

# Chapter 1 - Setup

## Objects
- Allen key 3mm (grabbable) [source: GRB_AllenKey3mm]
- Return Tray (placepoint) [allows: Allen key 3mm]
- Mystery Lever
- Panel Button (touchable) [source: TCH_PanelButton]

## Spawn Points
- Bench Spawn (spawn point) [near: Workbench]

### Step 1 - Pick up the key
- VoiceOver: Pick up the Allen key 3mm from the trolley.
- Trigger: User grabs Allen key 3mm
- Highlight: Allen key 3mm

### Step 2 - Place it
- Trigger: User places Allen key 3mm on Return Tray
`;

const out = await tool.handler(path ? { path } : { text: inline });
console.log(out);

const parsed = JSON.parse(out);
const assert = (cond, msg) => {
  if (!cond) { console.error("ASSERT FAIL:", msg); process.exit(1); }
};

if (!path) {
  // Validate the inline fixture deterministically.
  assert(parsed.spec.module === "Smoke Test", "module parsed");
  assert(parsed.spec.storyJson.includes("Smoke.json"), "story_json frontmatter parsed");
  assert(parsed.stats.chapters === 1, "one chapter");
  assert(parsed.stats.objects === 4, `4 declared objects incl. spawnpoint (got ${parsed.stats.objects})`);
  assert(parsed.spec.objects.some((o) => o.alias === "Allen key 3mm" && o.type === "grabbable" && o.source === "GRB_AllenKey3mm"), "grabbable + source");
  assert(parsed.spec.objects.some((o) => o.type === "placepoint" && o.allows === "Allen key 3mm"), "placepoint allows");
  assert(parsed.gaps.some((g) => g.kind === "UNTYPED_OBJECT" && /Mystery Lever/.test(g.line)), "untyped object gap surfaced");
  assert(parsed.spec.references.some((r) => r.alias === "Allen key 3mm"), "multi-word alias reference resolved");
  assert(parsed.ok === false, "ok=false because of the untyped-object gap");
  console.error("\nSMOKE OK: all inline assertions passed.");
}
