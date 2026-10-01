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

const MAX_LOG_BYTES = 5 * 1024 * 1024;
const MAX_ENTRY_BYTES = 64 * 1024;
const RETRY_DELAY_MS = 1000;
let retryAfter = 0;

function rotateForEntry(bytes) {
  try {
    if (statSync(DEBUG_LOG).size + bytes > MAX_LOG_BYTES) {
      renameSync(DEBUG_LOG, `${DEBUG_LOG}.old`);
    }
  } catch (error) {
    // Another process may already have rotated this shared file.
    if (error.code !== "ENOENT") throw error;
  }
}

function formatEntry(message) {
  const prefix = Buffer.from(`[${new Date().toISOString()}] [PID:${process.pid}] `);
  const text = String(message);
  // Bound encoding work even when the caller supplies a much larger string.
  const body = Buffer.from(text.slice(0, MAX_ENTRY_BYTES));
  if (text.length <= MAX_ENTRY_BYTES && prefix.length + body.length + 1 <= MAX_ENTRY_BYTES)
    return Buffer.concat([prefix, body, Buffer.from("\n")]);

  const suffix = Buffer.from(" [truncated]\n");
  let end = MAX_ENTRY_BYTES - prefix.length - suffix.length;
  while (end > 0 && (body[end] & 0xc0) === 0x80) end--;
  return Buffer.concat([prefix, body.subarray(0, end), suffix]);
}

/**
 * Append a debug message to the file-based debug log (no-op unless UNITY_MCP_DEBUG=1).
 * @param {string} message
 */
export function debugLog(message) {
  if (!DEBUG_ENABLED || performance.now() < retryAfter) return;
  try {
    const entry = formatEntry(message);
    mkdirSync(STATE_DIR, { recursive: true });
    rotateForEntry(entry.length);
    appendFileSync(DEBUG_LOG, entry);
  } catch (error) {
    retryAfter = performance.now() + RETRY_DELAY_MS;
    try {
      const code = typeof error?.code === "string" ? error.code.slice(0, 32).replace(/[\r\n]/g, " ") : "format-or-write";
      console.error(`[MCP Debug] File logging unavailable (${code}); entry skipped, retrying on a later call after 1 second.`);
    } catch { /* Diagnostics must never interrupt the MCP request. */ }
  }
}
