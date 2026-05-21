import { randomUUID } from "node:crypto";
import { prisma } from "@dpf/db";

export type SelfUpgradeRunStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export async function createRun(params: {
  triggeredBy?: string;
  fromVersion?: string;
  toVersion?: string;
}) {
  const runId = `SUR-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
  return prisma.selfUpgradeRun.create({
    data: {
      runId,
      status: "pending",
      trigger: params.triggeredBy ?? "unknown",
      currentSha: params.fromVersion ?? null,
      targetSha: params.toVersion ?? null,
    },
  });
}

export async function startRun(runId: string) {
  return prisma.selfUpgradeRun.update({
    where: { runId },
    data: { status: "running", startedAt: new Date() },
  });
}

export async function completeRun(runId: string) {
  return prisma.selfUpgradeRun.update({
    where: { runId },
    data: { status: "succeeded", completedAt: new Date() },
  });
}

export async function failRun(runId: string, error: string) {
  return prisma.selfUpgradeRun.update({
    where: { runId },
    data: { status: "failed", completedAt: new Date(), failureLog: error },
  });
}

export async function cancelRun(runId: string) {
  return prisma.selfUpgradeRun.update({
    where: { runId },
    data: { status: "cancelled", completedAt: new Date() },
  });
}

export async function appendLog(runId: string, chunk: string) {
  const current = await prisma.selfUpgradeRun.findUniqueOrThrow({
    where: { runId },
    select: { failureLog: true },
  });
  return prisma.selfUpgradeRun.update({
    where: { runId },
    data: { failureLog: current.failureLog ? `${current.failureLog}\n${chunk}` : chunk },
  });
}

export async function getLatestRun() {
  return prisma.selfUpgradeRun.findFirst({
    orderBy: { createdAt: "desc" },
  });
}

export async function getRun(runId: string) {
  return prisma.selfUpgradeRun.findUnique({ where: { runId } });
}
