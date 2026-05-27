/**
 * Plan + interpret the read-only MCP `tools/list` probe used by the bootstrap
 * to prove the DPF MCP endpoint is reachable and the contributor's token is
 * scoped for at least the read surface.
 *
 * Pure functions only. Shell adapters do the HTTP call; the bearer token never
 * appears in any plan or result object. `redactBearer: true` is a compile-time
 * reminder for the adapter.
 */

import type { McpReadinessProbeResult } from "./types";

export type McpReadinessProbePlan = {
  endpoint: string;
  method: "tools/list";
  expectsResponseShape: "non-empty-tools-array";
  redactBearer: true;
};

export function planMcpReadinessProbe(
  endpoint: string,
  hasToken: boolean,
): McpReadinessProbePlan | { skipReason: "no_token" } {
  if (!hasToken) {
    return { skipReason: "no_token" };
  }
  return {
    endpoint,
    method: "tools/list",
    expectsResponseShape: "non-empty-tools-array",
    redactBearer: true,
  };
}

/**
 * Interpret an HTTP response from `/api/mcp/v1` `tools/list` into the
 * structured `McpReadinessProbeResult` persisted in install state.
 *
 * - HTTP 200 with `result.tools` array of length >= 1 -> ok=true.
 * - HTTP 200 but shape unrecognized -> ok=false reason=unexpected_shape.
 * - HTTP 401/403 with `insufficient_token_scope` in body -> scope_insufficient.
 * - HTTP 401/403 otherwise -> no_token.
 * - HTTP 5xx or 0 (no response) -> endpoint_unreachable.
 */
export function interpretMcpReadinessResponse(
  httpStatus: number,
  body: unknown,
  observedAt: string,
): McpReadinessProbeResult {
  if (httpStatus === 0) {
    return { ok: false, reason: "endpoint_unreachable", httpStatus: null };
  }

  if (httpStatus >= 500) {
    return { ok: false, reason: "endpoint_unreachable", httpStatus };
  }

  if (httpStatus === 401 || httpStatus === 403) {
    if (looksLikeInsufficientScope(body)) {
      return { ok: false, reason: "scope_insufficient", httpStatus };
    }
    return { ok: false, reason: "no_token", httpStatus };
  }

  if (httpStatus === 200) {
    const tools = extractToolsArray(body);
    if (tools && tools.length > 0) {
      return { ok: true, toolCount: tools.length, observedAt };
    }
    return { ok: false, reason: "unexpected_shape", httpStatus };
  }

  return { ok: false, reason: "unexpected_shape", httpStatus };
}

function looksLikeInsufficientScope(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  const error = b.error as { message?: string } | undefined;
  if (error && typeof error.message === "string" && error.message.includes("insufficient_token_scope")) {
    return true;
  }
  const structured = b.structuredContent as { error?: string } | undefined;
  if (structured && structured.error === "insufficient_token_scope") {
    return true;
  }
  return false;
}

function extractToolsArray(body: unknown): unknown[] | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const result = b.result as { tools?: unknown[] } | undefined;
  if (result && Array.isArray(result.tools)) return result.tools;
  return null;
}
