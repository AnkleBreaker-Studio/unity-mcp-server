import { test } from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { runWithRequestContext } from "../../src/request-context.js";
import { requestSleep, shareRequestWork } from "../../src/request-cancellation.js";

test("many parallel waits retain one abort listener and release it after completion", async () => {
  const controller = new AbortController();
  await runWithRequestContext({ signal: controller.signal }, async () => {
    const pending = Array.from({ length: 40 }, () => requestSleep(5));
    assert.equal(getEventListeners(controller.signal, "abort").length, 1);
    await Promise.all(pending);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  });
});

test("aborting parallel waits releases their timers and listener", async () => {
  const controller = new AbortController();
  await runWithRequestContext({ signal: controller.signal }, async () => {
    const pending = Array.from({ length: 40 }, () => requestSleep(30_000));
    controller.abort();
    const settled = await Promise.allSettled(pending);
    assert.ok(settled.every(result => result.status === "rejected" && result.reason.name === "AbortError"));
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  });
});

test("an abandoned shared operation cannot remove its replacement from the cache", async () => {
  const cache = new Map();
  const first = new AbortController();
  let releaseFirst;
  let releaseSecond;
  const oldWork = runWithRequestContext({ signal: first.signal }, () => shareRequestWork(cache, "key", () => new Promise(resolve => { releaseFirst = resolve; })));
  oldWork.catch(() => {});
  await Promise.resolve();
  first.abort();
  await assert.rejects(oldWork, { name: "AbortError" });
  const newWork = runWithRequestContext({}, () => shareRequestWork(cache, "key", () => new Promise(resolve => { releaseSecond = resolve; })));
  await Promise.resolve();
  releaseFirst("old");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cache.size, 1);
  const joined = runWithRequestContext({}, () => shareRequestWork(cache, "key", () => { throw new Error("Replacement was lost"); }));
  releaseSecond("new");
  assert.deepEqual(await Promise.all([newWork, joined]), ["new", "new"]);
  assert.equal(cache.size, 0);
});
