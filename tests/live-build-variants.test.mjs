import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { McpTestClient } from "./helpers/mcp-client.mjs";

const projectArgument = process.env.UNITY_MCP_BUILD_PROJECT;
const canonicalPath = path => realpathSync(path).replaceAll("\\", "/").toLowerCase();

test("Unity 6.6 build variants and project-setting restoration", {
  skip: !projectArgument && "set UNITY_MCP_BUILD_PROJECT to an open disposable validation project",
  timeout: 900_000,
}, async () => {
  const projectPath = resolve(projectArgument);
  assert.ok(existsSync(join(projectPath, ".unity-mcp-validation")), "refusing a project without its validation marker");
  const client = new McpTestClient({ env: { UNITY_QUEUE_POLL_TIMEOUT: "600000" }, timeoutMs: 650_000 }).start();
  const evidence = { unityVersion: null, nodeVersion: process.version, project: basename(projectPath), builds: [] };
  let port;
  let originalVariant;

  async function call(name, args = {}) {
    const response = await client.callTool(name, { port, ...args });
    assert.equal(response.isError, false, response.payloadText);
    assert.equal(response.payload.success, true, response.payloadText);
    return response.payload.data;
  }

  async function code(source) {
    const data = await call("unity_execute_code", { code: source });
    assert.equal(data.success, true, JSON.stringify(data));
    return data.result;
  }

  async function select() {
    const selected = await client.callTool("unity_select_instance", { projectName: basename(projectPath) });
    assert.equal(selected.isError, false, selected.payloadText);
    const instance = selected.payload.instance;
    assert.equal(canonicalPath(instance.projectPath), canonicalPath(projectPath), "selected a different project");
    assert.ok(instance.protocolVersion >= 3, "build variants require plugin protocol 3");
    port = instance.port;
    evidence.unityVersion = instance.unityVersion;
  }

  async function waitForCompilation() {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      try {
        await select();
        const compilation = await call("unity_get_compilation_errors", { severity: "error" });
        if (compilation.isCompiling === false) {
          assert.equal(compilation.count, 0, JSON.stringify(compilation));
          return;
        }
      } catch (error) {
        if (!/connect|instance|fetch|session|404/i.test(error.message)) throw error;
      }
      await delay(1000);
    }
    assert.fail("Unity did not finish compiling within 120 seconds");
  }

  async function inspectAssembly(relativePath) {
    return code(`
      var cecil = System.AppDomain.CurrentDomain.GetAssemblies().First(a => a.GetName().Name == "Unity.Cecil");
      var type = cecil.GetType("Mono.Cecil.AssemblyDefinition");
      var read = type.GetMethods().First(m => m.Name == "ReadAssembly" && m.GetParameters().Length == 1 && m.GetParameters()[0].ParameterType == typeof(string));
      var definition = read.Invoke(null, new object[] { ${JSON.stringify(relativePath)} });
      try {
        var module = type.GetProperty("MainModule").GetValue(definition);
        var types = ((System.Collections.IEnumerable)module.GetType().GetProperty("Types").GetValue(module)).Cast<object>();
        var probe = types.First(t => t.GetType().GetProperty("FullName").GetValue(t).ToString() == "UnityMcpValidationFixtures.VariantProbe");
        var fields = ((System.Collections.IEnumerable)probe.GetType().GetProperty("Fields").GetValue(probe)).Cast<object>();
        return fields.ToDictionary(f => f.GetType().GetProperty("Name").GetValue(f).ToString(), f => f.GetType().GetProperty("Constant").GetValue(f));
      } finally { ((System.IDisposable)definition).Dispose(); }
    `);
  }

  try {
    await client.initialize();
    await select();
    await waitForCompilation();
    const state = await call("unity_editor_state");
    assert.equal(state.isPlaying, false, "exit Play Mode before this build test");
    const version = evidence.unityVersion.split(".").map(Number);
    assert.ok(version[0] > 6000 || (version[0] === 6000 && version[1] >= 6), "requires Unity 6.6 or newer");
    const setup = await code(`
      if (UnityEngine.SceneManagement.SceneManager.GetActiveScene().isDirty) throw new System.Exception("Save the validation scene first");
      return new { variant = UnityEditor.PlayerSettings.GetManagedCodeVariant(UnityEditor.Build.NamedBuildTarget.Standalone).ToString(),
        backend = UnityEditor.PlayerSettings.GetScriptingBackend(UnityEditor.Build.NamedBuildTarget.Standalone).ToString() };
    `);
    assert.equal(setup.backend, "Mono2x", "this assembly inspection fixture requires the Mono backend");
    originalVariant = setup.variant;
    evidence.setup = setup;
    const fixturePath = join(projectPath, "Assets", "__McpValidation");
    mkdirSync(join(fixturePath, "Editor"), { recursive: true });
    copyFileSync(new URL("./fixtures/VariantProbe.cs", import.meta.url), join(fixturePath, "McpVariantProbe.cs"));
    copyFileSync(new URL("./fixtures/BuildVariantFailure.cs", import.meta.url), join(fixturePath, "Editor", "BuildVariantFailure.cs"));
    await call("unity_execute_menu_item", { menuPath: "Assets/Refresh" });
    await delay(1500);
    await waitForCompilation();
    await code(`
      var scene = UnityEditor.SceneManagement.EditorSceneManager.NewScene(UnityEditor.SceneManagement.NewSceneSetup.EmptyScene, UnityEditor.SceneManagement.NewSceneMode.Single);
      UnityEditor.SceneManagement.EditorSceneManager.SaveScene(scene, "Assets/__McpValidation/BuildScene.unity");
      UnityEditor.PlayerSettings.SetManagedCodeVariant(UnityEditor.Build.NamedBuildTarget.Standalone, UnityEditor.ManagedCodeVariant.Instrumented);
      UnityEditor.SessionState.SetBool("UnityMcpValidation.FailBuild", false);
      return true;
    `);
    const cases = [
      { developmentBuild: true, expectedVariant: "Checked", checks: true, instrumentation: true },
      { developmentBuild: false, expectedVariant: "Release", checks: false, instrumentation: false },
      { developmentBuild: false, managedCodeVariant: "Instrumented", expectedVariant: "Instrumented", checks: false, instrumentation: true },
      { developmentBuild: false, managedCodeVariant: "Debug", expectedVariant: "Debug", checks: true, instrumentation: true },
      { developmentBuild: true, managedCodeVariant: "Release", expectedVariant: "Release", checks: false, instrumentation: false },
    ];
    for (const entry of cases) {
      const role = entry.developmentBuild ? "Dev" : "Dist";
      const options = { target: "StandaloneWindows64", outputPath: join(projectPath, "Builds", role, "Validation.exe").replaceAll("\\", "/"),
        scenes: ["Assets/__McpValidation/BuildScene.unity"], developmentBuild: entry.developmentBuild };
      if (entry.managedCodeVariant) options.managedCodeVariant = entry.managedCodeVariant;
      console.error(`[build] Development=${entry.developmentBuild}, variant=${entry.managedCodeVariant ?? "default"}`);
      const build = await call("unity_build", options);
      const record = { options, build };
      evidence.builds.push(record);
      assert.equal(build.success, true, JSON.stringify(build));
      assert.equal(build.managedCodeVariant, entry.expectedVariant);
      assert.equal(build.developmentBuild, entry.developmentBuild);
      await waitForCompilation();
      record.compiledConstants = await inspectAssembly(`Builds/${role}/Validation_Data/Managed/Assembly-CSharp.dll`);
      record.restoredVariant = await code("return UnityEditor.PlayerSettings.GetManagedCodeVariant(UnityEditor.Build.NamedBuildTarget.Standalone).ToString();");
      assert.equal(record.compiledConstants.Checks, entry.checks);
      assert.equal(record.compiledConstants.Instrumentation, entry.instrumentation);
      assert.equal(record.restoredVariant, "Instrumented");
    }
    await code('UnityEditor.SessionState.SetBool("UnityMcpValidation.FailBuild", true); return true;');
    const failure = await client.callTool("unity_build", { port, target: "StandaloneWindows64", developmentBuild: true,
      outputPath: join(projectPath, "Builds", "Dev", "Validation.exe").replaceAll("\\", "/"), scenes: ["Assets/__McpValidation/BuildScene.unity"] });
    evidence.failure = failure.payload;
    assert.ok(failure.payload.data?.success === false || /Intentional MCP validation/.test(failure.payloadText), failure.payloadText);
    evidence.failureRestoration = await code(`return new {
      attempted = UnityEditor.SessionState.GetString("UnityMcpValidation.FailedBuildVariant", ""),
      restored = UnityEditor.PlayerSettings.GetManagedCodeVariant(UnityEditor.Build.NamedBuildTarget.Standalone).ToString() };`);
    assert.deepEqual(evidence.failureRestoration, { attempted: "Checked", restored: "Instrumented" });
    assert.deepEqual(client.stdoutViolations, []);
    evidence.passed = true;
  } catch (error) {
    evidence.error = error.message;
    throw error;
  } finally {
    try {
      if (originalVariant) {
        await select();
        evidence.finalVariant = await code(`
          UnityEditor.SessionState.SetBool("UnityMcpValidation.FailBuild", false);
          UnityEditor.PlayerSettings.SetManagedCodeVariant(UnityEditor.Build.NamedBuildTarget.Standalone, UnityEditor.ManagedCodeVariant.${originalVariant});
          return UnityEditor.PlayerSettings.GetManagedCodeVariant(UnityEditor.Build.NamedBuildTarget.Standalone).ToString();
        `);
        assert.equal(evidence.finalVariant, originalVariant);
      }
    } finally {
      writeFileSync(join(projectPath, "Library", "UnityMcpBuildVariants.json"), JSON.stringify(evidence, null, 2) + "\n");
      await client.close();
    }
  }
});
