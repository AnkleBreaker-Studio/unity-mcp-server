import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { McpTestClient } from "./helpers/mcp-client.mjs";

const project = process.env.UNITY_MCP_RESPONSE_PROJECT;
const canonical = path => realpathSync(path).replaceAll("\\", "/").toLowerCase();

test("live Unity responses preserve small results and bound Unicode and image output", {
  skip: !project && "set UNITY_MCP_RESPONSE_PROJECT to an open marked validation project",
  timeout: 120_000,
}, async () => {
  assert.ok(isAbsolute(project));
  assert.ok(existsSync(join(project, ".unity-mcp-validation")));
  const normal = new McpTestClient({ timeoutMs: 30_000 }).start();
  const limited = new McpTestClient({ timeoutMs: 30_000, env: { UNITY_RESPONSE_HARD_LIMIT: "4096", UNITY_RESPONSE_SOFT_LIMIT: "1024" } }).start();
  const report = { nodeVersion: process.version, project, passed: false };
  const bytes = response => Buffer.byteLength(JSON.stringify(response), "utf8");
  const payload = response => JSON.parse(response.content.filter(block => block.type === "text").at(-1).text);
  let port;
  const raw = (client, name, args = {}) => client.request("tools/call", { name, arguments: { port, ...args } });
  try {
    await normal.initialize();
    await limited.initialize();
    const list = await normal.callTool("unity_list_instances", { refresh: true });
    assert.equal(list.isError, false);
    const instance = list.payload.instances.find(item => canonical(item.projectPath) === canonical(project));
    assert.ok(instance);
    port = instance.port;
    for (const client of [normal, limited]) {
      const selected = await client.callTool("unity_select_instance", { port });
      assert.equal(selected.isError, false, selected.payloadText);
      assert.equal(canonical(selected.payload.instance.projectPath), canonical(project));
    }
    const before = await raw(normal, "unity_editor_state");
    assert.notEqual(before.isError, true);
    const state = payload(before).data;
    assert.equal(state.isCompiling, false);
    assert.equal(state.isPlaying, false);
    report.unityVersion = instance.unityVersion;
    report.port = port;

    const soft = await raw(limited, "unity_execute_code", { code: "return new string('x', 1400);" });
    assert.notEqual(soft.isError, true);
    assert.equal(payload(soft).data.result.length, 1400);
    assert.match(soft.content[0].text, /large response/i);
    assert.ok(bytes(soft) <= 4096);
    report.softLimit = { bytes: bytes(soft), resultLength: 1400, warningBeforeResult: true };

    const large = await raw(limited, "unity_execute_code", { code: "return new string('\\u754c', 3000);" });
    assert.equal(large.isError, true);
    const omitted = payload(large);
    assert.equal(omitted.code, "response_too_large");
    assert.ok(omitted.responseBytes > 4096);
    assert.ok(bytes(large) <= 4096);
    report.unicodeLimit = { bytes: bytes(large), originalBytes: omitted.responseBytes, code: omitted.code };

    const image = await raw(normal, "unity_advanced_tool", { tool: "unity_graphics_scene_capture", params: { width: 64, height: 64 } });
    assert.notEqual(image.isError, true, JSON.stringify(image));
    const block = image.content.find(item => item.type === "image");
    assert.ok(block?.data.length > 0, JSON.stringify(image.content.map(item => ({ type: item.type, text: item.text?.slice(0, 1000) }))));
    assert.equal(block.mimeType, "image/png");
    report.image = { mimeType: block.mimeType, base64Length: block.data.length, resultBytes: bytes(image) };

    const missing = await raw(normal, "unity_advanced_tool", { tool: "unity_graphics_asset_preview", params: { assetPath: `Assets/__McpValidation/Missing${randomUUID()}.asset` } });
    assert.equal(missing.isError, true);
    report.missingImageIsError = true;
    const after = await raw(normal, "unity_editor_state");
    assert.notEqual(after.isError, true);
    assert.equal(payload(after).data.isPlaying, false);
    assert.equal(payload(after).data.isCompiling, false);
    assert.deepEqual(normal.stdoutViolations, []);
    assert.deepEqual(limited.stdoutViolations, []);
    report.passed = true;
  } finally {
    await limited.close();
    await normal.close();
    writeFileSync(join(project, "Library", "UnityMcpResponseLimits.json"), JSON.stringify(report, null, 2) + "\n");
  }
});
