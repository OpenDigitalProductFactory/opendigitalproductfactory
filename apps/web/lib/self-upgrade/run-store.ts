import { randomUUID } from "node:crypto";
import { isEligibleRecoveryPredecessor } from "@/lib/self-upgrade/recovery-eligibility";
import { prisma, Prisma } from "@dpf/db";
import { safeSyncSelfUpgradeChangeRecord } from "@/lib/self-upgrade/change-record";
import { agentEventBus } from "@/lib/agent-event-bus";
import { recordCorrectiveRecoveryEvidence } from "@/lib/backlog/capture-corrective-bi";
import {
  deriveFailureReason,
  FAILURE_REASON_MAX,
} from "@/lib/self-upgrade/build-failure-classifier";
import type { SelfUpgradeRunStatus } from "@/lib/self-upgrade/run-types";
import type {
  SelfUpgradeAdmissionRecord,
  SelfUpgradeAdmissionRepository,
} from "@/lib/self-upgrade/admission";

export type { SelfUpgradeRunStatus } from "@/lib/self-upgrade/run-types";

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
  const created = await prisma.selfUpgradeRun.create({
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
  notifyRunState(created.runId, "queued");
  return created;
}

const ACTIVE_RUN_STATUSES = ["pending", "queued", "running"];

type RecoveryTargetRelationship = "exact" | "distinct" | "conflicting";

function classifyRecoveryTargetRelationship(
  predecessor: { targetSha: string; targetTag: string },
  target: { targetSha: string; targetTag: string },
): RecoveryTargetRelationship {
  const sameSha = predecessor.targetSha.toLowerCase() === target.targetSha.toLowerCase();
  const sameTag = predecessor.targetTag === target.targetTag;
  if (sameSha && sameTag) return "exact";
  if (!sameSha && !sameTag) return "distinct";
  return "conflicting";
}

function asAdmissionRecord(row: {
  runId: string;
  recoveryOfRunId: string | null;
  status: string;
  trigger: string;
  targetSha: string | null;
  targetTag: string | null;
  requestedForce: boolean;
  dryRun: boolean;
  routine: boolean;
  impactSummaryId: string | null;
  admissionFingerprint: string | null;
  dispatchStatus: string | null;
  dispatchAttemptCount: number;
  dispatchLeaseToken: string | null;
  dispatchLeaseExpiresAt: Date | null;
  dispatchEventIds: string[];
  completedAt: Date | null;
}): SelfUpgradeAdmissionRecord {
  if (!row.admissionFingerprint || !row.dispatchStatus) {
    throw new Error(`Self-upgrade ${row.runId} has no durable admission contract`);
  }
  return row as SelfUpgradeAdmissionRecord;
}

/** BI-3FD07259 — the production persistence boundary for durable admission. */
export const selfUpgradeAdmissionRepository: SelfUpgradeAdmissionRepository = {
  async admit(input) {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        "SELECT pg_advisory_xact_lock(hashtext('self-upgrade-admission'))",
      );
      const active = await tx.selfUpgradeRun.findFirst({
        where: { status: { in: ACTIVE_RUN_STATUSES } },
        orderBy: { createdAt: "desc" },
      });
      if (active) {
        return {
          disposition:
            active.admissionFingerprint === input.admissionFingerprint
              ? ("idempotent" as const)
              : ("already_active" as const),
          run: asAdmissionRecord(active),
        };
      }
      if (input.recoveryOfRunId) {
        if (input.target.targetKind !== "release-artifact" || !input.target.targetTag) {
          return { disposition: "recovery_refused" as const, reason: "recovery-target-invalid" as const, run: null };
        }
        const predecessor = await tx.selfUpgradeRun.findUnique({
          where: { runId: input.recoveryOfRunId },
        });
        if (
          !predecessor ||
          predecessor.completedAt === null ||
          predecessor.status !== "failed"
        ) {
          return {
            disposition: "recovery_refused" as const,
            reason: predecessor ? "recovery-predecessor-not-terminal" as const : "recovery-predecessor-missing" as const,
            run: null,
          };
        }
        if (!isEligibleRecoveryPredecessor(predecessor)) {
          return { disposition: "recovery_refused" as const, reason: "recovery-predecessor-ambiguous" as const, run: null };
        }
        const targetRelationship = classifyRecoveryTargetRelationship(
          { targetSha: predecessor.targetSha, targetTag: predecessor.targetTag },
          { targetSha: input.target.targetSha, targetTag: input.target.targetTag },
        );
        if (targetRelationship === "conflicting") {
          return { disposition: "recovery_refused" as const, reason: "recovery-target-not-distinct" as const, run: null };
        }
        const latest = await tx.selfUpgradeRun.findFirst({
          orderBy: { createdAt: "desc" },
        });
        if (latest?.runId !== predecessor.runId) {
          return { disposition: "recovery_refused" as const, reason: "recovery-predecessor-not-latest" as const, run: null };
        }
        const existingSuccessor = await tx.selfUpgradeRun.findUnique({
          where: { recoveryOfRunId: predecessor.runId },
        });
        if (existingSuccessor) {
          return {
            disposition: "recovery_conflict" as const,
            run: asAdmissionRecord(existingSuccessor),
          };
        }
      }
      const created = await tx.selfUpgradeRun.create({
        data: {
          runId: input.runId,
          recoveryOfRunId: input.recoveryOfRunId ?? null,
          status: "pending",
          trigger: input.triggeredBy,
          targetSha: input.target.targetSha,
          targetTag: input.target.targetTag,
          requestedForce: input.requestedForce,
          dryRun: input.dryRun,
          routine: input.routine,
          impactSummaryId: input.impactSummaryId,
          admissionFingerprint: input.admissionFingerprint,
          dispatchStatus: input.dispatchStatus,
        },
      });
      return { disposition: "created" as const, run: asAdmissionRecord(created) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  },

  async read(runId) {
    const row = await prisma.selfUpgradeRun.findUnique({ where: { runId } });
    return row?.admissionFingerprint && row.dispatchStatus
      ? asAdmissionRecord(row)
      : null;
  },

  async claimDispatch(input) {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        "SELECT pg_advisory_xact_lock(hashtext('self-upgrade-dispatch'))",
      );
      const latest = await tx.selfUpgradeRun.findFirst({
        where: { status: { in: ACTIVE_RUN_STATUSES } },
        orderBy: { createdAt: "desc" },
        select: { runId: true },
      });
      if (latest?.runId !== input.runId) {
        return { claimed: false as const, reason: "newer-active-run" };
      }
      const claimed = await tx.selfUpgradeRun.updateMany({
        where: {
          runId: input.runId,
          status: "pending",
          admissionFingerprint: input.admissionFingerprint,
          dispatchStatus: { in: ["admission_pending", "indeterminate", "dispatching"] },
          OR: [
            { dispatchLeaseExpiresAt: null },
            { dispatchLeaseExpiresAt: { lte: input.now } },
          ],
        },
        data: {
          dispatchStatus: "dispatching",
          dispatchLeaseToken: input.leaseToken,
          dispatchLeaseExpiresAt: input.leaseExpiresAt,
          dispatchAttemptedAt: input.now,
          dispatchAttemptCount: { increment: 1 },
          dispatchError: null,
        },
      });
      if (claimed.count !== 1) {
        return { claimed: false as const, reason: "dispatch-not-claimable" };
      }
      const row = await tx.selfUpgradeRun.findUniqueOrThrow({ where: { runId: input.runId } });
      return { claimed: true as const, run: asAdmissionRecord(row) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  },

  async acknowledgeDispatch(input) {
    return prisma.$transaction(async (tx) => {
      const row = await tx.selfUpgradeRun.findUnique({ where: { runId: input.runId } });
      if (
        !row ||
        row.dispatchStatus !== "dispatching" ||
        row.dispatchLeaseToken !== input.leaseToken
      ) return false;
      await tx.selfUpgradeRun.update({
        where: { runId: input.runId },
        data: {
          ...(row.status === "pending" ? { status: "queued" } : {}),
          dispatchStatus: "dispatched",
          dispatchEventIds: input.eventIds,
          dispatchAcknowledgedAt: input.acknowledgedAt,
          dispatchLeaseToken: null,
          dispatchLeaseExpiresAt: null,
          dispatchError: null,
        },
      });
      return true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  },

  async markDispatchIndeterminate(input) {
    const updated = await prisma.selfUpgradeRun.updateMany({
      where: {
        runId: input.runId,
        status: "pending",
        dispatchStatus: { in: ["admission_pending", "dispatching", "indeterminate"] },
        ...(input.leaseToken ? { dispatchLeaseToken: input.leaseToken } : {}),
      },
      data: {
        dispatchStatus: "indeterminate",
        dispatchLeaseToken: null,
        dispatchLeaseExpiresAt: null,
        dispatchError: input.reason,
      },
    });
    return updated.count === 1;
  },

  async failDispatch(input) {
    const updated = await prisma.selfUpgradeRun.updateMany({
      where: {
        runId: input.runId,
        status: "pending",
        dispatchStatus: { in: ["admission_pending", "dispatching", "indeterminate"] },
      },
      data: {
        status: "failed",
        dispatchStatus: "dispatch_failed",
        dispatchError: input.reason,
        failureLog: input.reason,
        reason: input.reason,
        completedAt: input.observedAt,
        dispatchLeaseToken: null,
        dispatchLeaseExpiresAt: null,
      },
    });
    return updated.count === 1;
  },

  async listRecoverable(input) {
    const rows = await prisma.selfUpgradeRun.findMany({
      where: {
        status: "pending",
        dispatchStatus: { in: ["admission_pending", "indeterminate", "dispatching"] },
        OR: [
          { dispatchLeaseExpiresAt: null },
          { dispatchLeaseExpiresAt: { lte: input.now } },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: input.limit,
    });
    return rows.map(asAdmissionRecord);
  },
};

export async function claimAdmittedRunForWorker(
  runId: string,
): Promise<"claimed" | "duplicate" | "legacy"> {
  const row = await prisma.selfUpgradeRun.findUnique({
    where: { runId },
    select: { status: true, dispatchStatus: true },
  });
  if (!row?.dispatchStatus) return "legacy";
  const claimed = await prisma.selfUpgradeRun.updateMany({
    where: {
      runId,
      status: { in: ["pending", "queued"] },
      dispatchStatus: { in: ["dispatching", "dispatched"] },
    },
    data: { status: "running", startedAt: new Date() },
  });
  if (claimed.count !== 1) return "duplicate";
  notifyRunState(runId, "running");
  await safeSyncSelfUpgradeChangeRecord(runId);
  return "claimed";
}

/**
 * A worker may yield an admitted run only before quiescence or any physical
 * mutation begins. The admission reconciler can then dispatch the same run id
 * again without creating a second upgrade identity.
 */
export async function deferAdmittedRunForRedispatch(runId: string, reason: string) {
  const updated = await prisma.selfUpgradeRun.updateMany({
    where: {
      runId,
      status: "running",
      completedAt: null,
      dispatchStatus: { in: ["dispatching", "dispatched"] },
    },
    data: {
      status: "pending",
      startedAt: null,
      dispatchStatus: "indeterminate",
      dispatchError: reason,
      dispatchLeaseToken: null,
      dispatchLeaseExpiresAt: null,
    },
  });
  if (updated.count !== 1) return false;
  notifyRunState(runId, "pending");
  await safeSyncSelfUpgradeChangeRecord(runId);
  return true;
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
  const current = await prisma.selfUpgradeRun.findUnique({ where: { runId } });
  if (current?.status === "running") return current;
  const updated = await prisma.selfUpgradeRun.update({
    where: { runId },
    data: { status: "running", startedAt: new Date() },
  });
  notifyRunState(updated.runId, "running");
  // Lazily open the paired change record (standard change → in-progress).
  await safeSyncSelfUpgradeChangeRecord(runId);
  return updated;
}

export async function completeRun(runId: string) {
  const completedAt = new Date();
  const updated = await prisma.selfUpgradeRun.update({
    where: { runId },
    data: { status: "succeeded", completedAt },
  });
  notifyRunState(updated.runId, "succeeded");
  await safeSyncSelfUpgradeChangeRecord(runId);
  await recordCorrectiveRecoveryEvidence({
    source: "self-upgrade-failure",
    recovery: {
      runId: updated.runId,
      currentSha: updated.currentSha,
      targetSha: updated.targetSha,
      deployedSha: updated.deployedSha,
      completedAt: updated.completedAt ?? completedAt,
    },
  });
  return updated;
}

export async function failRun(runId: string, error: string, reason?: string) {
  // Record WHY, not just the log. `skipRun` has always written a structured
  // `reason` that the Upgrade Center renders in plain language; `failRun` wrote
  // only `failureLog`, so a failed run showed the operator nothing but raw
  // Docker output behind a tooltip. Measured on this install: 55 of 55 failed
  // runs carried no reason, and that hid two multi-day outages (four
  // consecutive daily failures 2026-07-26..29, and the Git-LFS breakage of
  // 2026-08-29 — four more days where the cause sat only in a build log).
  //
  // The derivation reuses the SAME classification this function already ran
  // below to fingerprint the corrective BI and then threw away; callers that
  // already know the cause (preflight, release-target) pass it explicitly.
  const resolvedReason = (reason ?? deriveFailureReason(error)).slice(0, FAILURE_REASON_MAX);
  const updated = await prisma.selfUpgradeRun.update({
    where: { runId },
    data: {
      status: "failed",
      completedAt: new Date(),
      failureLog: error,
      reason: resolvedReason,
    },
  });
  notifyRunState(updated.runId, "failed");
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
  notifyRunState(updated.runId, "skipped");
  // A skip is a non-event: no record is opened. The sync only finalizes a
  // record that already exists (defensive).
  await safeSyncSelfUpgradeChangeRecord(runId);
  return updated;
}

export async function recordRunRecoveryPoint(
  runId: string,
  recoveryPoint: unknown,
) {
  const current = await prisma.selfUpgradeRun.findUnique({
    where: { runId },
    select: { completionEvidence: true },
  });
  return prisma.selfUpgradeRun.update({
    where: { runId },
    data: {
      completionEvidence: toJson({
        ...asEvidenceRecord(current?.completionEvidence),
        recoveryPoint,
      }),
    },
  });
}

export type PromoterReadinessReport = {
  stage: "preflight";
  owner: "bridge" | "portal" | "unavailable";
  mode: "enforced" | "legacy-bootstrap";
  result: "ready" | "failed" | "unavailable";
  baselineSha?: string;
  targetSha: string;
  imageDigest?: string;
  contractVersion?: number;
  contractDigest?: string;
  startedAt: string;
  completedAt: string;
  quiescenceBegan: false;
  failures: Array<{ code: string; message: string; remediation?: string }>;
};

const READINESS_MESSAGE_LIMIT = 500;
const READINESS_FAILURE_LIMIT = 12;
const READINESS_ATTEMPT_LIMIT = 5;

function asEvidenceRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function redactReadinessText(value: string): string {
  return value
    .replace(/(token|secret|password|authorization)\s*[=:]\s*\S+/gi, "$1=[redacted]")
    .replace(/dpfmcp_[A-Za-z0-9_-]+/g, "[redacted]")
    .slice(0, READINESS_MESSAGE_LIMIT);
}

export function sanitizePromoterReadinessReport(report: PromoterReadinessReport): PromoterReadinessReport {
  return {
    ...report,
    failures: report.failures.slice(0, READINESS_FAILURE_LIMIT).map((failure) => ({
      code: failure.code.slice(0, 80),
      message: redactReadinessText(failure.message),
      ...(failure.remediation ? { remediation: redactReadinessText(failure.remediation) } : {}),
    })),
  };
}

/** Read/merge/write keeps recovery and rollback evidence while replacing only readiness. */
export async function recordPromoterReadiness(runId: string, report: PromoterReadinessReport) {
  const current = await prisma.selfUpgradeRun.findUnique({
    where: { runId },
    select: { completionEvidence: true },
  });
  const evidence = asEvidenceRecord(current?.completionEvidence);
  const prior = asEvidenceRecord(evidence.readiness);
  const attempts = Array.isArray(prior.attempts) ? prior.attempts : [];
  const sanitized = sanitizePromoterReadinessReport(report);
  const readiness = {
    ...sanitized,
    attempts: [
      ...attempts,
      {
        result: prior.result,
        completedAt: prior.completedAt,
        failureCodes: Array.isArray(prior.failures)
          ? prior.failures.slice(0, READINESS_FAILURE_LIMIT).map((failure) =>
              typeof failure === "object" && failure !== null && "code" in failure
                ? String((failure as { code: unknown }).code).slice(0, 80)
                : "unknown",
            )
          : [],
      },
    ].filter((attempt) => attempt.result).slice(-READINESS_ATTEMPT_LIMIT),
  };
  return prisma.selfUpgradeRun.update({
    where: { runId },
    data: { completionEvidence: toJson({ ...evidence, readiness }) },
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
  notifyRunState(updated.runId, "cancelled");
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

function notifyRunState(runId: string, status: SelfUpgradeRunStatus): void {
  try {
    agentEventBus.broadcastSystem({
      type: "system:self-upgrade",
      runId,
      status,
      observedAt: new Date().toISOString(),
    });
  } catch (error) {
    // The database write above is authoritative. Notification failures are
    // observable but never allowed to roll back or fail durable lifecycle work.
    console.error("[self-upgrade] lifecycle notification failed", error);
  }
}
