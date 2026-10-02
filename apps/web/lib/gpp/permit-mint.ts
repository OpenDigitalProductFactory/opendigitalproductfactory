// Mint a shadow permit when an existing gate admits an O/A/I call.
//
// GPP Phase 2, PR-C (docs/superpowers/plans/2026-10-01-gpp-phase-2-permits-and-enforcement.md).
// Scope baseline: OBJ-PERMIT (minted only at gate admit), OBJ-NODISRUPT.
//
// Fail-open by contract: any error is logged and swallowed, and the caller
// records the verdict `absent`. A permit is audit evidence in PR-C; it is never
// a precondition of the call.
//
// PR-D: the claims bind the exact call's `paramHash`, and the row is signed
// (permit-handle.ts). With no key configured the row is minted unsigned and
// the handle is the bare permit id; that is recorded as `unsigned`, not raised.

import { randomBytes, randomUUID } from "node:crypto";

import { bindingRef, type GppBinding } from "./bindings";
import { computeParamHash } from "./param-hash";
import type { PermitClaims } from "./permit-claims";
import { formatPermitHandle, signPermit } from "./permit-handle";
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
  /** The admitted call's arguments; bound into the claims as `paramHash`. */
  params?: Record<string, unknown>;
  now?: Date;
};

export type MintedPermit = {
  row: PermitRow;
  /** `gpp1.<permitId>.<keyId>.<mac>` when signed; the bare permit id when the install has no key. */
  handle: string;
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
    paramHash: input.params ? computeParamHash(input.toolName, input.params) : null,
    enforcement: "shadow",
    notBefore: now,
    expiresAt: new Date(now.getTime() + GPP_PERMIT_TTL_MS),
    maxUses: 1,
    nonce: randomBytes(16).toString("hex"),
    parentPermitId: null,
  };
}

/** Sign and write the permit row. Returns null, never throws, when anything fails. */
export async function mintShadowPermit(input: MintShadowPermitInput): Promise<MintedPermit | null> {
  try {
    const claims = shadowPermitClaims(input);
    const signature = signPermit(claims);
    const row = await gppPermitStore().createPermit(claims, signature);
    const handle = signature
      ? formatPermitHandle({ permitId: row.permitId, keyId: signature.keyId, mac: signature.mac })
      : row.permitId;
    return { row, handle };
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
