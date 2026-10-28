import { describe, expect, it } from "vitest";

import type { FlowReviewReceipt } from "./flow-review-receipt";
import {
  REVIEW_SIGHTING_SOURCE,
  flowBottleneckRouting,
  readReviewSighting,
  reviewSighting,
  sustainedBottleneck,
  sustainedBottleneckIntake,
} from "./flow-review-escalation";

const SHAPE = "delivery-small@1.0.0";
const H = 3_600_000;
const receipt = (reviewedOn: string, stageKey: string | null, cause: string | null): FlowReviewReceipt => ({
  reviewedOn,
  current: { exits: 10, stepDwellMs: 5 * H, flowEfficiency: 0.1 },
  bottleneck: stageKey ? { stageKey, title: "Repair with a passing proof", roomsHeld: 6, waitMs: 30 * H, cause } : null,
});

describe("reviewSighting", () => {
  it("records one review's bottleneck and cause under an identity of its own, so the review is never counted twice", () => {
    const sighting = reviewSighting(SHAPE, receipt("2026-10-26", "repair", "awaiting-person"), "Small change");
    expect(sighting).toMatchObject({ sourceType: REVIEW_SIGHTING_SOURCE, sourceId: `${SHAPE}|2026-10-26` });
    expect(readReviewSighting(sighting!.evidence)).toEqual({
      shapeRef: SHAPE, reviewedOn: "2026-10-26", queueKey: `wr:${SHAPE}:repair`, stageKey: "repair", cause: "awaiting-person", roomsHeld: 6, waitMs: 30 * H,
    });
  });

  it("records nothing for a review with no bottleneck, or one whose cause was not observed", () => {
    expect(reviewSighting(SHAPE, receipt("2026-10-26", null, null), "Small change")).toBeNull();
    expect(reviewSighting(SHAPE, receipt("2026-10-26", "repair", null), "Small change")).toBeNull();
  });
});

describe("sustainedBottleneck", () => {
  const seen = (reviewedOn: string, stageKey: string, cause: string) =>
    readReviewSighting(reviewSighting(SHAPE, receipt(reviewedOn, stageKey, cause), "Small change")!.evidence)!;

  it("is the pile when two consecutive reviews name the same step and cause", () => {
    expect(sustainedBottleneck(seen("2026-10-26", "repair", "awaiting-person"), seen("2026-10-19", "repair", "awaiting-person")))
      .toMatchObject({ queueKey: `wr:${SHAPE}:repair`, cause: "awaiting-person", reviews: ["2026-10-19", "2026-10-26"] });
  });

  it("is nothing when the step or the cause changed, or there is no earlier review on record", () => {
    expect(sustainedBottleneck(seen("2026-10-26", "repair", "awaiting-person"), seen("2026-10-19", "merge", "awaiting-person"))).toBeNull();
    expect(sustainedBottleneck(seen("2026-10-26", "repair", "awaiting-person"), seen("2026-10-19", "repair", "conformance_pause"))).toBeNull();
    expect(sustainedBottleneck(seen("2026-10-26", "repair", "awaiting-person"), null)).toBeNull();
  });
});

describe("a sustained bottleneck becomes one routed, owned item", () => {
  const pile = sustainedBottleneck(
    readReviewSighting(reviewSighting(SHAPE, receipt("2026-10-26", "repair", "awaiting-person"), "Small change")!.evidence)!,
    readReviewSighting(reviewSighting(SHAPE, receipt("2026-10-19", "repair", "awaiting-person"), "Small change")!.evidence)!,
  )!;

  it("routes it as a gate bound to the shape stage: the pile is decidable from drive data when a room is held there", () => {
    expect(flowBottleneckRouting(SHAPE, "repair")).toEqual({
      kind: "gate",
      question: 1,
      bindsTo: "work-shape:delivery-small#stage:repair",
      reason: expect.stringContaining("decidable"),
    });
  });

  it("files under the pile's identity with the stage's accountable owner and the routing answer", () => {
    const intake = sustainedBottleneckIntake(pile, { shapeTitle: "Small change", stageTitle: "Repair with a passing proof", accountablePrincipalRef: "role:author" });
    expect(intake.origin).toEqual({ kind: "flow-bottleneck", id: `wr:${SHAPE}:repair|awaiting-person` });
    expect(intake.routing).toEqual(flowBottleneckRouting(SHAPE, "repair"));
    expect(intake).toMatchObject({ source: "automated-detection", workType: "bug" });
    expect(intake.title).toBe('Work keeps piling up at "Repair with a passing proof" in Small change (waiting on a person)');
    expect(intake.body).toContain("Accountable: role:author");
    expect(intake.body).toContain("Reviews: 2026-10-19, 2026-10-26");
    expect(intake.body).toContain("Routing: gate, bound to work-shape:delivery-small#stage:repair");
  });
});
