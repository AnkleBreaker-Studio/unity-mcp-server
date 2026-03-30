// Unity Hub CLI wrapper
import { execFile } from "child_process";
import { promisify } from "util";
import { CONFIG } from "./config.js";

const execFileAsync = promisify(execFile);

/**
 * Execute a Unity Hub CLI command
 */
async function runHubCommand(args, timeoutMs = 30000) {
  const hubPath = CONFIG.unityHubPath;

  // Strategies in order: modern CLI (3.x+), legacy CLI (2.x), shell-based fallback (Windows)
  const strategies = [
    { name: "modern", args: ["--headless", ...args] },
    { name: "legacy", args: ["--", "--headless", ...args] },
  ];

  const errors = [];

  for (const strategy of strategies) {
    try {
      const { stdout, stderr } = await execFileAsync(hubPath, strategy.args, {
        timeout: timeoutMs,
        windowsHide: true,
        // Capture output even on non-zero exit codes
        maxBuffer: 10 * 1024 * 1024,
      });
      const out = (stdout || "").trim();
      const err = (stderr || "").trim();
      // Some Hub versions return data on stderr, check both
      if (out || err) {
        return { success: true, stdout: out, stderr: err };
      }
    } catch (error) {
      const msg = error.message || String(error);
      const out = (error.stdout || "").trim();
      const err = (error.stderr || "").trim();
      errors.push({ strategy: strategy.name, message: msg, stdout: out, stderr: err });
      // If Hub returned data despite non-zero exit code, it might still be usable
      if (out && !msg.includes("ENOENT")) {
        return { success: true, stdout: out, stderr: err };
      }
    }
  }

  // All strategies failed — build helpful error message
  const lastErr = errors[errors.length - 1] || {};
  const isNotFound = errors.some((e) => e.message.includes("ENOENT"));
  const hint = isNotFound
    ? ` Unity Hub not found at "${hubPath}". Set UNITY_HUB_PATH environment variable to the correct path.`
    : " Ensure Unity Hub is installed and supports CLI mode (--headless).";
  return {
    success: false,
    error: (lastErr.message || "Unknown error") + hint,
    stdout: lastErr.stdout || "",
    stderr: lastErr.stderr || "",
  };
}

/**
 * List installed Unity Editor versions
 */
// export async function listInstalledEditors() {
//   const result = await runHubCommand(["editors", "--installed"]);
//   if (!result.success) return { error: result.error, raw: result.stderr };

//   const editors = [];
//   const lines = result.stdout.split("\n").filter((l) => l.trim());
//   for (const line of lines) {
//     // Parse lines like: "2022.3.0f1 , installed at C:\Program Files\Unity\..."
//     const match = line.match(/^([\d.]+\w+)\s*,?\s*installed at\s+(.+)$/i);
//     if (match) {
//       editors.push({ version: match[1].trim(), path: match[2].trim() });
//     }
//   }
//   return { editors, raw: result.stdout };
// }

/**
 * List available Unity Editor releases
 */
// export async function listAvailableReleases() {
//   const result = await runHubCommand(["editors", "--releases"]);
//   if (!result.success) return { error: result.error };
//   return { raw: result.stdout };
// }

/**
 * Install a Unity Editor version with optional modules
 */
// export async function installEditor(version, modules = []) {
//   const args = ["install", "--version", version];
//   for (const mod of modules) {
//     args.push("--module", mod);
//   }
//   const result = await runHubCommand(args, 600000); // 10min timeout for installs
//   return result;
// }

/**
 * Install modules to an existing editor
 */
// export async function installModules(version, modules) {
//   const args = ["install-modules", "--version", version];
//   for (const mod of modules) {
//     args.push("--module", mod);
//   }
//   const result = await runHubCommand(args, 300000);
//   return result;
// }

/**
 * Get or set the editor installation path
 */
// export async function getInstallPath() {
//   const result = await runHubCommand(["install-path"]);
//   return result;
// }

// export async function setInstallPath(path) {
//   const result = await runHubCommand(["install-path", "--set", path]);
//   return result;
// }
