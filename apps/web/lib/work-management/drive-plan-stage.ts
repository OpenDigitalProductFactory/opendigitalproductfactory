/**
 * The per-stage drive rules, shared by the sequential drive and the graph
 * drive (BI-8875C9DF, GPP Phase 3c PR-3c-1).
 *
 * Design: docs/superpowers/specs/2026-10-02-gpp-phase-3c-drive-graph-execution-design.md
 * §4.2, §5; plan: docs/superpowers/plans/2026-10-02-gpp-phase-3c-drive-graph-execution.md
 * (PR-3c-1, "planStage extraction").
 *
 * EXTRACTED, NOT CHANGED, from resolveDrivePlan (drive-resolution.ts): the
 * human / governed / agent / writeback-latch rules for one stage, and the
 * small helpers around them. The sequential drive calls planStage with exactly
 * the inputs it used inline, and the characterization golden
 * (drive-sequential-identity.test.ts) proves the plans are byte-identical.
 * The graph drive (drive-resolution-graph.ts) calls it once per marked stage,
 * with that token's own latch prior and iteration, so the two drives have one
 * home for these rules.
 */
import type { DriveAction, DrivePlan, DriveResolutionInput, AccountablePrincipalKind } from "./drive-resolution";
import type { DriveReasonFor } from "./drive-conclusion";
import {
  projectWorkShapeCycleBoundary,
  type ProjectedWorkShapeCycle,
  type WorkShapeDefinition,
  type WorkShapeDefinitionContract,
  type WorkShapeStage,
  type WorkShapeTriggerClass,
} from "./work-shapes";
import type { WorkroomShapeConformance } from "./workroom-shape-conformance";
import { writebackLatchHolds, type PriorDriveForLatch } from "./writeback-latch";
import {
  EXECUTOR_WRITEBACK_UNAVAILABLE_REASON,
  WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND,
  isCompletingWorkroomDriveReceipt,
  isCompletingWorkroomDriveReceiptAt,
  type PriorWorkroomDrive,
} from "./workroom-drive-receipts";

export function workroomDriveTaskId(roomId: string, shapeKey: string): string {
  return `workroom-${roomId}-${shapeKey}`;
}

/**
 * The task id of a parallel branch's agent stage while another token holds the
 * room's primary task (GPP Phase 3c PR-3c-2, design §6 "Dispatch every
 * tick"). Fixed on the token when it enters the stage; a sequential room never
 * uses it.
 */
export function workroomDriveBranchTaskId(roomId: string, shapeKey: string, stageKey: string): string {
  return `${workroomDriveTaskId(roomId, shapeKey)}--${stageKey}`;
}

export function parseAccountablePrincipalRef(
  ref: string,
): { kind: AccountablePrincipalKind; value: string } {
  if (ref.startsWith("agent:")) return { kind: "agent", value: ref.slice("agent:".length) };
  if (ref.startsWith("role:")) return { kind: "role", value: ref.slice("role:".length) };
  if (ref.startsWith("person:")) return { kind: "person", value: ref.slice("person:".length) };
  return { kind: "unknown", value: ref };
}

export function emptyPlan<A extends DriveAction>(
  input: DriveResolutionInput,
  action: A,
  reason: DriveReasonFor<A>,
  extras: Partial<DrivePlan> = {},
): DrivePlan {
  return {
    action,
    reason,
    roomId: input.roomId,
    shapeKey: input.definition?.key ?? null,
    definition: input.definition ?? null,
    shapeVersion: input.definition?.version ?? null,
    stageKey: null,
    accountablePrincipalRef: null,
    agentId: null,
    attentionPrincipalRef: null,
    taskId: null,
    conformance: extras.conformance ?? null,
    cycle: extras.cycle ?? null,
    deviations: extras.deviations ?? extras.conformance?.deviations ?? [],
    ledger: extras.ledger ?? [reason],
  };
}

/** The prior tick finished this same cycle (or already slept on it). */
export function cycleCompleted(prior: PriorWorkroomDrive | null, cycleKey: string): boolean {
  if (!prior || prior.cycleKey !== cycleKey) return false;
  return (prior.action === "stop" && prior.reason === "success")
    || (prior.action === "do_not_wake" && prior.reason === "cycle_complete");
}

function asShape(
  definition: WorkShapeDefinitionContract,
  collaborationShape: string | null,
): WorkShapeDefinition {
  return {
    key: definition.key,
    version: definition.version,
    title: definition.key,
    description: definition.key,
    triggers: definition.triggers,
    stages: definition.stages,
    stopConditions: definition.stopConditions,
    grants: definition.grants,
    measures: definition.measures,
    budgets: definition.budgets,
    reviewPoint: definition.reviewPoint,
    collaborationShape: (collaborationShape as WorkShapeDefinition["collaborationShape"]) ?? null,
  };
}

/** The cycle this tick belongs to: the declared trigger (or the first, or cadence) at `now`. */
export function projectDriveCycle(input: DriveResolutionInput, definition: WorkShapeDefinitionContract): ProjectedWorkShapeCycle {
  const trigger = input.trigger
    ?? (definition.triggers[0] as WorkShapeTriggerClass | undefined)
    ?? "cadence";
  return projectWorkShapeCycleBoundary({
    shape: asShape(definition, input.collaborationShape),
    trigger,
    startedAt: input.now ?? new Date(0),
  });
}

export function ledgerFrom(conformance: WorkroomShapeConformance, extra: string[]): string[] {
  const fromDeviations = conformance.deviations.map((deviation) => `${deviation.code}: ${deviation.summary}`);
  return [...fromDeviations, ...extra];
}

/**
 * The plan for one stage the drive is on: attention for a human or governed
 * stage, a pause for an unknown principal or a stage already dispatched
 * without writeback (the latch), else an agent dispatch.
 *
 * `prior` is the latch's view of the last tick: the room's for the sequential
 * drive, the token's own for the graph drive (writeback-latch.ts compares its
 * stage, so a room-level prior would never latch a second branch).
 * `iteration` is given only by the graph drive: a completing receipt then
 * counts only at that iteration.
 */
export function planStage(args: {
  input: DriveResolutionInput;
  definition: WorkShapeDefinitionContract;
  stage: WorkShapeStage;
  conformance: WorkroomShapeConformance;
  cycle: ProjectedWorkShapeCycle;
  prior: PriorDriveForLatch | null;
  iteration?: number;
}): DrivePlan {
  const { input, stage, conformance, cycle, prior } = args;
  const definition = args.definition;
  const parsed = parseAccountablePrincipalRef(stage.accountablePrincipalRef);
  const governed = stage.advance.kind === "governed-decision";
  const humanStage = parsed.kind === "role" || parsed.kind === "person";
  // EP-4614F35E: a governed-decision stage normally raises attention (a human
  // decides). The one exception — full proactivity — is when the accountable
  // principal is an AGENT and the room is `preauthorized`: the room drives its
  // own governed review, dispatching the non-author agent reviewer that records
  // the governed receipt. A role/person governed stage still raises attention.
  const agentDrivesGovernedReview =
    governed && parsed.kind === "agent" && Boolean(parsed.value) && input.actionBoundary === "preauthorized";
  if ((governed || humanStage) && !agentDrivesGovernedReview) {
    const reason: DriveReasonFor<"attention"> =
      governed ? "governed_decision" : parsed.kind === "role" ? "role_stage" : "person_stage";
    return {
      action: "attention",
      reason,
      roomId: input.roomId,
      shapeKey: definition.key,
      definition: input.definition ?? null,
      shapeVersion: definition.version,
      stageKey: stage.key,
      accountablePrincipalRef: stage.accountablePrincipalRef,
      agentId: null,
      attentionPrincipalRef: stage.accountablePrincipalRef,
      taskId: null,
      conformance,
      cycle,
      deviations: [],
      ledger: [`Stage ${stage.key} becomes attention (${reason}); the runner does not execute it.`],
    };
  }

  if (parsed.kind !== "agent" || !parsed.value) {
    return emptyPlan(input, "pause", "unknown_principal", {
      conformance,
      cycle,
      ledger: [`Stage ${stage.key} has no dispatchable agent principal.`],
    });
  }

  const iteration = args.iteration;
  const completing = input.receipts.some((receipt) =>
    iteration === undefined
      ? isCompletingWorkroomDriveReceipt(receipt, stage.key)
      : isCompletingWorkroomDriveReceiptAt(receipt, stage.key, iteration),
  );
  // On the graph path a `blocked` receipt is scoped to its iteration (PR-3c-3):
  // a pass the stage was sent back from must not latch the fresh pass. The
  // sequential drive passes no iteration and reads every blocked receipt, as before.
  const blocked = input.receipts.some(
    (receipt) =>
      receipt.stageKey === stage.key && receipt.kind === WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND
      && (iteration === undefined || (receipt.iteration ?? 0) === iteration),
  );
  // Bounded, not permanent: the latch holds within a cycle and releases on the
  // next, so a deployed fix can reach a room that previously failed closed.
  // Without this the pause reason re-triggers the pause and the room is locked
  // forever (12 of 24 rooms on this install were).
  const alreadyTriedWriteback = !completing
    && writebackLatchHolds({
      prior: prior ?? null,
      stageKey: stage.key,
      currentCycleKey: cycle?.cycleKey ?? null,
      blocked,
    });
  if (alreadyTriedWriteback) {
    return {
      action: "pause",
      reason: EXECUTOR_WRITEBACK_UNAVAILABLE_REASON,
      roomId: input.roomId,
      shapeKey: definition.key,
      definition: input.definition ?? null,
      shapeVersion: definition.version,
      stageKey: stage.key,
      accountablePrincipalRef: stage.accountablePrincipalRef,
      agentId: null,
      attentionPrincipalRef: null,
      taskId: null,
      conformance,
      cycle,
      deviations: [],
      ledger: [
        `Stage ${stage.key} already dispatched without a completing receipt; pause until writeback exists.`,
      ],
    };
  }

  return {
    action: "dispatch_agent",
    reason: "agent_stage",
    roomId: input.roomId,
    shapeKey: definition.key,
    definition: input.definition ?? null,
    shapeVersion: definition.version,
    stageKey: stage.key,
    accountablePrincipalRef: stage.accountablePrincipalRef,
    agentId: parsed.value,
    attentionPrincipalRef: null,
    taskId: workroomDriveTaskId(input.roomId, definition.key),
    conformance,
    cycle,
    deviations: [],
    ledger: [`Dispatch agent:${parsed.value} for stage ${stage.key}.`],
  };
}
