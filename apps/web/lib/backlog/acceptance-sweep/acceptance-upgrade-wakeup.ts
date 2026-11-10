import type { SweepUpgrade } from "./acceptance-sweep-checkpoint";

type UpgradeRow = { id: string; runId: string; status: string; dryRun: boolean; deployedSha: string | null; completedAt: Date | null };
export type AcceptanceWakeupPorts = {
  readServedIdentity(): Promise<string | null>;
  readLatestUpgrade(): Promise<UpgradeRow | null>;
  taskEnabled(): Promise<boolean>;
  wake(upgrade: SweepUpgrade | null): Promise<void>;
};

export async function reconcileAcceptanceUpgradeWakeup(ports: AcceptanceWakeupPorts): Promise<
  { outcome: "reconciled"; runId: string } | { outcome: "disabled-or-missing" | "unproven" }
> {
  if (!await ports.taskEnabled()) return { outcome: "disabled-or-missing" };
  const [served, run] = await Promise.all([ports.readServedIdentity(), ports.readLatestUpgrade()]);
  if (!served || !/^[a-f0-9]{40}$/i.test(served) || !run || run.status !== "succeeded" || run.dryRun
    || !run.completedAt || run.deployedSha?.toLowerCase() !== served.toLowerCase()) {
    await ports.wake(null); // Recover an expired daily sweep; no upgrade admitted.
    return { outcome: "unproven" };
  }
  await ports.wake({ runId: run.runId, rowId: run.id, completedAt: run.completedAt.toISOString() });
  return { outcome: "reconciled", runId: run.runId };
}

/** Event acceleration and cron backstop use the same admission path. */
export async function reconcileAcceptanceUpgradeWakeupFromStore() {
  const { prisma } = await import("@dpf/db");
  const { ACCEPTANCE_SWEEP_TASK_ID } = await import("@dpf/db/acceptance-sweep-config");
  const { getDeployedSha } = await import("@/lib/self-upgrade/completion");
  const { wakeAcceptanceSweep } = await import("./acceptance-sweep-lease");
  return reconcileAcceptanceUpgradeWakeup({
    readServedIdentity: getDeployedSha,
    readLatestUpgrade: () => prisma.selfUpgradeRun.findFirst({
      where: { status: "succeeded", dryRun: false, completedAt: { not: null } },
      orderBy: [{ completedAt: "desc" }, { id: "desc" }],
      select: { id: true, runId: true, status: true, dryRun: true, deployedSha: true, completedAt: true },
    }),
    taskEnabled: async () => (await prisma.scheduledAgentTask.findUnique({
      where: { taskId: ACCEPTANCE_SWEEP_TASK_ID }, select: { isActive: true },
    }))?.isActive === true,
    wake: observed => wakeAcceptanceSweep(prisma, ACCEPTANCE_SWEEP_TASK_ID, observed),
  });
}
