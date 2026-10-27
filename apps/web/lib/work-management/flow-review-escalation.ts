/**
 * A sustained bottleneck becomes one routed, owned backlog item
 * (BI-3EC4722F, EP-B70E718D F8c). Spec: docs/superpowers/specs/2026-10-02-workroom-flow-map-and-measurement-design.md §8 step 3.
 *
 * A flow review (flow-review-receipt.ts) is a projection over daily stage
 * snapshots, and those snapshots do not record why rooms are held. So the
 * review's bottleneck and cause are recorded when the review happens, as a
 * sighting: one ImprovementSignal per review, immutable, so it neither recurs
 * nor files. When two consecutive reviews name the same pile (queueKey +
 * cause), the pile is filed through the shared intake under that pile's
 * identity, so a later pair updates the open item rather than filing another.
 * The item carries the stage's accountable principal and its routing answer
 * (BI-B146AB6B's rule; this slice decided in DI-58C43DCC688E).
 */
import type { BacklogIngestInput } from "@/lib/operate/backlog-ingest";
import type { RoutingAnswer } from "@/lib/improvement-flywheel/routing-answer";
import type { CreateOrTouchImprovementSignalInput } from "@/lib/improvement-flywheel/signals";

import type { FlowReviewReceipt } from "./flow-review-receipt";
import { describeHoldCause, workroomStageQueueKey } from "./workroom-stage-telemetry";

/** Source of one review's recorded bottleneck; one signal per shape version and review day. */
export const REVIEW_SIGHTING_SOURCE = "workroom-flow-review";
/** The daily pile signal before F8c; an item it filed is updated, not duplicated. */
export const LEGACY_FLOW_BOTTLENECK_SOURCE = "workroom-flow-bottleneck";

export type ReviewSighting = {
  shapeRef: string;
  reviewedOn: string;
  queueKey: string;
  stageKey: string;
  cause: string;
  roomsHeld: number;
  waitMs: number | null;
};

export type SustainedBottleneck = ReviewSighting & { reviews: [string, string] };

/** The signal identity of one shape version's review on one day. */
export function reviewSightingSourceId(shapeRef: string, reviewedOn: string): string {
  return `${shapeRef}|${reviewedOn}`;
}

const why = (cause: string) => (cause === "awaiting-person" ? describeHoldCause(cause) : `blocked: ${describeHoldCause(cause)}`);

/** Record a review's bottleneck and cause; nothing when it named none or its cause was not observed. */
export function reviewSighting(shapeRef: string, receipt: FlowReviewReceipt, shapeTitle: string): CreateOrTouchImprovementSignalInput | null {
  const top = receipt.bottleneck;
  if (!top?.cause) return null;
  const sighting: ReviewSighting = {
    shapeRef,
    reviewedOn: receipt.reviewedOn,
    queueKey: workroomStageQueueKey(shapeRef, top.stageKey),
    stageKey: top.stageKey,
    cause: top.cause,
    roomsHeld: top.roomsHeld,
    waitMs: top.waitMs,
  };
  return {
    sourceType: REVIEW_SIGHTING_SOURCE,
    sourceId: reviewSightingSourceId(shapeRef, receipt.reviewedOn),
    title: `Flow review ${receipt.reviewedOn}: most waiting at "${top.title}" in ${shapeTitle} (${why(top.cause)})`,
    evidence: { ...sighting },
    immutable: true,
  };
}

/** A recorded sighting read back from its signal evidence, or null when the evidence is not one. */
export function readReviewSighting(evidence: unknown): ReviewSighting | null {
  if (!evidence || typeof evidence !== "object") return null;
  const e = evidence as Record<string, unknown>;
  const str = (key: string) => (typeof e[key] === "string" ? (e[key] as string) : null);
  const shapeRef = str("shapeRef"), reviewedOn = str("reviewedOn"), queueKey = str("queueKey"), stageKey = str("stageKey"), cause = str("cause");
  if (!shapeRef || !reviewedOn || !queueKey || !stageKey || !cause || typeof e.roomsHeld !== "number") return null;
  return { shapeRef, reviewedOn, queueKey, stageKey, cause, roomsHeld: e.roomsHeld, waitMs: typeof e.waitMs === "number" ? e.waitMs : null };
}

/** The pile, when this review and the one before it named the same step and cause. */
export function sustainedBottleneck(latest: ReviewSighting, previous: ReviewSighting | null): SustainedBottleneck | null {
  if (!previous || previous.queueKey !== latest.queueKey || previous.cause !== latest.cause) return null;
  return { ...latest, reviews: [previous.reviewedOn, latest.reviewedOn] };
}

/**
 * The routing answer for a sustained pile at a stage. Question 1 holds: whether
 * rooms are piling at a step, and why, is decidable from the drive's data at
 * the moment it holds a room there. So the control is a gate bound to that
 * shape stage, which every room of the shape inherits.
 */
export function flowBottleneckRouting(shapeRef: string, stageKey: string): RoutingAnswer {
  const bindsTo = `work-shape:${shapeRef.split("@")[0]}#stage:${stageKey}`;
  return {
    kind: "gate",
    question: 1,
    bindsTo,
    reason: "Rooms held at the step, and why, are decidable from the drive's data when it holds a room there, so a gate at that stage can act on them.",
  };
}

/** The intake for a sustained pile: its identity, owner, routing answer and the evidence of both reviews. */
export function sustainedBottleneckIntake(
  pile: SustainedBottleneck,
  names: { shapeTitle: string; stageTitle: string; accountablePrincipalRef: string },
  origin: { kind: string; id: string } = { kind: "flow-bottleneck", id: `${pile.queueKey}|${pile.cause}` },
): BacklogIngestInput & { routing: RoutingAnswer; origin: { kind: string; id: string } } {
  const routing = flowBottleneckRouting(pile.shapeRef, pile.stageKey);
  return {
    title: `Work keeps piling up at "${names.stageTitle}" in ${names.shapeTitle} (${why(pile.cause)})`,
    body: [
      `Two consecutive flow reviews of ${pile.shapeRef} named the same bottleneck: step "${names.stageTitle}" (${pile.stageKey}), ${why(pile.cause)}.`,
      `Reviews: ${pile.reviews.join(", ")}. At the latest, ${pile.roomsHeld} rooms were held there${pile.waitMs != null ? `, typically waiting ${Math.round(pile.waitMs / 3_600_000)}h` : ""}.`,
      `Accountable: ${names.accountablePrincipalRef} (the stage's accountable principal).`,
      `Routing: ${routing.kind}, bound to ${routing.bindsTo}. ${routing.reason}`,
      `Stage queue: ${pile.queueKey}. The shape's drill-in on the area Work view shows each review against its baseline.`,
    ].join("\n\n"),
    workType: "bug",
    source: "automated-detection",
    origin,
    routing,
  };
}
