/**
 * Identity of a self-upgrade whose swap already landed and whose ledger was
 * then marked failed by the retried swap step. SUR-6D9543E6, SUR-8F1389F9.
 *
 * The drain guard's error is "the drain already ended (completed)". That drain
 * ended because boot reconciliation closed it after the new portal came up on
 * the target, not because admission reopened.
 */
export const LANDED_SWAP_FALSE_FAILURE_REASON =
  "admission-reopened-before-swap: the drain already ended (completed)";

/**
 * The retried swap step is running inside the portal the promoter just booted.
 * That image's identity is the target, and the run's currentSha is still the
 * pre-swap image. False when the running identity is still the pre-swap SHA.
 */
export function resumedSwapAlreadyLanded(input: {
  deployedSha: string | null | undefined;
  targetSha: string | null | undefined;
  currentSha: string | null | undefined;
}): boolean {
  if (!input.deployedSha || !input.targetSha || !input.currentSha) return false;
  const deployed = input.deployedSha.toLowerCase();
  return deployed === input.targetSha.toLowerCase() && deployed !== input.currentSha.toLowerCase();
}

type LandedSwapFalseFailureRow = {
  runId: string;
  currentSha: string | null;
  deployedSha: string | null;
  targetSha: string | null;
};

/**
 * Correct rows the retried swap step marked failed after the new portal was
 * already the target. Returns how many rows were completed. Cooldown clearing
 * is non-fatal: a failed clear must not hide the ledger correction.
 */
export async function healLandedSwapFalseFailures(input: {
  deployedSha: string | null;
  completeRun: (runId: string) => Promise<unknown>;
  logger: Pick<Console, "log" | "error">;
  findFailedRuns?: (reason: string) => Promise<LandedSwapFalseFailureRow[] | null | undefined>;
}): Promise<number> {
  const findFailedRuns = input.findFailedRuns ?? (async (reason: string) => {
    const { prisma } = await import("@dpf/db");
    return prisma.selfUpgradeRun.findMany({
      where: { status: "failed", reason },
      select: { runId: true, currentSha: true, deployedSha: true, targetSha: true },
    });
  });
  const rows = (await findFailedRuns(LANDED_SWAP_FALSE_FAILURE_REASON)) ?? [];
  let healed = 0;
  for (const run of rows) {
    if (!resumedSwapAlreadyLanded({
      deployedSha: input.deployedSha,
      targetSha: run.deployedSha ?? run.targetSha,
      currentSha: run.currentSha,
    })) continue;
    await input.completeRun(run.runId);
    healed++;
    input.logger.log(`[self-upgrade-reconcile] ${run.runId} -> succeeded (landed swap had been recorded failed)`);
  }
  if (healed > 0) {
    try {
      const { clearCooldown } = await import("@/lib/self-upgrade/cooldown");
      await clearCooldown();
    } catch (err) {
      input.logger.error("[self-upgrade-reconcile] landed-swap cooldown clear failed (non-fatal):", err);
    }
  }
  return healed;
}
