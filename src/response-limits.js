import { CONFIG } from "./config.js";
import { looksLikeErrorObject } from "./response-format.js";

export function responseBytes(response) {
  return Buffer.byteLength(JSON.stringify(response), "utf8");
}

function originalFailure(response) {
  for (const block of response.content) {
    if (block.type !== "text") continue;
    try {
      const parsed = JSON.parse(block.text);
      if (looksLikeErrorObject(parsed.data)) return { ...parsed, ...parsed.data };
      if (looksLikeErrorObject(parsed)) return parsed;
    } catch {
      if (/^Error[:\s]/.test(block.text)) return { error: block.text };
    }
  }
  return {};
}

function errorResponse(problem) {
  return { content: [{ type: "text", text: JSON.stringify(problem) }], isError: true };
}

function oversizedResponse(response, toolName, size) {
  const problem = {
    success: false,
    code: "response_too_large",
    error: "Response too large to return. Inspect the operation's effects before repeating a write. Request smaller results for reads.",
    tool: toolName.slice(0, 64),
    responseBytes: size,
    limitBytes: CONFIG.responseHardLimitBytes,
    originalIsError: response.isError === true,
  };
  if (response.isError) {
    const original = originalFailure(response);
    const message = typeof original.error === "string" ? original.error : original.error?.message;
    const details = {
      outcomeUnknown: original.outcomeUnknown,
      code: original.code,
      ticketId: original.ticketId,
      requestId: original.requestId,
      queueSessionId: original.queueSessionId,
      message: typeof message === "string" ? message.slice(0, 160).replace(/[\uD800-\uDBFF]$/, "") : undefined,
    };
    // Keep recovery identifiers when they fit, without allowing diagnostics to exceed the same budget.
    for (const [key, value] of Object.entries(details)) {
      if (value === undefined || value === null || typeof value === "object") continue;
      if (typeof value === "string" && value.length > 160) continue;
      const originalError = { ...problem.originalError, [key]: value };
      if (responseBytes(errorResponse({ ...problem, originalError })) <= CONFIG.responseHardLimitBytes) {
        problem.originalError = originalError;
      }
    }
  }
  return errorResponse(problem);
}

export function limitToolResponse(response, toolName) {
  const size = responseBytes(response);
  if (size > CONFIG.responseHardLimitBytes) {
    console.error(`[MCP] Tool response omitted: ${size} bytes exceeds ${CONFIG.responseHardLimitBytes} bytes`);
    return oversizedResponse(response, toolName, size);
  }
  if (size > CONFIG.responseSoftLimitBytes) {
    console.error(`[MCP] Large response warning: ${size} bytes exceeds ${CONFIG.responseSoftLimitBytes} bytes`);
    const warning = { type: "text", text: `Large response (${size} bytes). Consider smaller read results when possible.` };
    const addedBytes = responseBytes(warning) + (response.content.length ? 1 : 0);
    // Prepending preserves clients that treat the final text block as the tool's structured result.
    if (size + addedBytes <= CONFIG.responseHardLimitBytes) {
      return { ...response, content: [warning, ...response.content] };
    }
  }
  return response;
}

export function checkResourceResponse(response) {
  const size = responseBytes(response);
  if (size > CONFIG.responseHardLimitBytes) {
    throw new Error(`Resource response too large (${size} bytes; limit ${CONFIG.responseHardLimitBytes} bytes). Use smaller project-context files or categories.`);
  }
  return response;
}
