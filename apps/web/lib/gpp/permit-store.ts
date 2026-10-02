// Persistence seam for GPP permits and permit observations.
//
// GPP Phase 2, PR-C. The only module that touches the GppPermit and
// GppPermitObservation tables, and (PR-D) the only place the permit code reads
// the decision ledger to check a permit's lineage. Callers (permit-mint.ts, permit-verdict.ts)
// treat every method as fallible and swallow its errors: a permit write is
// audit evidence, never a precondition of the call (plan Constraint 1, R3).

import { prisma, type GppObservationPath, type GppPermitEnforcement, type GppPermitVerdict, type Prisma } from "@dpf/db";

import type { PermitClaims } from "./permit-claims";
import type { PermitSignature } from "./permit-handle";

/** A GppPermit row as the verdict needs it. `keyId`/`mac` are null when minted unsigned. */
export type PermitRow = PermitClaims & {
  id: string;
  useCount: number;
  revokedAt: Date | null;
  keyId: string | null;
  mac: string | null;
};

/**
 * Where a permit's lineage is recorded. The alignment gate writes a
 * DecisionInteraction (hash-chained when sealed); a human checkpoint writes an
 * AuthorizationDecisionLog row, which is not chained.
 */
export type PermitLineageRef =
  | { kind: "decision-interaction"; interactionId: string }
  | { kind: "authorization-decision"; decisionId: string };

/** `sealed` is true only for a DecisionInteraction carrying chainEntryHash and sealedAt. */
export type PermitLineage = { found: false } | { found: true; sealed: boolean };

export type PermitObservationCreate = {
  permitRowId: string | null;
  bindingId: string | null;
  toolName: string;
  verdict: GppPermitVerdict;
  path: GppObservationPath;
  toolExecutionId: string | null;
  callerSite: string | null;
  detail: Record<string, unknown>;
  /**
   * PR-E: set only when an enforced binding covers the call — `enforced` when
   * it was enforced, `shadow` when enforcement was downgraded for this call.
   * Omitted otherwise, and the column keeps its `shadow` default.
   */
  enforcement?: GppPermitEnforcement;
};

export type GppPermitStore = {
  createPermit: (claims: PermitClaims, signature: PermitSignature | null) => Promise<PermitRow>;
  findPermitByPermitId: (permitId: string) => Promise<PermitRow | null>;
  /**
   * Take one use, atomically: a single conditional update guarded by
   * `useCount < maxUses`. Resolves true only for the presentation that took the
   * use; false when the permit was already spent, including by a concurrent
   * presentation that read the same row (PR-G). The verdict treats false as
   * `exhausted`, so exactly one concurrent presentation of a single-use
   * handle is `valid`.
   */
  consumePermit: (row: Pick<PermitRow, "id" | "maxUses">) => Promise<boolean>;
  createObservation: (data: PermitObservationCreate) => Promise<void>;
  findLineage: (ref: PermitLineageRef) => Promise<PermitLineage>;
};

// Column names differ from the spec's claim names where the FK Index Coverage
// guard requires it: an identifier that is deliberately NOT a foreign key is a
// `*Ref`/`*Key` column (lineage must be able to go missing and be recorded as
// such, and audit evidence must outlive its referent). This is the one place
// the two vocabularies meet.
const PERMIT_SELECT = {
  id: true, gppPermitId: true, bindingKey: true, bindingVersion: true, shapeRef: true, stageKey: true,
  gateKey: true, authority: true, gateDecisionRef: true, authorityDecisionRef: true, envelopeId: true,
  actorGaid: true, actorUserRef: true, actorAgentRef: true, workroomRef: true, subjectScope: true,
  capabilities: true, paramHash: true, enforcement: true, notBefore: true, expiresAt: true,
  maxUses: true, useCount: true, nonce: true, parentPermitId: true, revokedAt: true, keyRef: true, mac: true,
} as const;

type PermitDbRow = {
  id: string; gppPermitId: string; bindingKey: string; bindingVersion: number; shapeRef: string | null;
  stageKey: string | null; gateKey: string; authority: PermitClaims["authority"]; gateDecisionRef: string | null;
  authorityDecisionRef: string | null; envelopeId: string | null; actorGaid: string | null; actorUserRef: string;
  actorAgentRef: string | null; workroomRef: string | null; subjectScope: string | null; capabilities: unknown;
  paramHash: string | null; enforcement: PermitClaims["enforcement"]; notBefore: Date; expiresAt: Date;
  maxUses: number; useCount: number; nonce: string; parentPermitId: string | null; revokedAt: Date | null;
  keyRef: string | null; mac: string | null;
};

function toPermitRow(row: PermitDbRow): PermitRow {
  return {
    id: row.id,
    permitId: row.gppPermitId,
    bindingId: row.bindingKey,
    bindingVersion: row.bindingVersion,
    shapeRef: row.shapeRef,
    stageKey: row.stageKey,
    gateKey: row.gateKey,
    authority: row.authority,
    gateDecisionId: row.gateDecisionRef,
    authorityDecisionId: row.authorityDecisionRef,
    envelopeId: row.envelopeId,
    actorGaid: row.actorGaid,
    actorUserId: row.actorUserRef,
    actorAgentId: row.actorAgentRef,
    workroomId: row.workroomRef,
    subjectScope: row.subjectScope,
    capabilities: Array.isArray(row.capabilities) ? (row.capabilities as PermitRow["capabilities"]) : [],
    paramHash: row.paramHash,
    enforcement: row.enforcement,
    notBefore: row.notBefore,
    expiresAt: row.expiresAt,
    maxUses: row.maxUses,
    useCount: row.useCount,
    nonce: row.nonce,
    parentPermitId: row.parentPermitId,
    revokedAt: row.revokedAt,
    keyId: row.keyRef,
    mac: row.mac,
  };
}

const prismaStore: GppPermitStore = {
  async createPermit(claims, signature) {
    const created = await prisma.gppPermit.create({
      data: {
        gppPermitId: claims.permitId,
        bindingKey: claims.bindingId,
        bindingVersion: claims.bindingVersion,
        shapeRef: claims.shapeRef,
        stageKey: claims.stageKey,
        gateKey: claims.gateKey,
        authority: claims.authority,
        gateDecisionRef: claims.gateDecisionId,
        authorityDecisionRef: claims.authorityDecisionId,
        envelopeId: claims.envelopeId,
        actorGaid: claims.actorGaid,
        actorUserRef: claims.actorUserId,
        actorAgentRef: claims.actorAgentId,
        workroomRef: claims.workroomId,
        subjectScope: claims.subjectScope,
        capabilities: claims.capabilities as unknown as Prisma.InputJsonValue,
        paramHash: claims.paramHash,
        enforcement: claims.enforcement,
        notBefore: claims.notBefore,
        expiresAt: claims.expiresAt,
        maxUses: claims.maxUses,
        nonce: claims.nonce,
        parentPermitId: claims.parentPermitId,
        keyRef: signature?.keyId ?? null,
        mac: signature?.mac ?? null,
      },
      select: PERMIT_SELECT,
    });
    return toPermitRow(created);
  },
  async findPermitByPermitId(permitId) {
    const row = await prisma.gppPermit.findUnique({ where: { gppPermitId: permitId }, select: PERMIT_SELECT });
    return row ? toPermitRow(row) : null;
  },
  async consumePermit(row) {
    // One UPDATE ... WHERE "useCount" < maxUses. Under PostgreSQL's row lock a
    // second concurrent update re-evaluates the guard against the committed
    // row, so at most `maxUses` updates ever match; `count` says whether this
    // one did. `maxUses` is fixed at mint, so the caller's copy is current.
    const { count } = await prisma.gppPermit.updateMany({
      where: { id: row.id, useCount: { lt: row.maxUses } },
      data: { useCount: { increment: 1 } },
    });
    return count === 1;
  },
  async createObservation(data) {
    const { bindingId, detail, ...rest } = data;
    await prisma.gppPermitObservation.create({
      data: { ...rest, bindingKey: bindingId, detail: detail as Prisma.InputJsonValue },
      select: { id: true },
    });
  },
  async findLineage(ref) {
    if (ref.kind === "decision-interaction") {
      const decision = await prisma.decisionInteraction.findUnique({
        where: { interactionId: ref.interactionId },
        select: { chainEntryHash: true, sealedAt: true },
      });
      return decision ? { found: true, sealed: Boolean(decision.chainEntryHash && decision.sealedAt) } : { found: false };
    }
    const decision = await prisma.authorizationDecisionLog.findUnique({
      where: { decisionId: ref.decisionId },
      select: { id: true },
    });
    return decision ? { found: true, sealed: false } : { found: false };
  },
};

let storeOverride: GppPermitStore | null = null;

/** Test seam, wired through `_setGovernanceForTests` in mcp-governed-execute.ts. */
export function setGppPermitStoreOverrideForTests(override: GppPermitStore | null): void {
  storeOverride = override;
}

export function gppPermitStore(): GppPermitStore {
  return storeOverride ?? prismaStore;
}
