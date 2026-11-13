/**
 * The daily flow review (BI-3EC4722F, EP-B70E718D F8c): record each shape
 * version's newest review the day it happens, and file a pile that two
 * consecutive reviews named. The rules are pure in flow-review-escalation.ts;
 * this binds them to the store.
 */
import type { BacklogIngestInput } from "@/lib/operate/backlog-ingest";
import type { CreateOrTouchImprovementSignalInput } from "@/lib/improvement-flywheel/signals";

import type { FlowReviewHistory } from "./flow-review-receipt";
import {
  LEGACY_FLOW_BOTTLENECK_SOURCE,
  REVIEW_SIGHTING_SOURCE,
  readReviewSighting,
  reviewSighting,
  reviewSightingSourceId,
  sustainedBottleneck,
  sustainedBottleneckIntake,
} from "./flow-review-escalation";
import type { WorkShapeDefinition } from "./work-shapes";

export type FlowReviewEscalationDeps = {
  /** Every current shape version that has stage data, with its reviews newest first. */
  loadReviews: () => Promise<{ definition: WorkShapeDefinition; shapeRef: string; history: NonNullable<FlowReviewHistory> }[]>;
  findSignal: (sourceType: string, sourceId: string) => Promise<{ signalId: string; evidence: unknown; backlogItemId: string | null } | null>;
  recordSignal: (input: CreateOrTouchImprovementSignalInput) => Promise<unknown>;
  ingest: (input: BacklogIngestInput) => Promise<{ itemId: string }>;
};

export type FlowReviewEscalationResult = { reviewsRecorded: number; filed: string[] };

export async function runFlowReviewEscalation(deps: FlowReviewEscalationDeps): Promise<FlowReviewEscalationResult> {
  const result: FlowReviewEscalationResult = { reviewsRecorded: 0, filed: [] };
  for (const { definition, shapeRef, history } of await deps.loadReviews()) {
    const [latest, previous] = history.receipts;
    if (!latest) continue;
    const sighting = reviewSighting(shapeRef, latest, definition.title);
    if (!sighting) continue;
    // A review is recorded once, the first day the job sees it; later days change nothing.
    if (await deps.findSignal(REVIEW_SIGHTING_SOURCE, sighting.sourceId)) continue;
    await deps.recordSignal(sighting);
    result.reviewsRecorded += 1;
    if (!previous) continue;
    const before = await deps.findSignal(REVIEW_SIGHTING_SOURCE, reviewSightingSourceId(shapeRef, previous.reviewedOn));
    const pile = sustainedBottleneck(readReviewSighting(sighting.evidence)!, readReviewSighting(before?.evidence));
    if (!pile) continue;
    const stage = definition.stages.find((candidate) => candidate.key === pile.stageKey);
    // An item the pre-F8c daily signal already filed for this pile is updated, not duplicated.
    const legacy = await deps.findSignal(LEGACY_FLOW_BOTTLENECK_SOURCE, `${pile.queueKey}|${pile.cause}`);
    const intake = sustainedBottleneckIntake(
      pile,
      {
        shapeTitle: definition.title,
        stageTitle: stage?.title ?? pile.stageKey,
        accountablePrincipalRef: stage?.accountablePrincipalRef ?? "role:unassigned",
      },
      legacy?.backlogItemId ? { kind: "improvement-signal", id: legacy.signalId } : undefined,
    );
    const filed = await deps.ingest(intake);
    result.filed.push(filed.itemId);
  }
  return result;
}

/** The store-backed dependencies. */
export async function defaultFlowReviewEscalationDeps(): Promise<FlowReviewEscalationDeps> {
  const { prisma } = await import("@dpf/db");
  const { createOrTouchImprovementSignal } = await import("@/lib/improvement-flywheel/signals");
  const { ingestBacklogItem } = await import("@/lib/operate/backlog-ingest");
  const { loadCurrentFlowReviews } = await import("./area-flow.server");
  return {
    loadReviews: () => loadCurrentFlowReviews(),
    findSignal: (sourceType, sourceId) =>
      prisma.improvementSignal.findUnique({
        where: { sourceType_sourceId: { sourceType, sourceId } },
        select: { signalId: true, evidence: true, backlogItemId: true },
      }),
    recordSignal: (input) => createOrTouchImprovementSignal(input),
    ingest: (input) => ingestBacklogItem(input),
  };
}
