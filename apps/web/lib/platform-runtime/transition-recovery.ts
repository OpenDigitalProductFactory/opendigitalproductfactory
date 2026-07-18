import { prisma } from "@dpf/db";
import { reconcileRuntimeCapabilityTransitions, type RuntimeTransitionReconcileRow } from "./transition-coordinator";
import type { RuntimeTransitionReceipt } from "./transition-protocol";

let admission: "reconciling" | "ready" | "recovery_required" = "reconciling";

export function assertRuntimeCapabilityTransitionAdmission(): void {
  if (admission !== "ready") throw new Error(admission === "recovery_required" ? "runtime_capability_recovery_required" : "runtime_capability_reconciliation_in_progress");
}

/** Production DB adapter. Host IO remains explicit so startup cannot silently
 * claim readiness when the /dpf-state mount or promoter is unavailable. */
export async function reconcileRuntimeCapabilityTransitionsOnStartup(host: {
  readReceipt(transitionId: string): Promise<RuntimeTransitionReceipt | null>;
  relaunch(row: RuntimeTransitionReconcileRow): Promise<void>;
  compensate(row: RuntimeTransitionReconcileRow, reason: string): Promise<void>;
  protocolSecret: string;
}): Promise<void> {
  admission = "reconciling";
  let recoveryRequired = false;
  const listActive = async () => prisma.runtimeCapabilityTransition.findMany({
    where: { status: { in: ["pending", "applying", "host_applied", "compensating"] } },
    orderBy: { createdAt: "asc" },
    select: { transitionId: true, status: true, catalogHash: true, previousStateHash: true, desiredStateHash: true, previousKeys: true, desiredKeys: true, previousProfiles: true, desiredProfiles: true, previousServices: true, desiredServices: true, previousStates: true, desiredStates: true, envelope: true, envelopeSignature: true, createdAt: true },
  }) as unknown as Promise<RuntimeTransitionReconcileRow[]>;
  await reconcileRuntimeCapabilityTransitions({
    listActive,
    readHostReceipt: host.readReceipt,
    protocolSecret: host.protocolSecret,
    relaunch: host.relaunch,
    compensate: host.compensate,
    completeFromReceipt: async (row, receipt) => {
      await prisma.$transaction(async (tx) => {
        for (const [capabilityId, state] of Object.entries(row.desiredStates)) await tx.platformCapability.update({ where: { capabilityId }, data: { state } });
        await tx.runtimeCapabilityTransition.update({ where: { transitionId: row.transitionId }, data: { status: "succeeded", hostReceipt: receipt, completedAt: new Date() } });
        await tx.runtimeCapabilityTransitionEvent.create({ data: { transitionId: row.transitionId, outcome: "succeeded", detail: { receipt, source: "startup-reconciler" } } });
      });
    },
    classifyTerminalReceipt: async (row, receipt) => {
      const status = receipt.status === "rolled_back" ? "rolled_back" : receipt.status === "rollback_failed" ? "rollback_failed" : "failed";
      await prisma.$transaction(async (tx) => {
        await tx.runtimeCapabilityTransition.update({ where: { transitionId: row.transitionId }, data: { status, hostReceipt: receipt, failure: { code: receipt.failure ?? status }, completedAt: new Date() } });
        await tx.runtimeCapabilityTransitionEvent.create({ data: { transitionId: row.transitionId, outcome: status, detail: { receipt, source: "startup-reconciler" } } });
      });
      if (status === "rollback_failed") recoveryRequired = true;
    },
    markRecoveryRequired: async (row, reason) => {
      recoveryRequired = true;
      await prisma.$transaction(async (tx) => {
        await tx.runtimeCapabilityTransition.update({ where: { transitionId: row.transitionId }, data: { status: "rollback_failed", failure: { code: reason, recoveryRequired: true }, completedAt: new Date() } });
        await tx.runtimeCapabilityTransitionEvent.create({ data: { transitionId: row.transitionId, outcome: "rollback_failed", detail: { reason, source: "startup-reconciler" } } });
      });
    },
  });
  admission = recoveryRequired ? "recovery_required" : "ready";
}
