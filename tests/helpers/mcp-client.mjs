// Minimal MCP stdio test client — spawns src/index.js and speaks newline-delimited
// JSON-RPC 2.0 (the MCP stdio framing). Tracks stdout protocol purity: every stdout
// line MUST parse as a JSON-RPC message (the 2.28.2 Codex framing bug class).

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SERVER_ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "index.js");

export class McpTestClient {
  /**
   * @param {object} [options]
   * @param {object} [options.env] Extra env vars (typically MockBridge#env()).
   * @param {number} [options.timeoutMs] Per-request timeout (default 20s).
   */
  constructor(options = {}) {
    this.extraEnv = options.env || {};
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this._id = 0;
    /** @type {Map<number, {resolve: Function, reject: Function, timer: NodeJS.Timeout}>} */
    this._pending = new Map();
    /** @type {string[]} stdout lines that failed to parse as JSON-RPC */
    this.stdoutViolations = [];
    /** @type {string} accumulated stderr (diagnostics) */
    this.stderr = "";
    this._stdoutBuffer = "";
    this._child = null;
  }

  start() {
    this._child = spawn(process.execPath, [SERVER_ENTRY], {
      env: { ...process.env, ...this.extraEnv },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this._child.stdout.on("data", (chunk) => this._onStdout(chunk.toString("utf8")));
    this._child.stderr.on("data", (chunk) => (this.stderr += chunk.toString("utf8")));
    return this;
  }

  _onStdout(text) {
    this._stdoutBuffer += text;
    let newlineIndex;
    while ((newlineIndex = this._stdoutBuffer.indexOf("\n")) >= 0) {
      const line = this._stdoutBuffer.slice(0, newlineIndex).replace(/\r$/, "");
      this._stdoutBuffer = this._stdoutBuffer.slice(newlineIndex + 1);
      if (line.trim() === "") continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        this.stdoutViolations.push(line);
        continue;
      }
      if (message.jsonrpc !== "2.0") this.stdoutViolations.push(line);
      if (message.id !== undefined && this._pending.has(message.id)) {
        const { resolve, reject, timer } = this._pending.get(message.id);
        this._pending.delete(message.id);
        clearTimeout(timer);
        message.error ? reject(new Error(`RPC error ${message.error.code}: ${message.error.message}`)) : resolve(message.result);
      }
      // Server-initiated notifications/requests are ignored by this test client.
    }
  }

  /** Raw JSON-RPC request. */
  request(method, params = {}) {
    const id = ++this._id;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`Timeout waiting for ${method} (id ${id}). stderr tail:\n${this.stderr.slice(-2000)}`));
      }, this.timeoutMs);
      this._pending.set(id, { resolve, reject, timer });
      this._child.stdin.write(payload + "\n");
    });
  }

  notify(method, params = {}) {
    this._child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  /** Full MCP handshake. Returns the initialize result (serverInfo etc.). */
  async initialize() {
    const result = await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "umcp-test-client", version: "1.0.0" },
    });
    this.notify("notifications/initialized");
    return result;
  }

  /** @returns {Promise<{tools: Array<{name: string, description: string, inputSchema: object}>}>} */
  listTools() {
    return this.request("tools/list");
  }

  /**
   * Call a tool. Returns { blocks, payload, payloadText, isError } where `payload` is the
   * parsed JSON of the LAST text block (tool output; earlier blocks may be instance/context banners).
   */
  async callTool(name, args = {}) {
    const result = await this.request("tools/call", { name, arguments: args });
    const blocks = result.content || [];
    const textBlocks = blocks.filter((b) => b.type === "text");
    const payloadText = textBlocks.length > 0 ? textBlocks[textBlocks.length - 1].text : "";
    let payload = null;
    try {
      payload = JSON.parse(payloadText);
    } catch {
      // Non-JSON tool output (error strings, guidance text) — callers assert on payloadText.
    }
    return { blocks, payload, payloadText, isError: result.isError === true };
  }

  async close() {
    for (const { reject, timer } of this._pending.values()) {
      clearTimeout(timer);
      reject(new Error("Client closed"));
    }
    this._pending.clear();
    if (this._child && this._child.exitCode === null) {
      this._child.stdin.end();
      const exited = new Promise((resolve) => this._child.once("exit", resolve));
      const finished = await Promise.race([exited.then(() => true), new Promise((r) => setTimeout(() => r(false), 1500))]);
      if (!finished) this._child.kill("SIGKILL");
    }
  }
}
