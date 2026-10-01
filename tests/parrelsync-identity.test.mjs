import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { MockBridge } from "./helpers/mock-bridge.mjs";
import { McpTestClient } from "./helpers/mcp-client.mjs";

for (const index of [0, 7, -1, undefined]) test(`ParrelSync discovery retains clone identity and displays a valid label (${index})`, async () => {
  const bridge = new MockBridge({ instance: { isClone: true, cloneIndex: index, mainProjectPath: "C:/Mock/Main" } });
  await bridge.start();
  const env = bridge.env(), client = new McpTestClient({ env }).start();
  try {
    await client.initialize();
    const response = await client.callTool("unity_editor_state", {});
    assert.equal(response.isError, false);
    const banner = response.blocks.filter(x => x.type === "text").map(x => x.text).join("\n");
    assert.match(banner, index >= 0 ? new RegExp(`ParrelSync clone #${index}`) : /ParrelSync clone\)/);
    assert.doesNotMatch(banner, /clone #-1|clone #undefined/);
    const instances = (await client.callTool("unity_list_instances", { refresh: true })).payload.instances;
    assert.equal(instances.length, 1); assert.equal(instances[0].isClone, true);
    assert.equal(instances[0].cloneIndex, index ?? -1); assert.equal(instances[0].mainProjectPath, "C:/Mock/Main");
    assert.deepEqual(client.stdoutViolations, []);
  } finally {
    await client.close(); await bridge.stop();
    const directory = resolve(dirname(env.UNITY_INSTANCE_REGISTRY));
    assert.equal(dirname(directory), resolve(tmpdir())); assert.ok(directory.startsWith(join(resolve(tmpdir()), "umcp-test-")));
    rmSync(directory, { recursive: true, force: true });
  }
});
