import { describe, expect, it, vi } from "vitest";
import { computeWeeklyReview } from "./decision-engine-review-task";
import { loadReviewWindow, REVIEW_WINDOW_ROW_CAP } from "./load-review-window";

const NOW = new Date("2026-10-25T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);
function row(id: string, days: number, chosenOptionId: string | null = null) {
  return {
    interactionId: id, profileId: "platform", gateKey: "kernel-consult",
    domainClass: "architecture", outcomeType: "recommend", riskTier: "low",
    question: "Which approach preserves the existing contract?", gateFallbackUsed: false,
    outcomePayload: null, routeContext: null, recommendedOptionId: "a" as string | null,
    chosenOptionId, createdAt: daysAgo(days),
  };
}

/** Apply actual date/recommendation predicates, unlike an unconditional fixture return. */
function ledgerDb(rows: ReturnType<typeof row>[]) {
  return {
    decisionInteraction: { findMany: vi.fn(async (args: {
      where: { createdAt: { gte?: Date; lte?: Date }; recommendedOptionId?: { not: null } };
      take: number;
    }) => rows.filter(r => {
      const range = args.where.createdAt;
      return (!range.gte || r.createdAt >= range.gte)
        && (!range.lte || r.createdAt <= range.lte)
        && (!args.where.recommendedOptionId || r.recommendedOptionId !== null);
    }).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()
      || b.interactionId.localeCompare(a.interactionId)).slice(0, args.take)) },
    decisionPerspectiveProfile: { findMany: vi.fn(async () => [{ profileId: "platform", kind: "platform" }]) },
    perspectiveMaterial: { groupBy: vi.fn(async () => []) },
  };
}

describe("weekly activity and overdue recorded choices", () => {
  it("reports ten-day-old missing choices without inflating this week's activity", async () => {
    const db = ledgerDb([
      row("recent", 1), row("missing-10", 10), row("missing-11", 11),
      row("recorded-12", 12, "a"),
      { ...row("no-recommendation", 13), recommendedOptionId: null },
    ]);
    const { lines } = await computeWeeklyReview({ db, now: NOW });
    expect(lines.find(l => l.lineKey === "unlearned:kernel-consult")).toMatchObject({
      evidence: { total: 3, unlearned: 2, ratio: 0.67 },
    });
    expect(lines.find(l => l.lineKey === "volume")?.evidence.total).toBe(1);
  });

  it("loads both recorded and missing choices into the overdue denominator", async () => {
    const result = await loadReviewWindow(ledgerDb([
      row("recent", 1), row("missing", 10), row("recorded", 12, "a"),
      { ...row("no-recommendation", 15), recommendedOptionId: null },
    ]), { now: NOW });
    expect(result.overdueRows.map(r => r.interactionId)).toEqual(["missing", "recorded"]);
    expect(result.rows.map(r => r.interactionId)).toEqual(["recent"]);
    expect(result.overdueCoverage.complete).toBe(true);
  });

  it("keeps the fixed seven-day maturity cutoff when the recent window changes", async () => {
    const result = await loadReviewWindow(ledgerDb([
      row("recent", 1), row("outside-recent", 4), row("not-mature", 6), row("mature", 8),
    ]), { now: NOW, days: 3 });
    expect(result.rows.map(r => r.interactionId)).toEqual(["recent"]);
    expect(result.overdueRows.map(r => r.interactionId)).toEqual(["mature"]);
  });

  it("includes the exact maturity cutoff and excludes future recommendations", async () => {
    const result = await loadReviewWindow(ledgerDb([
      row("cutoff", 7), row("not-yet", 7 - 1 / 86_400_000), row("future", -1),
    ]), { now: NOW });
    expect(result.overdueRows.map(r => r.interactionId)).toEqual(["cutoff"]);
    expect(result.rows.some(r => r.interactionId === "future")).toBe(false);
  });

  it("detects overflow even when the sampled choices would raise no finding", async () => {
    const db = ledgerDb(Array.from({ length: REVIEW_WINDOW_ROW_CAP + 1 },
      (_, i) => row(String(i).padStart(6, "0"), 10, "a")));
    const window = await loadReviewWindow(db, { now: NOW });
    expect(window.overdueRows).toHaveLength(REVIEW_WINDOW_ROW_CAP);
    expect(window.overdueCoverage).toEqual({ complete: false, rowLimit: REVIEW_WINDOW_ROW_CAP });
    const { lines } = await computeWeeklyReview({ db, now: NOW });
    expect(lines.find(l => l.lineKey === "unlearned:coverage")).toMatchObject({
      proposedAction: "no-action",
      evidence: { coverageComplete: 0, sampled: REVIEW_WINDOW_ROW_CAP, rowLimit: REVIEW_WINDOW_ROW_CAP },
    });
    expect(lines.find(l => l.lineKey === "unlearned:coverage")?.headline).toMatch(/incomplete/i);
  });

  it("does not claim overflow when the population fits exactly at its limit", async () => {
    const db = ledgerDb(Array.from({ length: REVIEW_WINDOW_ROW_CAP },
      (_, i) => row(String(i), 10, "a")));
    const result = await loadReviewWindow(db, { now: NOW });
    expect(result.overdueCoverage.complete).toBe(true);
  });

  it("uses a deterministic tie-break and one look-ahead row for the older read", async () => {
    const db = ledgerDb([]);
    await loadReviewWindow(db, { now: NOW });
    expect(db.decisionInteraction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { createdAt: { lte: daysAgo(7) }, recommendedOptionId: { not: null } },
      orderBy: [{ createdAt: "desc" }, { interactionId: "desc" }],
      take: REVIEW_WINDOW_ROW_CAP + 1,
    }));
  });
});
