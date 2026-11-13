// BI-FEDD8F45 — the two daily jobs' bodies, kept out of the queue modules so
// the function-registration graph stays free of @dpf/db (see scheduled-owner).

import { RETIREMENT_ORIGIN_KIND, MAX_WINDOW_DAYS, buildGuardEvidence, fileRetirementReviews, type ReviewItemState } from "./guard-retirement-filing";
import { classifyAndStore, guardMedianDurations, guardOutcomeCounts, guardRunDays, latestDeclarations } from "./guard-outcome-store";
import { GUARD_OUTCOME_OPERATION } from "./guard-outcome-run";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function runGuardOutcomeClassification(now = new Date()) {
  const [{ prisma }, { resolveScheduledOwnerUserId }] = await Promise.all([
    import("@dpf/db"),
    import("@/lib/queue/scheduled-owner"),
  ]);
  const ownerUserId = await resolveScheduledOwnerUserId();
  return classifyAndStore({ db: prisma, now, ownerUserId });
}

export async function runGuardRetirementReview(now = new Date()) {
  const [{ prisma }, { ingestBacklogItem, backlogOriginMarker }] = await Promise.all([
    import("@dpf/db"),
    import("@/lib/operate/backlog-ingest"),
  ]);
  const since = new Date(now.getTime() - MAX_WINDOW_DAYS * DAY_MS);
  const [runDays, outcomes, declarations, medians, earliest] = await Promise.all([
    guardRunDays(prisma, since, now),
    guardOutcomeCounts(prisma, since, now),
    latestDeclarations(prisma),
    guardMedianDurations(prisma, since, now),
    prisma.externalEvidenceRecord.findFirst({
      where: { operationType: GUARD_OUTCOME_OPERATION.run },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
  ]);

  const guardIds = [...new Set(runDays.map((d) => d.guardId))];
  const reviewItems = new Map<string, ReviewItemState>();
  if (guardIds.length > 0) {
    const items = await prisma.backlogItem.findMany({
      where: { OR: guardIds.map((id) => ({ body: { contains: backlogOriginMarker(RETIREMENT_ORIGIN_KIND, id) } })) },
      select: { body: true, status: true, completedAt: true, updatedAt: true },
      orderBy: { createdAt: "desc" },
    });
    for (const id of guardIds) {
      const marker = backlogOriginMarker(RETIREMENT_ORIGIN_KIND, id);
      const mine = items.filter((item) => item.body?.includes(marker));
      if (mine.length === 0) continue;
      const open = mine.some((item) => !["done", "deferred", "retired"].includes(item.status));
      const closed = mine
        .filter((item) => ["done", "deferred", "retired"].includes(item.status))
        .map((item) => item.completedAt ?? item.updatedAt)
        .sort((a, b) => b.getTime() - a.getTime());
      reviewItems.set(id, { guardId: id, open, closedAt: closed[0] ?? null });
    }
  }

  const guards = buildGuardEvidence({
    now,
    runDays,
    outcomes,
    declarations,
    reviewItems,
    medianDurations: medians,
    earliestRecordAt: earliest?.createdAt ?? null,
  });
  return fileRetirementReviews({ now, guards, file: (input) => ingestBacklogItem(input), agentId: "platform-engineer" });
}
