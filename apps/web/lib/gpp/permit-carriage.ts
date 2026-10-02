// How an MCP client carries a permit handle on `tools/call`.
//
// GPP Phase 2, PR-C (docs/superpowers/plans/2026-10-01-gpp-phase-2-permits-and-enforcement.md).
// The key is the one settled in the MCP extension draft (BI-899C3844); it
// supersedes the spec's `io.` key. Carriage is additive: a request without it
// is handled exactly as before, and a present handle is only ever verified in
// shadow by the reference monitor.

import { isRecord } from "@/lib/shared/coerce";

export const PERMIT_HANDLE_META_KEY = "com.opendigitalproductfactory/authorization-handle";

/** The handle in `params._meta`, when it is a non-empty string; otherwise undefined. */
export function presentedPermitHandle(meta: unknown): string | undefined {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return undefined;
  const handle = (meta as Record<string, unknown>)[PERMIT_HANDLE_META_KEY];
  return typeof handle === "string" && handle.length > 0 ? handle : undefined;
}

/**
 * The MCP authorization extension's key on a tool result's `_meta`: the
 * denial envelope (`reason`, `remediation`, `remediationHints`) of a call
 * refused for want of transaction authorization. GPP Phase 2, PR-G.
 */
export const AUTHORIZATION_RESULT_META_KEY = "io.modelcontextprotocol/authorization";

/** The parts of a governed result the MCP `_meta` lift reads. Structural, so this module imports no executor types. */
export type PermitResultFacts = {
  data?: unknown;
  governance?: {
    rejected?: string;
    permit?: { handle: string; verdict: string };
    permitHandleExpiresAt?: string;
  };
};

/**
 * PR-G: what a `tools/call` result carries on `_meta` for GPP, or undefined
 * when nothing applies (every call today except a consequential call a gate
 * admitted, so other results are unchanged).
 *
 * - A `permit_required` refusal: its `data.authorization` denial envelope,
 *   under `io.modelcontextprotocol/authorization`. The same object stays in
 *   `structuredContent`; the `_meta` copy is where a client implementing the
 *   extension looks for it.
 * - A call a gate admitted (the monitor minted a permit, which happens only
 *   for an outward, authority or irreversible call): the minted handle and
 *   its expiry, under `com.opendigitalproductfactory/authorization-handle`.
 *   On a request the same key carries the handle string alone.
 *
 * The handle is a bearer artifact for exactly one call: callers put it on the
 * wire response only, never in a log line.
 */
export function permitResultMeta(result: PermitResultFacts): Record<string, unknown> | undefined {
  const meta: Record<string, unknown> = {};
  const governance = result.governance;
  if (governance?.rejected === "permit_required" && isRecord(result.data) && isRecord(result.data.authorization)) {
    meta[AUTHORIZATION_RESULT_META_KEY] = result.data.authorization;
  }
  if (governance?.permit?.handle && governance.permitHandleExpiresAt) {
    meta[PERMIT_HANDLE_META_KEY] = { handle: governance.permit.handle, expiresAt: governance.permitHandleExpiresAt };
  }
  return Object.keys(meta).length > 0 ? meta : undefined;
}
