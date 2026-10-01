import { existsSync, mkdirSync, readFileSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const [directory, mode, worker = "0"] = process.argv.slice(2);
process.env.UNITY_INSTANCE_REGISTRY = join(directory, "instances.json");
process.env.UNITY_MCP_DEBUG = mode === "disabled" ? "0" : "1";
const { debugLog } = await import("../../src/state-persistence.js");
const log = join(directory, "mcp-debug.log");
const limit = 5 * 1024 * 1024;

if (mode === "disabled") {
  debugLog({ toString() { throw new Error("Disabled logging formatted a message"); } });
} else if (mode === "small") {
  debugLog("first message"); debugLog("second message");
} else if (mode === "sustained" || mode === "multiple-rotations") {
  for (let i = 0; i < (mode === "sustained" ? 96 : 260); i++) debugLog(`entry ${i}: ` + "x".repeat(65536));
} else if (mode === "unicode") {
  debugLog("start: " + "abc😀é".repeat(30000));
} else if (mode === "unicode-boundaries") {
  for (let i = 0; i < 8; i++) debugLog(" ".repeat(i) + "é😀".repeat(20000));
} else if (mode === "historical") {
  mkdirSync(directory, { recursive: true }); writeFileSync(log, "h".repeat(limit + 100));
  debugLog("after existing oversized log");
} else if (mode === "rotation-failure") {
  mkdirSync(log + ".old", { recursive: true }); writeFileSync(log, "x".repeat(limit));
  debugLog("must not grow the log after failed rotation");
  const sizeAfterFailure = statSync(log).size;
  rmdirSync(log + ".old");
  await delay(1200); debugLog("recovered");
  console.log(JSON.stringify({ sizeAfterFailure, recovered: readFileSync(log, "utf8").includes("recovered") }));
} else if (mode === "unwritable") {
  for (let i = 0; i < 3; i++) debugLog("x".repeat(1024 * 1024));
} else if (mode === "bad-message") {
  debugLog({ toString() { throw new Error("Formatting failure"); } });
} else if (mode === "concurrent") {
  while (!existsSync(join(directory, "start"))) await delay(10);
  for (let i = 0; i < 110; i++) { debugLog(`worker ${worker} entry ${i}: ` + "é".repeat(8192)); await delay(1); }
} else throw new Error("Unknown fixture mode");
