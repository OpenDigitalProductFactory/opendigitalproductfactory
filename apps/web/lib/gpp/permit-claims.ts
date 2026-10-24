// GPP permit claim set (spec §5.2) and its canonical form.
//
// GPP Phase 2, PR-C (docs/superpowers/plans/2026-10-01-gpp-phase-2-permits-and-enforcement.md).
// Pure. The canonical form is what PR-D signs, so it uses the one shared
// canonicaliser (`canonicalJson`, code-unit key order) and never a
// `localeCompare` sort, which is host-locale dependent.
//
// The claim set is the immutable part of a GppPermit row. State that changes
// after minting (useCount, revokedAt) and the signature itself (keyId, mac) are
// not claims.

import { canonicalJson } from "@dpf/integration-shared/canonical-json";

/** One capability a permit grants. Phase 2 grants exactly one tool per permit. */
export type PermitCapability = { tool: string; argConstraints?: Record<string, unknown> };

export type PermitAuthority = "wwmd" | "wwwd" | "wsid";

export type PermitClaims = {
  permitId: string;
  bindingId: string;
  bindingVersion: number;
  shapeRef: string | null;
  stageKey: string | null;
  gateKey: string;
  authority: PermitAuthority;
  gateDecisionId: string | null;
  authorityDecisionId: string | null;
  envelopeId: string | null;
  actorGaid: string | null;
  actorUserId: string;
  actorAgentId: string | null;
  workroomId: string | null;
  subjectScope: string | null;
  capabilities: PermitCapability[];
  paramHash: string | null;
  enforcement: "shadow" | "enforced" | "environment";
  notBefore: Date;
  expiresAt: Date;
  maxUses: number;
  nonce: string;
  parentPermitId: string | null;
};

/** Read the claims from a row-shaped value, ignoring every non-claim column. */
export function permitClaimsOf(row: PermitClaims): PermitClaims {
  return {
    permitId: row.permitId,
    bindingId: row.bindingId,
    bindingVersion: row.bindingVersion,
    shapeRef: row.shapeRef ?? null,
    stageKey: row.stageKey ?? null,
    gateKey: row.gateKey,
    authority: row.authority,
    gateDecisionId: row.gateDecisionId ?? null,
    authorityDecisionId: row.authorityDecisionId ?? null,
    envelopeId: row.envelopeId ?? null,
    actorGaid: row.actorGaid ?? null,
    actorUserId: row.actorUserId,
    actorAgentId: row.actorAgentId ?? null,
    workroomId: row.workroomId ?? null,
    subjectScope: row.subjectScope ?? null,
    capabilities: row.capabilities,
    paramHash: row.paramHash ?? null,
    enforcement: row.enforcement,
    notBefore: row.notBefore,
    expiresAt: row.expiresAt,
    maxUses: row.maxUses,
    nonce: row.nonce,
    parentPermitId: row.parentPermitId ?? null,
  };
}

/**
 * Canonical string over the claim set. Dates become ISO strings first, because
 * `canonicalJson` walks a Date's own keys and would render it as `{}`.
 */
export function canonicalPermitClaims(row: PermitClaims): string {
  const claims = permitClaimsOf(row);
  return canonicalJson({
    ...claims,
    notBefore: claims.notBefore.toISOString(),
    expiresAt: claims.expiresAt.toISOString(),
  });
}
