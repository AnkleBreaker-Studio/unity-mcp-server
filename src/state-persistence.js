// AnkleBreaker Unity MCP — File-based State Persistence
// Persists critical session state (selected instance, discovery flags) to disk
// so it survives MCP server process restarts by the host (Claude Desktop).
//
// The MCP host may kill and restart the server process between tool calls,
// which wipes all in-memory module-level state. This module provides a
// transparent persistence layer to maintain continuity across restarts.

import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from "fs";
import { join, dirname } from "path";
import { CONFIG } from "./config.js";

// State file lives alongside the instance registry
const STATE_DIR = dirname(CONFIG.instanceRegistryPath);
const STATE_FILE = join(STATE_DIR, "mcp-session-state.json");
const DEBUG_LOG = join(STATE_DIR, "mcp-debug.log");

// Time-to-live: persisted state expires after this duration (ms).
// Prevents stale state from a previous session being picked up.
const STATE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Persist a key-value pair to the session state file.
 * @param {string} key
 * @param {*} value — must be JSON-serializable
 */
export function persistState(key, value) {
  try {
    let state = {};
    if (existsSync(STATE_FILE)) {
      try {
        state = JSON.parse(readFileSync(STATE_FILE, "utf-8"));
      } catch {
        state = {};
      }
    }
    state[key] = value;
    state._updatedAt = Date.now();
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    debugLog(`persistState(${key}) FAILED: ${err.message}`);
  }
}

/**
 * Load a value from the persisted session state.
 * Returns undefined if the key doesn't exist or the state has expired.
 * @param {string} key
 * @returns {*} The persisted value, or undefined.
 */
export function loadState(key) {
  try {
    if (!existsSync(STATE_FILE)) return undefined;
    const state = JSON.parse(readFileSync(STATE_FILE, "utf-8"));

    // Check TTL — expire old state to avoid cross-session bleed
    if (state._updatedAt && Date.now() - state._updatedAt > STATE_TTL_MS) {
      debugLog(`loadState(${key}): state expired (age=${Date.now() - state._updatedAt}ms)`);
      return undefined;
    }

    return state[key];
  } catch {
    return undefined;
  }
}

/**
 * Clear all persisted session state.
 */
export function clearState() {
  try {
    if (existsSync(STATE_FILE)) {
      writeFileSync(STATE_FILE, "{}");
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Append a debug message to the file-based debug log.
 * Unlike console.error (which may not be visible), this always writes to disk.
 * @param {string} message
 */
export function debugLog(message) {
  try {
    const ts = new Date().toISOString();
    const pid = process.pid;
    mkdirSync(STATE_DIR, { recursive: true });
    appendFileSync(DEBUG_LOG, `[${ts}] [PID:${pid}] ${message}\n`);
  } catch {
    // Last-resort: try console.error
    console.error(`[MCP Debug] ${message}`);
  }
}
