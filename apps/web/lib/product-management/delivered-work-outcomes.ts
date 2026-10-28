// BI-42399593: delivered platform work records whether it achieved its purpose.
//
// Founder direction 2026-10-27 (BI-B1B44777): a merge closes an item, and a
// change that missed its purpose comes back as a reopen or a failure someone
// reports. So "did it hold?" is measurable from facts the platform already
// keeps, with no person in the loop:
//
//   held = still done, no done->other status change after delivery, and no
//          failing evidence recorded after delivery.
//
// Kernel decisions: DI-9A293A1A31A3 (objectives derive from the epic, or one
// standing platform-work objective), DI-321FE7AC7AA4 (record the matured hold
// rate at delivery), DI-F3101AA957C7 (origin columns plus an explicit
// designation of the business Product platform work serves; never inferred).

import { evidenceKindMetadata, isExecutionEvidenceKind } from "@/lib/backlog/execution-evidence";

export const DELIVERED_WORK_OUTCOME_METHOD = "delivered-work-hold-rate.v1";
export const DELIVERED_WORK_DECISION_REFS = ["DI-9A293A1A31A3", "DI-321FE7AC7AA4", "DI-F3101AA957C7"] as const;

/** The origin of the standing objective, whose sourceRef is the designated Product's id. */
export const PLATFORM_WORK_OBJECTIVE_SOURCE_KIND = "platform-work";
/** The origin of an epic-derived objective, whose sourceRef is the epic's semantic id. */
export const EPIC_OBJECTIVE_SOURCE_KIND = "epic";
/** ProductOutcomeObservation.sourceKind for an observation recorded at delivery. */
export const DELIVERY_OBSERVATION_SOURCE_KIND = "delivery";

/** A delivery is judged once it has had this long to come back. */
export const HOLD_WINDOW_DAYS = 14;
/** Deliveries older than this leave the cohort. */
export const LOOKBACK_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

export const DELIVERED_WORK_MEASURE_DEFINITION =
  `Share of this objective's backlog items first delivered (moved to done) between ${LOOKBACK_DAYS} and `
  + `${HOLD_WINDOW_DAYS} days before the observation that held: still done, never moved out of done after `
  + "delivery, and no failing evidence recorded after delivery. Recorded by the platform each time an item "
  + "of this objective is delivered.";

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

export function deliveredWorkWindow(observedAt: Date): { from: Date; to: Date } {
  return {
    from: new Date(observedAt.getTime() - LOOKBACK_DAYS * DAY_MS),
    to: new Date(observedAt.getTime() - HOLD_WINDOW_DAYS * DAY_MS),
  };
}

/** One observation per delivery: a redelivery after a reopen is a new one. */
export function deliveryObservationSourceRef(itemId: string, deliveredAt: Date): string {
  return `${itemId}@${deliveredAt.toISOString()}`;
}

export type DeliveredWorkFact = {
  itemId: string;
  status: string;
  deliveredAt: Date;
  /** Status changes and evidence rows on the item; only those after delivery count. */
  laterActivities: readonly { kind: string; recordedAt: Date; payload: unknown }[];
};

export type NotHeldReason = "reopened" | "failing-evidence" | "no-longer-done";

export type DeliveredWorkHoldRate = {
  numerator: number;
  denominator: number;
  /** Percentage, 0-100, rounded to the column's six decimal places. */
  value: number;
  notHeld: { itemId: string; reason: NotHeldReason }[];
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function notHeldReason(fact: DeliveredWorkFact): NotHeldReason | null {
  const after = fact.laterActivities.filter((row) => row.recordedAt > fact.deliveredAt);
  if (after.some((row) => row.kind === "status_change" && record(row.payload)?.from === "done")) return "reopened";
  if (after.some((row) => {
    const kind = record(row.payload)?.evidenceKind;
    return row.kind === "evidence" && isExecutionEvidenceKind(kind) && evidenceKindMetadata(kind).polarity === "fail";
  })) return "failing-evidence";
  if (fact.status !== "done") return "no-longer-done";
  return null;
}

/** The hold rate of a matured cohort, or null when nothing has matured yet. */
export function computeDeliveredWorkHoldRate(facts: readonly DeliveredWorkFact[]): DeliveredWorkHoldRate | null {
  if (facts.length === 0) return null;
  const notHeld = facts.flatMap((fact) => {
    const reason = notHeldReason(fact);
    return reason ? [{ itemId: fact.itemId, reason }] : [];
  });
  const numerator = facts.length - notHeld.length;
  return {
    numerator,
    denominator: facts.length,
    value: Math.round((numerator / facts.length) * 100 * 1e6) / 1e6,
    notHeld,
  };
}
