import { prisma } from "@dpf/db";
import type { Prisma } from "@dpf/db";

import {
  authorizeObjectiveMappingRequestKeyEvolution,
  validateObjectiveMappingRequestKey,
} from "@/lib/mcp-task-objective-mapping-request-key";

import {
  MAX_OBJECTIVE_MAPPING_HISTORY_ROWS,
  classifyHistoricalObjectiveMappingArtifacts,
  currentBaseline,
  exactArtifactRefMatches,
  exactStringSetMatches,
  loadObjectiveMappingHistoryFromDb,
  parseBaselinePayloads,
  type BaselinePayload,
  type TerminalRecoveryPorts,
  type TerminalRecoveryRoom,
} from "./terminal-recovery";
import {
  MAX_OBJECTIVE_MAPPING_EVIDENCE_ACTIVITIES,
  reconcileInitiativeObjectives,
  selectEligibleObjectiveEvidenceActivityIds,
} from "./objective-reconciliation";
import { readRepositoryProviderBlob } from "./repository-artifact";
import { loadCapsuleLivenessInventory } from "@/lib/work-capsules/liveness-inventory";
import {
  err,
  ok,
  type ActionFailure,
  type ActionSuccess,
} from "@/lib/shared/action-result";

export type ObjectiveMappingAdmissionRefusalReason =
  | "invalid-server-request-key"
  | "workroom-identity-conflict"
  | "baseline-conflict"
  | "eligible-evidence-conflict"
  | "objective-mapping-history-unavailable"
  | "immutable-identity-conflict"
  | "prior-authority-active"
  | "authoritative-output-exists";

export class ObjectiveMappingAdmissionRefusal extends Error {
  readonly code = "objective_mapping_admission_refused";

  constructor(
    readonly reason: ObjectiveMappingAdmissionRefusalReason,
    readonly taskRunId?: string,
  ) {
    super(`Objective-mapping admission refused: ${reason}${taskRunId ? ` on ${taskRunId}` : ""}.`);
    this.name = "ObjectiveMappingAdmissionRefusal";
  }
}

export function isObjectiveMappingAdmissionRefusal(
  error: unknown,
): error is ObjectiveMappingAdmissionRefusal {
  return error instanceof ObjectiveMappingAdmissionRefusal;
}

type ObjectiveMappingSubmissionPacket = Parameters<typeof authorizeObjectiveMappingRequestKeyEvolution>[0]["packet"];

type ObjectiveMappingAdmissionDb = Pick<
  Prisma.TransactionClient,
  "backlogItem" | "backlogItemActivity" | "workroom" | "taskRun" | "toolExecution"
  | "featureBuild" | "nonProductionEnvironmentLease"
>;

type WorkroomLivenessReader = (
  db: ObjectiveMappingAdmissionDb,
  workroomId: string,
) => Promise<boolean>;

type ObjectiveMappingAdmissionSnapshot = {
  itemRowId: string;
  room: TerminalRecoveryRoom & { repositoryFullName: string; headSha: string };
  baselineRows: BaselinePayload[];
  baseline: BaselinePayload & { artifactRef: NonNullable<BaselinePayload["artifactRef"]> };
  history: Parameters<typeof classifyHistoricalObjectiveMappingArtifacts>[0]["history"] extends readonly (infer T)[] ? T[] : never;
  currentMappingExists: boolean;
};

async function loadObjectiveMappingAdmissionSnapshot(args: {
  db: ObjectiveMappingAdmissionDb;
  packet: ObjectiveMappingSubmissionPacket;
  workroomIsLive: WorkroomLivenessReader;
}): Promise<ActionSuccess<ObjectiveMappingAdmissionSnapshot> | (
  ActionFailure & { reason: ObjectiveMappingAdmissionRefusalReason }
)> {
  const { db, packet } = args;
  const item = await db.backlogItem.findUnique({
    where: { itemId: packet.binding.itemId },
    select: { id: true, itemId: true },
  });
  if (!item) return { ...err("baseline-conflict"), reason: "baseline-conflict" };

  const room = await db.workroom.findUnique({
    where: { capsuleId: packet.binding.workroomRef.workroomId },
    select: {
      capsuleId: true,
      backlogItemId: true,
      repositoryFullName: true,
      baseSha: true,
      headBranch: true,
      headSha: true,
      archivedAt: true,
    },
  });
  const expectedRoom = packet.binding.workroomRef;
  if (!room || room.archivedAt !== null
    || (room.backlogItemId !== item.itemId && room.backlogItemId !== item.id)
    || room.repositoryFullName?.toLocaleLowerCase("en-US") !== expectedRoom.repositoryFullName.toLocaleLowerCase("en-US")
    || room.headBranch !== expectedRoom.branchName
    || room.headSha?.toLocaleLowerCase("en-US") !== expectedRoom.headSha.toLocaleLowerCase("en-US")) {
    return { ...err("workroom-identity-conflict"), reason: "workroom-identity-conflict" };
  }
  if (!await args.workroomIsLive(db, room.capsuleId)) {
    return { ...err("workroom-identity-conflict"), reason: "workroom-identity-conflict" };
  }

  const baselineActivities = await db.backlogItemActivity.findMany({
    where: { backlogItemId: item.id, kind: "initiative_scope_baseline" },
    orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
    select: { id: true, backlogItemId: true, kind: true, recordedAt: true, payload: true },
  });
  const baselineRows = parseBaselinePayloads(baselineActivities.map((entry) => entry.payload));
  const baseline = baselineRows ? currentBaseline(baselineRows) : null;
  const expectedBaselineId = packet.binding.expectedCurrentBaselineId ?? null;
  if (!baseline || !baseline.artifactRef || baseline.baselineId !== expectedBaselineId
    || !exactArtifactRefMatches(baseline.artifactRef, packet.binding.artifactRef)) {
    return { ...err("baseline-conflict"), reason: "baseline-conflict" };
  }
  const baselineRecordedAt = baselineActivities.find((entry) => {
    const payload = entry.payload;
    return payload && typeof payload === "object" && !Array.isArray(payload)
      && (payload as Record<string, unknown>).baselineId === baseline.baselineId;
  })?.recordedAt;
  if (!baselineRecordedAt) return { ...err("baseline-conflict"), reason: "baseline-conflict" };

  const evidence = await db.backlogItemActivity.findMany({
    where: {
      backlogItemId: item.id,
      kind: "evidence",
      recordedAt: { gte: baselineRecordedAt },
    },
    orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
    take: MAX_OBJECTIVE_MAPPING_EVIDENCE_ACTIVITIES + 1,
    select: { id: true, backlogItemId: true, kind: true, recordedAt: true, payload: true },
  });
  const eligible = selectEligibleObjectiveEvidenceActivityIds({
    itemId: item.itemId,
    itemRowId: item.id,
    baselineRecordedAt,
    activities: evidence,
  });
  if (!eligible.ok || !exactStringSetMatches(
    eligible.data.activityIds,
    packet.binding.eligibleEvidenceActivityIds,
  )) {
    return { ...err("eligible-evidence-conflict"), reason: "eligible-evidence-conflict" };
  }

  const history = await loadObjectiveMappingHistoryFromDb(db, {
    itemId: item.itemId,
    headSha: expectedRoom.headSha,
  });
  if (!history.ok) return { ...err("objective-mapping-history-unavailable"), reason: "objective-mapping-history-unavailable" };

  const mappingActivities = await db.backlogItemActivity.findMany({
    where: { backlogItemId: item.id, kind: "initiative_objective_mapping" },
    orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
    take: MAX_OBJECTIVE_MAPPING_HISTORY_ROWS + 1,
    select: { id: true, backlogItemId: true, kind: true, recordedAt: true, payload: true },
  });
  if (mappingActivities.length > MAX_OBJECTIVE_MAPPING_HISTORY_ROWS) {
    return { ...err("objective-mapping-history-unavailable"), reason: "objective-mapping-history-unavailable" };
  }
  const currentMappingExists = reconcileInitiativeObjectives({
    itemId: item.itemId,
    itemRowId: item.id,
    activities: [...baselineActivities, ...evidence, ...mappingActivities],
  }).state === "pass";

  return ok({
      itemRowId: item.id,
      room: {
        capsuleId: room.capsuleId,
        backlogItemId: room.backlogItemId,
        repositoryFullName: room.repositoryFullName!,
        baseSha: room.baseSha,
        headBranch: room.headBranch,
        headSha: room.headSha!,
        isLive: true,
      },
      baselineRows: baselineRows!,
      baseline: baseline as ObjectiveMappingAdmissionSnapshot["baseline"],
      history: history.data.history,
      currentMappingExists,
  });
}

function admissionRefusalFromAuthorization(
  result: Exclude<ReturnType<typeof authorizeObjectiveMappingRequestKeyEvolution>, { authorized: true }>,
): ObjectiveMappingAdmissionRefusal {
  return new ObjectiveMappingAdmissionRefusal(result.reason, result.taskRunId);
}

/**
 * Prepare provider proof outside the database transaction, then return a
 * server-only guard that revalidates under the same BacklogItem lock used by
 * objective-mapping persistence. Alternate request keys therefore cannot race
 * between readiness projection and TaskRun creation.
 */
export type ObjectiveMappingAdmissionGuard = (tx: Prisma.TransactionClient) => Promise<void>;

export async function prepareObjectiveMappingSubmissionAdmission(args: {
  packet: ObjectiveMappingSubmissionPacket;
  expectedTaskRunId: string;
  ports?: {
    db: ObjectiveMappingAdmissionDb;
    verifyHistoricalArtifact: TerminalRecoveryPorts["verifyHistoricalArtifact"];
    workroomIsLive?: WorkroomLivenessReader;
  };
}): Promise<ActionSuccess<{ admissionGuard: ObjectiveMappingAdmissionGuard }> | (
  ActionFailure & { refusal: ObjectiveMappingAdmissionRefusal }
)> {
  if (!validateObjectiveMappingRequestKey(args.packet)) {
    const refusal = new ObjectiveMappingAdmissionRefusal("invalid-server-request-key");
    return { ...err(refusal.message), refusal };
  }
  const admissionDb = args.ports?.db ?? prisma;
  const verifyHistoricalArtifact = args.ports?.verifyHistoricalArtifact
    ?? ((input: Parameters<TerminalRecoveryPorts["verifyHistoricalArtifact"]>[0]) => readRepositoryProviderBlob(input));
  const workroomIsLive = args.ports?.workroomIsLive ?? (async (db, workroomId) => {
    const inventory = await loadCapsuleLivenessInventory(db, {
      where: { capsuleId: workroomId },
      take: 2,
    });
    return inventory.capsulesAll.length === 1 && inventory.capsulesAll[0]?.isLive === true;
  });
  const initial = await loadObjectiveMappingAdmissionSnapshot({
    db: admissionDb,
    packet: args.packet,
    workroomIsLive,
  });
  if (!initial.ok) {
    const refusal = new ObjectiveMappingAdmissionRefusal(initial.reason);
    return { ...err(refusal.message), refusal };
  }
  if (initial.data.currentMappingExists) {
    const refusal = new ObjectiveMappingAdmissionRefusal("authoritative-output-exists");
    return { ...err(refusal.message), refusal };
  }
  const classified = await classifyHistoricalObjectiveMappingArtifacts({
    history: initial.data.history,
    baselineRows: initial.data.baselineRows,
    currentBaseline: initial.data.baseline,
    currentArtifact: {
      repositoryFullName: args.packet.binding.artifactRef.repositoryFullName,
      path: args.packet.binding.artifactRef.path,
    },
    room: initial.data.room,
    verify: verifyHistoricalArtifact,
  });
  if (!classified.ok) {
    const refusal = new ObjectiveMappingAdmissionRefusal("objective-mapping-history-unavailable");
    return { ...err(refusal.message), refusal };
  }
  const initialAuthorization = authorizeObjectiveMappingRequestKeyEvolution({
    packet: args.packet,
    history: classified.data.history,
    providerProvenImpossibleTaskRunProofs: classified.data.providerProvenImpossibleTaskRunProofs,
    expectedTaskRunId: args.expectedTaskRunId,
  });
  if (!initialAuthorization.authorized) {
    const refusal = admissionRefusalFromAuthorization(initialAuthorization);
    return { ...err(refusal.message), refusal };
  }

  const providerProofs = classified.data.providerProvenImpossibleTaskRunProofs;
  return ok({
    admissionGuard: async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "BacklogItem" WHERE "itemId" = ${args.packet.binding.itemId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "WorkCapsule" WHERE "capsuleId" = ${args.packet.binding.workroomRef.workroomId} FOR SHARE`;
      const current = await loadObjectiveMappingAdmissionSnapshot({
        db: tx,
        packet: args.packet,
        workroomIsLive,
      });
      if (!current.ok) throw new ObjectiveMappingAdmissionRefusal(current.reason);
      if (current.data.currentMappingExists) {
        throw new ObjectiveMappingAdmissionRefusal("authoritative-output-exists");
      }
      const authorization = authorizeObjectiveMappingRequestKeyEvolution({
        packet: args.packet,
        history: current.data.history,
        providerProvenImpossibleTaskRunProofs: providerProofs,
        expectedTaskRunId: args.expectedTaskRunId,
      });
      if (!authorization.authorized) throw admissionRefusalFromAuthorization(authorization);
    },
  });
}
