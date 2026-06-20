import { randomUUID } from "node:crypto";
import { prisma, Prisma } from "@dpf/db";
import { safeSyncSelfUpgradeChangeRecord } from "@/lib/self-upgrade/change-record";

export type SelfUpgradeRunStatus =
  | "queued"
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "skipped"
  | "completing"
  | "rolled_back";

export async function createRun(params: {
  runId?: string;
  triggeredBy?: string;
  fromVersion?: string;
  toVersion?: string;
  expectedDeployedSha?: string;
  /** Link to the UpgradeImpactSummary the operator reviewed (best effort). */
  impactSummaryId?: string | null;
}) {
  const runId = params.runId ?? `SUR-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
  return prisma.selfUpgradeRun.create({
    data: {
      runId,
      status: "queued",
      trigger: params.triggeredBy ?? "unknown",
      currentSha: params.fromVersion ?? null,
      targetSha: params.toVersion ?? null,
      deployedSha: params.expectedDeployedSha ?? null,
      impactSummaryId: params.impactSummaryId ?? null,
    },
  });
}

export async function updateRunPlan(
  runId: string,
  params: {
    fromVersion?: string;
    toVersion?: string;
    expectedDeployedSha?: string;
  },
) {
  return prisma.selfUpgradeRun.update({
    where: { runId },
    data: {
      currentSha: params.fromVersion ?? null,
      targetSha: params.toVersion ?? null,
      deployedSha: params.expectedDeployedSha ?? null,
    },
  });
}

export async function startRun(runId: string) {
  const updated = await prisma.selfUpgradeRun.update({
    where: { runId },
    data: { status: "running", startedAt: new Date() },
  });
  // Lazily open the paired change record (standard change → in-progress).
  await safeSyncSelfUpgradeChangeRecord(runId);
  return updated;
}

export async function completeRun(runId: string) {
  const updated = await prisma.selfUpgradeRun.update({
    where: { runId },
    data: { status: "succeeded", completedAt: new Date() },
  });
  await safeSyncSelfUpgradeChangeRecord(runId);
  return updated;
}

export async function failRun(runId: string, error: string) {
  const updated = await prisma.selfUpgradeRun.update({
    where: { runId },
    data: { status: "failed", completedAt: new Date(), failureLog: error },
  });
  await safeSyncSelfUpgradeChangeRecord(runId);
  // BI-9EA09823 — best-effort: every self-upgrade failure lands a fingerprinted
  // corrective BI, keyed on the failure CLASS (not runId) so recurrences
  // increment occurrenceCount instead of spamming new items. The run row is
  // already persisted above, so a throw here cannot corrupt run state — but the
  // helper never throws anyway.
  try {
    const { classifyBuildFailure } = await import("@/lib/self-upgrade/build-failure-classifier");
    const cls = classifyBuildFailure({ log: error });
    const { captureCorrectiveFailureBI } = await import("@/lib/backlog/capture-corrective-bi");
    await captureCorrectiveFailureBI({
      source: "self-upgrade-failure",
      signature: `${cls.class}|${cls.failingTrace.slice(0, 200)}`,
      title: `[self-upgrade] ${cls.class}: ${cls.summary}`.slice(0, 200),
      body: [
        `class: ${cls.class}`,
        `disposition: ${cls.isMainDefectVsEnvironment ?? "unknown"}`,
        `playbook: ${cls.playbookLink}`,
        `runId: ${runId}`,
        ``,
        cls.failingTrace,
      ].join("\n"),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[failRun] corrective-BI capture failed:", err);
  }
  return updated;
}

export async function skipRun(runId: string, reason: string) {
  const updated = await prisma.selfUpgradeRun.update({
    where: { runId },
    data: { status: "skipped", completedAt: new Date(), reason },
  });
  // A skip is a non-event: no record is opened. The sync only finalizes a
  // record that already exists (defensive).
  await safeSyncSelfUpgradeChangeRecord(runId);
  return updated;
}

export async function recordRunRecoveryPoint(
  runId: string,
  recoveryPoint: unknown,
) {
  return prisma.selfUpgradeRun.update({
    where: { runId },
    data: {
      completionEvidence: toJson({
        recoveryPoint,
      }),
    },
  });
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function cancelRun(runId: string) {
  const updated = await prisma.selfUpgradeRun.update({
    where: { runId },
    data: { status: "cancelled", completedAt: new Date() },
  });
  await safeSyncSelfUpgradeChangeRecord(runId);
  return updated;
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

/**
 * The most-recent successfully-completed run. Its `targetSha` is the upstream
 * lineage marker the running build contains — the basis for the §5.0 freshness
 * gate (don't re-merge an upstream we already carry). Distinct from the running
 * `deployedSha`, which in merge mode is the merge-commit identity, not the
 * upstream SHA it absorbed.
 */
export async function getLatestSucceededRun() {
  return prisma.selfUpgradeRun.findFirst({
    where: { status: "succeeded" },
    orderBy: { createdAt: "desc" },
  });
}

export async function getRun(runId: string) {
  return prisma.selfUpgradeRun.findUnique({ where: { runId } });
}
