const originalFetch = globalThis.fetch;
globalThis.fetch = (url, options) => {
  const parsed = new URL(url);
  if (/\/api\/queue\/status(?:-scoped)?$/.test(parsed.pathname)) {
    // Observe the real transport without changing requests or their responses.
    console.error(`[CancellationValidation] ${JSON.stringify({ ticketId: parsed.searchParams.get("ticketId") })}`);
  }
  return originalFetch(url, options);
};
await import("../../src/index.js");
