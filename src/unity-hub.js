// Unity Hub CLI wrapper
import { execFile } from "child_process";
import { promisify } from "util";
import { CONFIG } from "./config.js";

const execFileAsync = promisify(execFile);

async function runHubCommand(args, { timeoutMs = 30000, mutates = false } = {}) {
  const hubPath = CONFIG.unityHubPath;
  const prefix = process.platform === "linux" ? ["--headless"] : ["--", "--headless"];

  // Headless syntax depends on the OS; retrying another prefix can repeat a partially applied install.
  try {
    const { stdout, stderr } = await execFileAsync(hubPath, [...prefix, ...args], {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { success: true, stdout: (stdout || "").trim(), stderr: (stderr || "").trim() };
  } catch (error) {
    const code = typeof error.code === "string" ? error.code : null;
    const exitCode = Number.isInteger(error.code) ? error.code : null;
    const timedOut = error.killed === true && code !== "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
    const notStarted = error.syscall?.startsWith("spawn") || code === "ERR_INVALID_ARG_TYPE" || code === "ERR_OUT_OF_RANGE";
    const outcomeUnknown = mutates && !notStarted;
    let message = timedOut
      ? `Unity Hub command exceeded its ${timeoutMs} ms timeout.`
      : exitCode !== null
        ? `Unity Hub exited with code ${exitCode}.`
        : `Unity Hub command failed: ${String(error.message || error).split("\n")[0]}`;
    if (code === "ENOENT") message += ` Unity Hub not found at "${hubPath}". Set UNITY_HUB_PATH to the executable path.`;
    if (outcomeUnknown) message += " The outcome is unknown; inspect Unity Hub before retrying because changes may already have occurred.";
    return {
      success: false,
      error: message,
      stdout: (error.stdout || "").trim(),
      stderr: (error.stderr || "").trim(),
      code,
      exitCode,
      signal: error.signal || null,
      timedOut,
      outcomeUnknown,
    };
  }
}

function outputText(result) {
  // Some Hub versions put command data on stderr, including successful editor lists.
  return [result.stdout, result.stderr].filter(Boolean).join("\n");
}

/**
 * List installed Unity Editor versions
 */
export async function listInstalledEditors() {
  const result = await runHubCommand(["editors", "--installed"]);
  if (!result.success) return { ...result, raw: outputText(result) };

  const editors = [];
  const raw = outputText(result);
  const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
  const seen = new Set();
  for (const line of lines) {
    // Parse lines like: "2022.3.0f1 , installed at C:\Program Files\Unity\..."
    const match = line.match(/^([\d.]+\w+)\s*,?\s*installed at\s+(.+)$/i);
    if (match) {
      const editor = { version: match[1].trim(), path: match[2].trim() };
      const key = `${editor.version}\0${editor.path}`;
      if (!seen.has(key)) {
        seen.add(key);
        editors.push(editor);
      }
    }
  }
  return { editors, raw };
}

/**
 * List available Unity Editor releases
 */
export async function listAvailableReleases() {
  const result = await runHubCommand(["editors", "--releases"]);
  if (!result.success) return { ...result, raw: outputText(result) };
  return { raw: outputText(result) };
}

/**
 * Install a Unity Editor version with optional modules
 */
export async function installEditor(version, modules = []) {
  const args = ["install", "--version", version];
  for (const mod of modules) {
    args.push("--module", mod);
  }
  const result = await runHubCommand(args, { timeoutMs: 600000, mutates: true });
  return result;
}

/**
 * Install modules to an existing editor
 */
export async function installModules(version, modules) {
  const args = ["install-modules", "--version", version];
  for (const mod of modules) {
    args.push("--module", mod);
  }
  const result = await runHubCommand(args, { timeoutMs: 300000, mutates: true });
  return result;
}

/**
 * Get or set the editor installation path
 */
export async function getInstallPath() {
  const result = await runHubCommand(["install-path"]);
  return result;
}

export async function setInstallPath(path) {
  const result = await runHubCommand(["install-path", "--set", path], { mutates: true });
  return result;
}
