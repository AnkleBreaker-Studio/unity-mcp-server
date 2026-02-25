#!/usr/bin/env node
/**
 * AnkleBreaker Unity MCP Multi-Agent Stress Test
 *
 * Simulates N agents each submitting M requests concurrently
 * to validate queue fairness, ticket tracking, and timeout handling.
 *
 * Usage:
 *   node tests/multi-agent-stress-test.mjs [--agents N] [--requests M] [--mock]
 *
 * --mock   : Start a local mock Unity bridge (no real Unity needed)
 * --agents : Number of concurrent agents (default: 5)
 * --requests: Requests per agent (default: 6)
 */

import http from "http";
import { randomBytes } from "crypto";

// ─── CLI args ────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const MOCK_MODE = args.includes("--mock");
const NUM_AGENTS = parseInt(args.find((_, i, a) => a[i - 1] === "--agents") || "5");
const REQUESTS_PER_AGENT = parseInt(args.find((_, i, a) => a[i - 1] === "--requests") || "6");
const BRIDGE_PORT = 7890;
const BRIDGE_HOST = "127.0.0.1";

// ─── Colors ──────────────────────────────────────────────────────────
const C = {
  reset: "\x1b[0m", bold: "\x1b[1m",
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m",
  blue: "\x1b[34m", magenta: "\x1b[35m", cyan: "\x1b[36m",
  gray: "\x1b[90m",
};
const AGENT_COLORS = [C.cyan, C.magenta, C.yellow, C.green, C.blue, C.red];

function log(color, prefix, msg) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`${C.gray}[${ts}]${C.reset} ${color}${prefix}${C.reset} ${msg}`);
}

// ─── HTTP helpers ────────────────────────────────────────────────────
function httpRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: BRIDGE_HOST, port: BRIDGE_PORT, path, method, headers: {} };
    if (body) {
      const data = JSON.stringify(body);
      opts.headers["Content-Type"] = "application/json";
      opts.headers["Content-Length"] = Buffer.byteLength(data);
    }
    const req = http.request(opts, (res) => {
      let chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Mock Unity Bridge ──────────────────────────────────────────────
// Simulates queue/submit, queue/status, queue/info endpoints
// with realistic processing delays (50-300ms per request)
let mockServer = null;
const mockTickets = new Map();
let mockTicketCounter = 0;

function startMockBridge() {
  return new Promise((resolve) => {
    mockServer = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const url = new URL(req.url, `http://${BRIDGE_HOST}:${BRIDGE_PORT}`);
        const path = url.pathname;

        // ── queue/submit ──
        if (path === "/api/queue/submit" && req.method === "POST") {
          const payload = JSON.parse(body);
          const ticketId = `ticket-${++mockTicketCounter}`;
          const processingTime = 50 + Math.random() * 250; // 50-300ms

          const ticket = {
            ticketId,
            status: "Queued",
            agentId: payload.agentId || "unknown",
            apiPath: payload.apiPath,
            submittedAt: new Date().toISOString(),
            result: null,
          };
          mockTickets.set(ticketId, ticket);

          // Simulate async processing
          setTimeout(() => {
            ticket.status = "Completed";
            ticket.completedAt = new Date().toISOString();
            ticket.result = {
              success: true,
              data: `Mock result for ${payload.apiPath} (agent: ${payload.agentId})`,
              processingTimeMs: Math.round(processingTime),
            };
          }, processingTime);

          res.writeHead(202, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ticketId, status: "Queued", position: mockTickets.size }));
          return;
        }

        // ── queue/status ──
        if (path === "/api/queue/status") {
          const ticketId = url.searchParams.get("ticketId");
          const ticket = mockTickets.get(ticketId);
          if (!ticket) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Ticket not found" }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(ticket));
          return;
        }

        // ── queue/info ──
        if (path === "/api/queue/info") {
          const agents = new Map();
          let pending = 0;
          for (const t of mockTickets.values()) {
            if (t.status === "Queued") {
              pending++;
              agents.set(t.agentId, (agents.get(t.agentId) || 0) + 1);
            }
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            totalPending: pending,
            activeAgents: agents.size,
            perAgent: Object.fromEntries(agents),
            completedCacheSize: [...mockTickets.values()].filter((t) => t.status === "Completed").length,
          }));
          return;
        }

        // ── ping ──
        if (path === "/api/ping") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok", mock: true }));
          return;
        }

        // ── Fallback: simulate legacy endpoints ──
        const delay = 30 + Math.random() * 100;
        setTimeout(() => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, mock: true, path, data: {} }));
        }, delay);
      });
    });

    mockServer.listen(BRIDGE_PORT, BRIDGE_HOST, () => {
      log(C.green, "[MOCK]", `Mock Unity bridge running on ${BRIDGE_HOST}:${BRIDGE_PORT}`);
      resolve();
    });
  });
}

// ─── Agent Simulation ────────────────────────────────────────────────
// Each agent: submit request → get ticket → poll until done
async function simulateAgent(agentIdx, agentId) {
  const color = AGENT_COLORS[agentIdx % AGENT_COLORS.length];
  const prefix = `[Agent-${agentIdx}]`;
  const results = [];

  // Varied API paths to test read batching vs write serialization
  const apiPaths = [
    "editor/state",           // read
    "scene/hierarchy",        // read
    "gameobject/info",        // read
    "gameobject/create",      // write
    "component/set_property", // write
    "scene/info",             // read
    "asset/list",             // read
    "script/create",          // write
    "material/create",        // write
    "editor/ping",            // read
  ];

  log(color, prefix, `Starting — will submit ${REQUESTS_PER_AGENT} requests (id: ${agentId})`);

  for (let i = 0; i < REQUESTS_PER_AGENT; i++) {
    const apiPath = apiPaths[i % apiPaths.length];
    const startTime = Date.now();

    try {
      // 1. Submit to queue
      const submitRes = await httpRequest("POST", "/api/queue/submit", {
        apiPath,
        body: JSON.stringify({ test: true, agentIdx, requestIdx: i }),
        agentId,
      });

      if (submitRes.status !== 202) {
        log(C.red, prefix, `Submit FAILED (HTTP ${submitRes.status}): ${JSON.stringify(submitRes.body)}`);
        results.push({ apiPath, status: "submit_failed", elapsed: Date.now() - startTime });
        continue;
      }

      const ticketId = submitRes.body.ticketId;
      log(color, prefix, `Submitted ${C.bold}${apiPath}${C.reset} → ticket ${ticketId}`);

      // 2. Poll for result (exponential backoff)
      let pollInterval = 50;
      let completed = false;
      const pollStart = Date.now();

      while (Date.now() - pollStart < 30000) { // 30s timeout
        await sleep(pollInterval);
        pollInterval = Math.min(pollInterval * 1.5, 1000);

        const statusRes = await httpRequest("GET", `/api/queue/status?ticketId=${ticketId}`);

        if (statusRes.body.status === "Completed") {
          const elapsed = Date.now() - startTime;
          log(color, prefix, `  ✓ ${ticketId} completed in ${C.bold}${elapsed}ms${C.reset}`);
          results.push({ apiPath, ticketId, status: "completed", elapsed });
          completed = true;
          break;
        } else if (statusRes.body.status === "Failed" || statusRes.body.status === "TimedOut") {
          const elapsed = Date.now() - startTime;
          log(C.red, prefix, `  ✗ ${ticketId} ${statusRes.body.status}: ${statusRes.body.errorMessage || "unknown"}`);
          results.push({ apiPath, ticketId, status: statusRes.body.status, elapsed });
          completed = true;
          break;
        }
      }

      if (!completed) {
        log(C.red, prefix, `  ✗ ${ticketId} POLL TIMEOUT (30s)`);
        results.push({ apiPath, ticketId, status: "poll_timeout", elapsed: Date.now() - startTime });
      }

    } catch (err) {
      log(C.red, prefix, `Error: ${err.message}`);
      results.push({ apiPath, status: "error", error: err.message, elapsed: Date.now() - startTime });
    }

    // Small stagger between requests from same agent (10-50ms)
    await sleep(10 + Math.random() * 40);
  }

  log(color, prefix, `Finished — ${results.filter(r => r.status === "completed").length}/${REQUESTS_PER_AGENT} succeeded`);
  return { agentId, agentIdx, results };
}

// ─── Queue Info Poller ───────────────────────────────────────────────
// Periodically checks queue state during the test
async function pollQueueInfo(abortSignal) {
  while (!abortSignal.aborted) {
    try {
      const res = await httpRequest("GET", "/api/queue/info");
      if (res.body.totalPending > 0) {
        const agentInfo = res.body.perAgent
          ? Object.entries(res.body.perAgent).map(([a, c]) => `${a.slice(-8)}:${c}`).join(", ")
          : "n/a";
        log(C.gray, "[QUEUE]", `Pending: ${res.body.totalPending} | Agents: ${res.body.activeAgents} | [${agentInfo}]`);
      }
    } catch { /* bridge might be between requests */ }
    await sleep(500);
  }
}

// ─── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${C.bold}═══════════════════════════════════════════════════════════${C.reset}`);
  console.log(`${C.bold}  AB Unity MCP Multi-Agent Stress Test${C.reset}`);
  console.log(`${C.bold}═══════════════════════════════════════════════════════════${C.reset}`);
  console.log(`  Agents: ${NUM_AGENTS}  |  Requests/agent: ${REQUESTS_PER_AGENT}  |  Total: ${NUM_AGENTS * REQUESTS_PER_AGENT}`);
  console.log(`  Mode: ${MOCK_MODE ? "MOCK (simulated bridge)" : "LIVE (real Unity bridge)"}`);
  console.log(`${C.bold}═══════════════════════════════════════════════════════════${C.reset}\n`);

  // Start mock if needed
  if (MOCK_MODE) {
    await startMockBridge();
  } else {
    // Verify bridge is running
    try {
      await httpRequest("GET", "/api/ping");
      log(C.green, "[INIT]", "Unity bridge is reachable");
    } catch {
      console.error(`${C.red}ERROR: Unity bridge not reachable at ${BRIDGE_HOST}:${BRIDGE_PORT}`);
      console.error(`Run with --mock to use a simulated bridge${C.reset}`);
      process.exit(1);
    }
  }

  // Generate agent IDs
  const agents = Array.from({ length: NUM_AGENTS }, (_, i) => ({
    idx: i,
    id: `test-agent-${process.pid}-${randomBytes(3).toString("hex")}`,
  }));

  log(C.green, "[INIT]", `Agent IDs: ${agents.map(a => a.id.slice(-8)).join(", ")}`);

  // Start queue info polling
  const abortController = new AbortController();
  const queuePollPromise = pollQueueInfo(abortController.signal);

  // Launch all agents concurrently
  const testStart = Date.now();
  const agentPromises = agents.map((a) => simulateAgent(a.idx, a.id));
  const allResults = await Promise.all(agentPromises);
  const totalElapsed = Date.now() - testStart;

  // Stop queue polling
  abortController.abort();

  // ── Summary ──
  console.log(`\n${C.bold}═══════════════════════════════════════════════════════════${C.reset}`);
  console.log(`${C.bold}  TEST RESULTS${C.reset}`);
  console.log(`${C.bold}═══════════════════════════════════════════════════════════${C.reset}\n`);

  let totalCompleted = 0, totalFailed = 0, totalTimeout = 0;
  const allElapsed = [];

  for (const agentResult of allResults) {
    const color = AGENT_COLORS[agentResult.agentIdx % AGENT_COLORS.length];
    const completed = agentResult.results.filter(r => r.status === "completed");
    const failed = agentResult.results.filter(r => r.status !== "completed");
    totalCompleted += completed.length;
    totalFailed += failed.filter(r => r.status !== "poll_timeout").length;
    totalTimeout += failed.filter(r => r.status === "poll_timeout").length;

    const times = completed.map(r => r.elapsed);
    allElapsed.push(...times);
    const avg = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
    const max = times.length ? Math.max(...times) : 0;
    const min = times.length ? Math.min(...times) : 0;

    console.log(`${color}  Agent-${agentResult.agentIdx}${C.reset} (${agentResult.agentId.slice(-8)}): ` +
      `${C.green}${completed.length} ok${C.reset} / ` +
      `${failed.length > 0 ? C.red : C.gray}${failed.length} fail${C.reset}  |  ` +
      `avg: ${avg}ms  min: ${min}ms  max: ${max}ms`);
  }

  console.log(`\n${C.bold}  Totals:${C.reset}`);
  console.log(`    Completed: ${C.green}${totalCompleted}${C.reset} / ${NUM_AGENTS * REQUESTS_PER_AGENT}`);
  if (totalFailed > 0) console.log(`    Failed:    ${C.red}${totalFailed}${C.reset}`);
  if (totalTimeout > 0) console.log(`    Timed out: ${C.red}${totalTimeout}${C.reset}`);
  console.log(`    Wall time: ${C.bold}${totalElapsed}ms${C.reset}`);

  if (allElapsed.length > 0) {
    allElapsed.sort((a, b) => a - b);
    const p50 = allElapsed[Math.floor(allElapsed.length * 0.5)];
    const p95 = allElapsed[Math.floor(allElapsed.length * 0.95)];
    const p99 = allElapsed[Math.floor(allElapsed.length * 0.99)];
    const avg = Math.round(allElapsed.reduce((a, b) => a + b, 0) / allElapsed.length);
    console.log(`\n${C.bold}  Latency (all requests):${C.reset}`);
    console.log(`    avg: ${avg}ms  |  p50: ${p50}ms  |  p95: ${p95}ms  |  p99: ${p99}ms`);
  }

  // Check fairness: did any agent get starved?
  console.log(`\n${C.bold}  Fairness Check:${C.reset}`);
  const completionOrder = allResults.flatMap(r =>
    r.results.filter(x => x.status === "completed").map(x => ({ agent: r.agentIdx, elapsed: x.elapsed }))
  ).sort((a, b) => a.elapsed - b.elapsed);

  // Group completion times into quartiles
  const quartileSize = Math.ceil(completionOrder.length / 4);
  for (let q = 0; q < 4; q++) {
    const slice = completionOrder.slice(q * quartileSize, (q + 1) * quartileSize);
    const agentCounts = {};
    for (const item of slice) {
      agentCounts[item.agent] = (agentCounts[item.agent] || 0) + 1;
    }
    const dist = Object.entries(agentCounts).map(([a, c]) => `A${a}:${c}`).join(" ");
    console.log(`    Q${q + 1}: ${dist}`);
  }

  console.log(`\n${C.bold}═══════════════════════════════════════════════════════════${C.reset}\n`);

  // Get final queue info
  try {
    const finalInfo = await httpRequest("GET", "/api/queue/info");
    log(C.gray, "[FINAL]", `Queue state: ${JSON.stringify(finalInfo.body)}`);
  } catch { /* ok */ }

  if (mockServer) mockServer.close();
  process.exit(totalFailed + totalTimeout > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`${C.red}Fatal: ${err.message}${C.reset}`);
  if (mockServer) mockServer.close();
  process.exit(1);
});
