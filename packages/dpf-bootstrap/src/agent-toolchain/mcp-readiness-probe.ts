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

/**
 * Scope-coverage reconciliation (BI-A3DE9A31).
 *
 * Tokens minted before the `write -> development` template fix carry a narrow
 * legacy scope set MISSING `registry_read` (and the other development reads),
 * so registry-gated tools like `principle_decide` (WWMD) refuse. The bootstrap
 * must treat "token present" as distinct from "token sufficient": probe a
 * registry_read-gated, read-only, no-arg tool and re-mint when it reports a
 * scope failure.
 *
 * This is the SSOT for the probe tool name + the failure markers; the shell
 * adapters (dpf-bootstrap-agent-toolchain.{sh,ps1}) mirror the marker strings.
 */
export const SCOPE_COVERAGE_PROBE = {
  /** Read-only, no-arg, registry_read-gated tool — the cheapest scope probe. */
  tool: "get_my_coworker_profile",
  /** The dev-template scope a legacy "write" token is missing. */
  requiredScope: "registry_read",
  /** Substring the DPF MCP emits when a token lacks a required scope. */
  scopeFailureMarker: "lacks the required scope",
} as const;

export type ScopeCoverageResult =
  | { sufficient: true }
  | { sufficient: false; missingScope: string }
  | { sufficient: null; reason: "unreachable" | "inconclusive" };

/**
 * Interpret the `tools/call` response for {@link SCOPE_COVERAGE_PROBE.tool}.
 *
 * The DPF MCP returns a scope failure as HTTP 200 with `result.isError === true`
 * and a content text like "Token lacks the required scope for X. Required: one
 * of registry_read; …" — NOT as 401/403. So this keys on the tool-call result.
 *
 * - `sufficient: true`  — the call succeeded; the token carries the gated scope.
 * - `sufficient: false` — explicit scope failure naming `requiredScope`.
 * - `sufficient: null`  — unreachable / ambiguous. **Callers MUST NOT re-mint**
 *   on null; only an unambiguous `false` justifies replacing a present token.
 */
export function interpretScopeCoverageProbe(
  httpStatus: number,
  body: unknown,
  requiredScope: string = SCOPE_COVERAGE_PROBE.requiredScope,
): ScopeCoverageResult {
  if (httpStatus === 0 || httpStatus >= 500) {
    return { sufficient: null, reason: "unreachable" };
  }
  if (httpStatus !== 200) {
    return { sufficient: null, reason: "inconclusive" };
  }
  const result = extractToolCallResult(body);
  if (!result) return { sufficient: null, reason: "inconclusive" };

  if (result.isError && typeof result.text === "string") {
    const t = result.text;
    if (t.includes(SCOPE_COVERAGE_PROBE.scopeFailureMarker) && t.includes(requiredScope)) {
      return { sufficient: false, missingScope: requiredScope };
    }
    // An error for some other reason — don't assume under-provisioned.
    return { sufficient: null, reason: "inconclusive" };
  }

  // 200 + a non-error tool result => the registry_read-gated call ran.
  if (result.isError === false || result.isError === undefined) {
    return { sufficient: true };
  }
  return { sufficient: null, reason: "inconclusive" };
}

function extractToolCallResult(
  body: unknown,
): { isError?: boolean; text?: string } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const result = b.result as
    | { isError?: boolean; content?: Array<{ text?: unknown }> }
    | undefined;
  if (!result || typeof result !== "object") return null;
  const first = Array.isArray(result.content) ? result.content[0] : undefined;
  const text = first && typeof first.text === "string" ? first.text : undefined;
  return { isError: result.isError, text };
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
