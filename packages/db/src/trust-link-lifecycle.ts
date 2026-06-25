// EP-MSP-FEDERATION · WS-0b (BI-B59A09C3 / BI-130107D6) — shared trust-link
// lifecycle. Generalizes the edge-node enrollment trust model (edge-node-types.ts)
// into one state machine that EdgeNode and FederationLink both use: token-prefix
// validation, pending→trusted→quarantined→revoked transitions, single-use
// bootstrap, and the submit/authenticate gates. The Federation Link (B1) IS the
// edge enrollment handshake generalized to deployment-to-deployment — with one
// addition the edge does not need: DUAL approval (both sovereign sides consent
// before the link is trusted).
//
// Pure functions, no DB access. edge-node-types.ts keeps its own thin wrappers
// for backward-compatible imports; a follow-up can have them delegate here.

export const TRUST_STATES = ["pending", "trusted", "quarantined", "revoked"] as const;
export type TrustState = (typeof TRUST_STATES)[number];

const TRUST_TRANSITIONS: Record<TrustState, TrustState[]> = {
  pending: ["trusted", "quarantined", "revoked"],
  trusted: ["quarantined", "revoked"],
  quarantined: ["trusted", "revoked"],
  revoked: [], // terminal — tokens invalidated, row preserved for audit
};

export function canTransitionTrust(from: TrustState, to: TrustState): boolean {
  if (from === to) return true;
  return TRUST_TRANSITIONS[from]?.includes(to) ?? false;
}

// Token namespace prefixes (mirrors the dpfmcp_/dpfedge_/dpfboot_ family).
// Federation prefixes are chosen so neither is a prefix of the other
// (dpflink_ is NOT a prefix of dpffboot_), so startsWith checks never alias.
export const TOKEN_PREFIXES = {
  edgeBootstrap: "dpfboot_",
  edgeNode: "dpfedge_",
  federationBootstrap: "dpffboot_",
  federationLink: "dpflink_",
} as const;

export function hasTokenPrefix(token: string, prefix: string): boolean {
  return token.startsWith(prefix) && token.length > prefix.length;
}

/** First `n` chars after the prefix, for visual ID only (never auth material). */
export function tokenDisplayPrefix(token: string, prefix: string, n = 8): string {
  return hasTokenPrefix(token, prefix) ? token.slice(prefix.length, prefix.length + n) : "";
}

// ── Single-use bootstrap semantics (generalized from edge-node-types) ─────────

export interface BootstrapTokenState {
  consumedAt: Date | null;
  consumedById: string | null;
  revokedAt: Date | null;
  expiresAt: Date;
}

export function isBootstrapConsumed(
  t: Pick<BootstrapTokenState, "consumedAt" | "consumedById">,
): boolean {
  return t.consumedAt !== null && t.consumedById !== null;
}

export function isBootstrapUsable(t: BootstrapTokenState, now: Date = new Date()): boolean {
  if (isBootstrapConsumed(t)) return false;
  if (t.revokedAt !== null) return false;
  if (t.expiresAt.getTime() <= now.getTime()) return false;
  return true;
}

// ── Submit / authenticate gates ──────────────────────────────────────────────

export function canSubmitUnderTrust(trustState: TrustState): boolean {
  return trustState === "trusted";
}

export interface AuthGateState {
  tokenHash: string | null;
  trustState: TrustState;
  revokedAt: Date | null;
}

export function canAuthenticateUnderTrust(s: AuthGateState): boolean {
  if (s.tokenHash === null) return false;
  if (s.trustState === "revoked") return false;
  if (s.revokedAt !== null) return false;
  return true;
}

// ── Dual approval (NEW for federation vs the edge's single-sided approval) ────
// A FederationLink between two sovereign deployments is trusted only when BOTH
// sides have approved: the customer confirms who manages them and what they
// expose; the MSP confirms whom they manage. Either side revokes unilaterally.

export function isDualApproved(
  approvedAtLocal: Date | null,
  approvedAtPeer: Date | null,
): boolean {
  return approvedAtLocal !== null && approvedAtPeer !== null;
}

export interface LinkTrustInput {
  approvedAtLocal: Date | null;
  approvedAtPeer: Date | null;
  revokedAt: Date | null;
  quarantinedAt: Date | null;
}

/** Derive the link trust state from the approval/revoke/quarantine timestamps.
 *  Revoke and quarantine win over approval; trust requires BOTH approvals. */
export function resolveLinkTrust(input: LinkTrustInput): TrustState {
  if (input.revokedAt !== null) return "revoked";
  if (input.quarantinedAt !== null) return "quarantined";
  if (isDualApproved(input.approvedAtLocal, input.approvedAtPeer)) return "trusted";
  return "pending";
}
