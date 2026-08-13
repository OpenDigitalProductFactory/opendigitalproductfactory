/**
 * The WorkUnit contract — the invariant projection every durable work carrier
 * (WorkCapsule, WorkItem, TaskRun) satisfies, so the Universal Work Formula is
 * expressed once and the carriers are just adapters into it.
 *
 * EP-WORK-CONVERGENCE (BI-5659D187). Pure module: no DB, no imports. The variation
 * axes (context / temporal / participant) live on the source-registry entry, never
 * here; this is the shared shape the projection consumes.
 *
 * Design: docs/superpowers/specs/2026-08-12-work-model-convergence-addendum-common-work-formula-design.md
 */

export type WorkUnitCarrierKind = "work-capsule" | "work-item" | "task-run";

/** The case a unit projects into, addressed by (sourceType, sourceId). */
export interface WorkUnitCaseRef {
  sourceType: string;
  sourceId: string;
}

/**
 * The invariant work-unit shape. A carrier-specific record (capsule/work-item/…)
 * maps onto this via a `toWorkUnit*` adapter; the case projection reads WorkUnit,
 * never a carrier's bespoke shape.
 */
export interface WorkUnit {
  carrier: WorkUnitCarrierKind;
  /** The durable carrier's stable id (capsuleId / itemId). */
  carrierId: string;
  title: string;
  status: string;
  /** The case this unit belongs to; null when the unit is not yet anchored to a case. */
  caseRef: WorkUnitCaseRef | null;
  /** The canonical WorkItem anchor for this unit of work, when known. */
  workItemId: string | null;
  backlogItemId: string | null;
}

export interface CapsuleWorkUnitInput {
  capsuleId: string;
  title: string;
  status: string;
  backlogItemId?: string | null;
  workItemId?: string | null;
}

/** Adapter: a coding WorkCapsule → WorkUnit. */
export function toWorkUnitFromCapsule(input: CapsuleWorkUnitInput): WorkUnit {
  const backlogItemId = input.backlogItemId ?? null;
  return {
    carrier: "work-capsule",
    carrierId: input.capsuleId,
    title: input.title,
    status: input.status,
    caseRef: backlogItemId ? { sourceType: "backlog-item", sourceId: backlogItemId } : null,
    workItemId: input.workItemId ?? null,
    backlogItemId,
  };
}

export interface WorkItemWorkUnitInput {
  id: string;
  sourceType: string;
  sourceId: string | null;
  title: string;
  status: string;
}

/** Adapter: a generic WorkItem → WorkUnit (the WorkItem is itself the anchor). */
export function toWorkUnitFromWorkItem(input: WorkItemWorkUnitInput): WorkUnit {
  return {
    carrier: "work-item",
    carrierId: input.id,
    title: input.title,
    status: input.status,
    caseRef: input.sourceId ? { sourceType: input.sourceType, sourceId: input.sourceId } : null,
    workItemId: input.id,
    backlogItemId: input.sourceType === "backlog-item" ? input.sourceId : null,
  };
}

/** True when two units resolve to the same case (used to dedupe capsule + work-item for one job). */
export function isSameWorkCase(a: WorkUnit, b: WorkUnit): boolean {
  if (a.workItemId && b.workItemId) return a.workItemId === b.workItemId;
  if (a.caseRef && b.caseRef) {
    return a.caseRef.sourceType === b.caseRef.sourceType && a.caseRef.sourceId === b.caseRef.sourceId;
  }
  return false;
}
