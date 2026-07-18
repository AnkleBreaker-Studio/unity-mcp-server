// AnkleBreaker Unity MCP — File-based debug logging
// Opt-in via UNITY_MCP_DEBUG=1: appends diagnostics to a log file next to the
// instance registry. Disabled by default — an always-on log grew without bound
// on every tool call and added sync disk I/O per request.

import { mkdirSync, appendFileSync, statSync, renameSync } from "fs";
import { join, dirname } from "path";
import { CONFIG } from "./config.js";

const STATE_DIR = dirname(CONFIG.instanceRegistryPath);
const DEBUG_LOG = join(STATE_DIR, "mcp-debug.log");

const DEBUG_ENABLED = process.env.UNITY_MCP_DEBUG === "1";

// Rotate once per process: if the previous log outgrew the cap, move it aside
// (replacing any older rotation) so the log can never grow without bound.
const MAX_LOG_BYTES = 5 * 1024 * 1024;
let _rotationChecked = false;

function rotateIfOversized() {
  if (_rotationChecked) return;
  _rotationChecked = true;
  try {
    if (statSync(DEBUG_LOG).size > MAX_LOG_BYTES) {
      renameSync(DEBUG_LOG, `${DEBUG_LOG}.old`);
    }
  } catch {
    // Log doesn't exist yet or can't be rotated — nothing to do.
  }
}

/**
 * Append a debug message to the file-based debug log (no-op unless UNITY_MCP_DEBUG=1).
 * @param {string} message
 */
export function debugLog(message) {
  if (!DEBUG_ENABLED) return;
  try {
    rotateIfOversized();
    const ts = new Date().toISOString();
    mkdirSync(STATE_DIR, { recursive: true });
    appendFileSync(DEBUG_LOG, `[${ts}] [PID:${process.pid}] ${message}\n`);
  } catch {
    // Last-resort: stderr (never stdout — that's the MCP JSON-RPC transport).
    console.error(`[MCP Debug] ${message}`);
  }
}
