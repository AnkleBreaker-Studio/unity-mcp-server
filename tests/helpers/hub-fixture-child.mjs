import fs from "node:fs";

const response = JSON.parse(process.env.MCP_HUB_FIXTURE_RESPONSE);
if (response.echoArgs) fs.writeSync(1, JSON.stringify(process.argv.slice(2)));
if (response.stdout) fs.writeSync(1, response.stdout);
if (response.stderr) fs.writeSync(2, response.stderr);
if (response.overflow) fs.writeSync(1, "x".repeat(16384));
if (response.wait) setInterval(() => {}, 1000);
else process.exitCode = response.exitCode ?? 0;
