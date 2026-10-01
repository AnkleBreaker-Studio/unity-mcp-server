import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, realpathSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { isAbsolute, join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { McpTestClient } from "./helpers/mcp-client.mjs";

const project = process.env.UNITY_MCP_PACKAGE_PROJECT;
const serial = process.env.UNITY_MCP_PACKAGE_SERIAL === "1";
const canonical = path => realpathSync(path).replaceAll("\\", "/").toLowerCase();
const payload = response => JSON.parse(response.content.filter(block => block.type === "text").at(-1).text);

test("live Package Manager preserves payloads and package lifecycle", {
  skip: !project && "set UNITY_MCP_PACKAGE_PROJECT to an open marked validation project",
  timeout: 180_000,
}, async () => {
  assert.ok(isAbsolute(project));
  assert.ok(existsSync(join(project, ".unity-mcp-validation")));
  const client = new McpTestClient({ timeoutMs: 90_000, serverEntry: process.env.UNITY_MCP_PACKAGE_SERVER_ENTRY }).start();
  const runId = randomUUID().replaceAll("-", "");
  const name = `com.anklebreaker.mcp-validation-${runId}`;
  const fixture = mkdtempSync(join(dirname(project), "package-fixture-"));
  const manifest = () => JSON.parse(readFileSync(join(project, "Packages", "manifest.json"), "utf8").replace(/^\uFEFF/, ""));
  const beforeManifest = manifest();
  const report = { nodeVersion: process.version, serverEntry: client.serverEntry, concurrentReads: !serial, project, passed: false, checks: [] };
  let port, added = false;
  const raw = (tool, args = {}, agent = "primary") => client.request("tools/call", {
    name: tool, arguments: { port, ...args }, _meta: { agentId: `packages-${runId}-${agent}` },
  });
  const call = async (tool, args, agent) => {
    const response = await raw(tool, args, agent);
    assert.notEqual(response.isError, true, JSON.stringify(response));
    return payload(response).data;
  };
  try {
    writeFileSync(join(fixture, "package.json"), JSON.stringify({ name, version: "1.0.0", displayName: "MCP Package Validation", unity: "2021.3" }, null, 2));
    writeFileSync(join(fixture, "fixture.txt"), "Disposable package lifecycle validation.\n");
    await client.initialize();
    const discovery = await client.callTool("unity_list_instances", { refresh: true });
    const instance = discovery.payload.instances.find(item => item.projectPath && canonical(item.projectPath) === canonical(project));
    assert.ok(instance, "The validation editor must already be open");
    port = instance.port;
    const selection = await client.callTool("unity_select_instance", { port });
    assert.equal(canonical(selection.payload.instance.projectPath), canonical(project));
    const state = await call("unity_editor_state");
    assert.equal(state.isCompiling, false);
    assert.equal(state.isPlaying, false);
    assert.equal(state.sceneDirty, false);
    report.unityVersion = instance.unityVersion;
    const installed = await call("unity_packages_list");
    assert.equal(installed.count, installed.packages.length);
    assert.ok(installed.packages.some(pkg => pkg.name === "com.anklebreaker.unity-mcp"));
    const readers = [
      () => call("unity_packages_info", { name: "com.anklebreaker.unity-mcp" }, "info"),
      () => call("unity_packages_list", {}, "list"),
    ];
    const [info, parallelList] = serial
      ? [await readers[0](), await readers[1]()]
      : await Promise.all(readers.map(read => read()));
    assert.equal(info.name, "com.anklebreaker.unity-mcp");
    assert.ok(Array.isArray(info.dependencies) && Array.isArray(info.compatibleVersions));
    assert.equal(parallelList.count, installed.count);
    report.checks.push(serial ? "Sequential list/info payloads" : "List/info payloads and overlapping agents");

    const search = await call("unity_packages_search", { query: "com.unity.cinemachine" });
    assert.equal(search.query, "com.unity.cinemachine");
    assert.equal(search.count, search.results.length);
    assert.ok(search.results.some(pkg => pkg.name === search.query));
    report.checks.push("Registry search payload and package name");

    const missing = await raw("unity_packages_info", { name });
    assert.equal(missing.isError, true);
    assert.match(payload(missing).data.error, /not found/);
    const invalid = await raw("unity_packages_add", { identifier: "" });
    assert.equal(invalid.isError, true);
    assert.match(payload(invalid).data.error, /required/);
    report.checks.push("Missing package and invalid input remain tool errors");

    const add = await call("unity_packages_add", { identifier: `file:${fixture.replaceAll("\\", "/")}` });
    added = true;
    assert.deepEqual(add, { success: true, name, displayName: "MCP Package Validation", version: "1.0.0" });
    const fixtureInfo = await call("unity_packages_info", { name });
    assert.equal(fixtureInfo.name, name);
    assert.equal(fixtureInfo.source, "Local");
    const remove = await call("unity_packages_remove", { name });
    added = false;
    assert.deepEqual(remove, { success: true, removed: name });
    assert.deepEqual(manifest(), beforeManifest);
    report.checks.push("Local package add/info/remove and restored manifest");

    const finalState = await call("unity_editor_state");
    assert.equal(finalState.isCompiling, false);
    assert.equal(finalState.isPlaying, false);
    assert.equal(finalState.sceneDirty, false);
    const compilation = await call("unity_get_compilation_errors", { severity: "error" });
    assert.equal(compilation.isCompiling, false);
    assert.equal(compilation.count, 0);
    assert.deepEqual(client.stdoutViolations, []);
    report.checks.push("Clean editor and MCP stdout after package changes");
    report.passed = true;
  } finally {
    try {
      if (port && (added || manifest().dependencies?.[name])) await call("unity_packages_remove", { name });
      assert.deepEqual(manifest(), beforeManifest, "Validation package dependencies were not restored");
    } catch (error) {
      report.passed = false;
      throw error;
    } finally {
      await client.close();
      if (!manifest().dependencies?.[name]) rmSync(fixture, { recursive: true, force: true });
      writeFileSync(join(project, "Library", "UnityMcpPackages.json"), JSON.stringify(report, null, 2) + "\n");
    }
  }
});
