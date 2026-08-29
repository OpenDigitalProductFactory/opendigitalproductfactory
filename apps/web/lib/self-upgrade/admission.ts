import { createHash, randomUUID } from "node:crypto";
import { after } from "next/server";
import { inngest } from "@/lib/queue/inngest-client";
import { getJobEngineHealth } from "@/lib/queue/job-engine-health";
import { getSelfUpgradeConfig } from "@/lib/self-upgrade/config";
import { readCurrentContainerConfigDigest } from "@/lib/self-upgrade/runtime-image-identity";
import { selfUpgradeAdmissionRepository } from "@/lib/self-upgrade/run-store";
import { resolveSelfUpgradeStatusTarget } from "@/lib/self-upgrade/status-target";
import { readSelfUpgradeSupport } from "@/lib/self-upgrade/support";
import { getErrorMessage } from "@/lib/shared/get-error-message";

export type SelfUpgradeDispatchStatus =
  | "admission_pending"
  | "dispatching"
  | "dispatched"
  | "indeterminate"
  | "dispatch_failed";

export type SelfUpgradeTargetBinding = Readonly<{
  targetKind: "git-source" | "release-artifact";
  targetSha: string;
  targetTag: string | null;
}>;

export type SelfUpgradeAdmissionRecord = Readonly<{
  runId: string;
  status: string;
  trigger: string;
  targetSha: string | null;
  targetTag: string | null;
  requestedForce: boolean;
  dryRun: boolean;
  routine: boolean;
  impactSummaryId: string | null;
  admissionFingerprint: string;
  dispatchStatus: SelfUpgradeDispatchStatus;
  dispatchAttemptCount: number;
  dispatchLeaseToken: string | null;
  dispatchLeaseExpiresAt: Date | null;
  dispatchEventIds?: string[];
  completedAt: Date | null;
}>;

export type SelfUpgradeAdmissionInput = Readonly<{
  triggeredBy: string;
  target: SelfUpgradeTargetBinding;
  requestedForce: boolean;
  dryRun: boolean;
  routine: boolean;
  impactSummaryId: string | null;
}>;

type PersistedAdmissionInput = SelfUpgradeAdmissionInput & {
  runId: string;
  admissionFingerprint: string;
  dispatchStatus: "admission_pending";
};

export type SelfUpgradeAdmissionRepository = {
  admit(input: PersistedAdmissionInput): Promise<{
    disposition: "created" | "idempotent" | "already_active";
    run: SelfUpgradeAdmissionRecord;
  }>;
  read(runId: string): Promise<SelfUpgradeAdmissionRecord | null>;
  claimDispatch(input: {
    runId: string;
    admissionFingerprint: string;
    leaseToken: string;
    leaseExpiresAt: Date;
    now: Date;
  }): Promise<
    | { claimed: true; run: SelfUpgradeAdmissionRecord }
    | { claimed: false; reason: string }
  >;
  acknowledgeDispatch(input: {
    runId: string;
    leaseToken: string;
    eventIds: string[];
    acknowledgedAt: Date;
  }): Promise<boolean>;
  markDispatchIndeterminate(input: {
    runId: string;
    leaseToken: string | null;
    reason: string;
    observedAt: Date;
  }): Promise<boolean>;
  failDispatch(input: {
    runId: string;
    reason: string;
    observedAt: Date;
  }): Promise<boolean>;
  listRecoverable(input: { now: Date; limit: number }): Promise<SelfUpgradeAdmissionRecord[]>;
};

type DispatchEvent = {
  id: string;
  name: "ops/self-upgrade.run";
  data: {
    runId: string;
    triggeredBy: string;
    force?: true;
    dryRun?: boolean;
    routine?: true;
  };
};

type SelfUpgradeAdmissionDependencies = {
  repository: SelfUpgradeAdmissionRepository;
  send(event: DispatchEvent): Promise<{ ids: string[] }>;
  resolveTarget(): Promise<SelfUpgradeTargetBinding | null>;
  readJobEngineHealth(): Promise<{ status: "healthy" | "degraded" | "unknown" }>;
  schedule(task: () => Promise<void>): void;
  createRunId(): string;
  createLeaseToken(): string;
  now(): Date;
};

export type SelfUpgradeDispatchOutcome =
  | { status: "dispatched"; runId: string }
  | { status: "indeterminate"; runId: string }
  | { status: "failed"; runId: string }
  | { status: "not-claimed"; runId: string };

const DISPATCH_LEASE_MS = 60_000;
const RECONCILE_LIMIT = 10;

export function computeSelfUpgradeAdmissionFingerprint(
  input: SelfUpgradeAdmissionInput,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        targetKind: input.target.targetKind,
        targetSha: input.target.targetSha.toLowerCase(),
        targetTag: input.target.targetTag,
        triggeredBy: input.triggeredBy,
        requestedForce: input.requestedForce,
        dryRun: input.dryRun,
        routine: input.routine,
        impactSummaryId: input.impactSummaryId,
      }),
    )
    .digest("hex");
}

function targetMatches(
  run: SelfUpgradeAdmissionRecord,
  target: SelfUpgradeTargetBinding | null,
): boolean {
  if (!target || !run.targetSha) return false;
  return (
    run.targetSha.toLowerCase() === target.targetSha.toLowerCase() &&
    run.targetTag === target.targetTag
  );
}

function fingerprintMatches(
  run: SelfUpgradeAdmissionRecord,
  target: SelfUpgradeTargetBinding,
): boolean {
  return run.admissionFingerprint === computeSelfUpgradeAdmissionFingerprint({
    triggeredBy: run.trigger,
    target,
    requestedForce: run.requestedForce,
    dryRun: run.dryRun,
    routine: run.routine,
    impactSummaryId: run.impactSummaryId,
  });
}

export function isDefiniteSelfUpgradeDispatchRefusal(error: unknown): boolean {
  const message = getErrorMessage(error);
  return /Inngest API Error: (400|401|403|404|406|409|412|413)\b/.test(message) ||
    /couldn't find an event key/i.test(message);
}

function buildEvent(run: SelfUpgradeAdmissionRecord): DispatchEvent {
  return {
    id: `self-upgrade:${run.runId}`,
    name: "ops/self-upgrade.run",
    data: {
      runId: run.runId,
      triggeredBy: run.trigger,
      ...(run.requestedForce ? { force: true as const } : {}),
      ...(run.dryRun ? { dryRun: true } : {}),
      ...(run.routine ? { routine: true as const } : {}),
    },
  };
}

export function createSelfUpgradeAdmissionService(
  dependencies: SelfUpgradeAdmissionDependencies,
) {
  async function dispatch(runId: string): Promise<SelfUpgradeDispatchOutcome> {
    const existing = await dependencies.repository.read(runId);
    if (!existing) return { status: "not-claimed", runId };

    const currentTarget = await dependencies.resolveTarget().catch(() => null);
    if (!currentTarget) {
      await dependencies.repository.markDispatchIndeterminate({
        runId,
        leaseToken: null,
        reason: "admission-target-unavailable",
        observedAt: dependencies.now(),
      });
      return { status: "indeterminate", runId };
    }
    if (!targetMatches(existing, currentTarget)) {
      await dependencies.repository.failDispatch({
        runId,
        reason: "admission-target-drift",
        observedAt: dependencies.now(),
      });
      return { status: "failed", runId };
    }
    if (!fingerprintMatches(existing, currentTarget)) {
      await dependencies.repository.failDispatch({
        runId,
        reason: "admission-binding-drift",
        observedAt: dependencies.now(),
      });
      return { status: "failed", runId };
    }

    const health = await dependencies.readJobEngineHealth();
    if (health.status !== "healthy") {
      await dependencies.repository.markDispatchIndeterminate({
        runId,
        leaseToken: null,
        reason: `job-engine-${health.status}`,
        observedAt: dependencies.now(),
      });
      return { status: "indeterminate", runId };
    }

    const now = dependencies.now();
    const leaseToken = dependencies.createLeaseToken();
    const claim = await dependencies.repository.claimDispatch({
      runId,
      admissionFingerprint: existing.admissionFingerprint,
      leaseToken,
      leaseExpiresAt: new Date(now.getTime() + DISPATCH_LEASE_MS),
      now,
    });
    if (!claim.claimed) return { status: "not-claimed", runId };

    try {
      const sent = await dependencies.send(buildEvent(claim.run));
      const acknowledged = await dependencies.repository.acknowledgeDispatch({
        runId,
        leaseToken,
        eventIds: sent.ids,
        acknowledgedAt: dependencies.now(),
      });
      return acknowledged
        ? { status: "dispatched", runId }
        : { status: "not-claimed", runId };
    } catch (error) {
      const reason = getErrorMessage(error) || "queue dispatch failed";
      if (isDefiniteSelfUpgradeDispatchRefusal(error)) {
        await dependencies.repository.failDispatch({
          runId,
          reason: `queue-dispatch-refused: ${reason}`,
          observedAt: dependencies.now(),
        });
        return { status: "failed", runId };
      }
      await dependencies.repository.markDispatchIndeterminate({
        runId,
        leaseToken,
        reason: `queue-dispatch-indeterminate: ${reason}`,
        observedAt: dependencies.now(),
      });
      return { status: "indeterminate", runId };
    }
  }

  return {
    async admit(input: SelfUpgradeAdmissionInput) {
      const admitted = await dependencies.repository.admit({
        ...input,
        runId: dependencies.createRunId(),
        admissionFingerprint: computeSelfUpgradeAdmissionFingerprint(input),
        dispatchStatus: "admission_pending",
      });
      if (admitted.disposition !== "already_active") {
        dependencies.schedule(async () => {
          await dispatch(admitted.run.runId);
        });
      }
      return {
        admitted: admitted.disposition !== "already_active",
        runId: admitted.run.runId,
        disposition: admitted.disposition,
        dispatchStatus: admitted.run.dispatchStatus,
      };
    },
    dispatch,
    async reconcile() {
      const rows = await dependencies.repository.listRecoverable({
        now: dependencies.now(),
        limit: RECONCILE_LIMIT,
      });
      const summary = { attempted: 0, dispatched: 0, indeterminate: 0, failed: 0 };
      for (const row of rows) {
        summary.attempted += 1;
        const outcome = await dispatch(row.runId);
        if (outcome.status === "dispatched") summary.dispatched += 1;
        if (outcome.status === "indeterminate") summary.indeterminate += 1;
        if (outcome.status === "failed") summary.failed += 1;
      }
      return summary;
    },
  };
}

export async function resolveCurrentSelfUpgradeTarget(): Promise<SelfUpgradeTargetBinding | null> {
  const config = await getSelfUpgradeConfig();
  const support = await readSelfUpgradeSupport(config.enabled);
  if (!support.supported) return null;
  const target = await resolveSelfUpgradeStatusTarget({
    support,
    config,
    currentConfigDigest: await readCurrentContainerConfigDigest(),
  });
  if (target.availability !== "resolved" || !target.targetSha) return null;
  return {
    targetKind: support.targetKind,
    targetSha: target.targetSha,
    targetTag: target.targetTag,
  };
}

function productionService(schedule: (task: () => Promise<void>) => void) {
  return createSelfUpgradeAdmissionService({
    repository: selfUpgradeAdmissionRepository,
    send: (event) => inngest.send(event),
    resolveTarget: resolveCurrentSelfUpgradeTarget,
    readJobEngineHealth: async () => ({ status: (await getJobEngineHealth()).status }),
    schedule,
    createRunId: () => `SUR-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`,
    createLeaseToken: randomUUID,
    now: () => new Date(),
  });
}

export async function admitSelfUpgrade(input: SelfUpgradeAdmissionInput) {
  return productionService((task) => after(task)).admit(input);
}

export async function reconcileSelfUpgradeAdmissions() {
  return productionService((task) => void task()).reconcile();
}
