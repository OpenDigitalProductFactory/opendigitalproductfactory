/**
 * Canonical WorkItem anchor for a WorkCapsule.
 *
 * EP-WORK-CONVERGENCE (BI-650994D7). A capsule and a WorkItem could both describe
 * the same unit of work (both carry the backlog item) with nothing joining them —
 * two rows for one job. This resolves-or-creates the single canonical WorkItem for
 * the capsule's backlog item and links it via WorkCapsule.workItemId, so capsule and
 * case converge on one anchor.
 *
 * Pure core with injected ports (testable without a DB). The prisma binding lives in
 * capsule-workitem-anchor.server.ts. Callers run it NON-FATALLY — a capsule must still
 * be usable if anchoring fails (the FK is nullable by design).
 *
 * Design: docs/superpowers/specs/2026-08-12-work-model-convergence-addendum-common-work-formula-design.md §3 (D2)
 */

/** Canonical source type for a backlog-item-backed work case (source-registry.ts). */
export const BACKLOG_ITEM_SOURCE_TYPE = "backlog-item";
export const WORK_CAPSULE_SOURCE_TYPE = "work-capsule";

export interface AnchorWorkItemCreateInput {
  sourceType: string;
  sourceId: string;
  title: string;
  description: string;
  workerConstraint: Record<string, unknown>;
  queueId: string;
  status: string;
}

export interface WorkItemAnchorPorts {
  /** Find an existing WorkItem for (sourceType, sourceId), or null. */
  findWorkItemBySource(sourceType: string, sourceId: string): Promise<{ id: string } | null>;
  /** Resolve (find-or-create) the canonical queue a capsule-anchored WorkItem lands in. */
  resolveCanonicalQueueId(): Promise<string>;
  /** Create a WorkItem and return its id. */
  createWorkItem(data: AnchorWorkItemCreateInput): Promise<{ id: string }>;
  /** Bind the capsule to the resolved WorkItem. */
  setCapsuleWorkItem(capsuleId: string, workItemId: string): Promise<void>;
}

export interface EnsureCapsuleWorkItemAnchorArgs {
  ports: WorkItemAnchorPorts;
  /** WorkCapsule.capsuleId (WC-*) or id — whatever setCapsuleWorkItem keys on. */
  capsuleId: string;
  backlogItemId: string | null | undefined;
  title: string;
}

export interface CapsuleWorkItemAnchorResult {
  workItemId: string;
  /** True when a new canonical WorkItem was created (vs. linked to an existing one). */
  created: boolean;
}

/**
 * Resolve-or-create the canonical WorkItem for the capsule and link it. Backlog-backed
 * capsules share the backlog-item case; ad-hoc capsules use their own stable capsule id
 * so no carrier can originate unaddressable work.
 */
export async function ensureCapsuleWorkItemAnchor(
  args: EnsureCapsuleWorkItemAnchorArgs,
): Promise<CapsuleWorkItemAnchorResult | null> {
  const backlogItemId = args.backlogItemId ?? null;
  const sourceType = backlogItemId ? BACKLOG_ITEM_SOURCE_TYPE : WORK_CAPSULE_SOURCE_TYPE;
  const sourceId = backlogItemId ?? args.capsuleId;

  const existing = await args.ports.findWorkItemBySource(sourceType, sourceId);
  let workItemId: string;
  let created = false;

  if (existing) {
    workItemId = existing.id;
  } else {
    const queueId = await args.ports.resolveCanonicalQueueId();
    const workItem = await args.ports.createWorkItem({
      sourceType,
      sourceId,
      title: args.title,
      description: args.title,
      workerConstraint: {},
      queueId,
      status: "queued",
    });
    workItemId = workItem.id;
    created = true;
  }

  await args.ports.setCapsuleWorkItem(args.capsuleId, workItemId);
  return { workItemId, created };
}
