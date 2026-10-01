// Persistence seam for GPP permits and permit observations.
//
// GPP Phase 2, PR-C. The only module that touches the GppPermit and
// GppPermitObservation tables. Callers (permit-mint.ts, permit-verdict.ts)
// treat every method as fallible and swallow its errors: a permit write is
// audit evidence, never a precondition of the call (plan Constraint 1, R3).

import { prisma, type GppObservationPath, type GppPermitVerdict, type Prisma } from "@dpf/db";

import type { PermitClaims } from "./permit-claims";

/** A GppPermit row as the verdict needs it. */
export type PermitRow = PermitClaims & {
  id: string;
  useCount: number;
  revokedAt: Date | null;
};

export type PermitObservationCreate = {
  permitRowId: string | null;
  bindingId: string | null;
  toolName: string;
  verdict: GppPermitVerdict;
  path: GppObservationPath;
  toolExecutionId: string | null;
  callerSite: string | null;
  detail: Record<string, unknown>;
};

export type GppPermitStore = {
  createPermit: (claims: PermitClaims) => Promise<PermitRow>;
  findPermitByPermitId: (permitId: string) => Promise<PermitRow | null>;
  /** Count one use, compare-and-set on `useCount < maxUses`. */
  consumePermit: (row: Pick<PermitRow, "id" | "maxUses">) => Promise<void>;
  createObservation: (data: PermitObservationCreate) => Promise<void>;
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
  maxUses: true, useCount: true, nonce: true, parentPermitId: true, revokedAt: true,
} as const;

type PermitDbRow = {
  id: string; gppPermitId: string; bindingKey: string; bindingVersion: number; shapeRef: string | null;
  stageKey: string | null; gateKey: string; authority: PermitClaims["authority"]; gateDecisionRef: string | null;
  authorityDecisionRef: string | null; envelopeId: string | null; actorGaid: string | null; actorUserRef: string;
  actorAgentRef: string | null; workroomRef: string | null; subjectScope: string | null; capabilities: unknown;
  paramHash: string | null; enforcement: PermitClaims["enforcement"]; notBefore: Date; expiresAt: Date;
  maxUses: number; useCount: number; nonce: string; parentPermitId: string | null; revokedAt: Date | null;
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
  };
}

const prismaStore: GppPermitStore = {
  async createPermit(claims) {
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
    await prisma.gppPermit.updateMany({
      where: { id: row.id, useCount: { lt: row.maxUses } },
      data: { useCount: { increment: 1 } },
    });
  },
  async createObservation(data) {
    const { bindingId, detail, ...rest } = data;
    await prisma.gppPermitObservation.create({
      data: { ...rest, bindingKey: bindingId, detail: detail as Prisma.InputJsonValue },
      select: { id: true },
    });
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
