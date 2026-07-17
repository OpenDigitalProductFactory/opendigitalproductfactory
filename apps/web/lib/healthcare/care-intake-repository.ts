import { randomUUID } from "node:crypto";

import {
  assertCareIntakeTransition,
  calculateIntakeReadiness,
  type CareIntakePacketStatus,
  type CareIntakeRequirement,
  type CareIntakeSourceMode,
} from "@dpf/db/healthcare-care-intake";

type PacketRow = {
  id: string;
  packetId: string;
  organizationId: string;
  patientProfileId: string;
  status: string;
  version: number;
  requirementSnapshot: unknown;
  requiredConsentCount: number;
  requiresCoverageEvidence: boolean;
};

type Transaction = {
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
  careIntakePacket: {
    findFirst(args: unknown): Promise<PacketRow | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  careIntakeResponse: {
    findMany(args: unknown): Promise<Array<{ answeredLinkIds: string[] }>>;
  };
  careIntakeException: { count(args: unknown): Promise<number> };
  careConsentAttestation: { count(args: unknown): Promise<number> };
  careCoverageEvidence: { count(args: unknown): Promise<number> };
  careIntakeStatusEvent: { create(args: unknown): Promise<unknown> };
};

export type CareIntakeDatabase = {
  $transaction<T>(callback: (tx: Transaction) => Promise<T>): Promise<T>;
};

export type CareIntakeContext = {
  organizationId: string;
  patientProfileId: string;
  patientPrincipalId: string;
  packetId: string;
};

function requirements(value: unknown): CareIntakeRequirement[] {
  if (!Array.isArray(value)) throw new Error("Invalid intake requirement snapshot");
  return value as CareIntakeRequirement[];
}

async function setContext(tx: Transaction, input: CareIntakeContext) {
  await tx.$executeRaw`SELECT set_config('app.organization_id', ${input.organizationId}, true), set_config('app.patient_profile_ids', ${input.patientProfileId}, true), set_config('app.patient_principal_id', ${input.patientPrincipalId}, true)`;
}

async function readiness(tx: Transaction, packet: PacketRow) {
  const [responses, unresolvedExceptionCount, acceptedConsentCount, acceptedCoverageEvidenceCount] =
    await Promise.all([
      tx.careIntakeResponse.findMany({
        where: { packetId: packet.id, organizationId: packet.organizationId, status: { not: "entered-in-error" } },
        select: { answeredLinkIds: true },
      }),
      tx.careIntakeException.count({
        where: { packetId: packet.id, organizationId: packet.organizationId, status: { in: ["open", "in-progress"] } },
      }),
      tx.careConsentAttestation.count({
        where: { packetId: packet.id, organizationId: packet.organizationId, status: "accepted" },
      }),
      tx.careCoverageEvidence.count({
        where: { packetId: packet.id, organizationId: packet.organizationId, status: "accepted" },
      }),
    ]);
  return calculateIntakeReadiness({
    requirements: requirements(packet.requirementSnapshot),
    answeredLinkIds: [...new Set(responses.flatMap((row) => row.answeredLinkIds))],
    unresolvedExceptionCount,
    requiredConsentCount: packet.requiredConsentCount,
    acceptedConsentCount,
    requiredCoverageEvidence: packet.requiresCoverageEvidence,
    acceptedCoverageEvidenceCount,
  });
}

export async function getCareIntakeReadiness(
  input: CareIntakeContext,
  database: CareIntakeDatabase,
) {
  return database.$transaction(async (tx) => {
    await setContext(tx, input);
    const packet = await tx.careIntakePacket.findFirst({
      where: {
        packetId: input.packetId,
        organizationId: input.organizationId,
        patientProfileId: input.patientProfileId,
      },
    });
    if (!packet) throw new Error("Care intake packet not found");
    return {
      packetId: packet.packetId,
      status: packet.status,
      version: packet.version,
      ...(await readiness(tx, packet)),
    };
  });
}

export async function transitionCareIntakePacket(
  input: CareIntakeContext & {
    expectedVersion: number;
    toStatus: CareIntakePacketStatus;
    reason: string;
    sourceMode: CareIntakeSourceMode;
    actorPrincipalId: string;
  },
  database: CareIntakeDatabase,
) {
  return database.$transaction(async (tx) => {
    await setContext(tx, input);
    const packet = await tx.careIntakePacket.findFirst({
      where: {
        packetId: input.packetId,
        organizationId: input.organizationId,
        patientProfileId: input.patientProfileId,
      },
    });
    if (!packet) throw new Error("Care intake packet not found");
    assertCareIntakeTransition(
      packet.status as CareIntakePacketStatus,
      input.toStatus,
    );
    const currentReadiness = await readiness(tx, packet);
    if (input.toStatus === "completed" && !currentReadiness.ready) {
      return { ok: false as const, errors: currentReadiness.blockers };
    }
    const version = packet.version + 1;
    const updated = await tx.careIntakePacket.updateMany({
      where: {
        id: packet.id,
        organizationId: input.organizationId,
        status: packet.status,
        version: input.expectedVersion,
      },
      data: {
        status: input.toStatus,
        version,
        completionPercent: currentReadiness.completionPercent,
        startedAt: input.toStatus === "in-progress" ? new Date() : undefined,
        completedAt: input.toStatus === "completed" ? new Date() : undefined,
        stoppedAt: input.toStatus === "stopped" ? new Date() : undefined,
        enteredInErrorAt:
          input.toStatus === "entered-in-error" ? new Date() : undefined,
      },
    });
    if (updated.count !== 1) {
      return { ok: false as const, errors: ["stale-intake-version"] };
    }
    await tx.careIntakeStatusEvent.create({
      data: {
        eventId: `intake-event-${randomUUID()}`,
        organizationId: input.organizationId,
        packetId: packet.id,
        patientProfileId: input.patientProfileId,
        packetVersion: version,
        fromStatus: packet.status,
        toStatus: input.toStatus,
        reason: input.reason,
        sourceMode: input.sourceMode,
        actorPrincipalId: input.actorPrincipalId,
      },
    });
    return {
      ok: true as const,
      packetId: packet.packetId,
      status: input.toStatus,
      version,
    };
  });
}
