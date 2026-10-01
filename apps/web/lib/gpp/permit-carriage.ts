// How an MCP client carries a permit handle on `tools/call`.
//
// GPP Phase 2, PR-C (docs/superpowers/plans/2026-10-01-gpp-phase-2-permits-and-enforcement.md).
// The key is the one settled in the MCP extension draft (BI-899C3844); it
// supersedes the spec's `io.` key. Carriage is additive: a request without it
// is handled exactly as before, and a present handle is only ever verified in
// shadow by the reference monitor.

export const PERMIT_HANDLE_META_KEY = "com.opendigitalproductfactory/authorization-handle";

/** The handle in `params._meta`, when it is a non-empty string; otherwise undefined. */
export function presentedPermitHandle(meta: unknown): string | undefined {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return undefined;
  const handle = (meta as Record<string, unknown>)[PERMIT_HANDLE_META_KEY];
  return typeof handle === "string" && handle.length > 0 ? handle : undefined;
}
