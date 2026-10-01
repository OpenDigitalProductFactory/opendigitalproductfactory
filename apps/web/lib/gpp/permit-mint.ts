// Mint a shadow permit when an existing gate admits an O/A/I call.
//
// GPP Phase 2, PR-C (docs/superpowers/plans/2026-10-01-gpp-phase-2-permits-and-enforcement.md).
// Scope baseline: OBJ-PERMIT (minted only at gate admit), OBJ-NODISRUPT.
//
// Fail-open by contract: any error is logged and swallowed, and the caller
// records the verdict `absent`. A permit is audit evidence in PR-C; it is never
// a precondition of the call.

import { randomBytes, randomUUID } from "node:crypto";

import { bindingRef, type GppBinding } from "./bindings";
import type { PermitClaims } from "./permit-claims";
import { gppPermitStore, type PermitRow } from "./permit-store";

/**
 * Permit lifetime. Mirrors AUTHORITY_APPROVAL_TTL_MS
 * (lib/coworker/authority-approval-envelope.ts), the lifetime of the approval a
 * human-checkpoint permit cites; permit-verdict.test.ts pins the two together.
 */
export const GPP_PERMIT_TTL_MS = 15 * 60 * 1000;

export type MintShadowPermitInput = {
  binding: GppBinding;
  toolName: string;
  actorUserId: string;
  actorAgentId?: string | null;
  workroomId?: string | null;
  gateDecisionId?: string | null;
  authorityDecisionId?: string | null;
  envelopeId?: string | null;
  now?: Date;
};

export function newPermitId(): string {
  return `GPM-${randomUUID()}`;
}

/** The claim set a gate admit mints. Pure apart from the id and nonce. */
export function shadowPermitClaims(input: MintShadowPermitInput): PermitClaims {
  const now = input.now ?? new Date();
  return {
    permitId: newPermitId(),
    bindingId: input.binding.bindingId,
    bindingVersion: input.binding.version,
    shapeRef: null,
    stageKey: null,
    gateKey: input.binding.gateKey,
    authority: input.binding.authority,
    gateDecisionId: input.gateDecisionId ?? null,
    authorityDecisionId: input.authorityDecisionId ?? null,
    envelopeId: input.envelopeId ?? null,
    actorGaid: null,
    actorUserId: input.actorUserId,
    actorAgentId: input.actorAgentId ?? null,
    workroomId: input.workroomId ?? null,
    subjectScope: null,
    capabilities: [{ tool: input.toolName }],
    paramHash: null,
    enforcement: "shadow",
    notBefore: now,
    expiresAt: new Date(now.getTime() + GPP_PERMIT_TTL_MS),
    maxUses: 1,
    nonce: randomBytes(16).toString("hex"),
    parentPermitId: null,
  };
}

/** Write the permit row. Returns null, never throws, when the write fails. */
export async function mintShadowPermit(input: MintShadowPermitInput): Promise<PermitRow | null> {
  try {
    return await gppPermitStore().createPermit(shadowPermitClaims(input));
  } catch (err) {
    console.error(
      "[gpp-permit] shadow permit mint failed binding=%s tool=%s: %s",
      JSON.stringify(bindingRef(input.binding)),
      JSON.stringify(input.toolName),
      err instanceof Error ? JSON.stringify(err.message) : JSON.stringify(String(err)),
    );
    return null;
  }
}
