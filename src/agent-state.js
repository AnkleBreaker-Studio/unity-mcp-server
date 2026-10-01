import { createHash } from "node:crypto";
import { CONFIG } from "./config.js";

const AGENT_ID_BYTES = 1024;
const SELECTION_BYTES = 64 * 1024;
const CONTEXT_MARKERS = 16;
const failure = (code, message) => Object.assign(new Error(`${code}: ${message}`), { code });

export function validateAgentId(agentId) {
  if (typeof agentId !== "string") throw new Error("agentId must be a string");
  if (Buffer.byteLength(agentId, "utf8") > AGENT_ID_BYTES)
    throw failure("agent_id_too_large", `agentId exceeds ${AGENT_ID_BYTES} UTF-8 bytes; use a shorter stable identifier.`);
}

export class AgentStateStore {
  constructor({ limit = CONFIG.agentStateLimit, byteLimit = CONFIG.agentStateBytes } = {}) {
    this.limit = limit;
    this.byteLimit = byteLimit;
    this.records = new Map();
    this.identityBytes = 0;
    this.evictions = 0;
    this.capacityRefusals = 0;
    this.contextEvictions = 0;
    this.requiresExplicitSelectionForUnknownAgents = false;
  }

  acquire(agentId, create = true) {
    validateAgentId(agentId);
    let record = this.records.get(agentId);
    if (!record && !create) return null;
    if (!record) {
      const bytes = Buffer.byteLength(agentId, "utf8");
      this.reserve(1, bytes);
      record = {
        agentId, identityBytes: bytes, activeLeases: 0, selectedInstance: null,
        selectionRequired: this.requiresExplicitSelectionForUnknownAgents,
        discoveryDone: false, pendingSelection: null, pendingDiscovery: new Map(), contextMarkers: new Map(),
      };
      this.identityBytes += bytes;
    }
    this.records.delete(agentId);
    this.records.set(agentId, record);
    record.activeLeases++;
    return record;
  }

  release(record) {
    if (record) record.activeLeases--;
  }

  reserve(count, bytes, protectedRecord) {
    let remainingCount = this.records.size + count, remainingBytes = this.identityBytes + bytes;
    const victims = [];
    for (const record of this.records.values()) {
      if (remainingCount <= this.limit && remainingBytes <= this.byteLimit) break;
      if (record.activeLeases || record === protectedRecord) continue;
      victims.push(record);
      remainingCount--; remainingBytes -= record.identityBytes;
    }
    if (remainingCount > this.limit || remainingBytes > this.byteLimit) {
      this.capacityRefusals++;
      throw failure("agent_state_capacity", "Agent state capacity is busy or this identity exceeds the byte budget. Retry after active requests finish or increase UNITY_MCP_AGENT_STATE_LIMIT / UNITY_MCP_AGENT_STATE_BYTES.");
    }
    for (const record of victims) {
      this.records.delete(record.agentId);
      this.identityBytes -= record.identityBytes;
      this.evictions++;
      // A forgotten ID cannot be distinguished from a new one without unbounded tombstones.
      this.requiresExplicitSelectionForUnknownAgents = true;
    }
  }

  select(record, instance) {
    const selectionBytes = instance ? Buffer.byteLength(JSON.stringify(instance), "utf8") : 0;
    if (selectionBytes > SELECTION_BYTES)
      throw failure("agent_state_metadata_too_large", `Selected instance metadata exceeds ${SELECTION_BYTES} UTF-8 bytes; the previous selection is unchanged.`);
    const bytes = Buffer.byteLength(record.agentId, "utf8") + selectionBytes;
    this.reserve(0, bytes - record.identityBytes, record);
    this.identityBytes += bytes - record.identityBytes;
    record.identityBytes = bytes;
    record.selectedInstance = instance;
  }

  beginContext(record, identity) {
    const key = createHash("sha256").update(JSON.stringify(identity)).digest("hex");
    const existing = record.contextMarkers.get(key);
    if (existing) {
      record.contextMarkers.delete(key); record.contextMarkers.set(key, existing);
      return null;
    }
    if (record.contextMarkers.size >= CONTEXT_MARKERS) {
      record.contextMarkers.delete(record.contextMarkers.keys().next().value);
      this.contextEvictions++;
    }
    const marker = { key };
    record.contextMarkers.set(key, marker);
    return marker;
  }

  forgetContext(record, marker) {
    // Late failures must not clear a newer fetch for the same project.
    if (record.contextMarkers.get(marker.key) === marker) record.contextMarkers.delete(marker.key);
  }

  snapshot() {
    let activeAgents = 0, activeLeases = 0, selections = 0, pendingSelections = 0, contextMarkers = 0;
    for (const record of this.records.values()) {
      activeAgents += Number(record.activeLeases > 0);
      activeLeases += record.activeLeases;
      selections += Number(!!record.selectedInstance);
      pendingSelections += Number(!!record.pendingSelection);
      contextMarkers += record.contextMarkers.size;
    }
    return {
      agents: this.records.size, limit: this.limit, identityBytes: this.identityBytes, identityByteLimit: this.byteLimit,
      activeAgents, activeLeases, selections, pendingSelections, contextMarkers, contextMarkersPerAgentLimit: CONTEXT_MARKERS,
      evictions: this.evictions, capacityRefusals: this.capacityRefusals, contextEvictions: this.contextEvictions,
      requiresExplicitSelectionForUnknownAgents: this.requiresExplicitSelectionForUnknownAgents,
    };
  }
}

export const agentState = new AgentStateStore();
