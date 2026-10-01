import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const original = childProcess.execFile;
const plan = JSON.parse(process.env.MCP_HUB_FIXTURE_PLAN);
let invocation = 0;
function execFile(file, args, options, callback) {
  if (file !== process.env.UNITY_HUB_PATH) return original(file, args, options, callback);
  fs.appendFileSync(process.env.MCP_HUB_FIXTURE_LOG, JSON.stringify({ args, options }) + "\n");
  const response = plan.responses[Math.min(invocation++, plan.responses.length - 1)];
  const executable = plan.missingExecutable ? file : process.execPath;
  return original(executable, [fileURLToPath(new URL("./hub-fixture-child.mjs", import.meta.url)), ...args], {
    ...options,
    timeout: plan.timeoutMs ?? options.timeout,
    maxBuffer: plan.maxBuffer ?? options.maxBuffer,
    env: { ...process.env, MCP_HUB_FIXTURE_RESPONSE: JSON.stringify(response) },
  }, callback);
}
execFile[promisify.custom] = (file, args, options) => new Promise((resolve, reject) => {
  execFile(file, args, options, (error, stdout, stderr) => {
    if (error) { error.stdout = stdout; error.stderr = stderr; reject(error); }
    else resolve({ stdout, stderr });
  });
});
childProcess.execFile = execFile;
syncBuiltinESMExports();
await import("../../src/index.js");
