import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpTestClient } from "./helpers/mcp-client.mjs";

async function exercise(plan, tool, args, check) {
  const root = await fs.mkdtemp(join(tmpdir(), "umcp-hub-"));
  const log = join(root, "calls.jsonl");
  const client = new McpTestClient({
    serverEntry: fileURLToPath(new URL("./helpers/hub-fixture-server.mjs", import.meta.url)),
    env: {
      UNITY_HUB_PATH: join(root, "fixture-hub"),
      MCP_HUB_FIXTURE_LOG: log,
      MCP_HUB_FIXTURE_PLAN: JSON.stringify(plan),
    },
  }).start();
  try {
    await client.initialize();
    const result = await client.callTool(tool, args);
    const calls = (await fs.readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line));
    assert.deepEqual(client.stdoutViolations, []);
    await check(result, calls);
  } finally {
    await client.close();
    assert.equal(dirname(root), resolve(tmpdir()));
    assert.ok(basename(root).startsWith("umcp-hub-"));
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("Hub nonzero exit remains an MCP error even with progress on stdout", async () => {
  await exercise({ responses: [{ stdout: "Downloading editor\n", stderr: "Download failed\n", exitCode: 7 }] },
    "unity_hub_install_editor", { version: "6000.6.2f1" }, (result, calls) => {
      assert.equal(result.isError, true);
      assert.equal(result.payload.success, false);
      assert.equal(result.payload.exitCode, 7);
      assert.match(result.payload.stdout, /Downloading/);
      assert.match(result.payload.stderr, /Download failed/);
      assert.equal(calls.length, 1);
    });
});

test("Hub failed module installation is never retried with another CLI prefix", async () => {
  await exercise({ responses: [{ stderr: "Module installation failed\n", exitCode: 2 }] },
    "unity_hub_install_modules", { version: "6000.6.2f1", modules: ["webgl"] }, (result, calls) => {
      assert.equal(calls.length, 1);
      assert.equal(result.isError, true);
      assert.equal(result.payload.outcomeUnknown, true);
    });
});

test("Hub silent successful writes execute once and remain successful", async () => {
  await exercise({ responses: [{}] }, "unity_hub_set_install_path", { path: "C:/Unity Test/Editors" }, (result, calls) => {
    assert.equal(calls.length, 1);
    assert.equal(result.isError, false);
    assert.equal(result.payload.success, true);
    assert.equal(result.payload.stdout, "");
    assert.equal(result.payload.stderr, "");
  });
});

test("Hub timeout after progress reports an unknown outcome without replay", async () => {
  await exercise({ timeoutMs: 1500, responses: [{ stdout: "Installing\n", wait: true }] },
    "unity_hub_install_editor", { version: "6000.6.2f1" }, (result, calls) => {
      assert.equal(result.isError, true);
      assert.equal(result.payload.timedOut, true);
      assert.equal(result.payload.outcomeUnknown, true);
      assert.match(result.payload.error, /before retrying/i);
      assert.equal(calls.length, 1);
    });
});

test("Hub silent timeout does not start a second installation", async () => {
  await exercise({ timeoutMs: 1500, responses: [{ wait: true }] },
    "unity_hub_install_modules", { version: "6000.6.2f1", modules: ["android"] }, (result, calls) => {
      assert.equal(calls.length, 1);
      assert.equal(result.isError, true);
      assert.equal(result.payload.timedOut, true);
    });
});

test("Hub output buffer failure is not a successful or timed-out install", async () => {
  await exercise({ maxBuffer: 4096, responses: [{ overflow: true }] },
    "unity_hub_install_editor", { version: "6000.6.2f1" }, (result, calls) => {
      assert.equal(result.isError, true);
      assert.equal(result.payload.code, "ERR_CHILD_PROCESS_STDIO_MAXBUFFER");
      assert.equal(result.payload.timedOut, false);
      assert.equal(result.payload.outcomeUnknown, true);
      assert.equal(calls.length, 1);
    });
});

test("Hub installed-editor data on stderr is parsed and returned", async () => {
  const data = "6000.6.2f1 , installed at C:/Unity Editors/6000.6.2f1\n2021.3.18f1, installed at D:/Old Unity\n";
  await exercise({ responses: [{ stderr: data }] }, "unity_hub_list_editors", {}, (result, calls) => {
    assert.equal(result.isError, false);
    assert.deepEqual(result.payload.editors, [
      { version: "6000.6.2f1", path: "C:/Unity Editors/6000.6.2f1" },
      { version: "2021.3.18f1", path: "D:/Old Unity" },
    ]);
    assert.match(result.payload.raw, /6000.6.2f1/);
    assert.equal(calls.length, 1);
  });
});

test("Hub available releases on stderr are preserved", async () => {
  await exercise({ responses: [{ stderr: "6000.6.2f1 release available\n" }] }, "unity_hub_available_releases", {}, result => {
    assert.equal(result.isError, false);
    assert.match(result.payload.raw, /6000.6.2f1/);
  });
});

test("Hub list failure preserves process diagnostics without returning an empty success", async () => {
  await exercise({ responses: [{ stdout: "Scanning installs\n", stderr: "Access denied\n", exitCode: 4 }] },
    "unity_hub_list_editors", {}, (result, calls) => {
      assert.equal(result.isError, true);
      assert.equal(result.payload.success, false);
      assert.equal(result.payload.exitCode, 4);
      assert.match(result.payload.stdout, /Scanning/);
      assert.match(result.payload.raw, /Access denied/);
      assert.equal(calls.length, 1);
    });
});

test("Hub missing executable is reported once with path guidance", async () => {
  await exercise({ missingExecutable: true, responses: [{}] }, "unity_hub_install_editor", { version: "6000.6.2f1" }, (result, calls) => {
    assert.equal(calls.length, 1);
    assert.equal(result.isError, true);
    assert.equal(result.payload.code, "ENOENT");
    assert.equal(result.payload.outcomeUnknown, false);
    assert.match(result.payload.error, /UNITY_HUB_PATH/);
  });
});

test("Hub arguments remain separate and use the documented platform prefix", async () => {
  const location = 'C:/Unity spaces/$(literal)&quoted"path';
  await exercise({ responses: [{ echoArgs: true }] }, "unity_hub_set_install_path", { path: location }, (result, calls) => {
    assert.equal(result.isError, false);
    assert.equal(calls.length, 1);
    const prefix = process.platform === "linux" ? ["--headless"] : ["--", "--headless"];
    assert.deepEqual(calls[0].args, [...prefix, "install-path", "--set", location]);
    assert.deepEqual(JSON.parse(result.payload.stdout), calls[0].args);
    assert.equal(calls[0].options.windowsHide, true);
    assert.notEqual(calls[0].options.shell, true);
  });
});

test("Hub successful calls preserve public result fields and original timeouts", async () => {
  const list = "6000.6.2f1 installed at /Unity/6000.6.2f1";
  const cases = [
    ["unity_hub_list_editors", {}, list, { editors: [{ version: "6000.6.2f1", path: "/Unity/6000.6.2f1" }], raw: list }, 30000],
    ["unity_hub_available_releases", {}, "Available versions", { raw: "Available versions" }, 30000],
    ["unity_hub_get_install_path", {}, "/Unity", { success: true, stdout: "/Unity", stderr: "" }, 30000],
    ["unity_hub_set_install_path", { path: "/Unity" }, "Saved", { success: true, stdout: "Saved", stderr: "" }, 30000],
    ["unity_hub_install_editor", { version: "6000.6.2f1", modules: ["android", "webgl"] }, "Installed", { success: true, stdout: "Installed", stderr: "" }, 600000],
    ["unity_hub_install_modules", { version: "6000.6.2f1", modules: ["webgl"] }, "Installed", { success: true, stdout: "Installed", stderr: "" }, 300000],
  ];
  for (const [name, args, stdout, expected, timeout] of cases) {
    await exercise({ responses: [{ stdout }] }, name, args, (result, calls) => {
      assert.equal(result.isError, false, name);
      assert.deepEqual(result.payload, expected, name);
      assert.equal(calls.length, 1, name);
      assert.equal(calls[0].options.timeout, timeout, name);
      assert.equal(calls[0].options.maxBuffer, 10 * 1024 * 1024, name);
      if (name === "unity_hub_install_editor") assert.deepEqual(calls[0].args.slice(-4), ["--module", "android", "--module", "webgl"]);
    });
  }
});

test("Hub ordinary stderr warnings do not override a successful exit", async () => {
  await exercise({ responses: [{ stdout: "/Unity\n", stderr: "Update check unavailable\n" }] },
    "unity_hub_get_install_path", {}, result => {
      assert.equal(result.isError, false);
      assert.deepEqual(result.payload, { success: true, stdout: "/Unity", stderr: "Update check unavailable" });
    });
});

test("Hub duplicate editor lines across streams do not duplicate installs", async () => {
  const first = "6000.6.2f1 installed at /Unity/One";
  const second = "6000.6.2f1 installed at /Unity/Two";
  await exercise({ responses: [{ stdout: first + "\n", stderr: "  " + first + "\n" + second + "\n" }] },
    "unity_hub_list_editors", {}, result => {
      assert.equal(result.isError, false);
      assert.deepEqual(result.payload.editors, [
        { version: "6000.6.2f1", path: "/Unity/One" },
        { version: "6000.6.2f1", path: "/Unity/Two" },
      ]);
      assert.match(result.payload.raw, /Unity\/Two/);
    });
});

test("Hub empty successful lists are not retried", async () => {
  for (const name of ["unity_hub_list_editors", "unity_hub_available_releases"]) {
    await exercise({ responses: [{}] }, name, {}, (result, calls) => {
      assert.equal(result.isError, false);
      assert.equal(result.payload.raw, "");
      assert.equal(calls.length, 1);
    });
  }
});
