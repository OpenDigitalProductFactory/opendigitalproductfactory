import { Prisma, prisma } from "@dpf/db";

import type {
  DataControlOperationStatus,
  DataControlStepStatus,
} from "./control-operation-domain";
import type {
  DataControlRecoveryStore,
  RecoverableDataControlOperation,
  RecoverableDataControlStep,
} from "./control-operation-runner";

type PrismaLike = typeof prisma;

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function toNullableJson(value: unknown) {
  return value === null || value === undefined ? Prisma.DbNull : toJson(value);
}

const STEP_SELECT = {
  stepId: true,
  operationId: true,
  targetKey: true,
  targetType: true,
  idempotencyKey: true,
  status: true,
  compensable: true,
  targetReceipt: true,
  leaseExpiresAt: true,
  nextRetryAt: true,
} as const;

function stepRecord(row: {
  stepId: string;
  operationId: string;
  targetKey: string;
  targetType: string;
  idempotencyKey: string;
  status: string;
  compensable: boolean;
  targetReceipt: unknown;
  leaseExpiresAt: Date | null;
  nextRetryAt: Date | null;
}): RecoverableDataControlStep {
  return { ...row, status: row.status as DataControlStepStatus };
}

export async function listRecoverableDataControlOperationIds(
  input: { now: Date; limit: number },
  db: PrismaLike = prisma,
): Promise<string[]> {
  const rows = await db.dataControlOperation.findMany({
    where: {
      status: { in: ["executing", "partially-complete", "compensating"] },
      steps: {
        some: {
          OR: [
            { status: { in: ["pending", "failed", "applied", "verified"] }, nextRetryAt: { lte: input.now } },
            { status: { in: ["pending", "failed", "applied", "verified"] }, nextRetryAt: null },
            { status: "executing", leaseExpiresAt: { lt: input.now } },
          ],
        },
      },
    },
    orderBy: { updatedAt: "asc" },
    take: input.limit,
    select: { operationId: true },
  });
  return rows.map((row) => row.operationId);
}

export function createPrismaDataControlRecoveryStore(
  db: PrismaLike = prisma,
): DataControlRecoveryStore {
  return {
    readOperation: async (operationId) => {
      const row = await db.dataControlOperation.findUnique({
        where: { operationId },
        select: {
          operationId: true,
          organizationId: true,
          actionKey: true,
          status: true,
          governedCaseWorkItemId: true,
          steps: { orderBy: { sequence: "asc" }, select: STEP_SELECT },
        },
      });
      if (!row) return null;
      return {
        ...row,
        status: row.status as DataControlOperationStatus,
        steps: row.steps.map(stepRecord),
      } satisfies RecoverableDataControlOperation;
    },
    claimStep: async (stepId, input) => {
      const claimed = await db.dataControlOperationStep.updateMany({
        where: {
          stepId,
          OR: [
            {
              status: { in: ["pending", "failed", "applied", "verified"] },
              OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: input.now } }],
            },
            { status: "executing", leaseExpiresAt: { lt: input.now } },
          ],
        },
        data: {
          status: "executing",
          leaseOwner: input.workerId,
          leaseExpiresAt: input.leaseExpiresAt,
          claimedAt: input.now,
          attempt: { increment: 1 },
        },
      });
      if (claimed.count !== 1) return null;
      const step = await db.dataControlOperationStep.findUnique({
        where: { stepId },
        select: STEP_SELECT,
      });
      return step ? stepRecord(step) : null;
    },
    markApplied: async (stepId, receipt) => {
      const updated = await db.dataControlOperationStep.updateMany({
        where: { stepId, status: "executing" },
        data: {
          status: "applied",
          targetReceipt: toNullableJson(receipt),
          appliedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
          errorClass: null,
          errorDetail: Prisma.DbNull,
          nextRetryAt: null,
        },
      });
      if (updated.count !== 1) throw new Error("data_control_step_apply_cas_failed");
    },
    markVerified: async (stepId, evidence) => {
      const updated = await db.dataControlOperationStep.updateMany({
        where: { stepId, status: "applied" },
        data: {
          status: "verified",
          verificationReceipt: toNullableJson(evidence),
          verifiedAt: new Date(),
        },
      });
      if (updated.count !== 1) throw new Error("data_control_step_verify_cas_failed");
    },
    markFailed: async (stepId, failure) => {
      await db.dataControlOperationStep.updateMany({
        where: { stepId, status: { in: ["executing", "applied"] } },
        data: {
          status: "failed",
          errorClass: failure.errorClass,
          errorDetail: toNullableJson(failure.errorDetail),
          nextRetryAt: failure.nextRetryAt,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
    },
    markCompensated: async (stepId, receipt) => {
      const updated = await db.dataControlOperationStep.updateMany({
        where: { stepId, status: "executing", compensable: true },
        data: {
          status: "compensated",
          compensationReceipt: toNullableJson(receipt),
          compensatedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
      if (updated.count !== 1) throw new Error("data_control_step_compensate_cas_failed");
    },
    transitionOperation: async (operationId, from, to) => {
      const updated = await db.dataControlOperation.updateMany({
        where: { operationId, status: { in: [...from] } },
        data: {
          status: to,
          reconciledAt: to === "reconciled" || to === "compensated" ? new Date() : undefined,
          failedAt: to === "failed" ? new Date() : undefined,
        },
      });
      return updated.count === 1;
    },
    ensureGovernedCase: async (operation, failedTargets) => {
      if (operation.governedCaseWorkItemId) return operation.governedCaseWorkItemId;
      const queue = await db.workQueue.findFirst({
        where: { queueType: "escalation", isActive: true },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (!queue) return null;
      const workItem = await db.workItem.upsert({
        where: { itemId: `DCOCASE-${operation.operationId}` },
        update: {},
        create: {
          itemId: `DCOCASE-${operation.operationId}`,
          sourceType: "data-control-operation",
          sourceId: operation.operationId,
          title: `Data operation needs reconciliation: ${operation.actionKey}`,
          description: `Non-compensable targets remain partial: ${failedTargets.join(", ")}`,
          urgency: "urgent",
          effortClass: "medium",
          workerConstraint: toJson({
            workerType: "either",
            requiredCapabilities: ["data-governance"],
            sensitivityLevel: "restricted",
          }),
          queueId: queue.id,
          evidence: toJson({
            operationId: operation.operationId,
            failedTargets: [...failedTargets],
          }),
        },
        select: { id: true },
      });
      await db.dataControlOperation.updateMany({
        where: { operationId: operation.operationId, governedCaseWorkItemId: null },
        data: { governedCaseWorkItemId: workItem.id },
      });
      return workItem.id;
    },
    writeTerminalEvidence: async (operationId, evidence) => {
      await db.dataControlOperation.updateMany({
        where: {
          operationId,
          status: evidence.status,
          terminalEvidence: { equals: Prisma.DbNull },
        },
        data: { terminalEvidence: toJson(evidence) },
      });
    },
  };
}
