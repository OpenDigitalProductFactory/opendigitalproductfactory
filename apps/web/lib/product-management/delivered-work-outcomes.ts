// BI-8DE5429B (reworks BI-42399593): every observation is about ONE backlog
// item's own outcome.
//
// Founder direction 2026-10-28: "The outcome is an aspect of the BI." So what
// is measured is that item's stated (or derived) outcome, at the moments the
// platform learns something about it (WWMD DI-19ED69C312FC):
//
//   delivered         -> achieved      (delivery closes an item by default,
//                                       founder direction 2026-10-27, BI-B1B44777)
//   reopened from done -> regressed
//   failing evidence recorded while the item is done -> not-achieved
//
// The epic-derived and standing platform-work objectives stay only as the
// roll-up the observations hang on (DI-9A293A1A31A3, DI-F3101AA957C7). Their
// rate is the mean of these per-item values, derived from the items; nothing
// authors an aggregate any more (the cohort hold rate of DI-321FE7AC7AA4 is
// superseded).

import { createHash } from "node:crypto";

import { evidenceKindMetadata, isExecutionEvidenceKind } from "@/lib/backlog/execution-evidence";

export const ITEM_OUTCOME_METHOD = "item-outcome.v1";
export const ITEM_OUTCOME_DECISION_REFS = ["DI-19ED69C312FC", "DI-342D45001EF5", "DI-9A293A1A31A3", "DI-F3101AA957C7"] as const;

/** The origin of the standing objective, whose sourceRef is the designated Product's id. */
export const PLATFORM_WORK_OBJECTIVE_SOURCE_KIND = "platform-work";
/** The origin of an epic-derived objective, whose sourceRef is the epic's semantic id. */
export const EPIC_OBJECTIVE_SOURCE_KIND = "epic";
/** ProductOutcomeObservation.sourceKind for every observation in the delivery lifecycle. */
export const DELIVERY_OBSERVATION_SOURCE_KIND = "delivery";

export const ITEM_OUTCOME_RESULTS = ["achieved", "not-achieved", "regressed"] as const;
export type ItemOutcomeResult = (typeof ITEM_OUTCOME_RESULTS)[number];

export const ITEM_OUTCOME_EVENTS = ["delivered", "reopened", "failing-evidence"] as const;
export type ItemOutcomeEvent = (typeof ITEM_OUTCOME_EVENTS)[number];

export const ITEM_OUTCOME_RESULT_FOR_EVENT: Readonly<Record<ItemOutcomeEvent, ItemOutcomeResult>> = {
  delivered: "achieved",
  reopened: "regressed",
  "failing-evidence": "not-achieved",
};

/**
 * The objective's percentage measure, per observation: 100 when the item's
 * outcome is achieved, 0 when it is not or has regressed. The mean over an
 * objective's observations is the share of item outcomes that held.
 */
export function itemOutcomeValue(result: ItemOutcomeResult): number {
  return result === "achieved" ? 100 : 0;
}

export const ITEM_OUTCOME_MEASURE_DEFINITION =
  "Share of this objective's backlog item outcomes that held. Each observation is one item event, "
  + "measured against that item's own outcome: delivered = achieved (100); reopened from done = regressed (0); "
  + "failing evidence while done = not achieved (0). Recorded by the platform; nothing is authored as an aggregate.";

const PLATFORM_WORK_SCOPES = new Set(["platform", "common", "unknown"]);

/**
 * Platform, common and never-scoped work (operator decision 2026-10-07:
 * these count as Foundational). Work scoped to an archetype or a business
 * Product belongs to that owner's objectives instead.
 */
export function isPlatformWorkScope(item: { scopeKind: string | null; businessProductId: string | null }): boolean {
  if (item.businessProductId) return false;
  return item.scopeKind == null || PLATFORM_WORK_SCOPES.has(item.scopeKind);
}

/** One observation per item event: the event and the fact that triggered it identify it. */
export function itemOutcomeSourceRef(itemId: string, event: ItemOutcomeEvent, eventRef: string): string {
  return `${itemId}:${event}:${eventRef}`;
}

/** A stable short digest of the outcome text, so a later edit is visible against what was measured. */
export function outcomeDigest(outcome: string): string {
  return `sha256:${createHash("sha256").update(outcome.trim()).digest("hex").slice(0, 16)}`;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** The execution-evidence kinds whose polarity is fail; a failing check after delivery. */
export function isFailingEvidencePayload(payload: unknown): boolean {
  const kind = record(payload)?.evidenceKind;
  return isExecutionEvidenceKind(kind) && evidenceKindMetadata(kind).polarity === "fail";
}

/**
 * Which item event an activity is, if any. A status change out of done is a
 * reopen. Failing evidence counts only when it lands after the item was
 * delivered and while it is still done; before delivery it is ordinary work.
 */
export function classifyItemOutcomeActivity(
  activity: { kind: string; recordedAt: Date; payload: unknown },
  item: { status: string; completedAt: Date | null },
): ItemOutcomeEvent | null {
  const payload = record(activity.payload);
  if (activity.kind === "status_change" && payload?.from === "done" && payload.to !== "done") return "reopened";
  if (activity.kind === "evidence" && isFailingEvidencePayload(activity.payload)
    && item.status === "done" && item.completedAt && activity.recordedAt > item.completedAt) {
    return "failing-evidence";
  }
  return null;
}
