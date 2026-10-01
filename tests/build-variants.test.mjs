import { test } from "node:test";
import assert from "node:assert/strict";
import { MockBridge } from "./helpers/mock-bridge.mjs";
import { McpTestClient } from "./helpers/mcp-client.mjs";

async function withPlugin(protocolVersion, check) {
  const bridge = new MockBridge({ instance: { protocolVersion } });
  bridge.on("build/start", params => ({ success: true, options: params }));
  let client;
  try {
    await bridge.start();
    client = new McpTestClient({ env: bridge.env() }).start();
    await client.initialize();
    await check(client, bridge, { target: "StandaloneWindows64", outputPath: "Builds/Test.exe", port: bridge.port });
  } finally {
    if (client) await client.close();
    await bridge.stop();
  }
}

test("older plugins cannot silently ignore an explicit managed build variant", async () => {
  await withPlugin(2, async (client, bridge, args) => {
    const unsupported = await client.callTool("unity_build", { ...args, managedCodeVariant: "Checked" });
    assert.equal(unsupported.isError, true);
    assert.match(unsupported.payloadText, /protocol 3/);
    assert.equal(bridge.seen.some(call => call.route === "build/start"), false);
    const unchanged = await client.callTool("unity_build", { ...args, developmentBuild: true });
    assert.equal(unchanged.isError, false, unchanged.payloadText);
    assert.equal(bridge.seen.find(call => call.route === "build/start").params.developmentBuild, true);
  });
});

test("protocol-3 build options keep the variant independent of Development mode", async () => {
  await withPlugin(3, async (client, bridge, args) => {
    const schema = (await client.listTools()).tools.find(tool => tool.name === "unity_build").inputSchema;
    assert.deepEqual(schema.properties.managedCodeVariant.enum, ["Release", "Instrumented", "Checked", "Debug"]);
    const built = await client.callTool("unity_build", { ...args, developmentBuild: false, managedCodeVariant: "Instrumented" });
    assert.equal(built.isError, false, built.payloadText);
    const submitted = bridge.seen.find(call => call.route === "build/start");
    assert.equal(submitted.params.managedCodeVariant, "Instrumented");
    assert.equal(submitted.params.developmentBuild, false);
  });
});
