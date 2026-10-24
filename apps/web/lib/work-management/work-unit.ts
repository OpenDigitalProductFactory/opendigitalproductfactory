/**
 * The WorkUnit contract — the invariant projection every durable work carrier
 * (Workroom, WorkItem, TaskRun) satisfies, so the Universal Work Formula is
 * expressed once and the carriers are just adapters into it.
 *
 * EP-WORK-CONVERGENCE (BI-5659D187). Pure module: no DB, no imports. The variation
 * axes (context / temporal / participant) live on the source-registry entry, never
 * here; this is the shared shape the projection consumes.
 *
 * Design: docs/superpowers/specs/2026-08-12-work-model-convergence-addendum-common-work-formula-design.md
 */

export type WorkUnitCarrierKind =
  | "work-capsule"
  | "work-item"
  | "task-run"
  | "coworker-engagement";

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
  identity: {
    carrier: WorkUnitCarrierKind;
    carrierId: string;
    title: string;
    caseRef: WorkUnitCaseRef;
    workItemId: string | null;
    backlogItemId: string | null;
  };
  participants: {
    accountableRef: string | null;
    contributorRefs: string[];
  };
  process: {
    formula: readonly ["frame", "propose", "collaborate", "review", "govern", "verify", "carry-over"];
    stage: string | null;
  };
  currentState: { status: string };
  outcome: { summary: string | null; terminal: boolean };
  governance: { decisionScope: string | null; receiptRequired: boolean };
  carryOver: { restartable: boolean; note: string | null };
}

export const UNIVERSAL_WORK_FORMULA = [
  "frame", "propose", "collaborate", "review", "govern", "verify", "carry-over",
] as const;

/** Closed registry consumed by the conformance guard; carriers vary by adapter, not formula. */
export const WORK_UNIT_CARRIER_REGISTRY = [
  { carrier: "work-capsule", adapter: "toWorkUnitFromCapsule", addressableSourceType: "work-capsule" },
  { carrier: "work-item", adapter: "toWorkUnitFromWorkItem", addressableSourceType: "work-item" },
  { carrier: "task-run", adapter: "toWorkUnitFromTaskRun", addressableSourceType: "task-run" },
  { carrier: "coworker-engagement", adapter: "toWorkUnitFromCoworkerEngagement", addressableSourceType: "coworker-engagement" },
] as const satisfies ReadonlyArray<{
  carrier: WorkUnitCarrierKind;
  adapter: string;
  addressableSourceType: string;
}>;

const TERMINAL_CARRIER_STATUSES = new Set([
  "complete", "completed", "abandoned", "archived", "cancelled", "canceled", "failed", "rejected",
]);

function unit(args: {
  carrier: WorkUnitCarrierKind;
  carrierId: string;
  title: string;
  status: string;
  caseRef: WorkUnitCaseRef;
  workItemId?: string | null;
  backlogItemId?: string | null;
  accountableRef?: string | null;
  contributorRefs?: Array<string | null | undefined>;
  stage?: string | null;
  outcomeSummary?: string | null;
  decisionScope?: string | null;
  receiptRequired?: boolean;
  carryOverNote?: string | null;
}): WorkUnit {
  const terminal = TERMINAL_CARRIER_STATUSES.has(args.status.trim().toLowerCase());
  return {
    identity: {
      carrier: args.carrier,
      carrierId: args.carrierId,
      title: args.title,
      caseRef: args.caseRef,
      workItemId: args.workItemId ?? null,
      backlogItemId: args.backlogItemId ?? null,
    },
    participants: {
      accountableRef: args.accountableRef ?? null,
      contributorRefs: [...new Set((args.contributorRefs ?? []).filter((ref): ref is string => Boolean(ref)))],
    },
    process: { formula: UNIVERSAL_WORK_FORMULA, stage: args.stage ?? null },
    currentState: { status: args.status },
    outcome: { summary: args.outcomeSummary ?? null, terminal },
    governance: {
      decisionScope: args.decisionScope ?? null,
      receiptRequired: args.receiptRequired ?? false,
    },
    carryOver: { restartable: args.status !== "archived", note: args.carryOverNote ?? null },
  };
}

export interface CapsuleWorkUnitInput {
  capsuleId: string;
  title: string;
  status: string;
  backlogItemId?: string | null;
  workItemId?: string | null;
}

/** Adapter: a coding Workroom → WorkUnit. */
export function toWorkUnitFromCapsule(input: CapsuleWorkUnitInput): WorkUnit {
  const backlogItemId = input.backlogItemId ?? null;
  return unit({
    carrier: "work-capsule",
    carrierId: input.capsuleId,
    title: input.title,
    status: input.status,
    caseRef: backlogItemId
      ? { sourceType: "backlog-item", sourceId: backlogItemId }
      : { sourceType: "work-capsule", sourceId: input.capsuleId },
    workItemId: input.workItemId ?? null,
    backlogItemId,
    stage: input.status,
  });
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
  return unit({
    carrier: "work-item",
    carrierId: input.id,
    title: input.title,
    status: input.status,
    caseRef: input.sourceId
      ? { sourceType: input.sourceType, sourceId: input.sourceId }
      : { sourceType: "work-item", sourceId: input.id },
    workItemId: input.id,
    backlogItemId: input.sourceType === "backlog-item" ? input.sourceId : null,
    stage: input.status,
  });
}

export interface CoworkerEngagementWorkUnitInput {
  engagementId: string;
  requestedOutcome: string;
  status: string;
  requestedByUserId?: string | null;
  requestedByAgentId?: string | null;
  providerAgentId?: string | null;
  workCapsuleId?: string | null;
}

/** Adapter: a requested coworker service engagement -> WorkUnit. */
export function toWorkUnitFromCoworkerEngagement(input: CoworkerEngagementWorkUnitInput): WorkUnit {
  return unit({
    carrier: "coworker-engagement",
    carrierId: input.engagementId,
    title: input.requestedOutcome,
    status: input.status,
    caseRef: { sourceType: "coworker-engagement", sourceId: input.engagementId },
    workItemId: null,
    accountableRef: input.requestedByUserId ?? input.requestedByAgentId ?? null,
    contributorRefs: [input.providerAgentId, input.workCapsuleId],
    stage: input.status,
  });
}

export interface TaskRunWorkUnitInput {
  taskRunId: string;
  title: string;
  status: string;
  contextId?: string | null;
  buildId?: string | null;
  initiatingAgentId?: string | null;
  currentAgentId?: string | null;
  outcomeSummary?: string | null;
}

/** Adapter: an execution TaskRun → the same WorkUnit formula used by durable carriers. */
export function toWorkUnitFromTaskRun(input: TaskRunWorkUnitInput): WorkUnit {
  const contextId = input.contextId ?? input.buildId ?? input.taskRunId;
  const sourceType = input.contextId?.startsWith("BI-")
    ? "backlog-item"
    : input.buildId
      ? "feature-build"
      : "task-run";
  return unit({
    carrier: "task-run",
    carrierId: input.taskRunId,
    title: input.title,
    status: input.status,
    caseRef: { sourceType, sourceId: contextId },
    backlogItemId: sourceType === "backlog-item" ? contextId : null,
    accountableRef: input.initiatingAgentId,
    contributorRefs: [input.currentAgentId],
    stage: input.status,
    outcomeSummary: input.outcomeSummary,
  });
}

/** True when two units resolve to the same case (used to dedupe capsule + work-item for one job). */
export function isSameWorkCase(a: WorkUnit, b: WorkUnit): boolean {
  if (a.identity.workItemId && b.identity.workItemId) {
    return a.identity.workItemId === b.identity.workItemId;
  }
  return a.identity.caseRef.sourceType === b.identity.caseRef.sourceType
    && a.identity.caseRef.sourceId === b.identity.caseRef.sourceId;
}
