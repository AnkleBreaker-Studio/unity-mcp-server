import { randomUUID } from "node:crypto";
import { CONFIG } from "./config.js";
import { pluginSupports } from "./capabilities.js";
import { requestFetch, requestSleep as sleep, shareRequestWork, throwIfRequestCancelled } from "./request-cancellation.js";

const MAX_RETRIES = 4;
const queueModes = new Map();
const negotiations = new Map();
const backoff = attempt => 800 * 2 ** attempt;

function notSent(error) {
  return error?.code === "ECONNREFUSED" || error?.cause?.code === "ECONNREFUSED";
}

function transient(error) {
  return !error.status || error.status === 500 || error.status === 502 || error.status === 503 || error.status === 504;
}

function unknownOutcome(command, detail, identifiers = {}) {
  return {
    success: false,
    outcomeUnknown: true,
    error: `Outcome unknown for ${command}: ${detail}. The original request may have executed. Inspect Unity before retrying.`,
    ...identifiers,
  };
}

async function fetchJson(url, options, timeoutMs = CONFIG.editorBridgeTimeout) {
  const response = await requestFetch(url, options, timeoutMs);
  const text = response.text;
  if (!response.ok) {
    let body;
    try { body = JSON.parse(text); } catch { body = null; }
    const error = new Error(`HTTP ${response.status}: ${body?.error || text}`);
    error.status = response.status;
    error.bridgeCode = body?.code;
    throw error;
  }
  return JSON.parse(text);
}

function negotiate(bridgeUrl, agentId) {
  return shareRequestWork(negotiations, bridgeUrl, async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        const info = await fetchJson(`${bridgeUrl}/api/queue/info`, { headers: { "X-Agent-Id": agentId } });
        if (!pluginSupports(info, "IDEMPOTENT_QUEUE")) return null;
        if (!/^[a-f0-9]{32}$/i.test(info.queueSessionId || "")
            || !Number.isSafeInteger(info.queueSessionTimeMs) || info.queueSessionTimeMs < 0
            || !Number.isSafeInteger(info.queueRetryWindowMs) || info.queueRetryWindowMs <= 1000
            || info.queueRetryWindowMs > 120000) throw new Error("Invalid queue retry capability metadata");
        return info;
      } catch (error) {
        throwIfRequestCancelled();
        if (error.status === 404) return null;
        if (!transient(error) || attempt >= MAX_RETRIES) throw error;
        await sleep(backoff(attempt));
      }
    }
  });
}

async function legacy(command, body, bridgeUrl, agentId) {
  for (let attempt = 0; ; attempt++) {
    try {
      const data = await fetchJson(`${bridgeUrl}/api/${command}`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Agent-Id": agentId }, body,
      });
      return { success: true, data };
    } catch (error) {
      throwIfRequestCancelled();
      if (notSent(error) && attempt < MAX_RETRIES) { await sleep(backoff(attempt)); continue; }
      if (notSent(error) || (error.status >= 400 && error.status < 500))
        return { success: false, error: error.message };
      return unknownOutcome(command, error.message);
    }
  }
}

async function poll(command, ticketId, bridgeUrl, agentId, guard) {
  const deadline = performance.now() + (CONFIG.queuePollTimeoutMs || CONFIG.editorBridgeTimeout);
  let interval = CONFIG.queuePollIntervalMs;
  let missing = 0;
  const identifiers = { ticketId, ...(guard ? { requestId: guard.requestId, queueSessionId: guard.queueSessionId } : {}) };
  const query = new URLSearchParams({ ticketId: String(ticketId) });
  if (guard) query.set("queueSessionId", guard.queueSessionId);
  while (performance.now() < deadline) {
    try {
      const ticket = await fetchJson(`${bridgeUrl}/api/queue/${guard ? "status-scoped" : "status"}?${query}`, {
        headers: { "X-Agent-Id": agentId },
      }, Math.min(10000, deadline - performance.now()));
      missing = 0;
      if (ticket.status === "Completed")
        return { success: true, data: ticket.result !== undefined ? ticket.result : { status: "Completed" } };
      if (ticket.status === "Failed")
        return { success: false, error: ticket.errorMessage || ticket.error || "Queue processing failed" };
      if (ticket.status === "TimedOut")
        return unknownOutcome(command, ticket.errorMessage || ticket.error || "Unity-side execution timed out", identifiers);
      if (ticket.status !== "Queued" && ticket.status !== "Executing")
        return unknownOutcome(command, "Invalid queue status response", identifiers);
    } catch (error) {
      throwIfRequestCancelled();
      if (error.status === 404 && ++missing < 5) {
        // Older plugins briefly lost visibility between dequeue and execution tracking.
      } else if (!transient(error)) {
        return unknownOutcome(command, error.message, identifiers);
      }
    }
    await sleep(Math.max(0, Math.min(interval, deadline - performance.now())));
    interval = Math.min(Math.ceil(interval * 1.5), CONFIG.queuePollMaxMs);
  }
  return unknownOutcome(command, "Queue polling timed out", identifiers);
}

export async function sendQueuedCommand(command, params, bridgeUrl, agentId) {
  throwIfRequestCancelled();
  const body = JSON.stringify(params);
  if (queueModes.get(bridgeUrl) === false) return legacy(command, body, bridgeUrl, agentId);

  let info;
  try { info = await negotiate(bridgeUrl, agentId); }
  catch (error) {
    throwIfRequestCancelled();
    return { success: false, queueTransportError: true, error: `Queue capability check failed: ${error.message}. No command was submitted.` };
  }

  const guard = info ? {
    requestId: randomUUID().replaceAll("-", ""),
    queueSessionId: info.queueSessionId,
    expiresAtMs: info.queueSessionTimeMs + info.queueRetryWindowMs - 1000,
  } : null;
  const deadline = performance.now() + (info ? info.queueRetryWindowMs - 1000 : CONFIG.editorBridgeTimeout * (MAX_RETRIES + 1));
  const payload = JSON.stringify({ apiPath: command, method: "POST", body, agentId, ...guard });
  let uncertain = false;
  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES && performance.now() < deadline; attempt++) {
    let ticket;
    try {
      ticket = await fetchJson(`${bridgeUrl}/api/queue/${guard ? "submit-once" : "submit"}`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Agent-Id": agentId }, body: payload,
      }, Math.min(CONFIG.editorBridgeTimeout, deadline - performance.now()));
      const id = ticket?.ticketId;
      if (!(typeof id === "string" && id.length > 0 && id.length <= 128)
          && !(Number.isSafeInteger(id) && id > 0)) throw new Error("Missing or invalid queue ticket ID");
      if (guard && ticket.queueSessionId !== guard.queueSessionId) throw new Error("Queue acknowledgement session mismatch");
    } catch (error) {
      throwIfRequestCancelled();
      lastError = error;
      if (error.status === 404 && !uncertain && !guard) {
        queueModes.set(bridgeUrl, false);
        return legacy(command, body, bridgeUrl, agentId);
      }
      if (!notSent(error) && !(error.status >= 400 && error.status < 500)) uncertain = true;
      const canRetry = notSent(error) || (guard && transient(error));
      if (!canRetry || attempt >= MAX_RETRIES) break;
      console.error(`[MCP Bridge] Retrying ${command} with its original request identity (${attempt + 1}/${MAX_RETRIES})`);
      await sleep(Math.max(0, Math.min(backoff(attempt), deadline - performance.now())));
      continue;
    }
    queueModes.set(bridgeUrl, true);
    // Once accepted, only poll this ticket; a polling failure must never resubmit work.
    return poll(command, ticket.ticketId, bridgeUrl, agentId, guard);
  }
  if (uncertain || lastError?.status === 410 || lastError?.bridgeCode === "request_conflict")
    return unknownOutcome(command, lastError?.message || "Submission retry deadline expired", guard ? { requestId: guard.requestId, queueSessionId: guard.queueSessionId } : {});
  return { success: false, queueTransportError: true, error: lastError?.message || "Submission retry deadline expired before acceptance" };
}
