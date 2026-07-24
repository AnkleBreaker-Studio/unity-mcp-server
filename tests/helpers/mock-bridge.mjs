// Mock Unity Bridge — reusable test double for the plugin's HTTP bridge.
// Speaks the same protocol the real MCPBridgeServer exposes:
//   GET  /api/ping                     → instance identity (discovery reads projectName/projectPath/…)
//   POST /api/queue/submit             → { ticketId, status, position }        (202)
//   GET  /api/queue/status?ticketId=X  → ticket object ({ status, result })
//   GET  /api/queue/info               → queue stats
//   GET  /api/context[/{category}]     → project context (404 by default, like a project without Assets/MCP/Context)
//   POST /api/{route}                  → legacy synchronous execution
// Listens on an ephemeral port (127.0.0.1:0) so parallel test files never collide.

import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** @typedef {{ route: string, params: object, headers: object, via: "queue"|"legacy" }} SeenRequest */

export class MockBridge {
  /**
   * @param {object} [options]
   * @param {"queue"|"legacy"} [options.mode] "queue" (default) answers queue/submit; "legacy" 404s it so the server falls back to sync POSTs.
   * @param {object} [options.instance] Fields merged into the /api/ping identity payload.
   * @param {number} [options.processingDelayMs] Simulated queue processing delay (default 0 = complete immediately).
   */
  constructor(options = {}) {
    this.mode = options.mode || "queue";
    this.instance = {
      status: "ok",
      projectName: "MockProject",
      projectPath: "C:/Mock/Project",
      unityVersion: "6000.0.0f1",
      isClone: false,
      cloneIndex: -1,
      protocolVersion: 1,
      pluginVersion: "9.9.9-mock",
      ...options.instance,
    };
    this.processingDelayMs = options.processingDelayMs ?? 0;
    /** @type {Map<string, (params: object) => object>} route → responder returning the plugin-side result object */
    this.routes = new Map();
    /** @type {SeenRequest[]} */
    this.seen = [];
    /** @type {(cat: string|null) => object|null} return null → 404 (project without context) */
    this.contextProvider = () => null;
    this._tickets = new Map();
    this._ticketCounter = 0;
    this._server = null;
    this.port = 0;
  }

  /** Register a responder for a plugin route (e.g. "editor/state"). Return value is the ticket `result` / legacy body. */
  on(route, responder) {
    this.routes.set(route, responder);
    return this;
  }

  /**
   * Default plugin-side behavior for unregistered routes. Plugin handlers return RAW
   * result objects (no {success,data} envelope) — the Node bridge adds that wrapper.
   * (Some real handlers do include their own `success` field, which is why production
   * responses can show a double envelope; fixtures model the common raw shape.)
   */
  _defaultResponder(route, params) {
    return { mock: true, route, echo: params };
  }

  _resolve(route, params) {
    const responder = this.routes.get(route);
    return responder ? responder(params) : this._defaultResponder(route, params);
  }

  start() {
    return new Promise((resolve) => {
      this._server = http.createServer((req, res) => this._handle(req, res));
      this._server.listen(0, "127.0.0.1", () => {
        this.port = this._server.address().port;
        resolve(this);
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (!this._server) return resolve();
      this._server.close(() => resolve());
      // Drop keep-alive sockets so close() doesn't hang the test process.
      this._server.closeAllConnections?.();
    });
  }

  /**
   * Environment for spawning the MCP server against this mock: pins every port knob
   * to the mock and isolates the instance registry + home-derived paths into a temp dir.
   */
  env() {
    const isolatedDir = mkdtempSync(join(tmpdir(), "umcp-test-"));
    return {
      UNITY_BRIDGE_HOST: "127.0.0.1",
      UNITY_BRIDGE_PORT: String(this.port),
      UNITY_PORT_RANGE_START: String(this.port),
      UNITY_PORT_RANGE_END: String(this.port),
      UNITY_INSTANCE_REGISTRY: join(isolatedDir, "instances.json"),
      UNITY_QUEUE_POLL_INTERVAL: "10",
      UNITY_QUEUE_POLL_MAX: "50",
      UNITY_QUEUE_POLL_TIMEOUT: "15000",
      UNITY_BRIDGE_TIMEOUT: "15000",
      LOCALAPPDATA: isolatedDir,
      HOME: isolatedDir,
    };
  }

  _json(res, code, obj) {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(obj));
  }

  _handle(req, res) {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const url = new URL(req.url, `http://127.0.0.1:${this.port}`);
      const path = url.pathname.replace(/^\/api\//, "");

      if (path === "ping") return this._json(res, 200, this.instance);

      if (path === "queue/submit" && req.method === "POST") {
        if (this.mode === "legacy") return this._json(res, 404, { error: "Unknown route" });
        const payload = JSON.parse(body || "{}");
        const route = String(payload.apiPath || "").replace(/^\/?api\//, "").replace(/^\//, "");
        const params = payload.body ? JSON.parse(payload.body) : {};
        this.seen.push({ route, params, headers: req.headers, via: "queue" });
        const ticketId = `ticket-${++this._ticketCounter}`;
        // Field names mirror the plugin's MCPRequestQueue.TicketToDict EXACTLY. The failure
        // text lives in `errorMessage` — the mock previously emitted `error`, which is why a
        // 59-test suite never caught the server reading the wrong field for every route.
        const ticket = { ticketId, status: "Queued", agentId: payload.agentId || "unknown", result: null, errorMessage: "" };
        this._tickets.set(ticketId, ticket);
        const complete = () => {
          try {
            const outcome = this._resolve(route, params);
            if (outcome && outcome.__fail) {
              ticket.status = "Failed";
              ticket.errorMessage = outcome.error || "Mock failure";
            } else if (outcome && outcome.__timeout) {
              // Simulate a plugin-side sync-timeout terminal state.
              ticket.status = "TimedOut";
              ticket.errorMessage = outcome.error || "Timed out on the main thread";
            } else if (outcome && outcome.__evict) {
              // Simulate a domain reload evicting the ticket mid-flight: the action ran,
              // but every subsequent status poll 404s (the play-mode false-negative class).
              this._tickets.delete(ticketId);
            } else {
              ticket.status = "Completed";
              ticket.result = outcome;
            }
          } catch (err) {
            ticket.status = "Failed";
            ticket.errorMessage = err.message;
          }
        };
        this.processingDelayMs > 0 ? setTimeout(complete, this.processingDelayMs) : complete();
        return this._json(res, 202, { ticketId, status: "Queued", position: this._tickets.size });
      }

      if (path === "queue/status") {
        const ticket = this._tickets.get(url.searchParams.get("ticketId"));
        if (!ticket) return this._json(res, 404, { error: "Ticket not found" });
        return this._json(res, 200, ticket);
      }

      if (path === "queue/info") {
        return this._json(res, 200, { totalPending: 0, activeAgents: 0, perAgent: {}, completedCacheSize: this._tickets.size });
      }

      if (path === "context" || path.startsWith("context/")) {
        const category = path === "context" ? null : path.slice("context/".length);
        const ctx = this.contextProvider(category);
        if (ctx === null) return this._json(res, 404, { error: "No project context configured" });
        return this._json(res, 200, ctx);
      }

      // Legacy synchronous execution: POST /api/{route}
      if (req.method === "POST") {
        const params = body ? JSON.parse(body) : {};
        this.seen.push({ route: path, params, headers: req.headers, via: "legacy" });
        const outcome = this._resolve(path, params);
        if (outcome && outcome.__fail) return this._json(res, 200, { success: false, error: outcome.error || "Mock failure" });
        return this._json(res, 200, outcome);
      }

      return this._json(res, 404, { error: `Unknown route: ${path}` });
    });
  }
}
