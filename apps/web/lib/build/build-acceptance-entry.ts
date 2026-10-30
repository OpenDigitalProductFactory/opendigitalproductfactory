// apps/web/lib/build/build-acceptance-entry.ts
//
// BI-729D9B27 step 4: once a Build Studio build's merged change is proven live,
// its originating item owes independent acceptance on the live install. The
// acceptance sweep's steward lane is where that happens (WWMD DI-C80874472B8C),
// and it only takes items awaiting acceptance. Nothing moved a build-originated
// item there: the PR actuator links PRs by room branch or BI ids in the PR
// text, and a Build Studio PR carries neither. The ship reconciler calls this
// the moment the build's deployment proof holds.

import { prisma } from "@dpf/db";
import { isBacklogStatus, isLegalTransition } from "@/lib/backlog/transitions";

/** The status_change actuator the sweep routes at once, without the aged-item wait. */
export const BUILD_DELIVERY_ACTUATOR = "build-delivery-proven" as const;

const AWAITING_ACCEPTANCE = "awaiting-acceptance" as const;

export type BuildAcceptanceEntryDb = {
  featureBuild: { findUnique(args: unknown): Promise<{ originator: { id: string; itemId: string; status: string } | null } | null> };
  $transaction<T>(work: (tx: {
    backlogItem: { updateMany(args: unknown): Promise<{ count: number }> };
    backlogItemActivity: { create(args: unknown): Promise<unknown> };
  }) => Promise<T>): Promise<T>;
};

/** Move a deployed build's originating item to awaiting-acceptance. Idempotent; returns whether it moved. */
export async function enterAcceptanceOnDeployedBuild(
  buildId: string,
  db: BuildAcceptanceEntryDb = prisma as unknown as BuildAcceptanceEntryDb,
): Promise<boolean> {
  const build = await db.featureBuild.findUnique({
    where: { buildId },
    select: { originator: { select: { id: true, itemId: true, status: true } } },
  });
  const item = build?.originator;
  if (!item || !isBacklogStatus(item.status) || item.status === AWAITING_ACCEPTANCE) return false;
  if (!isLegalTransition(item.status, AWAITING_ACCEPTANCE)) return false;
  const from = item.status;
  return db.$transaction(async (tx) => {
    // Guarded on the status read above, so a concurrent move is never overwritten.
    const moved = await tx.backlogItem.updateMany({
      where: { id: item.id, status: from },
      data: { status: AWAITING_ACCEPTANCE, claimStatus: "released", claimedById: null, claimedByAgentId: null, claimedAt: null },
    });
    if (moved.count === 0) return false;
    await tx.backlogItemActivity.create({ data: {
      backlogItemId: item.id,
      kind: "status_change",
      summary: `${from} → ${AWAITING_ACCEPTANCE} — ${buildId}'s merged change is live; independent acceptance on the live install is owed`,
      payload: { from, to: AWAITING_ACCEPTANCE, actuator: BUILD_DELIVERY_ACTUATOR, buildId, claimAction: "released" },
    } });
    return true;
  });
}
