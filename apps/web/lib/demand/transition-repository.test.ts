import { describe, expect, it, vi } from "vitest";

import {
  transitionDemandItem,
  type DemandTransitionDb,
} from "./transition-repository";

function repository(stage: string | null = null) {
  const update = vi.fn(async () => ({}));
  const createActivity = vi.fn(async () => ({}));
  const db = {
    backlogItem: {
      findUnique: vi.fn(async () => ({
        id: "row-1",
        itemId: "BI-1",
        status: "open",
        body: "Customers cannot complete a booking.",
        demandStage: stage,
        demandScoreFramework: "rice",
        reach: 20,
        occurrenceCount: 20,
        impact: 2,
        confidence: 0.8,
        businessValue: null,
        timeCriticality: null,
        riskOpportunity: null,
        jobSize: 4,
        effortSize: "medium",
        investmentBucket: "grow",
        estimateAiJobSize: 4,
        estimateHumanJobSize: 4,
        estimateAgreed: true,
        demandEvidenceLinks: [{ id: "evidence-1" }],
      })),
      update,
    },
    backlogItemActivity: { create: createActivity },
    $transaction: vi.fn(async (work: (tx: unknown) => unknown) => work(db)),
  };
  return { db, update, createActivity };
}

describe("transitionDemandItem", () => {
  it("classifies an unclassified item explicitly and records an immutable snapshot", async () => {
    const { db, update, createActivity } = repository();

    const result = await transitionDemandItem(db as unknown as DemandTransitionDb, {
      itemId: "BI-1",
      to: "raw",
      recordedByUserId: "user-1",
    });

    expect(result).toMatchObject({ ok: true, from: "unclassified", to: "raw" });
    expect(update).toHaveBeenCalledWith({
      where: { id: "row-1" },
      data: { demandStage: "raw" },
    });
    expect(createActivity).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: "demand_stage_transition",
        recordedById: "user-1",
        payload: expect.objectContaining({
          from: "unclassified",
          to: "raw",
          evidenceCount: 1,
          score: 8,
          estimateSource: "agreed",
        }),
      }),
    });
  });

  it("rejects skipping evidence and does not write", async () => {
    const { db, update } = repository("raw");
    const existing = await db.backlogItem.findUnique();
    db.backlogItem.findUnique.mockResolvedValue({
      ...existing!,
      body: null,
      demandEvidenceLinks: [],
    } as never);

    const result = await transitionDemandItem(db as unknown as DemandTransitionDb, {
      itemId: "BI-1",
      to: "screened",
    });

    expect(result).toMatchObject({ ok: false, code: "evidence-required" });
    expect(update).not.toHaveBeenCalled();
  });
});
