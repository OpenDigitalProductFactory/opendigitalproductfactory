import { describe, expect, it, vi } from "vitest";

import type { FlowReviewReceipt } from "./flow-review-receipt";
import { REVIEW_SIGHTING_SOURCE, reviewSighting } from "./flow-review-escalation";
import { runFlowReviewEscalation, type FlowReviewEscalationDeps } from "./flow-review-escalation.server";
import { getWorkShape } from "./work-shapes";

const definition = getWorkShape("delivery-small")!;
const SHAPE = `${definition.key}@${definition.version}`;
const receipt = (reviewedOn: string, stageKey: string, cause: string | null): FlowReviewReceipt => ({
  reviewedOn,
  current: { exits: 10, stepDwellMs: 1, flowEfficiency: 0.1 },
  bottleneck: { stageKey, title: stageKey, roomsHeld: 5, waitMs: 3_600_000, cause },
});
const history = (...receipts: FlowReviewReceipt[]) => ({
  baselineFrom: "2026-09-01", baselineTo: "2026-09-29", baseline: { exits: 10, stepDwellMs: 1, flowEfficiency: 0.1 }, firstReviewOn: "2026-09-29", receipts,
});

function deps(receipts: FlowReviewReceipt[], stored: Record<string, { signalId: string; evidence: unknown; backlogItemId: string | null }> = {}) {
  const signals = { ...stored };
  const d = {
    loadReviews: vi.fn(async () => [{ definition, shapeRef: SHAPE, history: history(...receipts) }]),
    findSignal: vi.fn(async (sourceType: string, sourceId: string) => signals[`${sourceType}|${sourceId}`] ?? null),
    recordSignal: vi.fn(async (input) => { signals[`${input.sourceType}|${input.sourceId}`] = { signalId: "IS-NEW", evidence: input.evidence, backlogItemId: null }; }),
    ingest: vi.fn(async (_input: Parameters<FlowReviewEscalationDeps["ingest"]>[0]) => ({ itemId: "BI-FILED" })),
  } satisfies FlowReviewEscalationDeps;
  return d;
}
const recorded = (reviewedOn: string, stageKey: string, cause: string) => {
  const s = reviewSighting(SHAPE, receipt(reviewedOn, stageKey, cause), definition.title)!;
  return { [`${REVIEW_SIGHTING_SOURCE}|${s.sourceId}`]: { signalId: "IS-PREV", evidence: s.evidence, backlogItemId: null } };
};

describe("runFlowReviewEscalation", () => {
  it("records the newest review once, and files the pile when the review before named the same step and cause", async () => {
    const d = deps([receipt("2026-10-26", "repair", "awaiting-person"), receipt("2026-10-19", "repair", "awaiting-person")], recorded("2026-10-19", "repair", "awaiting-person"));
    expect(await runFlowReviewEscalation(d)).toEqual({ reviewsRecorded: 1, filed: ["BI-FILED"] });
    const intake = d.ingest.mock.calls[0]![0] as unknown as { origin: unknown; routing: { kind: string }; body: string };
    expect(intake.origin).toEqual({ kind: "flow-bottleneck", id: `wr:${SHAPE}:repair|awaiting-person` });
    expect(intake.routing.kind).toBe("gate");
    expect(intake.body).toContain(`Accountable: ${definition.stages.find((s) => s.key === "repair")!.accountablePrincipalRef}`);
    // The next day changes nothing: the review is already recorded.
    expect(await runFlowReviewEscalation(d)).toEqual({ reviewsRecorded: 0, filed: [] });
    expect(d.ingest).toHaveBeenCalledTimes(1);
  });

  it("records but does not file when the step or cause changed, or the review before was never recorded", async () => {
    const changed = deps([receipt("2026-10-26", "repair", "awaiting-person"), receipt("2026-10-19", "merge", "awaiting-person")], recorded("2026-10-19", "merge", "awaiting-person"));
    expect(await runFlowReviewEscalation(changed)).toEqual({ reviewsRecorded: 1, filed: [] });
    const unrecorded = deps([receipt("2026-10-26", "repair", "awaiting-person"), receipt("2026-10-19", "repair", "awaiting-person")]);
    expect(await runFlowReviewEscalation(unrecorded)).toEqual({ reviewsRecorded: 1, filed: [] });
  });

  it("records nothing for a review without an observed cause", async () => {
    const d = deps([receipt("2026-10-26", "repair", null)]);
    expect(await runFlowReviewEscalation(d)).toEqual({ reviewsRecorded: 0, filed: [] });
    expect(d.recordSignal).not.toHaveBeenCalled();
  });

  it("updates the item the pre-F8c daily signal filed for this pile instead of filing a second", async () => {
    const d = deps([receipt("2026-10-26", "repair", "awaiting-person"), receipt("2026-10-19", "repair", "awaiting-person")], {
      ...recorded("2026-10-19", "repair", "awaiting-person"),
      [`workroom-flow-bottleneck|wr:${SHAPE}:repair|awaiting-person`]: { signalId: "IS-OLD", evidence: {}, backlogItemId: "BI-OLD" },
    });
    await runFlowReviewEscalation(d);
    expect((d.ingest.mock.calls[0]![0] as unknown as { origin: unknown }).origin).toEqual({ kind: "improvement-signal", id: "IS-OLD" });
  });
});
