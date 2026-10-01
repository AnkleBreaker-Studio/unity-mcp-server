import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, readdirSync, statSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { MockBridge } from "../helpers/mock-bridge.mjs";

const root = new URL("../../", import.meta.url);
const output = process.argv[2];
assert.ok(output, "Pass a report path; this is an opt-in diagnostic, not a passing regression gate");
const temporary = mkdtempSync(join(tmpdir(), "umcp-retention-audit-"));
const bridge = new MockBridge({ instance: { projectName: "RetentionAudit", projectPath: "C:/RetentionAudit" } });
const report = { nodeVersion: process.version, scope: "Instrumented module copies and an isolated mock bridge; no real Unity connection", samples: [] };

try {
  await bridge.start();
  Object.assign(process.env, {
    UNITY_BRIDGE_HOST: "127.0.0.1", UNITY_BRIDGE_PORT: String(bridge.port),
    UNITY_PORT_RANGE_START: String(bridge.port), UNITY_PORT_RANGE_END: String(bridge.port),
    UNITY_INSTANCE_REGISTRY: join(temporary, "instances.json"), UNITY_MCP_DEBUG: "0",
  });
  writeFileSync(process.env.UNITY_INSTANCE_REGISTRY, JSON.stringify([{ port: bridge.port, ...bridge.instance }]));
  const discoveryUrl = new URL("src/instance-discovery.js", root);
  const original = readFileSync(discoveryUrl, "utf8");
  report.discoverySha256 = createHash("sha256").update(original).digest("hex");
  // Read-only exports expose retention without changing selection or HTTP behavior.
  const instrumented = original.replace(/from (["'])(\.\/.+?)\1/g,
    (_, quote, specifier) => `from ${quote}${new URL(specifier, discoveryUrl).href}${quote}`)
    + "\nexport function auditState() { return { selections: _agentInstances.size, selectionRequirements: _agentSelectionRequired.size, pendingSelections: pendingSelections.size }; }\n";
  const discovery = await import("data:text/javascript;base64," + Buffer.from(instrumented).toString("base64"));
  const { runWithRequestContext } = await import(new URL("src/request-context.js", root));
  for (let batch = 0; batch < 128; batch++) {
    const results = await Promise.allSettled(Array.from({ length: 32 }, (_, index) => {
      const agentId = `audit-agent-${batch * 32 + index}`;
      return runWithRequestContext({ agentId }, async () => {
        const selected = await discovery.selectInstance(bridge.port);
        assert.equal(selected.success, true);
        assert.equal(discovery.getSelectedInstance().projectPath, "C:/RetentionAudit");
      });
    }));
    for (const result of results) if (result.status === "rejected") throw result.reason;
    if ((batch + 1) % 32 === 0) report.samples.push({ completedAgents: (batch + 1) * 32, ...discovery.auditState() });
  }
  const beforeRepeat = discovery.auditState();
  await runWithRequestContext({ agentId: "audit-agent-0" }, async () => {
    assert.equal((await discovery.selectInstance(bridge.port)).success, true);
  });
  report.reusingAnAgentDoesNotGrowMaps = JSON.stringify(beforeRepeat) === JSON.stringify(discovery.auditState());
  report.completedWorkStillRetained = discovery.auditState();

  const loggerUrl = new URL("src/state-persistence.js", root);
  const logger = readFileSync(loggerUrl, "utf8");
  report.loggerSha256 = createHash("sha256").update(logger).digest("hex");
  process.env.UNITY_MCP_DEBUG = "1";
  const { debugLog } = await import(loggerUrl.href + "?retention-audit");
  for (let index = 0; index < 96; index++) debugLog("x".repeat(65536));
  report.logging = {
    entries: 96, messageCharacters: 65536, advertisedRotationBytes: 5 * 1024 * 1024,
    files: readdirSync(temporary).filter(name => name.startsWith("mcp-debug.log"))
      .map(name => ({ name, bytes: statSync(join(temporary, name)).size })),
  };
  report.observations = {
    allCompletedAgentsStillSelected: report.completedWorkStillRetained.selections === 4096,
    allSelectionRequirementsStillRetained: report.completedWorkStillRetained.selectionRequirements === 4096,
    pendingSelectionsReleased: report.completedWorkStillRetained.pendingSelections === 0,
    debugLogExceedsAdvertisedThreshold: report.logging.files.some(file => file.bytes > report.logging.advertisedRotationBytes),
  };
  writeFileSync(resolve(output), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ samples: report.samples, logging: report.logging }));
} finally {
  await bridge.stop();
  const resolvedTemporary = resolve(temporary), expectedParent = resolve(tmpdir());
  assert.equal(dirname(resolvedTemporary), expectedParent);
  assert.ok(resolvedTemporary.startsWith(join(expectedParent, "umcp-retention-audit-")));
  rmSync(resolvedTemporary, { recursive: true, force: true });
}
