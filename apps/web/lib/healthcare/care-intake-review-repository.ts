import { prisma } from "@dpf/db";
import {
  calculateIntakeReadiness,
  type CareIntakeRequirement,
} from "@dpf/db/healthcare-care-intake";

import {
  recordCareIntakeStaffDecision,
  setCareIntakeStaffContext,
} from "./care-intake-staff-context";

type ReviewPacketRow = {
  id: string;
  packetId: string;
  patientProfileId: string;
  appointmentId: string | null;
  status: string;
  version: number;
  sourceMode: string;
  dueAt: Date | null;
  completionPercent: number;
  requirementSnapshot: unknown;
  requiredConsentCount: number;
  requiresCoverageEvidence: boolean;
  responses: Array<{ answeredLinkIds: string[]; sourceMode: string; status: string; authoredAt: Date }>;
  exceptions: Array<{ exceptionId: string; exceptionType: string; status: string; severity: string; summary: string; assignedToPrincipalId: string | null }>;
  consentAttestations: Array<{ status: string }>;
  coverageEvidence: Array<{ status: string }>;
  accessGrants: Array<{
    grantId: string; granteePrincipalId: string | null; permittedOperations: string[];
    expiresAt: Date; lastUsedAt: Date | null; revokedAt: Date | null;
  }>;
};

type Transaction = {
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
  careIntakePacket: {
    findMany(args: unknown): Promise<ReviewPacketRow[]>;
    findFirst(args: unknown): Promise<{ id: string; packetId: string; patientProfileId: string } | null>;
  };
  careIntakeAccessGrant: {
    findFirst(args: unknown): Promise<{ grantId: string; revokedAt: Date | null } | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  authorizationDecisionLog: { create(args: unknown): Promise<unknown> };
};

export type CareIntakeReviewDatabase = {
  $transaction<T>(callback: (tx: Transaction) => Promise<T>): Promise<T>;
};

function requirements(value: unknown): CareIntakeRequirement[] {
  if (!Array.isArray(value)) throw new Error("Invalid intake requirement snapshot");
  return value as CareIntakeRequirement[];
}

export async function listCareIntakeReviewQueue(
  input: {
    organizationId: string;
    actorPrincipalId: string;
    limit?: number;
    statuses?: string[];
  },
  database: CareIntakeReviewDatabase = prisma as unknown as CareIntakeReviewDatabase,
) {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  return database.$transaction(async (tx) => {
    await setCareIntakeStaffContext(tx, input);
    const packets = await tx.careIntakePacket.findMany({
      where: {
        organizationId: input.organizationId,
        status: input.statuses?.length ? { in: input.statuses } : { in: ["assigned", "in-progress", "amended"] },
      },
      orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
      take: limit,
      select: {
        id: true, packetId: true, patientProfileId: true, appointmentId: true,
        status: true, version: true, sourceMode: true, dueAt: true,
        completionPercent: true, requirementSnapshot: true,
        requiredConsentCount: true, requiresCoverageEvidence: true,
        responses: {
          where: { status: { not: "entered-in-error" } },
          select: { answeredLinkIds: true, sourceMode: true, status: true, authoredAt: true },
        },
        exceptions: {
          where: { status: { in: ["open", "in-progress"] } },
          select: { exceptionId: true, exceptionType: true, status: true, severity: true, summary: true, assignedToPrincipalId: true },
        },
        consentAttestations: { select: { status: true } },
        coverageEvidence: { select: { status: true } },
        accessGrants: {
          select: { grantId: true, granteePrincipalId: true, permittedOperations: true, expiresAt: true, lastUsedAt: true, revokedAt: true },
        },
      },
    });
    const items = packets.map((packet) => {
      const readiness = calculateIntakeReadiness({
        requirements: requirements(packet.requirementSnapshot),
        answeredLinkIds: [...new Set(packet.responses.flatMap((response) => response.answeredLinkIds))],
        unresolvedExceptionCount: packet.exceptions.length,
        requiredConsentCount: packet.requiredConsentCount,
        acceptedConsentCount: packet.consentAttestations.filter((row) => row.status === "accepted").length,
        requiredCoverageEvidence: packet.requiresCoverageEvidence,
        acceptedCoverageEvidenceCount: packet.coverageEvidence.filter((row) => row.status === "accepted").length,
      });
      return {
        packetId: packet.packetId,
        patientProfileId: packet.patientProfileId,
        appointmentId: packet.appointmentId,
        status: packet.status,
        version: packet.version,
        dueAt: packet.dueAt,
        ready: readiness.ready,
        completionPercent: readiness.completionPercent,
        blockers: readiness.blockers,
        missingRequiredLinkIds: readiness.missingRequiredLinkIds,
        sourceModes: [...new Set([packet.sourceMode, ...packet.responses.map((response) => response.sourceMode)])].sort(),
        openExceptions: packet.exceptions,
        accessGrants: packet.accessGrants,
      };
    });
    await recordCareIntakeStaffDecision(tx, {
      organizationId: input.organizationId,
      actorPrincipalId: input.actorPrincipalId,
      actionKey: "healthcare.intake.review",
      objectRef: `care-intake-review:${input.organizationId}`,
      routeContext: "/api/v1/healthcare/intake/review",
      rationale: { resultCount: items.length, payloadProjection: "readiness-no-answers" },
    });
    return { items };
  });
}

export async function revokeCareIntakeAccessGrant(
  input: {
    organizationId: string;
    packetId: string;
    grantId: string;
    actorPrincipalId: string;
    reason: string;
  },
  database: CareIntakeReviewDatabase = prisma as unknown as CareIntakeReviewDatabase,
) {
  if (!input.reason.trim() || input.reason.length > 500) throw new Error("Invalid revocation reason");
  return database.$transaction(async (tx) => {
    await setCareIntakeStaffContext(tx, input);
    const packet = await tx.careIntakePacket.findFirst({
      where: { packetId: input.packetId, organizationId: input.organizationId },
      select: { id: true, packetId: true, patientProfileId: true },
    });
    if (!packet) throw new Error("Care intake packet not found");
    const grant = await tx.careIntakeAccessGrant.findFirst({
      where: { grantId: input.grantId, packetId: packet.id, organizationId: input.organizationId },
      select: { grantId: true, revokedAt: true },
    });
    if (!grant || grant.revokedAt) throw new Error("Active care intake grant not found");
    const revokedAt = new Date();
    const updated = await tx.careIntakeAccessGrant.updateMany({
      where: { grantId: input.grantId, packetId: packet.id, organizationId: input.organizationId, revokedAt: null },
      data: { revokedAt, revocationReason: input.reason.trim() },
    });
    if (updated.count !== 1) throw new Error("stale-intake-grant");
    await recordCareIntakeStaffDecision(tx, {
      organizationId: input.organizationId,
      actorPrincipalId: input.actorPrincipalId,
      actionKey: "healthcare.intake.grant.revoke",
      objectRef: `care-intake-grant:${input.grantId}`,
      routeContext: "/api/v1/healthcare/intake/:packetId/access-grants/:grantId/revoke",
      rationale: { packetId: input.packetId, reason: input.reason.trim() },
    });
    return { grantId: input.grantId, status: "revoked" as const, revokedAt };
  });
}
