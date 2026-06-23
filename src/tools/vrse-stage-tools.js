// VRse Stage Tools — additive, per-pipeline-level tools (skills-assisted, tools-focused).
//
// These run ALONGSIDE the existing console+skills pipeline; they do not replace it.
// Each tool encapsulates one pipeline "level" as a single call.
//
// vrse_storyboard_structure is PURE COMPUTE (text -> structured spec). It does NOT touch
// Unity — no bridge call — so it works in any MCP client / IDE without the Editor running.
// It is the deterministic ~60% of the "parse storyboard" level: it extracts frontmatter,
// per-chapter object declarations + modifiers, spawn points, and moment/alias references,
// and returns the interpretive GAPS the agent must resolve (untyped objects, missing
// sources, bad references). Logic ported from console/lib/storyboard-parser.ts.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as bridge from "../unity-editor-bridge.js";

// ─── Reserved section names (not chapter headings) ──────────────────────────
const SECTION_NAMES = new Set([
  "Objects",
  "Object Registry",
  "Spawn Points",
  "Spawn Point Registry",
]);

// Action lines that contribute alias references.
const REFERENCE_LINE_PREFIXES = [
  "Trigger:", "Highlight:", "Unhighlight:", "Spawn:", "Despawn:",
  "GuidanceArrow:", "Animation", "GrabUnlock:", "GrabLock:",
  "UnlockRotation:", "LockRotation:", "HMISwap:", "Teleport:",
  "DisableGrabFor:", "EnableGrabFor:", "CameraFade:",
];

// Lines to explicitly skip even if they contain alias-looking tokens.
const SKIP_LINE_PREFIXES = [
  "VoiceOver:", "VO:", "Voice Over:", "Voice-Over:", "Haptics:", "SFX:", "Timer:",
];

// ─── Parser (ported from console/lib/storyboard-parser.ts) ──────────────────

function parseStoryboard(text) {
  const normalized = String(text).replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const model = {
    module: "",
    project: undefined,
    artScene: undefined,
    devScene: undefined,
    storyJson: undefined,
    storyJsonMode: undefined,
    chapters: [],
    aliases: new Map(),
    references: [],
    parseErrors: [],
    untypedObjectLines: [], // bullet lines inside ## Objects with no recognized (type)
  };

  // ── Phase 1: frontmatter ──
  const fmMatch = normalized.match(/^---\s*\n([\s\S]*?)\n---/);
  let bodyStartLine = 0;
  if (fmMatch) {
    const fm = fmMatch[1];
    bodyStartLine = fmMatch[0].split("\n").length;
    const get = (key) => {
      const m = fm.match(new RegExp(`^\\s*${key}\\s*:\\s*"?([^"\\n]+?)"?\\s*$`, "m"));
      return m ? m[1].trim() : "";
    };
    if (get("module")) model.module = get("module");
    if (get("project")) model.project = get("project");
    if (get("art_scene")) model.artScene = get("art_scene");
    if (get("dev_scene")) model.devScene = get("dev_scene");
    if (get("story_json")) model.storyJson = get("story_json");
    if (get("story_json_mode")) model.storyJsonMode = get("story_json_mode");
  }

  // ── Phase 2: walk body, build chapter/moment structure + Objects blocks ──
  let currentChapter = null;
  let currentMoment = null;
  let currentSection = "none"; // 'none' | 'objects' | 'spawn_points' | 'other'

  for (let i = bodyStartLine; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();
    if (!line) {
      if (currentMoment) currentMoment.rawLines.push("");
      continue;
    }

    // ### moment
    const momentMatch = line.match(/^###\s+(?:Step|Moment|M)?\s*(\d+)?\s*[-—.:]?\s*(.+)/i);
    if (momentMatch) {
      if (!currentChapter) {
        model.parseErrors.push({
          severity: "warning",
          code: "NO_CHAPTERS",
          message: `Moment "${momentMatch[2].trim()}" appears before any chapter heading.`,
          line,
        });
        continue;
      }
      currentMoment = {
        index: momentMatch[1] !== undefined ? parseInt(momentMatch[1]) : currentChapter.moments.length,
        name: momentMatch[2].trim(),
        rawLines: [],
      };
      currentChapter.moments.push(currentMoment);
      currentSection = "none";
      continue;
    }

    // ## section or chapter
    const doubleHashMatch = line.match(/^##\s+(?!#)(.+)/);
    if (doubleHashMatch) {
      const heading = doubleHashMatch[1].trim();
      if (isReservedSection(heading)) {
        currentSection = heading.toLowerCase().startsWith("object") ? "objects"
          : heading.toLowerCase().startsWith("spawn") ? "spawn_points"
          : "other";
        currentMoment = null;
        continue;
      }
      if ((currentSection === "objects" || currentSection === "spawn_points") && !looksLikeChapter(heading)) {
        continue; // grouping comment inside a section — ignore
      }
      currentChapter = makeChapter(heading, model.chapters.length);
      model.chapters.push(currentChapter);
      currentMoment = null;
      currentSection = "none";
      continue;
    }

    // # chapter (or module name if not yet set)
    const singleHashMatch = line.match(/^#\s+(?!#)(.+)/);
    if (singleHashMatch) {
      const heading = singleHashMatch[1].trim();
      if ((currentSection === "objects" || currentSection === "spawn_points") && !looksLikeChapter(heading)) {
        continue;
      }
      if (!model.module && !looksLikeChapter(heading)) {
        model.module = heading;
      } else {
        currentChapter = makeChapter(heading, model.chapters.length);
        model.chapters.push(currentChapter);
        currentMoment = null;
        currentSection = "none";
      }
      continue;
    }

    // ── Body content ──
    if (currentMoment) {
      currentMoment.rawLines.push(rawLine);
      continue;
    }

    if (currentChapter && currentSection === "objects") {
      const decl = parseObjectDeclLine(rawLine, currentChapter.index, currentChapter.name);
      if (decl) {
        const key = aliasKey(currentChapter.index, decl.alias);
        if (model.aliases.has(key)) {
          model.parseErrors.push({
            severity: "warning",
            code: "DUPLICATE_ALIAS",
            message: `Alias "${decl.alias}" declared twice in chapter "${currentChapter.name}".`,
            chapterIndex: currentChapter.index,
            alias: decl.alias,
            line: rawLine,
          });
        }
        model.aliases.set(key, decl);
        if (requiresSource(decl.declaredType) && !decl.sceneSource) {
          model.parseErrors.push({
            severity: "error",
            code: "MISSING_SOURCE",
            message: `Object "${decl.alias}" (${decl.declaredType}) in chapter "${currentChapter.name}" has no [source: …] annotation.`,
            chapterIndex: currentChapter.index,
            alias: decl.alias,
            line: rawLine,
          });
        }
      } else if (/^[-*]\s+/.test(line)) {
        // A bullet inside the Objects block that has no recognized (type) — the agent
        // must infer the type. Surfaced as an UNTYPED_OBJECT gap.
        model.untypedObjectLines.push({
          chapterIndex: currentChapter.index,
          chapterName: currentChapter.name,
          line: rawLine,
        });
      }
      continue;
    }

    if (currentChapter && currentSection === "spawn_points") {
      const sp = parseSpawnPointLine(rawLine, currentChapter.index, currentChapter.name);
      if (sp) {
        const key = aliasKey(currentChapter.index, sp.alias);
        if (!model.aliases.has(key)) model.aliases.set(key, sp);
      }
      continue;
    }
  }

  // ── Phase 3: walk each moment body for alias references ──
  for (const ch of model.chapters) {
    const validAliases = collectAliasesForChapter(model.aliases, ch.index);
    for (const m of ch.moments) {
      for (const rawLine of m.rawLines) {
        const line = rawLine.trim();
        if (!line) continue;
        if (!isReferenceLine(line)) continue;
        const foundAliases = extractAliasTokens(line, validAliases);
        for (const alias of foundAliases) {
          model.references.push({
            alias,
            chapterIndex: ch.index,
            chapterName: ch.name,
            momentIndex: m.index,
            momentName: m.name,
            rawLine: line,
          });
        }
      }
    }
  }

  // ── Phase 4: structural consistency checks ──
  if (!model.module) {
    model.parseErrors.push({
      severity: "error",
      code: "NO_MODULE_NAME",
      message: 'Storyboard is missing a module name. Add `module: "..."` to the frontmatter.',
    });
  }
  if (model.chapters.length === 0) {
    model.parseErrors.push({
      severity: "error",
      code: "NO_CHAPTERS",
      message: "Storyboard contains no chapter headings. Use `# Chapter N - Name` or `## Chapter N - Name`.",
    });
  }

  // BAD_ALLOWS_REFERENCE
  for (const decl of model.aliases.values()) {
    if (decl.declaredType === "placepoint" && decl.allows) {
      const validInChapter = collectAliasesForChapter(model.aliases, decl.chapterIndex);
      const target = validInChapter.get(decl.allows);
      if (!target) {
        model.parseErrors.push({
          severity: "error",
          code: "BAD_ALLOWS_REFERENCE",
          message: `Placepoint "${decl.alias}" references [allows: ${decl.allows}] which is not declared as a grabbable.`,
          chapterIndex: decl.chapterIndex,
          alias: decl.alias,
          line: decl.rawLine,
        });
      } else if (target.declaredType !== "grabbable") {
        model.parseErrors.push({
          severity: "warning",
          code: "BAD_ALLOWS_REFERENCE",
          message: `Placepoint "${decl.alias}" [allows: ${decl.allows}] points at a "${target.declaredType}", expected "grabbable".`,
          chapterIndex: decl.chapterIndex,
          alias: decl.alias,
          line: decl.rawLine,
        });
      }
    }
  }

  return model;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function aliasKey(chapterIndex, alias) {
  return `${chapterIndex}:${alias}`;
}

function requiresSource(type) {
  // placepoint = created at a spatial location; spawnpoint = scene-derived. Neither needs [source:].
  return type !== "placepoint" && type !== "spawnpoint";
}

function isReservedSection(heading) {
  const norm = heading.replace(/\s+/g, " ").trim();
  for (const name of SECTION_NAMES) if (name.toLowerCase() === norm.toLowerCase()) return true;
  return false;
}

function looksLikeChapter(heading) {
  return /^(?:Chapter\s+\d+|\d+\s*[-—.:])/i.test(heading);
}

function makeChapter(headingText, fallbackIndex) {
  const m = headingText.match(/^(?:Chapter\s+)?(\d+)?\s*[-—.:]?\s*(.+)/i);
  const index = m && m[1] !== undefined ? parseInt(m[1]) : fallbackIndex;
  const name = (m && m[2] && m[2].trim()) || headingText;
  return { index, name, moments: [] };
}

function parseObjectDeclLine(rawLine, chapterIndex, chapterName) {
  const line = rawLine.trim();
  const m = line.match(/^[-*]\s+(.+?)\s*\(\s*(grabbable|touchable|simple|pivot|placepoint|forceps)\s*\)(.*)$/i);
  if (!m) return null;
  const alias = m[1].trim();
  const declaredType = m[2].toLowerCase();
  const trailing = m[3];

  const sourceMatch = trailing.match(/\[source:\s*([^\]]+?)\s*\]/i);
  const allowsMatch = trailing.match(/\[allows:\s*([^\]]+?)\s*\]/i);
  const atMatch = trailing.match(/\[at:\s*([^\]]+?)\s*\]/i);
  const positionMatch = trailing.match(/\[position:\s*([^\]]+?)\s*\]/i);

  let position;
  if (positionMatch) {
    const parts = positionMatch[1].split(",").map((s) => parseFloat(s.trim()));
    if (parts.length === 3 && parts.every((n) => !Number.isNaN(n))) {
      position = [parts[0], parts[1], parts[2]];
    }
  }

  return {
    alias,
    sceneSource: sourceMatch ? sourceMatch[1].trim() : "",
    declaredType,
    allows: allowsMatch ? allowsMatch[1].trim() : undefined,
    at: atMatch ? atMatch[1].trim() : undefined,
    position,
    chapterIndex,
    chapterName,
    rawLine,
  };
}

function parseSpawnPointLine(rawLine, chapterIndex, chapterName) {
  const line = rawLine.trim();

  // Form A: `- Name (spawn point) [near: X] [at: ...]`
  const typed = line.match(/^[-*]\s+(.+?)\s*\(\s*spawn\s*point\s*\)(.*)$/i);
  if (typed) {
    const alias = typed[1].trim();
    const trailing = typed[2];
    const nearMatch = trailing.match(/\[near:\s*([^\]]+?)\s*\]/i);
    const atMatch = trailing.match(/\[at:\s*([^\]]+?)\s*\]/i);
    return {
      alias,
      sceneSource: alias,
      declaredType: "spawnpoint",
      at: atMatch ? atMatch[1].trim() : nearMatch ? `near ${nearMatch[1].trim()}` : undefined,
      chapterIndex,
      chapterName,
      rawLine,
    };
  }

  // Form B (legacy): `- SpawnPointName: Description`
  const m = line.match(/^[-*]\s+(.+?)\s*:\s*(.*)$/);
  if (!m) return null;
  return {
    alias: m[1].trim(),
    sceneSource: m[1].trim(),
    declaredType: "spawnpoint",
    at: (m[2] && m[2].trim()) || undefined,
    chapterIndex,
    chapterName,
    rawLine,
  };
}

function collectAliasesForChapter(all, chapterIndex) {
  const out = new Map();
  for (const decl of all.values()) {
    if (decl.chapterIndex === chapterIndex) out.set(decl.alias, decl);
  }
  for (const decl of all.values()) {
    if (decl.chapterIndex !== chapterIndex && !out.has(decl.alias)) out.set(decl.alias, decl);
  }
  return out;
}

function isReferenceLine(line) {
  const stripped = line.replace(/^[-*]\s*/, "");
  for (const prefix of SKIP_LINE_PREFIXES) {
    if (stripped.toLowerCase().startsWith(prefix.toLowerCase())) return false;
  }
  for (const prefix of REFERENCE_LINE_PREFIXES) {
    if (stripped.toLowerCase().startsWith(prefix.toLowerCase())) return true;
  }
  return false;
}

function extractAliasTokens(line, validAliases) {
  const tokenSet = new Set(line.match(/[A-Za-z_][\w]*/g) || []);
  const lower = line.toLowerCase();
  const found = [];
  for (const alias of validAliases.keys()) {
    const matched = /\s/.test(alias) ? lower.includes(alias.toLowerCase()) : tokenSet.has(alias);
    if (matched) found.push(alias);
  }
  return found.filter((a) => !found.some((b) => b !== a && b.toLowerCase().includes(a.toLowerCase())));
}

// ─── Spec assembly + gap derivation ─────────────────────────────────────────

function buildSpecAndGaps(model) {
  const objects = Array.from(model.aliases.values()).map((d) => ({
    alias: d.alias,
    type: d.declaredType,
    source: d.sceneSource || null,
    allows: d.allows || null,
    at: d.at || null,
    position: d.position || null,
    chapterIndex: d.chapterIndex,
    chapterName: d.chapterName,
  }));

  const chapters = model.chapters.map((c) => ({
    index: c.index,
    name: c.name,
    moments: c.moments.map((m) => ({ index: m.index, name: m.name })),
  }));

  const references = model.references.map((r) => ({
    alias: r.alias,
    chapterIndex: r.chapterIndex,
    momentIndex: r.momentIndex,
    momentName: r.momentName,
    line: r.rawLine,
  }));

  const usedSceneSources = Array.from(
    new Set(
      Array.from(model.aliases.values())
        .filter((d) => requiresSource(d.declaredType) && d.sceneSource)
        .map((d) => d.sceneSource)
    )
  );

  // Gaps = the interpretive items the agent must resolve before driving the deterministic tools.
  const gaps = [];
  for (const e of model.parseErrors) {
    gaps.push({
      kind: e.code,
      severity: e.severity,
      message: e.message,
      chapterIndex: e.chapterIndex,
      alias: e.alias,
      line: e.line,
    });
  }
  for (const u of model.untypedObjectLines) {
    gaps.push({
      kind: "UNTYPED_OBJECT",
      severity: "error",
      message:
        "Object line has no recognized (type) — infer it and add one of " +
        "(grabbable|touchable|simple|pivot|placepoint|forceps).",
      chapterIndex: u.chapterIndex,
      line: u.line,
    });
  }

  const errorCount = gaps.filter((g) => g.severity === "error").length;
  const warningCount = gaps.filter((g) => g.severity === "warning").length;

  return {
    ok: errorCount === 0,
    spec: {
      module: model.module || null,
      project: model.project || null,
      artScene: model.artScene || null,
      devScene: model.devScene || null,
      storyJson: model.storyJson || null,
      storyJsonMode: model.storyJsonMode || null,
      chapters,
      objects,
      references,
      usedSceneSources,
    },
    gaps,
    stats: {
      chapters: chapters.length,
      moments: chapters.reduce((n, c) => n + c.moments.length, 0),
      objects: objects.length,
      references: references.length,
      errors: errorCount,
      warnings: warningCount,
    },
    next:
      errorCount === 0
        ? "Spec is structurally complete. Resolve any warnings, then drive the deterministic stage tools (vrse_prepare_scene → … → vrse_finalize) or vrse_build_module."
        : "Resolve the `gaps` (severity=error) first — supply missing types/sources — then re-parse and proceed once clean.",
  };
}

// ─── Tool definitions ────────────────────────────────────────────────────────

// ─── SOP → storyboard (smart ingest) support ─────────────────────────────────
//
// vrse_parse_storyboard (the smart front door) converts an UNFORMATTED SOP into a storyboard, then parses it.
// The interpretive SOP→storyboard step needs an LLM. We get that model from the
// SESSION (MCP sampling) so NO API key is embedded in the server. Resolution order:
//   1. MCP sampling   — the client runs the completion with its own model + creds
//   2. server env key — ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN (+ BASE_URL), headless
//   3. agent-delegate — return the prompt for the calling agent (itself an LLM) to run

let _sopSampler = null; // async ({system, user, maxTokens}) => string | null  (MCP sampling)

/** Wired from index.js: lets vrse_parse_storyboard borrow the client's model via MCP sampling. */
export function setSopSampler(fn) {
  _sopSampler = fn;
}

const SKILLS_DIR = process.env.VRSE_SKILLS_DIR || join(homedir(), ".claude", "skills");

function readIfExists(...parts) {
  try { return readFileSync(join(...parts), "utf-8"); } catch { return null; }
}

const FALLBACK_RULES = `You convert Standard Operating Procedures (SOPs) into VRse training storyboards (markdown).
Output a storyboard with:
- YAML frontmatter: module, project, formatVersion: 2.0, art_scene, dev_scene, story_json, story_json_mode.
- One \`# Chapter N - NAME\` per SOP procedure.
- A \`## Objects\` block per chapter. Declare each object as \`- Alias (type)\` where type is one of
  grabbable | touchable | simple | pivot | placepoint | forceps. Do NOT add [source:] (bound later).
  Placepoints take [allows: <Grabbable>]; spawn points take [near: <X>].
- A \`## Spawn Points\` block (\`- Name (spawn point) [near: X]\`).
- One \`### Step N - NAME\` per SOP step (1 step = 1 moment, never collapse) with lifecycle blocks:
  **OnAwake**, **OnStart** (VoiceOver/Highlight), **OnWrong** (only from explicit CAUTION/Do-NOT/sequence
  rules), **OnRight** (InOrder|Random), **FirstWarning**, **LastWarning**, **OnEnd**.
Never hallucinate names not in the SOP; mark uncertain inferences with <!-- TODO: AUTHOR REVIEW -->.
Output ONLY the storyboard markdown — no preamble, no code fences.`;

/** Embedded conversion rules: the parse-sop-to-storyboard skill + the storyboard format it must emit. */
function loadSopRules() {
  const sopSkill = readIfExists(SKILLS_DIR, "parse-sop-to-storyboard", "SKILL.md");
  const mapping = readIfExists(SKILLS_DIR, "parse-sop-to-storyboard", "sop-mapping-rules.md");
  const format = readIfExists(SKILLS_DIR, "interpreting-storyboard-specs", "storyboard-format.md");
  const parts = [sopSkill, mapping, format].filter(Boolean);
  if (parts.length) return { rules: parts.join("\n\n---\n\n"), source: "skills" };
  return { rules: FALLBACK_RULES, source: "fallback" };
}

function buildFrontmatter(p = {}) {
  const lines = [
    "---",
    `module: "${p.module || "Untitled Module"}"`,
    `project: "${p.project || p.module || "Untitled"}"`,
    "formatVersion: 2.0",
  ];
  if (p.artScene) lines.push(`art_scene: "${p.artScene}"`);
  if (p.devScene) lines.push(`dev_scene: "${p.devScene}"`);
  if (p.storyJson) lines.push(`story_json: "${p.storyJson}"`);
  lines.push(`story_json_mode: ${p.storyJsonMode || "new"}`, "---");
  return lines.join("\n");
}

/** Heuristic: is this already a formatted VRse storyboard (vs a raw SOP)? */
function looksLikeStoryboard(text) {
  const hasFm = /^---\s*\n[\s\S]*?\bmodule\s*:[\s\S]*?\n---/m.test(text);
  const hasMarkers =
    /(^|\n)##\s+Objects\b/i.test(text) ||
    /(^|\n)###\s+(Step|Moment|M)\b/i.test(text) ||
    /(^|\n)#{1,2}\s+Chapter\s+\d+/i.test(text);
  return hasFm && hasMarkers;
}

/** Best-effort server-env LLM call (Anthropic Messages API or compatible). Returns text or null. */
async function envKeyCompletion({ system, user, maxTokens }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN;
  if (!apiKey && !authToken) return null;
  const base = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/$/, "");
  const model = process.env.VRSE_SOP_MODEL || process.env.CLAUDE_MODEL || "claude-sonnet-4-5";
  const headers = { "content-type": "application/json", "anthropic-version": "2023-06-01" };
  if (apiKey) headers["x-api-key"] = apiKey;
  else headers["authorization"] = `Bearer ${authToken}`;
  try {
    const resp = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const block = Array.isArray(data.content) ? data.content.find((b) => b.type === "text") : null;
    return block ? block.text : null;
  } catch {
    return null;
  }
}

/** Run the SOP→storyboard completion via the resolution chain (sampling → env key → delegate). */
async function runSopCompletion({ system, user, maxTokens = 16000 }) {
  if (_sopSampler) {
    try {
      const out = await _sopSampler({ system, user, maxTokens });
      if (out) return { text: out, via: "sampling" };
    } catch { /* fall through to next strategy */ }
  }
  const env = await envKeyCompletion({ system, user, maxTokens });
  if (env) return { text: env, via: "env-key" };
  return { text: null, via: "delegate" };
}

function stripCodeFences(s) {
  const m = s.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/);
  return m ? m[1] : s;
}

const INGEST_TOOL = {
  name: "vrse_parse_storyboard",
  description:
    "Upload ANYTHING — a formatted VRse storyboard OR an unformatted SOP — and get a structured spec. " +
    "Auto-detects: a storyboard is parsed deterministically (free, no LLM); an SOP is first converted to a " +
    "storyboard using the embedded parse-sop-to-storyboard rules via an LLM, then parsed. The LLM is the " +
    "CLIENT's own model (MCP sampling) so no API key lives in the server; it falls back to a server env key, " +
    "then to returning the conversion prompt for the calling agent to run. Returns " +
    "{ ok, mode, via, storyboard?, spec, gaps, stats } (or { needsLLM, conversionPrompt } on delegate). " +
    "For SOPs, optionally pass module/project/artScene/devScene/storyJson to set the frontmatter.",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "Raw content: a storyboard .md OR an unformatted SOP. Mutually exclusive with `path`." },
      path: { type: "string", description: "Filesystem path to a storyboard or SOP file (read on the server host)." },
      module: { type: "string", description: "(SOP only) module name for the storyboard frontmatter." },
      project: { type: "string", description: "(SOP only) project name." },
      artScene: { type: "string", description: "(SOP only) art scene path for frontmatter." },
      devScene: { type: "string", description: "(SOP only) dev scene path for frontmatter." },
      storyJson: { type: "string", description: "(SOP only) Story JSON output path for frontmatter." },
      storyJsonMode: { type: "string", enum: ["new", "append"], description: "(SOP only) defaults to new." },
    },
    required: [],
  },
  handler: async (args = {}) => {
    let content = args.text || "";
    if (!content && args.path) {
      try { content = readFileSync(args.path, "utf-8"); }
      catch (err) { return JSON.stringify({ ok: false, error: `Could not read path "${args.path}": ${err.message}` }, null, 2); }
    }
    if (!content || !content.trim()) {
      return JSON.stringify({ ok: false, error: "Provide a non-empty `text` or a readable `path`." }, null, 2);
    }

    // Already a storyboard? Parse deterministically — no LLM.
    if (looksLikeStoryboard(content)) {
      const model = parseStoryboard(content);
      const out = buildSpecAndGaps(model);
      return JSON.stringify({ ...out, mode: "storyboard", via: "deterministic" }, null, 2);
    }

    // Unformatted SOP → convert via LLM, then parse.
    const { rules, source } = loadSopRules();
    const frontmatter = buildFrontmatter(args);
    const system =
      rules +
      "\n\n# OUTPUT CONTRACT (strict)\n" +
      "Return ONLY the finished storyboard markdown — no commentary, no code fences. " +
      "The file MUST begin with EXACTLY this frontmatter (verbatim):\n\n" + frontmatter;
    const user =
      "<sop>\n" + content + "\n</sop>\n\n" +
      "Convert the SOP above into a VRse storyboard now, following all rules. " +
      "Begin the output with the exact frontmatter provided.";

    const { text, via } = await runSopCompletion({ system, user });

    if (!text) {
      // No model reachable — hand the prompt to the calling agent (it is an LLM).
      return JSON.stringify({
        ok: false,
        mode: "sop",
        needsLLM: true,
        via: "delegate",
        rulesSource: source,
        message:
          "This is an unformatted SOP and no LLM is reachable from the server " +
          "(client does not support MCP sampling and no server API key is set). " +
          "Run the `conversionPrompt` yourself (you are an LLM), then call vrse_storyboard_structure on the result.",
        conversionPrompt: { system, user },
      }, null, 2);
    }

    const storyboard = stripCodeFences(text).trim();
    const model = parseStoryboard(storyboard);
    const out = buildSpecAndGaps(model);
    return JSON.stringify({ ...out, mode: "sop", via, rulesSource: source, storyboard }, null, 2);
  },
};

// ─── Level 2: preflight (vrse_prepare_scene) ────────────────────────────────
//
// Opens the dev scene (Single) + ADDITIVELY loads the art scene, then verifies every declared
// [source:] object exists (and is unambiguous) in the loaded scenes BEFORE any conversion runs —
// the "fail loud early" gate. Pure server-side composition of existing routes (scene/open +
// vrse/parity/list-loaded-scenes), like the rest of the suite.
//
// buildPreflightReport is PURE (no bridge I/O) so it is unit-testable offline. It assembles the
// shared stage-tool envelope: { ok, halt, scenesLoaded, inventory, missing, next, stats }.
// `missing[]` is the shared precondition-reasons contract (what is blocking + how to act);
// `inventory.{found,notFound,duplicates}` is the per-source data breakdown.

/**
 * bridge.sendCommand wraps the Unity route result as { success, data: <route result> } — the actual
 * route payload (with results[]/hierarchy/etc.) lives under .data. Unwrap to the raw route result so
 * the pure report-builders (which assume the raw shape, like the offline tests) work against live data.
 * A bridge-level error ({ success:false, error } with no .data) passes through unchanged so the error
 * still surfaces downstream.
 */
export function unwrap(resp) {
  if (resp && typeof resp === "object" && resp.data && typeof resp.data === "object") return resp.data;
  return resp;
}

/** Normalize a scene/open response into { ok, name, path, error? }. */
function normalizeOpen(resp, fallbackPath) {
  const ok = !!(resp && resp.success);
  return {
    ok,
    name: (resp && resp.name) || null,
    path: (resp && resp.path) || fallbackPath || null,
    ...(ok ? {} : { error: (resp && resp.error) || "scene open failed" }),
  };
}

/** Pull the match array out of a vrse/parity/list-loaded-scenes response. */
function extractMatches(resp) {
  if (!resp) return [];
  const arr = resp.matches || resp.results || resp.objects || resp.gameObjects || [];
  return Array.isArray(arr) ? arr : [];
}

/** Count exact-name (case-insensitive) matches in an already-extracted match array. */
function exactCount(matches, exactName) {
  if (!Array.isArray(matches)) return 0;
  const n = String(exactName).trim().toLowerCase();
  return matches.filter((m) => m && typeof m.name === "string" && m.name.trim().toLowerCase() === n).length;
}

export function buildPreflightReport(
  { devScenePath = "", artScenePath = "", sources = [], validateMarkers = false, mode = "path" } = {},
  openResult = {},
  searchResultsByName = {},
  markerResultsByName = {}
) {
  const norm = (s) => String(s).trim().toLowerCase();

  const found = [];
  const notFound = [];
  const duplicates = [];
  for (const src of sources) {
    const all = searchResultsByName[src] || [];
    // list-loaded-scenes matches by SUBSTRING — keep only exact-name matches for existence/dup logic.
    const exact = all.filter((m) => m && typeof m.name === "string" && norm(m.name) === norm(src));
    if (exact.length === 0) {
      notFound.push(src);
    } else {
      const scenes = [...new Set(exact.map((m) => m.sceneName).filter(Boolean))];
      found.push({ source: src, count: exact.length, scenes });
      if (exact.length > 1) duplicates.push({ source: src, count: exact.length, scenes });
    }
  }

  const dev = openResult.dev || null;
  const art = openResult.art || null;
  const devOk = !!(dev && dev.ok);
  const artExpected = !!artScenePath || art != null;
  const artOk = art ? !!art.ok : !artExpected; // no art expected → not a blocker

  // markers (best-effort, informational): which <source>_PP / <source>_SP exist
  let markers;
  if (validateMarkers) {
    markers = sources.map((src) => ({
      source: src,
      pp: exactCount(markerResultsByName[`${src}_PP`], `${src}_PP`) > 0,
      sp: exactCount(markerResultsByName[`${src}_SP`], `${src}_SP`) > 0,
    }));
  }

  // Shared precondition-reasons contract (what is blocking the build, actionable).
  const missing = [];
  if (!devOk)
    missing.push({ kind: "DEV_SCENE_NOT_OPEN", detail: (dev && dev.error) || `Could not open dev scene '${devScenePath || "(none)"}'.` });
  if (artExpected && !artOk)
    missing.push({ kind: "ART_SCENE_NOT_LOADED", detail: (art && art.error) || `Could not additively load art scene '${artScenePath || "(none)"}'.` });
  for (const src of notFound)
    missing.push({ kind: "SOURCE_NOT_FOUND", source: src, detail: `Declared source '${src}' not found in any loaded scene.` });

  const ok = devOk && artOk && notFound.length === 0;
  const halt = !ok;

  let next;
  if (ok) {
    next =
      "Scenes loaded and all sources resolved. Proceed to vrse_setup_chapters → vrse_setup_objects." +
      (duplicates.length ? " NOTE: ambiguous (duplicate-named) sources detected — disambiguate before conversion." : "");
  } else if (!devOk || (artExpected && !artOk)) {
    next = "Fix the scene paths (dev_scene / art_scene) so both load, then re-run vrse_prepare_scene.";
  } else {
    next =
      "Resolve the missing sources: correct the [source:] names in the storyboard so they match objects " +
      "in the loaded art scene (or load the correct art scene), then re-run vrse_prepare_scene.";
  }

  return {
    ok,
    halt,
    mode,
    scenesLoaded: {
      dev: dev ? { ok: devOk, name: dev.name || null, path: dev.path || devScenePath || null, ...(dev.error ? { error: dev.error } : {}) } : null,
      art: art ? { ok: artOk, name: art.name || null, path: art.path || artScenePath || null, ...(art.error ? { error: art.error } : {}) } : null,
    },
    inventory: { found, notFound, duplicates },
    ...(markers ? { markers } : {}),
    missing,
    next,
    stats: {
      sources: sources.length,
      found: found.length,
      notFound: notFound.length,
      duplicates: duplicates.length,
    },
  };
}

const PREPARE_SCENE_TOOL = {
  name: "vrse_prepare_scene",
  description:
    "Level 2 (preflight) of the VRse build pipeline. Opens the dev scene and ADDITIVELY loads the " +
    "art scene, then verifies every declared [source:] object exists (and is unambiguous) in the " +
    "loaded scenes BEFORE any conversion runs — the fail-loud-early gate. PATH mode: pass devScenePath " +
    "(+ artScenePath), typically spec.devScene / spec.artScene from vrse_parse_storyboard. MODULE mode: " +
    "pass project + module (+ experience) to open the configured scenes via vrse/open-module. Pass " +
    "`sources` (spec.usedSceneSources) to verify them. Returns the shared stage envelope " +
    "{ ok, halt, scenesLoaded, inventory:{found,notFound,duplicates}, missing, next, stats }; read " +
    "halt/missing/next to know what is blocking. Requires a running Unity Editor.",
  inputSchema: {
    type: "object",
    properties: {
      devScenePath: { type: "string", description: "Dev scene asset path (PATH mode), e.g. 'Assets/Scenes/Dev_Module.unity'. From spec.devScene." },
      artScenePath: { type: "string", description: "Art scene asset path loaded ADDITIVELY (PATH mode), e.g. 'Assets/Art/Room.unity'. From spec.artScene." },
      sources: { type: "array", items: { type: "string" }, description: "Declared [source:] object names to verify exist in the loaded scenes. Pass spec.usedSceneSources." },
      validateMarkers: { type: "boolean", description: "If true, also report which <source>_PP / <source>_SP art markers exist (informational). Default false." },
      project: { type: "string", description: "MODULE mode: VRseBuilder project name (used only when devScenePath/artScenePath are omitted)." },
      module: { type: "string", description: "MODULE mode: module name to open via vrse/open-module." },
      experience: { type: "string", description: "MODULE mode: experience name or type (e.g. 'Training') for vrse/open-module." },
      port: { type: "number", description: "Target Unity instance port (omit to use the selected instance)." },
    },
    required: [],
  },
  handler: async (args = {}) => {
    const {
      devScenePath = "", artScenePath = "", sources = [], validateMarkers = false,
      project = "", module: moduleName = "", experience = "",
    } = args;
    try {
      const pathMode = !!(devScenePath || artScenePath);
      const mode = pathMode ? "path" : "module";
      const openResult = {};

      if (pathMode) {
        if (devScenePath) {
          openResult.dev = normalizeOpen(unwrap(await bridge.sendCommand("scene/open", { path: devScenePath })), devScenePath);
        } else {
          openResult.dev = { ok: false, error: "PATH mode: devScenePath is required to open the dev scene." };
        }
        if (artScenePath) {
          openResult.art = normalizeOpen(unwrap(await bridge.sendCommand("scene/open", { path: artScenePath, additive: true })), artScenePath);
        }
      } else {
        if (!project || !moduleName) {
          return JSON.stringify({
            ok: false, halt: true, mode,
            missing: [{ kind: "NO_OPEN_TARGET", detail: "Provide devScenePath (+ artScenePath) for PATH mode, or project + module (+ experience) for MODULE mode." }],
            next: "Supply scene paths (spec.devScene / spec.artScene) or project + module identifiers, then re-run vrse_prepare_scene.",
          }, null, 2);
        }
        const r = unwrap(await bridge.sendCommand("vrse/open-module", {
          projectName: project, moduleName, experienceName: experience, experienceType: experience,
        }));
        const okOpen = !!(r && r.success);
        openResult.dev = okOpen
          ? { ok: true, name: r.openedSceneName || null, path: r.devScenePath || null }
          : { ok: false, error: (r && r.error) || "vrse/open-module failed" };
        openResult.art = okOpen
          ? { ok: !!r.artSceneLoaded, name: null, path: r.artScenePath || null, ...(r.artSceneLoaded ? {} : { error: "vrse/open-module did not load an art scene (none configured?)." }) }
          : { ok: false, error: (r && r.error) || "vrse/open-module failed" };
      }

      // Verify declared sources across all loaded scenes.
      const searchResultsByName = {};
      for (const src of sources) {
        const resp = unwrap(await bridge.sendCommand("vrse/parity/list-loaded-scenes", { name: src, include_inactive: true }));
        searchResultsByName[src] = extractMatches(resp);
      }

      // Optional marker check.
      const markerResultsByName = {};
      if (validateMarkers) {
        for (const src of sources) {
          for (const suffix of ["_PP", "_SP"]) {
            const q = `${src}${suffix}`;
            const resp = unwrap(await bridge.sendCommand("vrse/parity/list-loaded-scenes", { name: q, include_inactive: true }));
            markerResultsByName[q] = extractMatches(resp);
          }
        }
      }

      const report = buildPreflightReport(
        { devScenePath, artScenePath, sources, validateMarkers, mode },
        openResult, searchResultsByName, markerResultsByName
      );
      return JSON.stringify(report, null, 2);
    } catch (err) {
      return JSON.stringify({
        ok: false, halt: true, error: err.message,
        next: "Ensure a Unity Editor instance is running and reachable, then re-run vrse_prepare_scene.",
      }, null, 2);
    }
  },
};

// ─── Level 4: conversion (vrse_setup_objects) ───────────────────────────────
//
// Converts art-scene sources into interactables and parents them into the correct EXISTING container
// (template-aware), folding in the former setup_chapters step (lazy container creation as a fallback).
// Two halves: the smart container RESOLUTION is pure JS here (offline-testable); the Unity conversion is
// the new plugin route `vrse/setup-objects` (ports VRseBatchSetup's DoSetupGrabbable/Touchable/Duplicate).
//
// resolveObjectContainers + buildSetupObjectsReport are PURE (no bridge I/O) — same split as
// buildPreflightReport. Boundary: conversion + marker-based placement only; spatial inference
// (on/inside/near) is vrse_place_objects (Level 5).

// type -> #h3 column (type-based layout). pivot rides with grabbable; simple/duplicate are props.
const TYPE_COLUMN = {
  grabbable: "Grabbable", pivot: "Grabbable", touchable: "Touchable",
  placepoint: "Placepoint", simple: "Props", duplicate: "Props",
  spawnpoint: "Spawnpoints", spawn: "Spawnpoints", teleport: "Spawnpoints", teleporttarget: "Spawnpoints",
};

/** Flatten a scene/hierarchy node tree into [{ name, path, node }], computing paths (nodes carry no path). */
function flattenHierarchy(node, prefix = "") {
  if (!node || !node.name) return [];
  const path = prefix ? `${prefix}/${node.name}` : node.name;
  let out = [{ name: node.name, path, node }];
  for (const c of node.children || []) out = out.concat(flattenHierarchy(c, path));
  return out;
}

/** Normalize a scene/hierarchy response into the root node (the parentPath subtree), or null. */
function normalizeHierarchy(resp, parentPath) {
  if (!resp || resp.error) return null;
  const arr = resp.hierarchy || (Array.isArray(resp) ? resp : null);
  if (Array.isArray(arr) && arr.length) return arr.find((n) => n && n.name === parentPath) || arr[0];
  if (resp.name) return resp;
  return null;
}

/**
 * Template-aware destination resolution. For each object, pick the correct EXISTING container path
 * (or a best-effort path to be lazily created). Pure — feed it a discovered hierarchy root node.
 */
export function resolveObjectContainers(objects = [], hierarchyRoot = null, opts = {}) {
  const root = hierarchyRoot && hierarchyRoot.name ? hierarchyRoot : { name: opts.queryObjectsParent || "QueryObjects", children: [] };
  const rootName = root.name;
  const flat = flattenHierarchy(root);
  const byName = (n) => flat.find((e) => e.name === n);

  const hasType = flat.some((e) => /^#h3 /.test(e.name) || e.name === "#h2 Interactables");
  const hasChapter = flat.some((e) => /^CHAPTER\s+\d+/i.test(e.name));
  const layout = opts.layout || (hasType ? "type" : hasChapter ? "chapter" : "chapter");

  const resolved = objects.map((o) => {
    const type = String(o.type || "").toLowerCase();
    const shared = !!o.shared;
    const chapterNum = o.chapter ?? o.chapterNumber ?? o.chapterIndex ?? 1;
    const chapterName = String(o.chapterName || "").toUpperCase();

    let parent = o.parent || null; // explicit override wins
    let lazy = false;

    if (!parent) {
      if (layout === "type") {
        const colName = "#h3 " + (TYPE_COLUMN[type] || "Props");
        const col = byName(colName);
        const colPath = col ? col.path : `${rootName}/${colName}`;
        const leafName = shared ? "#h4 Common" : `#h4 Chapter ${chapterNum}`;
        const leaf = col ? flat.find((e) => e.path.startsWith(col.path + "/") && e.name === leafName) : null;
        parent = leaf ? leaf.path : `${colPath}/${leafName}`;
        lazy = !leaf;
      } else if (shared) {
        parent = rootName; // shared objects live directly under QueryObjects (chapter-based)
        lazy = false;
      } else {
        const existing = flat.find((e) => new RegExp(`^CHAPTER\\s+${chapterNum}\\b`, "i").test(e.name));
        parent = existing ? existing.path : `${rootName}/CHAPTER ${chapterNum} - ${chapterName}`;
        lazy = !existing;
      }
    }

    return {
      type, source: o.source || "", name: o.name, parent,
      anchor: o.anchor || "", preferScene: o.preferScene || "",
      allows: o.allows || "", position: o.position || "",
      on: o.on || "", inside: o.inside || "",
      near: o.near || "", facing: o.facing || "",
      force_place: o.force_place, held_place_only: o.held_place_only,
      layout, lazy,
    };
  });

  return { layout, objects: resolved };
}

/** Assemble the shared stage envelope from the resolved objects + the plugin route result. */
export function buildSetupObjectsReport(resolved = [], routeResult = null) {
  const results = (routeResult && routeResult.results) || [];
  const byName = {};
  for (const r of results) byName[r.name] = r;

  const converted = [], skipped = [], failed = [], warnings = [];
  for (const obj of resolved) {
    const r = byName[obj.name];
    if (!r) { failed.push({ name: obj.name, parent: obj.parent, error: "no result returned for object" }); continue; }
    if (r.skipped) skipped.push({ name: obj.name, path: r.path || null });
    else if (r.ok) {
      const entry = { name: obj.name, path: r.path || null, nameOk: r.nameOk, hasMeshChild: r.hasMeshChild };
      // Non-fatal route warning (e.g. placepoint collider sized by fallback because the `allows` object
      // wasn't found) — the object IS created, but flag it so it isn't a silent wrong-sized collider.
      if (r.warning) { entry.warning = r.warning; warnings.push({ name: obj.name, detail: r.warning }); }
      converted.push(entry);
    }
    else failed.push({ name: obj.name, parent: obj.parent, error: r.error || "conversion failed" });
  }

  const routeOk = !routeResult || routeResult.success !== false;
  const ok = routeOk && failed.length === 0;

  const missing = [];
  if (routeResult && routeResult.error) missing.push({ kind: "ROUTE_ERROR", detail: routeResult.error });
  for (const f of failed) missing.push({ kind: "OBJECT_FAILED", name: f.name, detail: f.error });

  let next;
  if (ok && converted.length) next = "Objects converted. Proceed to vrse_place_objects (spatial) and/or vrse_harvest_ids → vrse_generate_story.";
  else if (ok) next = "No objects converted (all skipped or none provided).";
  else next = "Resolve the failures in `missing`: fix source names/types, ensure vrse_prepare_scene loaded the art scene, then re-run vrse_setup_objects.";

  return {
    ok, halt: !ok,
    objects: { converted, skipped, failed },
    produced: { objectPaths: converted.map((c) => c.path).filter(Boolean) },
    ...(warnings.length ? { warnings } : {}),
    missing, next,
    stats: { total: resolved.length, converted: converted.length, skipped: skipped.length, failed: failed.length, warnings: warnings.length },
  };
}

const SETUP_OBJECTS_TOOL = {
  name: "vrse_setup_objects",
  description:
    "Level 4 (conversion) of the VRse build pipeline. For each object: duplicate the art `source`, rename " +
    "to the logical `name`, parent it into the correct EXISTING container (template-aware — discovers the " +
    "scene hierarchy and maps by type/chapter; creates a container only as a lazy fallback), convert to its " +
    "type (grabbable | touchable | simple | placepoint marker-based; pivot→grabbable), and finalize (GameObjectQuery, mesh-tight / " +
    "trigger collider, enableOnStart=false). Pass `objects` (from parse_storyboard spec.objects[]). Returns " +
    "the shared envelope { ok, halt, objects:{converted,skipped,failed}, produced:{objectPaths}, missing, next, stats }. " +
    "Marker-based placement only (uses art transform or an explicit `anchor`); spatial inference is vrse_place_objects. " +
    "Requires a running Unity Editor with the plugin's vrse/setup-objects route.",
  inputSchema: {
    type: "object",
    properties: {
      objects: {
        type: "array",
        description: "Objects to convert. Each: { type:'grabbable'|'touchable'|'simple'|'pivot', source, name, chapter?(number), chapterName?, shared?(bool), anchor?, preferScene?, allows?, parent?(override) }.",
        items: {
          type: "object",
          properties: {
            type: { type: "string", description: "grabbable | touchable | simple | placepoint | pivot (pivot converts as grabbable; placepoint is marker-based — uses anchor/<name>_PP/position)." },
            source: { type: "string", description: "Art-scene source object name to duplicate." },
            name: { type: "string", description: "Logical output name." },
            chapter: { type: "number", description: "1-based chapter number (for container resolution)." },
            chapterName: { type: "string", description: "Chapter name (for CHAPTER container naming in chapter-based layout)." },
            shared: { type: "boolean", description: "True if used across chapters → Common container / QueryObjects root." },
            anchor: { type: "string", description: "Optional marker name to take position/rotation from instead of the source." },
            preferScene: { type: "string", description: "Optional scene name to disambiguate the source if the name exists in multiple loaded scenes." },
            allows: { type: "string", description: "Placepoint: CSV of allowed grabbables; the first sizes the trigger collider." },
            position: { type: "string", description: "Placepoint fallback position 'x,y,z' (local) when no anchor/<name>_PP marker is found." },
            force_place: { type: "boolean", description: "Placepoint: force-snap even grab-locked grabbables (optional)." },
            held_place_only: { type: "boolean", description: "Placepoint: only accept a held grabbable (optional)." },
            parent: { type: "string", description: "Optional explicit destination container path (overrides resolution)." },
          },
          required: ["type", "name"],
        },
      },
      queryObjectsParent: { type: "string", description: "Root container to discover under (default 'QueryObjects')." },
      layout: { type: "string", description: "Optional override: 'type' or 'chapter'. Auto-detected from the scene if omitted." },
      port: { type: "number", description: "Target Unity instance port (omit to use the selected instance)." },
    },
    required: ["objects"],
  },
  handler: async (args = {}) => {
    const { objects = [], queryObjectsParent = "QueryObjects", layout } = args;
    if (!Array.isArray(objects) || objects.length === 0) {
      return JSON.stringify({
        ok: false, halt: true,
        missing: [{ kind: "NO_OBJECTS", detail: "Provide a non-empty objects[]." }],
        next: "Pass spec.objects[] (type, source, name, chapter/shared) from vrse_parse_storyboard.",
      }, null, 2);
    }
    try {
      // 1. Discover the existing container hierarchy (template-aware).
      let hierarchyRoot = null;
      try {
        const h = unwrap(await bridge.sendCommand("scene/hierarchy", { parentPath: queryObjectsParent, maxDepth: 6 }));
        hierarchyRoot = normalizeHierarchy(h, queryObjectsParent);
      } catch { hierarchyRoot = null; }

      // 2. Resolve each object's destination container (pure).
      const { layout: detected, objects: resolved } = resolveObjectContainers(objects, hierarchyRoot, { layout, queryObjectsParent });

      // 3. Convert in one batch call (no per-object round-trips).
      const routeResult = unwrap(await bridge.sendCommand("vrse/setup-objects", { objects: resolved }));

      // 4. Assemble the report (pure).
      const report = buildSetupObjectsReport(resolved, routeResult);
      report.layout = detected;
      return JSON.stringify(report, null, 2);
    } catch (err) {
      return JSON.stringify({
        ok: false, halt: true, error: err.message,
        next: "Ensure Unity is running and the plugin is recompiled (vrse/setup-objects route), then re-run vrse_setup_objects.",
      }, null, 2);
    }
  },
};

// ─── Level 5A: spatial placement (vrse_place_objects) ───────────────────────
//
// Places placepoints by SPATIAL INFERENCE: `on` a surface (5×5 downward raycast grid → true mesh top,
// lift, surface-aligned yaw) or `inside` a container (lower-interior pose, fitted collider). The spatial
// math is C#-only (lives in the vrse/place-objects route); this Node tool reuses the same template-aware
// container resolution as setup_objects and forwards the spec. Spawn points / teleport targets (`near`
// ring-search) are Phase 5B. Boundary: marker-based placement stays in vrse_setup_objects.

const PLACE_OBJECTS_TOOL = {
  name: "vrse_place_objects",
  description:
    "Level 5 (spatial placement). Two kinds: (1) placepoints by inference — `on` a surface (raycast the true " +
    "top) or `inside` a container (lower interior), collider sized from the first `allows` grabbable; " +
    "(2) spawn points / teleport targets — `near` a CSV of objects (8-direction ring-search for a clear, " +
    "reachable, facing stand position), or marker-based (anchor / '_SP' name / position). Resolves the " +
    "destination container template-awarely (like setup_objects) and parents into it. Returns the shared " +
    "envelope { ok, halt, objects:{converted,skipped,failed}, produced:{objectPaths}, missing, next, stats }. " +
    "Requires a running Unity Editor with the plugin's vrse/place-objects route.",
  inputSchema: {
    type: "object",
    properties: {
      objects: {
        type: "array",
        description: "Spatial placepoints. Each: { type:'placepoint', name, on?|inside?, allows, chapter?(number), chapterName?, shared?, force_place?, held_place_only?, parent?(override) }.",
        items: {
          type: "object",
          properties: {
            type: { type: "string", description: "'placepoint' (use on/inside) or 'spawnpoint' (use near, or marker/'_SP'/position)." },
            name: { type: "string", description: "Logical output name." },
            on: { type: "string", description: "Placepoint: surface object name — place on its true top (mutually exclusive with inside)." },
            inside: { type: "string", description: "Placepoint: container object name — place in its lower interior (mutually exclusive with on)." },
            allows: { type: "string", description: "Placepoint: CSV of allowed grabbables; the first sizes the trigger collider." },
            near: { type: "string", description: "Spawnpoint: CSV of object names to stand near (ring-search picks a clear, facing stand position)." },
            facing: { type: "string", description: "Spawnpoint: 'toward' (default) or 'away' — flips the spawn yaw 180°." },
            chapter: { type: "number", description: "1-based chapter number (for container resolution)." },
            chapterName: { type: "string", description: "Chapter name (for CHAPTER container naming in chapter-based layout)." },
            shared: { type: "boolean", description: "True if used across chapters → Common container / QueryObjects root." },
            force_place: { type: "boolean", description: "Placepoint: force-snap even grab-locked grabbables (optional)." },
            held_place_only: { type: "boolean", description: "Placepoint: only accept a held grabbable (optional)." },
            parent: { type: "string", description: "Optional explicit destination container path (overrides resolution)." },
          },
          required: ["type", "name"],
        },
      },
      queryObjectsParent: { type: "string", description: "Root container to discover under (default 'QueryObjects')." },
      layout: { type: "string", description: "Optional override: 'type' or 'chapter'. Auto-detected if omitted." },
      port: { type: "number", description: "Target Unity instance port (omit to use the selected instance)." },
    },
    required: ["objects"],
  },
  handler: async (args = {}) => {
    const { objects = [], queryObjectsParent = "QueryObjects", layout } = args;
    if (!Array.isArray(objects) || objects.length === 0) {
      return JSON.stringify({
        ok: false, halt: true,
        missing: [{ kind: "NO_OBJECTS", detail: "Provide a non-empty objects[]." }],
        next: "Pass spatial placepoints (type 'placepoint', name, on|inside, allows).",
      }, null, 2);
    }
    try {
      let hierarchyRoot = null;
      try {
        const h = unwrap(await bridge.sendCommand("scene/hierarchy", { parentPath: queryObjectsParent, maxDepth: 6 }));
        hierarchyRoot = normalizeHierarchy(h, queryObjectsParent);
      } catch { hierarchyRoot = null; }

      const { layout: detected, objects: resolved } = resolveObjectContainers(objects, hierarchyRoot, { layout, queryObjectsParent });
      const routeResult = unwrap(await bridge.sendCommand("vrse/place-objects", { objects: resolved }));
      const report = buildSetupObjectsReport(resolved, routeResult);
      report.layout = detected;
      return JSON.stringify(report, null, 2);
    } catch (err) {
      return JSON.stringify({
        ok: false, halt: true, error: err.message,
        next: "Ensure Unity is running and the plugin is recompiled (vrse/place-objects route), then re-run vrse_place_objects.",
      }, null, 2);
    }
  },
};

// ─── Level 6: harvest IDs (vrse_harvest_ids) ────────────────────────────────
//
// The "linker" step: collects every GameObjectQuery's ID from the live scene into a name->ID map that
// vrse_generate_story (and validation) bind the Story JSON to. The C# route enumerates
// FindObjectsOfType<GameObjectQuery> DIRECTLY (not the stale QueryObjectsIdManager registry), so
// code-added GOQs from setup_objects/place_objects are seen with valid IDs immediately.
//
// buildHarvestReport is PURE (no bridge I/O) — same split as buildSetupObjectsReport. It HALTS when any
// harvested GOQ has an unassigned id (<=0), so the pipeline can't generate a story with dangling
// references (the kit's "never proceed with ID=-1" gate). It also surfaces duplicate names (ambiguous
// references) since those bite later when hand-editing/extending the story.

/** Assemble the harvest envelope from the (already-unwrapped) route result. */
export function buildHarvestReport(routeResult = null) {
  const results = (routeResult && routeResult.results) || [];

  const idMap = {};
  const objects = [];
  const invalid = [];
  const dupMap = {};
  let validCount = 0;

  for (const r of results) {
    const idOk = !!r.isIDValid && Number(r.id) > 0;
    objects.push({ name: r.name, id: r.id, path: r.path || null, valid: idOk, vrseComponents: r.vrseComponents || [] });
    if (idOk) {
      validCount++;
      if (Object.prototype.hasOwnProperty.call(idMap, r.name)) {
        (dupMap[r.name] = dupMap[r.name] || [idMap[r.name]]).push(r.id); // collision — record all ids
      } else {
        idMap[r.name] = r.id;
      }
    } else {
      invalid.push({ name: r.name, id: r.id, path: r.path || null });
    }
  }

  const duplicates = Object.keys(dupMap).map((name) => ({ name, ids: dupMap[name] }));
  const routeOk = !routeResult || routeResult.success !== false;
  const ok = routeOk && invalid.length === 0 && objects.length > 0;

  const missing = [];
  if (routeResult && routeResult.error) missing.push({ kind: "ROUTE_ERROR", detail: routeResult.error });
  if (objects.length === 0)
    missing.push({ kind: "NO_GOQ_FOUND", detail: "No GameObjectQuery objects found in scope — run vrse_setup_objects / vrse_place_objects first, or widen queryObjectsParent (pass '' to scan all loaded scenes)." });
  for (const iv of invalid)
    missing.push({ kind: "INVALID_GOQ_ID", name: iv.name, detail: `'${iv.name}' has id ${iv.id} (not yet assigned) — save the scene and re-harvest before generating the story.` });

  let next;
  if (ok) next = `Harvested ${Object.keys(idMap).length} object IDs. Proceed to vrse_generate_story (pass produced.idMap, or let it harvest itself).` + (duplicates.length ? " NOTE: duplicate names detected — references to them are ambiguous; disambiguate before story generation." : "");
  else if (invalid.length) next = "Some GOQ IDs are unassigned (id<=0). Re-run vrse_harvest_ids with save:true (persists the scene so Unity assigns IDs), then proceed to story generation.";
  else if (objects.length === 0) next = "Nothing to harvest. Run vrse_setup_objects / vrse_place_objects first, then re-run vrse_harvest_ids.";
  else next = "Resolve the issues in `missing`, then re-run vrse_harvest_ids.";

  return {
    ok, halt: !ok,
    produced: { idMap },
    objects,
    ...(invalid.length ? { invalid } : {}),
    ...(duplicates.length ? { duplicates } : {}),
    missing, next,
    stats: { total: objects.length, valid: validCount, invalid: invalid.length, duplicates: duplicates.length },
  };
}

const HARVEST_IDS_TOOL = {
  name: "vrse_harvest_ids",
  description:
    "Level 6 (ID harvest) of the VRse build pipeline — the linker between the built scene and the Story " +
    "JSON. Enumerates every GameObjectQuery under `queryObjectsParent` (default 'QueryObjects') DIRECTLY " +
    "from the live scene (not the stale manager registry, so objects just made by vrse_setup_objects / " +
    "vrse_place_objects are seen with valid IDs), and returns the shared envelope " +
    "{ ok, halt, produced:{idMap}, objects, invalid?, duplicates?, missing, next, stats }. `produced.idMap` " +
    "is the name->GameObjectQuery-ID map that vrse_generate_story binds actions/triggers to. HALTS if any " +
    "GOQ has an unassigned id (<=0) so you don't generate a story with dangling references — re-run with " +
    "save:true to persist the scene first. Also flags duplicate names (ambiguous references). Requires a " +
    "running Unity Editor with the plugin's vrse/harvest-ids route.",
  inputSchema: {
    type: "object",
    properties: {
      queryObjectsParent: { type: "string", description: "Container subtree to harvest under (default 'QueryObjects'). Pass '' to harvest ALL GameObjectQuery objects across the loaded scenes." },
      save: { type: "boolean", description: "Save the open scenes before harvesting (parity with the kit's 'save x2'). Direct enumeration already yields valid IDs, so default false; set true if any id reads <=0." },
      port: { type: "number", description: "Target Unity instance port (omit to use the selected instance)." },
    },
    required: [],
  },
  handler: async (args = {}) => {
    const { queryObjectsParent = "QueryObjects", save = false } = args;
    try {
      const routeResult = unwrap(await bridge.sendCommand("vrse/harvest-ids", { root: queryObjectsParent, save }));
      return JSON.stringify(buildHarvestReport(routeResult), null, 2);
    } catch (err) {
      return JSON.stringify({
        ok: false, halt: true, error: err.message,
        next: "Ensure Unity is running and the plugin is recompiled (vrse/harvest-ids route), then re-run vrse_harvest_ids.",
      }, null, 2);
    }
  },
};

// ─── Level 7: generate story (vrse_generate_story) ──────────────────────────
//
// Faithful server-side port of the kit's build_story.py (pipeline Step 6). Takes a build_moments-shaped
// `momentTable` (authored from parse_storyboard's spec) + the harvested `idMap` (name->GameObjectQuery id)
// and emits the module's Story JSON, then applies it to the scene (vrse/story-apply-json) and saves
// (vrse/story-save). The EMITTERS reproduce build_story.py byte-faithfully: every node is { Name, ID:-1,
// Query, Option, Data, Type } with Data a COMPACT json STRING; only 6 sites embed an id as `Name#$id`
// (Teleport.targetTransform, Timer-action Query, SFX Query, GuidanceArrow.targetGameObject,
// Place.grabbableName, Collision.targetCollisionGameObject) — everything else uses a bare Query name.
//
// buildStoryReport is PURE (no bridge I/O). It HALTS (collecting ALL problems, unlike build_story.py which
// exits on first) on unknown keywords, unresolved ids, ambiguous (duplicate-name) id references, or missing
// required fields — so a story with dangling references never reaches the scene.

/** node primitive — mirrors build_story.py _act (line 61). Type 0=action, 1=trigger; ID always -1. */
function _act(name, query, option, data = "", type = 0) {
  return { Name: name, ID: -1, Query: query, Option: option, Data: data, Type: type };
}
/** compact json string — mirrors build_story.py _data (separators=(',',':')); JSON.stringify is already compact. */
function _data(obj) {
  return JSON.stringify(obj);
}
/** resolve a name->id; on miss/ambiguity record into ctx.missing (aggregate, don't throw). */
function _need(ctx, key, label) {
  if (!Object.prototype.hasOwnProperty.call(ctx.idMap, key)) {
    ctx.missing.push({ kind: "ID_NOT_FOUND", name: key, detail: `${label}: '${key}' not found in idMap — ensure it exists in the scene (system objects like CountDownTimer/SFXPlayer/TriggerQueryObjectGuider need harvest with queryObjectsParent='').` });
    return null;
  }
  if (ctx.dupSet && ctx.dupSet.has(key))
    ctx.missing.push({ kind: "AMBIGUOUS_REF", name: key, detail: `${label}: '${key}' maps to multiple GameObjectQuery ids (duplicate names) — disambiguate before generating.` });
  return ctx.idMap[key];
}

// ── action emitters (mirror build_story.py 74-237; preserve Data key order for byte-parity) ──
const ACTION_EMITTERS = {
  VoiceOver: (a, ctx) => {
    if (!a.text) ctx.warnings.push({ kind: "EMPTY_VOICEOVER", detail: "VoiceOver action has empty text." });
    return _act("VoiceOver", "", "Play", _data({ text: a.text, waitForCompletion: a.wait ?? true }));
  },
  Spawn: (a) => _act("Objects", a.target, "Spawn"),
  Despawn: (a) => _act("Objects", a.target, "Despawn"),
  Highlight: function highlight(a, ctx) {
    const target = a.target;
    if (Array.isArray(target)) return target.map((t) => highlight({ ...a, target: t }, ctx));
    if ("color" in a || "width" in a || "label" in a) {
      const d = { Outline: { setActive: true } };
      if ("color" in a) d.Outline.outlineColor = a.color;
      if ("width" in a) d.Outline.outlineWidth = a.width;
      if ("label" in a) d.Label = { setActive: true, labelText: a.label };
      return _act("MetaLayerAction", target, "Edit", _data(d));
    }
    return _act("MetaLayerAction", target, "SetActive", _data({ Outline: true }));
  },
  Unhighlight: function unhighlight(a, ctx) {
    const target = a.target;
    if (Array.isArray(target)) return target.map((t) => unhighlight({ ...a, target: t }, ctx));
    return _act("MetaLayerAction", target, "SetActive", _data({ Outline: false }));
  },
  EnableGrab: (a) => _act("Objects", a.target, "SetComponentProperty", _data({ component: "Grabbable", property: "isGrabbable", propertyValue: "true" })),
  DisableGrab: (a) => _act("Objects", a.target, "SetComponentProperty", _data({ component: "Grabbable", property: "isGrabbable", propertyValue: "false" })),
  EnableGrabFor: (a) => _act("GrabbablePropertyChangeAction", a.target, "ChangeIsGrabbable", _data({ isGrabbable: true, targetRoleSetId: a.targetRoleSetId ?? 2 })),
  GrabLock: (a) => _act("GrabLockAction", a.target, "GrabLock", _data({ waitForCompletion: false })),
  GrabUnlock: (a) => _act("GrabLockAction", a.target, "GrabUnlock", _data(a.forceRelease ? { forceRelease: true } : { waitForCompletion: false })),
  ForceRelease: (a) => _act("Objects", a.target, "SetComponentProperty", _data({ component: "Grabbable", property: "isGrabbable", propertyValue: "true", forceRelease: true })),
  Teleport: (a, ctx) => { const sp = a.target; const spid = _need(ctx, sp, "Teleport"); return _act("Player", "", "Teleport", _data({ targetTransform: `${sp}#$${spid}` })); },
  Animation: (a, ctx) => {
    if (!a.target) ctx.warnings.push({ kind: "ANIMATION_NO_TARGET", detail: "Animation action has no `target` — Query='' will no-op at runtime." });
    return _act("Animation", a.target ?? "", "Play", _data({ _clipName: a.clip, waitForCompletion: a.wait ?? true }));
  },
  Haptics: (a) => _act("HapticsAction", "", "Both", _data({ hapticIntensity: a.intensity, hapticDuration: a.duration })),
  Timer: (a, ctx) => { const cdt = _need(ctx, "CountDownTimer", "Timer"); return _act("TimerAction", `CountDownTimer#$${cdt}`, "Start", _data({ duration: a.seconds, waitForCompletion: true })); },
  SFX: (a, ctx) => { const sfx = _need(ctx, "SFXPlayer", "SFX"); return _act("SFXPlayer", `SFXPlayer#$${sfx}`, "Play", _data({ audioClipName: a.clip })); },
  UnlockRotation: (a) => _act("PivotRotateLimiterAction", a.target, "Unlock", _data({ waitForCompletion: false })),
  GuidanceArrow: (a, ctx) => {
    if (a.disable) return _act("TargetGuidanceArrowAction", "TriggerQueryObjectGuider", "Disable", _data({ waitForCompletion: false }));
    const target = a.target; const tid = _need(ctx, target, "GuidanceArrow");
    return _act("TargetGuidanceArrowAction", "TriggerQueryObjectGuider", "Override", _data({ targetGameObject: `${target}#$${tid}`, waitForCompletion: true }));
  },
  LockMovement: () => _act("Player", "", "LockMovement"),
  UnlockMovement: () => _act("Player", "", "UnlockMovement"),
  CameraFade: (a) => _act("Player", "", "CameraFade", _data({ fadeType: a.type, fadeDuration: a.duration ?? 1, waitForCompletion: a.wait ?? true })),
  ToastMessage: (a) => _act("ToastMessage", "", "Show", _data({ message: a.text, messageType: a.messageType ?? 0 })),
};

// ── trigger emitters (mirror build_story.py 243-314; all Type=1) ──
const TRIGGER_EMITTERS = {
  Grab: (t) => _act("GrabbableTrigger", t.target, "Grab", _data({ handOption: t.hand ?? "Any", targetRoleSetId: t.targetRoleSetId ?? 0 }), 1),
  Release: (t) => _act("GrabbableTrigger", t.target, "Release", _data({ handOption: t.hand ?? "Any" }), 1),
  Touch: (t) => _act("HandTouchTrigger", t.target, "Touch", "", 1),
  Place: (t, ctx) => {
    const grab = t.grabbable; const gid = _need(ctx, grab, "Place trigger");
    const d = { grabbableName: `${grab}#$${gid}` };
    if (t.disableGrabOnPlace) d.disableGrabOnPlace = true;
    return _act("PlacePointTrigger", t.target, "Place", _data(d), 1);
  },
  Button: (t) => _act("UIButtonTrigger", t.target, "OnClick", "", 1),
  Collision: (t, ctx) => {
    const other = t.other ?? "Player";
    let otherStr;
    if (other === "Player") otherStr = "Player";
    else { const oid = _need(ctx, other, "Collision trigger"); otherStr = `${other}#$${oid}`; }
    return _act("CollisionTrigger", t.target, "Enter", _data({ targetCollisionGameObject: otherStr, isTrigger: t.isTrigger ?? true }), 1);
  },
  Pivot: (t) => _act("PivotRotateLimiterTrigger", t.target, t.limit ?? "Max", _data({ lockOnReach: t.lockOnReach ?? true }), 1),
  MCQ: () => _act("MCQResponseTrigger", "", "AnyResponse", "", 1),
  Timer: (t) => _act("Timer", "CountDownTimer", "Elapsed", _data({ duration: t.seconds }), 1),
};

// ── composition (mirror build_story.py 320-390) ──
function _emitAction(a, ctx) {
  const fn = ACTION_EMITTERS[a && a.action];
  if (!fn) { ctx.missing.push({ kind: "UNKNOWN_ACTION", name: a && a.action, detail: `unknown action '${a && a.action}' — add it to the emitter table.` }); return []; }
  const out = fn(a, ctx);
  return Array.isArray(out) ? out : [out];
}
function _emitActions(lst, ctx) { const out = []; for (const a of lst || []) out.push(..._emitAction(a, ctx)); return out; }
function _emitTrigger(t, ctx) {
  const fn = TRIGGER_EMITTERS[t && t.type];
  if (!fn) { ctx.missing.push({ kind: "UNKNOWN_TRIGGER", name: t && t.type, detail: `unknown trigger type '${t && t.type}' — add it to the emitter table.` }); return _act("UnknownTrigger", "", "", "", 1); }
  return fn(t, ctx);
}
function _emitSet(s, ctx) { return { trigger: _emitTrigger(s.trigger, ctx), actions: _emitActions(s.actions, ctx) }; }
function _buildMoment(m, ctx) {
  if (m.momentIndex === undefined || m.momentIndex === null) ctx.missing.push({ kind: "MISSING_MOMENT_INDEX", name: m.name, detail: `moment '${m.name}' has no momentIndex.` });
  if (!m.name) ctx.missing.push({ kind: "MISSING_MOMENT_NAME", detail: "a moment has no name." });
  const onRight = m.onRight || { mode: "InOrder", sets: [] };
  return {
    name: m.name,
    momentIndex: m.momentIndex,
    studio: { id: "" },
    defaults: m.defaults ?? "",
    onAwake: { actions: _emitActions(m.onAwake, ctx) },
    onStart: { actions: _emitActions(m.onStart, ctx) },
    onRight: { mode: onRight.mode ?? "InOrder", triggerActionSets: (onRight.sets || []).map((s) => _emitSet(s, ctx)) },
    onWrong: (m.onWrong || []).map((s) => _emitSet(s, ctx)),
    onFirstWarning: { actions: _emitActions(m.onFirstWarning, ctx) },
    onLastWarning: { actions: _emitActions(m.onLastWarning, ctx) },
    onEnd: { actions: _emitActions(m.onEnd, ctx) },
  };
}
function _buildStory(mom, ctx) {
  let defaults = mom.defaults ?? "";
  if (defaults && typeof defaults === "object" && !Array.isArray(defaults)) defaults = _data(defaults);
  if (!mom.module) ctx.missing.push({ kind: "NO_MODULE_NAME", detail: "momentTable.module is required." });
  return {
    name: mom.module,
    formatVersion: 2.0,
    chapters: (mom.chapters || []).map((ch, i) => ({
      name: ch.name,
      chapterIndex: ch.chapterIndex ?? i,
      studio: { id: "" },
      defaults: "",
      moments: (ch.moments || []).map((m) => _buildMoment(m, ctx)),
    })),
    defaults,
  };
}

/** Assemble the Story JSON + shared envelope from a momentTable + idMap (PURE — offline). */
export function buildStoryReport(momentTable, idMap = {}, opts = {}) {
  if (!momentTable || typeof momentTable !== "object") {
    return { ok: false, halt: true, missing: [{ kind: "NO_MOMENT_TABLE", detail: "Provide a momentTable { module, chapters[] }." }], next: "Author a momentTable from parse_storyboard's spec, then re-run vrse_generate_story.", stats: {} };
  }
  const duplicates = opts.duplicates || [];
  const ctx = { idMap: idMap || {}, missing: [], warnings: [], dupSet: new Set(duplicates.map((d) => d.name)) };
  const story = _buildStory(momentTable, ctx);

  let moments = 0, actions = 0, triggers = 0;
  for (const ch of story.chapters) for (const m of ch.moments) {
    moments++;
    for (const slot of [m.onAwake, m.onStart, m.onFirstWarning, m.onLastWarning, m.onEnd]) actions += (slot.actions || []).length;
    for (const set of m.onRight.triggerActionSets) { triggers++; actions += set.actions.length; }
    for (const set of m.onWrong) { triggers++; actions += set.actions.length; }
  }

  const halt = ctx.missing.length > 0;
  const ok = !halt;
  const hasVO = story.chapters.some((ch) => ch.moments.some((m) =>
    [m.onAwake, m.onStart, m.onFirstWarning, m.onLastWarning, m.onEnd].some((s) => (s.actions || []).some((n) => n.Name === "VoiceOver")) ||
    m.onRight.triggerActionSets.some((set) => set.actions.some((n) => n.Name === "VoiceOver")) ||
    m.onWrong.some((set) => set.actions.some((n) => n.Name === "VoiceOver"))));

  let next;
  if (!ok) next = "Resolve the issues in `missing` (unknown keywords / unresolved or ambiguous ids / missing required fields), then re-run vrse_generate_story.";
  else next = "Story built. Apply it (applyToScene, default) — the handler will validate, apply, and save." + (hasVO && !opts.vo ? " NOTE: VoiceOver narration is UNVOICED — re-run with vo:true (or call vrse_story_generate_vo) so narration plays." : "");

  return {
    ok, halt,
    produced: { story, storyJson: JSON.stringify(story) },
    ...(ctx.warnings.length ? { warnings: ctx.warnings } : {}),
    missing: ctx.missing,
    next,
    stats: { chapters: story.chapters.length, moments, actions, triggers, idsResolved: Object.keys(ctx.idMap).length, hasVoiceOver: hasVO },
  };
}

const GENERATE_STORY_TOOL = {
  name: "vrse_generate_story",
  description:
    "Level 7 (story generation) of the VRse build pipeline — server-side port of build_story.py. Takes a " +
    "build_moments-shaped `momentTable` (authored from vrse_parse_storyboard's spec) + the harvested `idMap` " +
    "(name->GameObjectQuery id), emits the module's Story JSON, then APPLIES it to the scene " +
    "(vrse/story-apply-json) and SAVES (vrse/story-save). If `idMap` is omitted it self-harvests " +
    "(queryObjectsParent='' so system objects CountDownTimer/SFXPlayer/TriggerQueryObjectGuider resolve). " +
    "VALIDATES every object reference against the idMap and HALTS before any scene mutation on unresolved/" +
    "ambiguous ids or unknown keywords. Returns the shared envelope { ok, halt, produced:{story,storyJson}, " +
    "warnings?, missing, next, stats } plus applied/saved info. Use dryRun:true to inspect the JSON without " +
    "touching the scene. VoiceOver audio is only generated when vo:true. Requires a running Unity Editor with " +
    "a StoryCreator in the scene and the plugin's vrse/story-apply-json route (json/storyJson fix).",
  inputSchema: {
    type: "object",
    properties: {
      momentTable: { type: "object", description: "The build_moments table { module, defaults?, chapters:[{ name, chapterIndex?, moments:[{ name, momentIndex, onAwake?, onStart?, onRight?:{mode,sets}, onWrong?, onFirstWarning?, onLastWarning?, onEnd? }] }] }. Actions are { action, ...fields }; triggers { type, ...fields }." },
      idMap: { type: "object", description: "Optional name->id map (produced.idMap from vrse_harvest_ids). Omit to self-harvest." },
      autoHarvest: { type: "boolean", description: "If idMap omitted, harvest it via vrse/harvest-ids (default true)." },
      queryObjectsParent: { type: "string", description: "Harvest scope when self-harvesting (default '' = all loaded scenes, so system objects resolve)." },
      dryRun: { type: "boolean", description: "Build + validate and return the JSON without applying to the scene (default false)." },
      save: { type: "boolean", description: "Save the story to its file after applying (default true)." },
      validate: { type: "boolean", description: "Run vrse/story-validate after applying and fold the result into the report (default false)." },
      vo: { type: "boolean", description: "After applying, generate VoiceOver audio (vrse/story-generate-vo). Default false — narration stays 'pending' until generated." },
      storyCreatorName: { type: "string", description: "Optional StoryCreator GameObject name (if multiple exist)." },
      port: { type: "number", description: "Target Unity instance port (omit to use the selected instance)." },
    },
    required: ["momentTable"],
  },
  handler: async (args = {}) => {
    const { momentTable, idMap, autoHarvest = true, queryObjectsParent = "", dryRun = false, save = true, validate = false, vo = false, storyCreatorName } = args;
    if (!momentTable) {
      return JSON.stringify({ ok: false, halt: true, missing: [{ kind: "NO_MOMENT_TABLE", detail: "Provide momentTable { module, chapters[] }." }], next: "Author a momentTable from parse_storyboard's spec, then re-run." }, null, 2);
    }
    try {
      // 1. Resolve idMap (+ duplicates) — self-harvest with root='' so system objects resolve.
      let map = idMap, duplicates = [];
      if (!map && autoHarvest) {
        const hr = buildHarvestReport(unwrap(await bridge.sendCommand("vrse/harvest-ids", { root: queryObjectsParent, save: false })));
        if (hr.halt) return JSON.stringify({ ok: false, halt: true, missing: hr.missing, next: "Harvest failed before story generation — " + hr.next }, null, 2);
        map = hr.produced.idMap; duplicates = hr.duplicates || [];
      }
      map = map || {};

      // 2. Build + validate (pure). Halt or dryRun => return without mutating the scene.
      const report = buildStoryReport(momentTable, map, { duplicates, vo });
      if (report.halt || dryRun) return JSON.stringify({ ...report, dryRun: !!dryRun }, null, 2);

      // 3. Apply.
      const applyResp = unwrap(await bridge.sendCommand("vrse/story-apply-json", { json: report.produced.storyJson, storyCreatorName, port: args.port }));
      if (!applyResp || applyResp.error || applyResp.success === false) {
        return JSON.stringify({ ok: false, halt: true, produced: report.produced, missing: [{ kind: "APPLY_FAILED", detail: (applyResp && applyResp.error) || "vrse/story-apply-json failed" }], next: "Apply failed — ensure a StoryCreator exists in the scene and the plugin is recompiled (json/storyJson fix), then re-run.", stats: report.stats }, null, 2);
      }
      const out = { ...report, applied: { storyCreator: applyResp.storyCreator, chapterCount: applyResp.chapterCount } };

      // 4. Save BEFORE any later mutation (so StoryVersioning has a file to back up next time).
      if (save) {
        const s = unwrap(await bridge.sendCommand("vrse/story-save", { storyCreatorName, port: args.port }));
        out.saved = { isSavedToFile: s && (s.isSavedToFile ?? s.success), filePath: s && s.filePath, ...(s && s.error ? { error: s.error } : {}) };
      }
      // 5. Optional validate.
      if (validate) out.validation = unwrap(await bridge.sendCommand("vrse/story-validate", { storyCreatorName, port: args.port }));
      // 6. Optional VO generation (after apply — operates on the in-scene story).
      if (vo) {
        const pend = unwrap(await bridge.sendCommand("vrse/story-has-pending-vo", { storyCreatorName, port: args.port }));
        out.vo = (pend && (pend.hasPending === false || pend.hasPendingVOs === false))
          ? { hasPending: false }
          : unwrap(await bridge.sendCommand("vrse/story-generate-vo", { storyCreatorName, port: args.port }));
      }

      out.next = `Story applied${save ? " and saved" : ""}.` + (report.stats.hasVoiceOver && !vo ? " NOTE: narration is unvoiced — re-run with vo:true or call vrse_story_generate_vo." : " Module build complete.");
      return JSON.stringify(out, null, 2);
    } catch (err) {
      return JSON.stringify({ ok: false, halt: true, error: err.message, next: "Ensure Unity is running and the plugin is recompiled (vrse/story-apply-json json/storyJson fix), then re-run vrse_generate_story." }, null, 2);
    }
  },
};

// ─── Translator: storyboard → momentTable (vrse_translate_storyboard) ────────
//
// Hybrid bridge between vrse_parse_storyboard and vrse_generate_story. Deterministically parses a
// structured kit-dialect storyboard (reusing parseStoryboard's preserved per-moment rawLines) into the
// build_moments-shaped momentTable generate_story consumes; loose PROSE is delegated to the existing
// SOP→storyboard LLM path first (same machinery as vrse_parse_storyboard). Unrecognized / unsupported lines
// are reported as gaps[] (never silently dropped), and every record's keyword is validated against
// generate_story's emitter tables — single source of truth, so parser and emitter can't drift.

export const KNOWN_ACTIONS = new Set(Object.keys(ACTION_EMITTERS));
export const KNOWN_TRIGGERS = new Set(Object.keys(TRIGGER_EMITTERS));

const LIFECYCLE_MARKER = /^\*{0,2}\s*(OnAwake|OnStart|OnRight|OnWrong|FirstWarning|LastWarning|OnEnd)\s*\*{0,2}\s*(?:\(([^)]*)\))?\s*$/i;
const SLOT_OF = { onawake: "onAwake", onstart: "onStart", onright: "onRight", onwrong: "onWrong", firstwarning: "onFirstWarning", lastwarning: "onLastWarning", onend: "onEnd" };

function _sbStripQuotes(s) { return String(s || "").trim().replace(/^["']+|["']+$/g, "").trim(); }
function _sbNum(s) { const n = parseFloat(String(s).replace(/[^\d.\-]/g, "")); return Number.isNaN(n) ? s : n; }
function _sbLeading(raw) { const m = String(raw).match(/^([ \t]*)/); return m ? m[1].replace(/\t/g, "  ").length : 0; }
function _sbTargetList(arg) { const t = String(arg).trim(); const m = t.match(/^\[(.+)\]$/); return m ? m[1].split(",").map((x) => x.trim()).filter(Boolean) : t; }

// Strip recognized [modifiers] off a line into a mods map; leave UNrecognized brackets (e.g. a
// multi-target list [A, B, C]) in place so the caller can parse them.
function _sbMods(s) {
  const mods = {};
  const KV = new Set(["color", "width", "label", "volume", "range", "speed", "material", "highlighter", "boundtype"]);
  const text = String(s).replace(/\[([^\]]+)\]/g, (whole, inner) => {
    const t = inner.trim();
    if (/^op1$/i.test(t)) { mods.role = 1; return ""; }
    if (/^op2$/i.test(t)) { mods.role = 2; return ""; }
    if (/^all$/i.test(t)) { mods.role = 0; return ""; }
    if (/^right hand$/i.test(t)) { mods.hand = "Right"; return ""; }
    if (/^left hand$/i.test(t)) { mods.hand = "Left"; return ""; }
    if (/^forcerelease$/i.test(t)) { mods.forceRelease = true; return ""; }
    if (/^lockonreach$/i.test(t)) { mods.lockOnReach = true; return ""; }
    if (/^istrigger$/i.test(t)) { mods.isTrigger = true; return ""; }
    if (/^disablegrabonplace$/i.test(t)) { mods.disableGrabOnPlace = true; return ""; }
    const kv = t.match(/^(\w+)\s*:\s*(.+)$/);
    if (kv && KV.has(kv[1].toLowerCase())) { mods[kv[1].toLowerCase()] = _sbStripQuotes(kv[2]); return ""; }
    return whole; // unrecognized — keep (multi-target list, etc.)
  }).trim();
  return { text, mods };
}

/** Parse one storyboard action line (already bullet-stripped) into a generate_story action record, an
 *  array of records (HMISwap / multi-target handled upstream), or { unknown }. */
export function parseActionLine(content) {
  const { text, mods } = _sbMods(content);
  const colon = text.indexOf(":");
  const kw = (colon >= 0 ? text.slice(0, colon) : text).trim();
  const arg = (colon >= 0 ? text.slice(colon + 1) : "").trim();
  const role = mods.role;
  switch (kw) {
    case "VoiceOver": return { action: "VoiceOver", text: _sbStripQuotes(arg) };
    case "Spawn": return { action: "Spawn", target: arg };
    case "Despawn": return { action: "Despawn", target: arg };
    case "Teleport": return { action: "Teleport", target: arg };
    case "Timer": return { action: "Timer", seconds: _sbNum(arg) };
    case "Highlight": { const r = { action: "Highlight", target: _sbTargetList(arg) }; if ("color" in mods) r.color = mods.color; if ("width" in mods) r.width = _sbNum(mods.width); if ("label" in mods) r.label = mods.label; return r; }
    case "Unhighlight": return { action: "Unhighlight", target: _sbTargetList(arg) };
    case "SFX": return { action: "SFX", clip: arg };
    case "Animation": { const m = arg.match(/^(.+?)\s+on\s+(.+)$/i); return m ? { action: "Animation", clip: m[1].trim(), target: m[2].trim() } : { action: "Animation", clip: arg }; }
    case "Haptics": { const p = arg.split(",").map((x) => _sbNum(x.trim())); return { action: "Haptics", intensity: p[0], duration: p[1] }; }
    case "GrabLock": return { action: "GrabLock", target: arg };
    case "GrabUnlock": { const r = { action: "GrabUnlock", target: arg }; if (mods.forceRelease) r.forceRelease = true; return r; }
    case "UnlockRotation": return { action: "UnlockRotation", target: arg };
    case "EnableGrab": return { action: "EnableGrab", target: arg };
    case "DisableGrab": return { action: "DisableGrab", target: arg };
    case "EnableGrabFor": { const r = { action: "EnableGrabFor", target: arg }; if (role !== undefined) r.targetRoleSetId = role; return r; }
    case "ForceRelease": return { action: "ForceRelease", target: arg };
    case "GuidanceArrow": return /^disable$/i.test(arg) ? { action: "GuidanceArrow", disable: true } : { action: "GuidanceArrow", target: arg };
    case "LockMovement": return { action: "LockMovement" };
    case "UnlockMovement": return { action: "UnlockMovement" };
    case "CameraFade": return { action: "CameraFade", type: arg };
    case "ToastMessage": return { action: "ToastMessage", text: _sbStripQuotes(arg) };
    case "HMISwap": { const m = arg.match(/^(.+?)\s*(?:→|->|=>)\s*(.+)$/); return m ? [{ action: "Despawn", target: m[1].trim() }, { action: "Spawn", target: m[2].trim() }] : { unknown: "HMISwap (bad syntax)" }; }
    default: return { unknown: kw || text };
  }
}

/** Parse one storyboard trigger phrase (text after `Trigger:`) into a generate_story trigger record or { unknown }. */
export function parseTriggerLine(content) {
  const { text, mods } = _sbMods(content);
  const p = text.trim();
  let m;
  if ((m = p.match(/^user\s+grabs\s+(.+)$/i))) { const r = { type: "Grab", target: m[1].trim() }; if (mods.hand) r.hand = mods.hand; if (mods.role !== undefined) r.targetRoleSetId = mods.role; return r; }
  if ((m = p.match(/^user\s+releases\s+(.+)$/i))) { const r = { type: "Release", target: m[1].trim() }; if (mods.hand) r.hand = mods.hand; return r; }
  if ((m = p.match(/^user\s+touches\s+(.+)$/i))) return { type: "Touch", target: m[1].trim() };
  if ((m = p.match(/^user\s+places\s+(.+?)\s+into\s+(.+)$/i))) { const r = { type: "Place", grabbable: m[1].trim(), target: m[2].trim() }; if (mods.disableGrabOnPlace) r.disableGrabOnPlace = true; return r; }
  if ((m = p.match(/^user\s+clicks\s+(.+)$/i))) return { type: "Button", target: m[1].trim() };
  if ((m = p.match(/^user\s+enters\s+(.+)$/i))) return { type: "Collision", target: m[1].trim(), other: "Player" };
  if ((m = p.match(/^user\s+rotates\s+(.+?)\s+to\s+(max|min)$/i))) { const r = { type: "Pivot", target: m[1].trim(), limit: m[2][0].toUpperCase() + m[2].slice(1).toLowerCase() }; if (mods.lockOnReach) r.lockOnReach = true; return r; }
  if (/^user\s+answers\s+mcq$/i.test(p)) return { type: "MCQ" };
  if ((m = p.match(/^timer\s+(\d+)\s*s?\s+elapsed$/i))) return { type: "Timer", seconds: _sbNum(m[1]) };
  if ((m = p.match(/^(.+?)\s+enters\s+(.+)$/i))) { const r = { type: "Collision", target: m[2].trim(), other: m[1].trim() }; if (mods.isTrigger) r.isTrigger = true; return r; } // tool enters target (after user-enters)
  return { unknown: p };
}

function _sbPushActions(arr, recs, gaps, ctx, line) {
  for (const r of (Array.isArray(recs) ? recs : [recs])) {
    if (r && r.unknown) { gaps.push({ kind: "UNKNOWN_ACTION", severity: "error", message: `${ctx}: unrecognized action '${r.unknown}'.`, line }); continue; }
    if (r && !KNOWN_ACTIONS.has(r.action)) { gaps.push({ kind: "UNSUPPORTED_ACTION", severity: "error", message: `${ctx}: action '${r.action}' has no generate_story emitter.`, line }); continue; }
    arr.push(r);
  }
}

function _sbBuildMoment(ch, mo, mi, gaps) {
  const slots = { onAwake: [], onStart: [], onRight: { mode: "InOrder", sets: [] }, onWrong: [], onFirstWarning: [], onLastWarning: [], onEnd: [] };
  let slot = null, curSet = null;
  const ctx = `${ch.name} / ${mo.name}`;
  for (const raw of mo.rawLines || []) {
    const line = String(raw).trim();
    if (!line) continue;
    const lm = line.match(LIFECYCLE_MARKER);
    if (lm) { slot = SLOT_OF[lm[1].toLowerCase()]; curSet = null; if (slot === "onRight" && lm[2]) slots.onRight.mode = lm[2].trim(); continue; }
    const bm = line.match(/^[-*]\s+(.+)$/);
    if (!bm || slot === null) continue;
    const content = bm[1].trim();
    if (slot === "onRight" || slot === "onWrong") {
      if (/^Trigger\s*:/i.test(content)) {
        const trig = parseTriggerLine(content.replace(/^Trigger\s*:/i, "").trim());
        if (trig.unknown) gaps.push({ kind: "UNKNOWN_TRIGGER", severity: "error", message: `${ctx}: unrecognized trigger '${trig.unknown}'.`, line });
        else if (!KNOWN_TRIGGERS.has(trig.type)) gaps.push({ kind: "UNSUPPORTED_TRIGGER", severity: "error", message: `${ctx}: trigger '${trig.type}' has no generate_story emitter.`, line });
        curSet = { trigger: trig.unknown ? { type: "__unknown__", target: "" } : trig, actions: [] };
        (slot === "onRight" ? slots.onRight.sets : slots.onWrong).push(curSet);
      } else if (!curSet) {
        gaps.push({ kind: "ACTION_WITHOUT_TRIGGER", severity: "warning", message: `${ctx}: action '${content}' in ${slot} has no preceding Trigger.`, line });
      } else {
        _sbPushActions(curSet.actions, parseActionLine(content), gaps, ctx, line);
      }
    } else {
      _sbPushActions(slots[slot], parseActionLine(content), gaps, ctx, line);
    }
  }
  return { name: mo.name, momentIndex: mo.index !== undefined ? mo.index : mi, defaults: "", ...slots };
}

/** Deterministic: a parsed storyboard `model` → momentTable + gaps (PURE, offline). */
export function buildMomentTable(model, opts = {}) {
  const gaps = [], warnings = [];
  const moduleName = model.module || opts.module || "";
  if (!moduleName) gaps.push({ kind: "NO_MODULE_NAME", severity: "error", message: "No module name (frontmatter `module:` or a leading title)." });
  if (!model.chapters || model.chapters.length === 0) gaps.push({ kind: "NO_CHAPTERS", severity: "error", message: "No chapters found." });

  const chapters = (model.chapters || []).map((ch, ci) => ({
    name: ch.name, chapterIndex: ci,
    moments: ch.moments.map((mo, mi) => _sbBuildMoment(ch, mo, mi, gaps)),
  }));

  let actions = 0, triggers = 0, moments = 0;
  for (const ch of chapters) for (const mo of ch.moments) {
    moments++;
    for (const k of ["onAwake", "onStart", "onFirstWarning", "onLastWarning", "onEnd"]) actions += mo[k].length;
    for (const s of mo.onRight.sets) { triggers++; actions += s.actions.length; }
    for (const s of mo.onWrong) { triggers++; actions += s.actions.length; }
  }
  const errors = gaps.filter((g) => g.severity !== "warning").length;
  return {
    momentTable: { module: moduleName, chapters },
    gaps, warnings,
    stats: { chapters: chapters.length, moments, actions, triggers, gaps: gaps.length, errors },
  };
}

/** Pure structured path: storyboard markdown → { momentTable, gaps, ... }. Offline; used by the tool + tests. */
export function storyboardToMomentTable(content, opts = {}) {
  return buildMomentTable(parseStoryboard(content), opts);
}

const TRANSLATE_STORYBOARD_TOOL = {
  name: "vrse_translate_storyboard",
  description:
    "Bridge between vrse_parse_storyboard and vrse_generate_story: converts a VRse storyboard into the " +
    "build_moments-shaped `momentTable` that vrse_generate_story consumes. HYBRID — a structured kit-dialect " +
    "storyboard is parsed DETERMINISTICALLY (lifecycle blocks **OnStart**/**OnRight** + keyword lines → " +
    "action/trigger records); loose PROSE/SOP is first converted to a storyboard via the same LLM path as " +
    "vrse_parse_storyboard (returns a delegate `conversionPrompt` when no LLM is reachable). Every record's " +
    "keyword is validated against generate_story's emitters; unrecognized/unsupported lines are reported in " +
    "`gaps[]` (never dropped). Returns { ok, halt, produced:{ momentTable }, gaps, warnings?, next, stats }. " +
    "Pass produced.momentTable straight to vrse_generate_story. Pure compute — no Unity needed.",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "Raw storyboard markdown OR a loose SOP. Mutually exclusive with `path`." },
      path: { type: "string", description: "Filesystem path to a storyboard/SOP file (read on the server host)." },
      module: { type: "string", description: "(SOP only) module name for the storyboard frontmatter." },
      project: { type: "string", description: "(SOP only) project name." },
      artScene: { type: "string", description: "(SOP only) art scene path." },
      devScene: { type: "string", description: "(SOP only) dev scene path." },
      storyJson: { type: "string", description: "(SOP only) Story JSON output path." },
    },
    required: [],
  },
  handler: async (args = {}) => {
    let content = args.text || "";
    if (!content && args.path) {
      try { content = readFileSync(args.path, "utf-8"); }
      catch (err) { return JSON.stringify({ ok: false, error: `Could not read path "${args.path}": ${err.message}` }, null, 2); }
    }
    if (!content || !content.trim()) return JSON.stringify({ ok: false, error: "Provide a non-empty `text` or a readable `path`." }, null, 2);

    // Loose prose → convert SOP→storyboard first (reuse parse_storyboard's LLM machinery; delegate if none).
    if (!looksLikeStoryboard(content)) {
      const { rules, source } = loadSopRules();
      const frontmatter = buildFrontmatter(args);
      const system = rules + "\n\n# OUTPUT CONTRACT (strict)\nReturn ONLY the finished storyboard markdown — no commentary, no code fences. The file MUST begin with EXACTLY this frontmatter (verbatim):\n\n" + frontmatter;
      const user = "<sop>\n" + content + "\n</sop>\n\nConvert the SOP above into a VRse storyboard now, following all rules. Begin the output with the exact frontmatter provided.";
      const { text, via } = await runSopCompletion({ system, user });
      if (!text) {
        return JSON.stringify({
          ok: false, halt: true, mode: "sop", needsLLM: true, via: "delegate", rulesSource: source,
          message: "Input is loose prose and no LLM is reachable. Run the conversionPrompt yourself to produce a structured storyboard, then re-call vrse_translate_storyboard on the result.",
          conversionPrompt: { system, user },
        }, null, 2);
      }
      content = stripCodeFences(text).trim();
    }

    try {
      const out = storyboardToMomentTable(content, args);
      const ok = out.stats.errors === 0;
      return JSON.stringify({
        ok, halt: !ok,
        produced: { momentTable: out.momentTable },
        gaps: out.gaps,
        ...(out.warnings.length ? { warnings: out.warnings } : {}),
        next: ok
          ? "momentTable built. Pass produced.momentTable to vrse_generate_story (it harvests ids, validates, applies, saves)."
          : "Resolve the gaps[] (unrecognized/unsupported keywords or ambiguous lines): fix the storyboard, or hand-edit produced.momentTable. UNSUPPORTED_* keywords need a generate_story emitter first.",
        stats: out.stats,
      }, null, 2);
    } catch (err) {
      return JSON.stringify({ ok: false, error: `Translate failed: ${err.message}` }, null, 2);
    }
  },
};

export const vrseStageTools = [
  {
    name: "vrse_storyboard_structure",
    description:
      "Parse a VRse storyboard (markdown) into a structured spec WITHOUT touching Unity. " +
      "Deterministic structural extraction: frontmatter (module/project/scene paths), per-chapter " +
      "object declarations with modifiers ([source:]/[allows:]/[at:]/[position:]), spawn points, " +
      "chapters/moments, and alias references. Returns { ok, spec, gaps, stats, next } where `gaps` " +
      "are the interpretive items YOU (the agent) must resolve — UNTYPED_OBJECT (infer the type), " +
      "MISSING_SOURCE (supply [source:]), BAD_ALLOWS_REFERENCE, NO_MODULE_NAME, NO_CHAPTERS. " +
      "STRICT structural variant: it never converts an SOP and never calls an LLM. (For the smart " +
      "'storyboard OR SOP' version, use vrse_parse_storyboard.) Runs in any MCP client, no Unity Editor. " +
      "Provide `text` OR `path`.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Raw storyboard markdown content. Mutually exclusive with `path`." },
        path: { type: "string", description: "Filesystem path to a storyboard .md file (read on the server host). Mutually exclusive with `text`." },
      },
      required: [],
    },
    handler: async ({ text = "", path = "" } = {}) => {
      let content = text;
      if (!content && path) {
        try {
          content = readFileSync(path, "utf-8");
        } catch (err) {
          return JSON.stringify({ ok: false, error: `Could not read path "${path}": ${err.message}` }, null, 2);
        }
      }
      if (!content || !content.trim()) {
        return JSON.stringify({ ok: false, error: "Provide a non-empty `text` or a readable `path`." }, null, 2);
      }
      try {
        const model = parseStoryboard(content);
        return JSON.stringify(buildSpecAndGaps(model), null, 2);
      } catch (err) {
        return JSON.stringify({ ok: false, error: `Parse failed: ${err.message}` }, null, 2);
      }
    },
  },
  INGEST_TOOL,
  PREPARE_SCENE_TOOL,
  SETUP_OBJECTS_TOOL,
  PLACE_OBJECTS_TOOL,
  HARVEST_IDS_TOOL,
  GENERATE_STORY_TOOL,
  TRANSLATE_STORYBOARD_TOOL,
];
