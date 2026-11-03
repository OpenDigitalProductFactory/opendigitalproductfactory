import { prisma, Prisma } from "@dpf/db";
import { publishRunCompletion, type SelfUpgradeRunRow } from "./run-store";
import { LANDED_SWAP_FALSE_FAILURE_REASON, resumedSwapAlreadyLanded } from "./landed-swap-identity";

type FailedSwap = SelfUpgradeRunRow & { changeRequest: {
  id: string; status: string; outcome: string | null;
  impactReport: Prisma.JsonValue; postChangeVerification: Prisma.JsonValue;
} | null };
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function exact(left: unknown, right: unknown): boolean {
  return typeof left === "string" && !!left && typeof right === "string" && left.toLowerCase() === right.toLowerCase();
}

/** The paired closed RFC survives the erroneous late failure's mirror attempt.
 * Require its own run, both source identities, and success before the failure. */
function priorCompletion(run: FailedSwap): Date | null {
  const change = run.changeRequest;
  if (!change || change.id !== run.changeRequestId || change.status !== "closed" || change.outcome !== "succeeded") return null;
  const impact = object(change.impactReport);
  const verification = object(change.postChangeVerification);
  if (impact.source !== "self-upgrade" || impact.runId !== run.runId ||
      !exact(impact.fromSha, run.currentSha) || !exact(impact.toSha, run.targetSha ?? run.deployedSha) ||
      !exact(verification.deployedSha, run.deployedSha ?? run.targetSha)) return null;
  const completed = typeof verification.completedAt === "string" ? new Date(verification.completedAt) : null;
  if (!completed || !Number.isFinite(completed.getTime()) || !run.startedAt || !run.completedAt ||
      completed < run.startedAt || completed >= run.completedAt) return null;
  return completed;
}

/** Only this exact replay defect may correct a terminal failed run. Ordinary
 * completion remains fenced. Newer releases can use the run's successful RFC;
 * the current image is useful only when it exactly matches this run's target. */
export async function healLandedSwapFalseFailures(input: {
  deployedSha: string | null;
  logger: Pick<Console, "log" | "error">;
  now?: Date;
}): Promise<number> {
  const rows = await prisma.selfUpgradeRun.findMany({
    where: { status: "failed", dryRun: false, reason: LANDED_SWAP_FALSE_FAILURE_REASON, failureLog: LANDED_SWAP_FALSE_FAILURE_REASON },
    include: { changeRequest: { select: { id: true, status: true, outcome: true, impactReport: true, postChangeVerification: true } } },
  });
  let healed = 0;
  for (const run of rows) {
    if (run.status !== "failed" || run.dryRun || run.reason !== LANDED_SWAP_FALSE_FAILURE_REASON || run.failureLog !== LANDED_SWAP_FALSE_FAILURE_REASON) continue;
    const prior = priorCompletion(run);
    const observed = resumedSwapAlreadyLanded({ deployedSha: input.deployedSha, targetSha: run.deployedSha ?? run.targetSha, currentSha: run.currentSha });
    if (!prior && !observed) continue;
    const now = input.now ?? new Date();
    // Compare the evidence and row state in the UPDATE as well as above. A
    // concurrent cancellation, new evidence or edited RFC invalidates this proof.
    const where: Prisma.SelfUpgradeRunWhereUniqueInput = {
      runId: run.runId, status: "failed", dryRun: false,
      reason: LANDED_SWAP_FALSE_FAILURE_REASON, failureLog: LANDED_SWAP_FALSE_FAILURE_REASON,
      currentSha: run.currentSha, targetSha: run.targetSha, deployedSha: run.deployedSha,
      startedAt: run.startedAt, completedAt: run.completedAt, AND: [{ changeRequestId: run.changeRequestId }],
      completionEvidence: { equals: run.completionEvidence ?? Prisma.DbNull },
      ...(prior && run.changeRequest ? { changeRequest: { is: {
        id: run.changeRequest.id, status: "closed", outcome: "succeeded",
        impactReport: { equals: run.changeRequest.impactReport ?? Prisma.DbNull },
        postChangeVerification: { equals: run.changeRequest.postChangeVerification ?? Prisma.DbNull },
      } } } : {}),
    };
    let updated: SelfUpgradeRunRow;
    try {
      updated = await prisma.selfUpgradeRun.update({ where, data: {
        status: "succeeded", completedAt: prior ?? now, reason: null, failureLog: null,
        completionEvidence: {
          ...object(run.completionEvidence),
          landedSwapRecovery: {
            source: prior ? "change-record" : "running-image", recoveredAt: now.toISOString(),
            observedDeployedSha: input.deployedSha, changeRequestId: prior ? run.changeRequestId : null,
            previousFailure: { reason: run.reason, failureLog: run.failureLog, completedAt: run.completedAt?.toISOString() ?? null },
          },
        } as Prisma.InputJsonValue,
      } });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2025") continue;
      throw error;
    }
    healed++;
    await publishRunCompletion(updated);
    input.logger.log("[self-upgrade-reconcile] " + run.runId + " -> succeeded (verified landed-swap replay correction)");
  }
  // Cooldown is global, not run-owned: a historical correction must never
  // erase backoff belonging to a newer genuine failure.
  return healed;
}
