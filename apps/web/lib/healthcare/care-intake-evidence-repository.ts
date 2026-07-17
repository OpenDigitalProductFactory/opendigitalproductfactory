import { createHash } from "node:crypto";

import { prisma } from "@dpf/db";

import {
  recordCareIntakeStaffDecision,
  setCareIntakeStaffContext,
} from "./care-intake-staff-context";

const FUNDING_TYPES = new Set([
  "commercial", "public-entitlement", "private", "supplemental", "self-pay", "other",
]);
const SHA256 = /^[a-f0-9]{64}$/i;

type PacketRow = { id: string; packetId: string; patientProfileId: string };
type CoverageRow = {
  id?: string; evidenceId: string; organizationId?: string; packetId?: string;
  patientProfileId?: string; status: string; evidenceRef?: string; evidenceDigest?: string;
};
type AttestationRow = {
  id?: string; attestationId: string; organizationId?: string; packetId?: string;
  patientProfileId?: string; status: string; documentRef?: string; documentDigest?: string;
  signatureEvidenceRef?: string; signatureDigest?: string;
};

type Transaction = {
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
  careIntakePacket: { findFirst(args: unknown): Promise<PacketRow | null> };
  patientConsentDirective: { findFirst(args: unknown): Promise<{ id: string; directiveId: string } | null> };
  careIntakeResponse: { findFirst(args: unknown): Promise<{ id: string } | null> };
  careCoverageEvidence: {
    upsert(args: unknown): Promise<CoverageRow>;
    findFirst(args: unknown): Promise<CoverageRow | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  careConsentAttestation: {
    upsert(args: unknown): Promise<AttestationRow>;
    findFirst(args: unknown): Promise<AttestationRow | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  authorizationDecisionLog: { create(args: unknown): Promise<unknown> };
};

export type CareIntakeEvidenceDatabase = {
  $transaction<T>(callback: (tx: Transaction) => Promise<T>): Promise<T>;
};

type BaseInput = {
  organizationId: string;
  packetId: string;
  actorPrincipalId: string;
};

function stableEvidenceId(prefix: string, input: BaseInput & { idempotencyKey: string }) {
  if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 128) {
    throw new Error("Invalid evidence idempotency key");
  }
  const digest = createHash("sha256")
    .update(`${input.organizationId}\0${input.packetId}\0${input.idempotencyKey}`)
    .digest("hex")
    .slice(0, 32);
  return `${prefix}-${digest}`;
}

function assertDigest(value: string, label: string) {
  if (!SHA256.test(value)) throw new Error(`Invalid ${label} digest`);
}

function assertReference(value: string, label: string) {
  if (!value.trim() || value.length > 1000) throw new Error(`Invalid ${label} reference`);
}

function assertOptionalText(value: string | null | undefined, label: string, max = 500) {
  if (value != null && (!value.trim() || value.length > max)) throw new Error(`Invalid ${label}`);
}

async function packetForStaff(tx: Transaction, input: BaseInput) {
  await setCareIntakeStaffContext(tx, input);
  const packet = await tx.careIntakePacket.findFirst({
    where: { packetId: input.packetId, organizationId: input.organizationId },
    select: { id: true, packetId: true, patientProfileId: true },
  });
  if (!packet) throw new Error("Care intake packet not found");
  await setCareIntakeStaffContext(tx, { ...input, patientProfileId: packet.patientProfileId });
  return packet;
}

export type StageCoverageEvidenceInput = BaseInput & {
  idempotencyKey: string;
  fundingType: string;
  payerOrProgramName?: string | null;
  memberIdentifierLast4?: string | null;
  responsiblePartyPrincipalId?: string | null;
  evidenceRef: string;
  evidenceDigest: string;
  effectiveFrom?: Date | null;
  effectiveUntil?: Date | null;
  sourceSystem?: string | null;
  sourceId?: string | null;
  sourceVersion?: string | null;
};

export async function stageCareCoverageEvidence(
  input: StageCoverageEvidenceInput,
  database: CareIntakeEvidenceDatabase = prisma as unknown as CareIntakeEvidenceDatabase,
) {
  if (!FUNDING_TYPES.has(input.fundingType)) throw new Error("Invalid funding type");
  assertReference(input.evidenceRef, "coverage evidence");
  assertDigest(input.evidenceDigest, "coverage evidence");
  assertOptionalText(input.payerOrProgramName, "payer or program name", 200);
  if (input.memberIdentifierLast4 && !/^[a-z0-9]{1,4}$/i.test(input.memberIdentifierLast4)) {
    throw new Error("Invalid member identifier suffix");
  }
  if (input.effectiveFrom && input.effectiveUntil && input.effectiveUntil < input.effectiveFrom) {
    throw new Error("Invalid coverage effective window");
  }
  const evidenceId = stableEvidenceId("coverage-evidence", input);
  return database.$transaction(async (tx) => {
    const packet = await packetForStaff(tx, input);
    const create = {
      evidenceId,
      organizationId: input.organizationId,
      packetId: packet.id,
      patientProfileId: packet.patientProfileId,
      status: "pending-review",
      fundingType: input.fundingType,
      payerOrProgramName: input.payerOrProgramName?.trim() || null,
      memberIdentifierLast4: input.memberIdentifierLast4?.toUpperCase() || null,
      responsiblePartyPrincipalId: input.responsiblePartyPrincipalId || null,
      evidenceRef: input.evidenceRef.trim(),
      evidenceDigest: input.evidenceDigest.toLowerCase(),
      effectiveFrom: input.effectiveFrom || null,
      effectiveUntil: input.effectiveUntil || null,
      sourceSystem: input.sourceSystem?.trim() || null,
      sourceId: input.sourceId?.trim() || null,
      sourceVersion: input.sourceVersion?.trim() || null,
    };
    const row = await tx.careCoverageEvidence.upsert({
      where: { evidenceId }, update: {}, create,
    });
    if (
      row.evidenceRef !== create.evidenceRef
      || row.evidenceDigest !== create.evidenceDigest
      || (row.packetId && row.packetId !== create.packetId)
    ) {
      throw new Error("evidence-idempotency-conflict");
    }
    await recordCareIntakeStaffDecision(tx, {
      organizationId: input.organizationId,
      actorPrincipalId: input.actorPrincipalId,
      actionKey: "healthcare.intake.coverage-evidence.stage",
      objectRef: `care-coverage-evidence:${evidenceId}`,
      routeContext: "/api/v1/healthcare/intake/:packetId/coverage-evidence",
      rationale: { packetId: input.packetId, fundingType: input.fundingType, status: row.status },
    });
    return { evidenceId, status: row.status, canonicalCoverageCreated: false as const };
  });
}

export type StageConsentAttestationInput = BaseInput & {
  idempotencyKey: string;
  patientConsentDirectiveId: string;
  responseId?: string | null;
  documentRef: string;
  documentDigest: string;
  documentVersion: string;
  signatureEvidenceRef: string;
  signatureDigest: string;
  signatureMethod: string;
  signerPrincipalId: string;
  witnessPrincipalId?: string | null;
  attestedAt: Date;
};

export async function stageCareConsentAttestation(
  input: StageConsentAttestationInput,
  database: CareIntakeEvidenceDatabase = prisma as unknown as CareIntakeEvidenceDatabase,
) {
  assertReference(input.documentRef, "consent document");
  assertReference(input.signatureEvidenceRef, "signature evidence");
  assertDigest(input.documentDigest, "consent document");
  assertDigest(input.signatureDigest, "signature evidence");
  assertOptionalText(input.documentVersion, "document version", 100);
  assertOptionalText(input.signatureMethod, "signature method", 100);
  if (!input.signerPrincipalId) throw new Error("Signer principal required");
  if (Number.isNaN(input.attestedAt.getTime())) throw new Error("Invalid attestation time");
  const attestationId = stableEvidenceId("consent-attestation", input);
  return database.$transaction(async (tx) => {
    const packet = await packetForStaff(tx, input);
    const directive = await tx.patientConsentDirective.findFirst({
      where: {
        directiveId: input.patientConsentDirectiveId,
        organizationId: input.organizationId,
        patientProfileId: packet.patientProfileId,
      },
      select: { id: true, directiveId: true },
    });
    if (!directive) throw new Error("Patient consent directive not found");
    let responseId: string | null = null;
    if (input.responseId) {
      const response = await tx.careIntakeResponse.findFirst({
        where: {
          responseId: input.responseId,
          packetId: packet.id,
          organizationId: input.organizationId,
          patientProfileId: packet.patientProfileId,
        },
        select: { id: true },
      });
      if (!response) throw new Error("Care intake response not found");
      responseId = response.id;
    }
    const create = {
      attestationId,
      organizationId: input.organizationId,
      packetId: packet.id,
      patientProfileId: packet.patientProfileId,
      responseId,
      patientConsentDirectiveId: directive.id,
      status: "pending-review",
      documentRef: input.documentRef.trim(),
      documentDigest: input.documentDigest.toLowerCase(),
      documentVersion: input.documentVersion.trim(),
      signatureEvidenceRef: input.signatureEvidenceRef.trim(),
      signatureDigest: input.signatureDigest.toLowerCase(),
      signatureMethod: input.signatureMethod.trim(),
      signerPrincipalId: input.signerPrincipalId,
      witnessPrincipalId: input.witnessPrincipalId || null,
      attestedAt: input.attestedAt,
    };
    const row = await tx.careConsentAttestation.upsert({
      where: { attestationId }, update: {}, create,
    });
    if (
      row.documentRef !== create.documentRef
      || row.documentDigest !== create.documentDigest
      || row.signatureEvidenceRef !== create.signatureEvidenceRef
      || row.signatureDigest !== create.signatureDigest
      || (row.packetId && row.packetId !== create.packetId)
    ) {
      throw new Error("evidence-idempotency-conflict");
    }
    await recordCareIntakeStaffDecision(tx, {
      organizationId: input.organizationId,
      actorPrincipalId: input.actorPrincipalId,
      actionKey: "healthcare.intake.consent-attestation.stage",
      objectRef: `care-consent-attestation:${attestationId}`,
      routeContext: "/api/v1/healthcare/intake/:packetId/consent-attestations",
      rationale: { packetId: input.packetId, directiveId: input.patientConsentDirectiveId, status: row.status },
    });
    return { attestationId, status: row.status, consentDirectiveChanged: false as const };
  });
}

type EvidenceDecisionInput = BaseInput & {
  decision: "accepted" | "rejected";
  reason?: string | null;
};

function rejectionReason(input: EvidenceDecisionInput) {
  if (input.decision === "accepted") {
    if (input.reason) throw new Error("Acceptance must not include a rejection reason");
    return null;
  }
  const reason = input.reason?.trim();
  if (!reason || reason.length > 500) throw new Error("Rejection reason required");
  return reason;
}

export async function decideCareCoverageEvidence(
  input: EvidenceDecisionInput & { evidenceId: string },
  database: CareIntakeEvidenceDatabase = prisma as unknown as CareIntakeEvidenceDatabase,
) {
  const reason = rejectionReason(input);
  return database.$transaction(async (tx) => {
    const packet = await packetForStaff(tx, input);
    const evidence = await tx.careCoverageEvidence.findFirst({
      where: { evidenceId: input.evidenceId, packetId: packet.id, organizationId: input.organizationId },
      select: { id: true, evidenceId: true, status: true },
    });
    if (!evidence) throw new Error("Coverage evidence not found");
    if (evidence.status !== "pending-review") throw new Error("evidence-already-reviewed");
    const data = input.decision === "accepted"
      ? { status: "accepted", verifiedAt: new Date(), verifiedByPrincipalId: input.actorPrincipalId, rejectionReason: null }
      : { status: "rejected", verifiedAt: null, verifiedByPrincipalId: null, rejectionReason: reason };
    const updated = await tx.careCoverageEvidence.updateMany({
      where: { id: evidence.id, status: "pending-review" }, data,
    });
    if (updated.count !== 1) throw new Error("stale-evidence-review");
    await recordCareIntakeStaffDecision(tx, {
      organizationId: input.organizationId,
      actorPrincipalId: input.actorPrincipalId,
      actionKey: `healthcare.intake.coverage-evidence.${input.decision}`,
      objectRef: `care-coverage-evidence:${input.evidenceId}`,
      routeContext: "/api/v1/healthcare/intake/:packetId/coverage-evidence/:evidenceId/decision",
      rationale: { packetId: input.packetId, decision: input.decision, reason },
    });
    return { evidenceId: input.evidenceId, status: input.decision, canonicalCoverageCreated: false as const };
  });
}

export async function decideCareConsentAttestation(
  input: EvidenceDecisionInput & { attestationId: string },
  database: CareIntakeEvidenceDatabase = prisma as unknown as CareIntakeEvidenceDatabase,
) {
  const reason = rejectionReason(input);
  return database.$transaction(async (tx) => {
    const packet = await packetForStaff(tx, input);
    const attestation = await tx.careConsentAttestation.findFirst({
      where: { attestationId: input.attestationId, packetId: packet.id, organizationId: input.organizationId },
      select: { id: true, attestationId: true, status: true },
    });
    if (!attestation) throw new Error("Consent attestation not found");
    if (attestation.status !== "pending-review") throw new Error("evidence-already-reviewed");
    const data = input.decision === "accepted"
      ? { status: "accepted", acceptedAt: new Date(), acceptedByPrincipalId: input.actorPrincipalId, rejectionReason: null }
      : { status: "rejected", acceptedAt: null, acceptedByPrincipalId: null, rejectionReason: reason };
    const updated = await tx.careConsentAttestation.updateMany({
      where: { id: attestation.id, status: "pending-review" }, data,
    });
    if (updated.count !== 1) throw new Error("stale-evidence-review");
    await recordCareIntakeStaffDecision(tx, {
      organizationId: input.organizationId,
      actorPrincipalId: input.actorPrincipalId,
      actionKey: `healthcare.intake.consent-attestation.${input.decision}`,
      objectRef: `care-consent-attestation:${input.attestationId}`,
      routeContext: "/api/v1/healthcare/intake/:packetId/consent-attestations/:attestationId/decision",
      rationale: { packetId: input.packetId, decision: input.decision, reason },
    });
    return { attestationId: input.attestationId, status: input.decision, consentDirectiveChanged: false as const };
  });
}
