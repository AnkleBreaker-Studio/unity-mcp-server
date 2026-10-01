import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { getEventListeners } from "node:events";
import { execFileSync } from "node:child_process";
import { gzipSync, deflateSync, brotliCompressSync } from "node:zlib";
import { CONFIG } from "../../src/config.js";
import { requestFetch } from "../../src/request-cancellation.js";
import { runWithRequestContext } from "../../src/request-context.js";

CONFIG.httpResponseLimitBytes = 1024;

async function serve(handler, check) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try { await check(`http://127.0.0.1:${server.address().port}`); }
  finally {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  }
}

const overflow = error => {
  assert.equal(error.code, "http_response_too_large");
  assert.equal(error.limitBytes, 1024);
  assert.ok(error.receivedBytes > 1024);
  assert.match(error.message, /1024/);
  return true;
};

test("HTTP body exactly at the byte limit preserves split UTF-8, BOM and replacement decoding", async () => {
  const body = Buffer.concat([Buffer.from("\ufeff\u754c\u{1f680}"), Buffer.from([0xff]), Buffer.alloc(1013, 120)]);
  assert.equal(body.length, 1024);
  const expected = await new Response(body).text();
  await serve((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    let position = 0;
    const timer = setInterval(() => {
      const end = position < 12 ? position + 1 : body.length;
      res.write(body.subarray(position, end));
      position = end;
      if (position === body.length) { clearInterval(timer); res.end(); }
    }, 2);
    res.on("close", () => clearInterval(timer));
  }, async url => assert.deepEqual(await requestFetch(url, {}, 2000), { ok: true, status: 200, text: expected }));
});

for (const status of [200, 500]) {
  test(`HTTP ${status} body exceeding the limit by one byte is rejected`, async () => {
    await serve((req, res) => { res.writeHead(status); res.end("x".repeat(1025)); },
      url => assert.rejects(requestFetch(url, {}, 2000), overflow));
  });
}

for (const [encoding, compress] of [["gzip", gzipSync], ["deflate", deflateSync], ["br", brotliCompressSync]]) {
  test(`HTTP limit counts decompressed ${encoding} bytes, not Content-Length`, async () => {
    const body = compress(Buffer.alloc(8192, 120));
    assert.ok(body.length < 1024);
    await serve((req, res) => {
      res.writeHead(200, { "Content-Encoding": encoding, "Content-Length": body.length });
      res.end(body);
    }, url => assert.rejects(requestFetch(url, {}, 2000), overflow));
  });
}

test("an oversized unfinished HTTP stream closes before its deadline and releases the request listener", async () => {
  let closed;
  const close = new Promise(resolve => { closed = resolve; });
  const controller = new AbortController();
  await serve((req, res) => {
    res.writeHead(200);
    res.write("x".repeat(1025));
    res.on("close", closed);
  }, async url => {
    await runWithRequestContext({ signal: controller.signal }, () => assert.rejects(requestFetch(url, {}, 1500), overflow));
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    await Promise.race([close, new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error("Oversized stream remained open")), 500);
      timer.unref();
    })]);
  });
});

test("empty responses and HTTP status flags keep their existing shape", async () => {
  await serve((req, res) => { res.writeHead(req.url === "/empty" ? 204 : 404); res.end(); }, async url => {
    assert.deepEqual(await requestFetch(`${url}/empty`, {}, 2000), { ok: true, status: 204, text: "" });
    assert.deepEqual(await requestFetch(url, {}, 2000), { ok: false, status: 404, text: "" });
  });
});

for (const mode of ["cancel", "deadline"]) {
  test(`HTTP ${mode} still interrupts a stalled body below the limit`, async () => {
    const controller = new AbortController();
    await serve((req, res) => {
      res.writeHead(200);
      res.write("partial");
      if (mode === "cancel") setImmediate(() => controller.abort());
    }, async url => {
      await runWithRequestContext({ signal: controller.signal }, () => assert.rejects(requestFetch(url, {}, 100), /abort|timed out/i));
      assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    });
  });
}

test("HTTP response limit configuration accepts byte integers and rejects invalid values", () => {
  const configUrl = new URL("../../src/config.js", import.meta.url).href;
  for (const [setting, expected] of [[undefined, 33554432], [" 2048 ", 2048], ["1024", 1024], ["0", 33554432], ["1023", 33554432], ["12.5", 33554432], ["Infinity", 33554432], ["9007199254740992", 33554432], ["invalid", 33554432]]) {
    const env = { ...process.env };
    delete env.UNITY_HTTP_RESPONSE_LIMIT;
    if (setting !== undefined) env.UNITY_HTTP_RESPONSE_LIMIT = setting;
    const output = execFileSync(process.execPath, ["--input-type=module", "-e", `import { CONFIG } from ${JSON.stringify(configUrl)}; console.log(CONFIG.httpResponseLimitBytes);`], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    assert.equal(Number(output.trim()), expected, String(setting));
  }
});
