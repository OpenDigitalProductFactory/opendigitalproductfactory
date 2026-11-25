import { prisma, type Prisma } from "@dpf/db";
import { QUIESCENCE_CONFIG_KEY, type EnteredStateAt } from "./quiescence-contract";
import { isRecord } from "@/lib/shared/coerce";
import { QuiescenceOwnershipError, withQuiescenceStartSerialization, type QuiescenceReservationDb } from "./quiescence-start-reservation";
import { readyToSwapBudgetMs, readyToSwapDeadline, resolveConfirmedUpgradeWindow } from "./ready-to-swap-window";

export type ReadyTransition =
  | { kind: "ready"; trigger: string; deadline: string }
  | { kind: "aborted"; operator: string };

/** Commit readiness and its deadline together under the existing owner lock.
 * A replay can read the first commitment (even after expiry), never renew it. */
export async function enterReadyToSwap(
  runId: string,
  triggerRefId: string | null,
  actualWaitMs: number,
  clock: () => Date = () => new Date(),
): Promise<ReadyTransition> {
  return withQuiescenceStartSerialization(prisma as unknown as QuiescenceReservationDb, QUIESCENCE_CONFIG_KEY, async (store) => {
    const tx = store as unknown as Prisma.TransactionClient;
    const config = (await tx.platformConfig.findUnique({ where: { key: QUIESCENCE_CONFIG_KEY } }))?.value;
    if (!isRecord(config) || config.runId !== runId || config.level !== "draining") throw new QuiescenceOwnershipError(null);
    await tx.$executeRaw`SELECT 1 FROM "QuiescenceRun" WHERE "runId" = ${runId} FOR UPDATE`;
    const row = await tx.quiescenceRun.findUnique({ where: { runId } });
    if (!row || row.triggerRefId !== triggerRefId) throw new QuiescenceOwnershipError(runId);
    if (row.abortRequestedAt) return { kind: "aborted", operator: row.abortRequestedBy ?? "unknown" };
    if (row.status === "ready-to-swap") {
      const deadline = readyToSwapDeadline(row);
      if (!deadline) throw new Error("Ready drain has no trustworthy deadline");
      return { kind: "ready", trigger: row.trigger, deadline: deadline.toISOString() };
    }
    if ((row.status !== "draining" && row.status !== "awaiting-operator") || row.readyToSwapDeadlineAt) {
      throw new QuiescenceOwnershipError(runId);
    }
    const budgetMs = row.readyToSwapBudgetMs
      ?? (row.trigger === "self-upgrade" ? resolveConfirmedUpgradeWindow() : readyToSwapBudgetMs("unrelated"));
    const now = clock();
    const deadline = new Date(+now + budgetMs);
    await tx.quiescenceRun.update({
      where: { runId },
      data: {
        status: "ready-to-swap",
        enteredStateAt: { ...(row.enteredStateAt as EnteredStateAt), "ready-to-swap": now.toISOString() },
        readyToSwapDeadlineAt: deadline,
        actualWaitMs,
      },
    });
    return { kind: "ready", trigger: row.trigger, deadline: deadline.toISOString() };
  });
}
