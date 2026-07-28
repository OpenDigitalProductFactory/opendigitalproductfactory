import {
  deriveOperationStatus,
  terminalEvidenceAllowed,
  type DataControlOperationStatus,
  type DataControlStepStatus,
} from "./control-operation-domain";

export type RecoverableDataControlStep = {
  stepId: string;
  operationId: string;
  targetKey: string;
  targetType: string;
  idempotencyKey: string;
  status: DataControlStepStatus;
  compensable: boolean;
  targetReceipt: unknown;
  leaseExpiresAt: Date | null;
  nextRetryAt: Date | null;
};

export type RecoverableDataControlOperation = {
  operationId: string;
  organizationId: string;
  actionKey: string;
  status: DataControlOperationStatus;
  governedCaseWorkItemId: string | null;
  steps: RecoverableDataControlStep[];
};

export interface DataControlRecoveryStore {
  readOperation(operationId: string): Promise<RecoverableDataControlOperation | null>;
  claimStep(
    stepId: string,
    input: { workerId: string; now: Date; leaseExpiresAt: Date },
  ): Promise<RecoverableDataControlStep | null>;
  markApplied(stepId: string, receipt: unknown): Promise<void>;
  markVerified(stepId: string, evidence: unknown): Promise<void>;
  markFailed(
    stepId: string,
    input: { errorClass: string; errorDetail: unknown; nextRetryAt: Date | null },
  ): Promise<void>;
  markCompensated(stepId: string, receipt: unknown): Promise<void>;
  transitionOperation(
    operationId: string,
    from: readonly DataControlOperationStatus[],
    to: DataControlOperationStatus,
  ): Promise<boolean>;
  ensureGovernedCase(
    operation: RecoverableDataControlOperation,
    failedTargets: readonly string[],
  ): Promise<string | null>;
  writeTerminalEvidence(
    operationId: string,
    evidence: {
      status: "reconciled" | "compensated";
      verifiedTargets: string[];
      compensatedTargets: string[];
      reconciledAt: string;
    },
  ): Promise<void>;
}

export interface DataControlTargetAdapter {
  effect(step: RecoverableDataControlStep): Promise<unknown>;
  verify(
    step: RecoverableDataControlStep,
  ): Promise<{ verified: boolean; evidence: unknown }>;
  compensate?(step: RecoverableDataControlStep): Promise<unknown>;
}

export type DataControlTargetAdapters = Readonly<
  Record<string, DataControlTargetAdapter>
>;

function retryAt(now: Date): Date {
  return new Date(now.getTime() + 60_000);
}

function errorClass(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}

async function runForwardStep(input: {
  step: RecoverableDataControlStep;
  adapter: DataControlTargetAdapter;
  store: DataControlRecoveryStore;
}): Promise<void> {
  const initialVerification = await input.adapter.verify(input.step);
  if (initialVerification.verified) {
    if (input.step.status !== "applied") {
      await input.store.markApplied(input.step.stepId, input.step.targetReceipt);
    }
    await input.store.markVerified(input.step.stepId, initialVerification.evidence);
    return;
  }

  const receipt = await input.adapter.effect(input.step);
  await input.store.markApplied(input.step.stepId, receipt);
  const verified = await input.adapter.verify({
    ...input.step,
    status: "applied",
    targetReceipt: receipt,
  });
  if (verified.verified) {
    await input.store.markVerified(input.step.stepId, verified.evidence);
  }
}

async function runCompensationStep(input: {
  step: RecoverableDataControlStep;
  adapter: DataControlTargetAdapter;
  store: DataControlRecoveryStore;
}): Promise<void> {
  if (!input.step.compensable || !input.adapter.compensate) return;
  const receipt = await input.adapter.compensate(input.step);
  await input.store.markCompensated(input.step.stepId, receipt);
}

export async function reconcileDataControlOperation(input: {
  operationId: string;
  workerId: string;
  store: DataControlRecoveryStore;
  adapters: DataControlTargetAdapters;
  now?: Date;
  leaseMs?: number;
}): Promise<{
  status: DataControlOperationStatus;
  blockedTargets: string[];
}> {
  const now = input.now ?? new Date();
  const operation = await input.store.readOperation(input.operationId);
  if (!operation) throw new Error("data_control_operation_not_found");
  const blockedTargets: string[] = [];

  for (const step of operation.steps) {
    if (step.status === "compensated") continue;
    if (step.status === "verified" && operation.status !== "compensating") continue;
    if (step.nextRetryAt && step.nextRetryAt > now) continue;
    const adapter = input.adapters[step.targetType];
    if (!adapter) {
      blockedTargets.push(step.targetKey);
      continue;
    }
    const claimed = await input.store.claimStep(step.stepId, {
      workerId: input.workerId,
      now,
      leaseExpiresAt: new Date(now.getTime() + (input.leaseMs ?? 5 * 60_000)),
    });
    if (!claimed) continue;
    try {
      if (operation.status === "compensating") {
        await runCompensationStep({ step: claimed, adapter, store: input.store });
      } else {
        await runForwardStep({ step: claimed, adapter, store: input.store });
      }
    } catch (error) {
      await input.store.markFailed(step.stepId, {
        errorClass: errorClass(error),
        errorDetail: { message: error instanceof Error ? error.message : "unknown" },
        nextRetryAt: retryAt(now),
      });
    }
  }

  const refreshed = await input.store.readOperation(input.operationId);
  if (!refreshed) throw new Error("data_control_operation_not_found");
  const uncompensableTargets = operation.status === "compensating"
    ? refreshed.steps
      .filter((step) => !step.compensable && step.status !== "compensated")
      .map((step) => step.targetKey)
    : [];
  const forwardStatus = deriveOperationStatus(
    refreshed.steps.map((step) => step.status),
  );
  const derived = operation.status === "compensating"
    ? refreshed.steps.every((step) => step.status === "compensated")
      ? "compensated"
      : uncompensableTargets.length > 0
        ? "partially-complete"
        : "compensating"
    : forwardStatus === "failed" &&
        refreshed.steps.some((step) => step.nextRetryAt !== null)
      ? "executing"
      : forwardStatus;
  if (derived !== operation.status) {
    await input.store.transitionOperation(
      operation.operationId,
      ["executing", "partially-complete", "compensating"],
      derived,
    );
  }

  if (derived === "partially-complete") {
    const irreversibleFailures = operation.status === "compensating"
      ? uncompensableTargets
      : refreshed.steps
        .filter((step) => step.status === "failed" && !step.compensable)
        .map((step) => step.targetKey);
    if (irreversibleFailures.length > 0) {
      await input.store.ensureGovernedCase(refreshed, irreversibleFailures);
    }
  }

  const stepStatuses = refreshed.steps.map((step) => step.status);
  if (terminalEvidenceAllowed(derived, stepStatuses)) {
    await input.store.writeTerminalEvidence(operation.operationId, {
      status: derived as "reconciled" | "compensated",
      verifiedTargets: refreshed.steps
        .filter((step) => step.status === "verified")
        .map((step) => step.targetKey),
      compensatedTargets: refreshed.steps
        .filter((step) => step.status === "compensated")
        .map((step) => step.targetKey),
      reconciledAt: now.toISOString(),
    });
  }
  return { status: derived, blockedTargets };
}
