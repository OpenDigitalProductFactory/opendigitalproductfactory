/**
 * The graph drive: the plan for a room whose shape uses a graph construct
 * (BI-8875C9DF, GPP Phase 3c PR-3c-1; parallel dispatch PR-3c-2).
 *
 * Design: docs/superpowers/specs/2026-10-02-gpp-phase-3c-drive-graph-execution-design.md
 * §4 (state model), §5 (kill switch), §7.1 (one switch); plan:
 * docs/superpowers/plans/2026-10-02-gpp-phase-3c-drive-graph-execution.md
 * (PR-3c-1, drive-resolution-graph.ts).
 *
 * Reached only through resolveDrivePlan's structural branch
 * (`usesGraphConstructs`), after the missing-shape, posture and substrate
 * early returns. In order:
 *
 * 1. KILL SWITCH. If the shape uses any construct whose flag in
 *    CONSTRUCT_EXECUTABLE is off, pause with `construct_not_executable`,
 *    naming each construct and element. Never run it some other way.
 * 2. MARKING. Read it; if it cannot be read, pause with `marking_unreadable`
 *    and carry the stored value verbatim (`marking: { raw }`).
 *    Both pauses keep the stored `stageKey`, not emptyPlan's null, so turning
 *    a flag back on resumes the room exactly where it stopped.
 * 3. STEP, CONFORMANCE, CYCLE. One firing (stepDriveMarking), then the
 *    Process Overseer check with the flow-aware `flowOrder` input, then the
 *    same cycle-complete and disposition rules as the sequential drive.
 * 4. TOKENS. One plan per marked stage through the shared planStage rules,
 *    each with the token's own latch prior and iteration. An agent-stage
 *    token's task id is fixed when it enters the stage (withFixedTaskIds) and
 *    its dispatch goes through that id. The aggregate action
 *    is the first by precedence stop > escalate > pause > dispatch_agent >
 *    attention > do_not_wake; its reason is the first token's at that
 *    precedence. Each token records its own last action, reason and cycle.
 *
 * After a readable marking, every plan carries a marking, so a graph room
 * never loses its marking on a tick (review blocker 1).
 *
 * A construct-specific branch of the step that PR-3c-1 does not implement
 * throws DriveConstructNotImplementedError; this planner turns it into the
 * same fail-closed pause, so the drive never throws for a room.
 */
import { constructsUsedBy } from "@/lib/gpp/shape-language/constructs-used-by";
import { stageElementId } from "@/lib/gpp/shape-language/element-ids";
import { CONSTRUCT_EXECUTABLE } from "@/lib/gpp/shape-language/executable-constructs";

import type { DriveAction, DrivePlan, DriveResolutionInput } from "./drive-resolution";
import {
  DriveConstructNotImplementedError,
  iterationOf,
  latchPriorFor,
  markedStageKeys,
  readStoredDriveMarking,
  stageToken,
  stepDriveMarking,
  type DriveMarking,
  type DriveStepResult,
  type DriveTokenPlan,
} from "./drive-marking";
import {
  cycleCompleted,
  emptyPlan,
  ledgerFrom,
  parseAccountablePrincipalRef,
  planStage,
  projectDriveCycle,
  workroomDriveBranchTaskId,
  workroomDriveTaskId,
} from "./drive-plan-stage";
import type { WorkShapeDefinitionContract } from "./work-shapes";
import { evaluateWorkroomShapeConformance } from "./workroom-shape-conformance";
import { isCompletingWorkroomDriveReceiptAt } from "./workroom-drive-receipts";

/** Aggregate precedence, highest first (design §4.3). */
const ACTION_PRECEDENCE: readonly DriveAction[] = ["stop", "escalate", "pause", "dispatch_agent", "attention", "do_not_wake"];

/** The first stage key the marking holds, in document order: the legacy `stageKey`. */
function firstMarked(definition: WorkShapeDefinitionContract, marking: DriveMarking): string | null {
  return markedStageKeys(definition, marking)[0] ?? null;
}

/**
 * Fix the task id of every agent-stage token that has none yet (PR-3c-2,
 * design §6 "Dispatch every tick"). In document order, a token takes the
 * room's primary task id when no other live token holds it, else its branch
 * id. A token that already carries one keeps it, so the id never depends on
 * which stages happen to be marked on a later tick. A sequential twin's single
 * token therefore always takes the primary id.
 */
export function withFixedTaskIds(definition: WorkShapeDefinitionContract, marking: DriveMarking, roomId: string): DriveMarking {
  const primary = workroomDriveTaskId(roomId, definition.key);
  const held = new Set(marking.tokens.flatMap((token) => (token.taskId ? [token.taskId] : [])));
  const fixed = new Map<string, string>();
  for (const stage of definition.stages) {
    const token = stageToken(marking, stage.key);
    if (!token || token.taskId) continue;
    const principal = parseAccountablePrincipalRef(stage.accountablePrincipalRef);
    if (principal.kind !== "agent" || !principal.value) continue;
    const taskId = held.has(primary) ? workroomDriveBranchTaskId(roomId, definition.key, stage.key) : primary;
    held.add(taskId);
    fixed.set(token.node, taskId);
  }
  if (fixed.size === 0) return marking;
  return {
    ...marking,
    tokens: marking.tokens.map((token) => {
      const taskId = token.from === undefined ? fixed.get(token.node) : undefined;
      return taskId ? { ...token, taskId } : token;
    }),
  };
}

export function resolveGraphDrivePlan(input: DriveResolutionInput & { definition: WorkShapeDefinitionContract }): DrivePlan {
  const definition = input.definition;
  const now = input.now ?? new Date(0);
  const cycle = projectDriveCycle(input, definition);

  // 1. The kill switch: one flag table for the compiler and the drive.
  const off = constructsUsedBy(definition).filter((use) => !CONSTRUCT_EXECUTABLE[use.construct]);
  if (off.length > 0) {
    return {
      ...emptyPlan(input, "pause", "construct_not_executable", {
        cycle,
        ledger: off.map((use) => `construct_not_executable: ${use.construct} at ${use.elementId}. ${use.detail} The room pauses where it stands.`),
      }),
      stageKey: input.currentStageKey,
    };
  }

  // 2. The marking.
  const read = readStoredDriveMarking(input.workspaceState, definition, cycle.cycleKey, now);
  if (!read.ok) {
    return {
      ...emptyPlan(input, "pause", "marking_unreadable", {
        cycle,
        ledger: ["marking_unreadable: the stored drive marking cannot be read; it is kept unchanged and the room pauses."],
      }),
      stageKey: input.currentStageKey,
      marking: { raw: read.raw },
    };
  }
  const stored = read.data.marking;

  // 3. One firing, then conformance over the flow.
  let stepped: DriveStepResult;
  try {
    stepped = stepDriveMarking(definition, stored, { receipts: input.receipts }, now);
    stepped = { ...stepped, marking: withFixedTaskIds(definition, stepped.marking, input.roomId) };
  } catch (error) {
    if (!(error instanceof DriveConstructNotImplementedError)) throw error;
    return {
      ...emptyPlan(input, "pause", "construct_not_executable", { cycle, ledger: [`${error.message} The room pauses where it stands.`] }),
      stageKey: firstMarked(definition, stored),
      marking: stored,
    };
  }
  const marked = markedStageKeys(definition, stepped.marking);
  const delivered = Object.fromEntries(definition.stages.map((stage) => [
    stage.key,
    input.receipts.some((receipt) => isCompletingWorkroomDriveReceiptAt(receipt, stage.key, iterationOf(stepped.marking, stage.key))),
  ]));
  const conformance = evaluateWorkroomShapeConformance({
    roomKey: input.roomId,
    definition,
    collaborationShape: input.collaborationShape,
    participants: input.participants,
    currentStageKey: firstMarked(definition, stored),
    proposedStageKey: marked[0] ?? null,
    receipts: input.receipts,
    budgetUsage: input.budgetUsage,
    stopConditionHits: input.stopConditionHits,
    reviewDue: input.reviewDue,
    proposedGrants: input.proposedGrants,
    coordinatorHasProcessCoordinationAuthority: input.coordinatorHasProcessCoordinationAuthority,
    independentEvaluatorPrincipalRef: input.independentEvaluatorPrincipalRef,
    independentApproverPrincipalRef: input.independentApproverPrincipalRef,
    requiredRoles: input.requiredRoles,
    coordinatorEligibility: input.coordinatorEligibility,
    checkedAt: input.now,
    flowOrder: { enabled: marked, delivered },
  });

  // A tick that does not advance keeps the marking it read (stored, derived or new-cycle).
  const held = (plan: DrivePlan): DrivePlan => ({ ...plan, stageKey: firstMarked(definition, stored), marking: stored });

  if (cycleCompleted(input.priorDrive ?? null, cycle.cycleKey)) {
    return held(emptyPlan(input, "do_not_wake", "cycle_complete", {
      conformance,
      cycle,
      ledger: [`Cycle ${cycle.cycleKey} is complete; the room wakes in the next cycle.`],
    }));
  }
  if (conformance.disposition === "stop") {
    return held(emptyPlan(input, "stop", "conformance_stop", { conformance, cycle, deviations: conformance.deviations, ledger: ledgerFrom(conformance, []) }));
  }
  if (conformance.disposition === "escalate") {
    return held(emptyPlan(input, "escalate", "conformance_escalate", { conformance, cycle, deviations: conformance.deviations, ledger: ledgerFrom(conformance, []) }));
  }
  if (conformance.disposition === "pause") {
    return held(emptyPlan(input, "pause", "conformance_pause", { conformance, cycle, deviations: conformance.deviations, ledger: ledgerFrom(conformance, []) }));
  }

  if (stepped.stopped) {
    return {
      ...emptyPlan(input, "stop", "success", { conformance, cycle, ledger: ["No further permitted stage; cycle complete."] }),
      marking: stepped.marking,
    };
  }

  // 4. One plan per marked stage, in document order.
  const tokenPlans: Array<{ plan: DrivePlan; token: DriveTokenPlan }> = [];
  for (const stageKey of marked) {
    const stage = definition.stages.find((entry) => entry.key === stageKey);
    const token = stageToken(stepped.marking, stageKey);
    if (!stage || !token) continue;
    const iteration = iterationOf(stepped.marking, stageKey);
    const planned = planStage({ input, definition, stage, conformance, cycle, prior: latchPriorFor(token, stageKey), iteration });
    // A dispatch goes through the task id fixed on the token when it entered the stage.
    const plan = planned.action === "dispatch_agent" && token.taskId ? { ...planned, taskId: token.taskId } : planned;
    tokenPlans.push({
      plan,
      token: {
        stageKey,
        iteration,
        action: plan.action,
        reason: plan.reason,
        agentId: plan.agentId,
        attentionPrincipalRef: plan.attentionPrincipalRef,
        taskId: plan.taskId,
        ledger: plan.ledger,
      },
    });
  }
  if (tokenPlans.length === 0) {
    return held(emptyPlan(input, "pause", "construct_not_executable", {
      conformance,
      cycle,
      ledger: ["construct_not_executable: the marking holds no stage the drive can plan for. The room pauses where it stands."],
    }));
  }

  const chosen = ACTION_PRECEDENCE
    .map((action) => tokenPlans.find((entry) => entry.plan.action === action))
    .find((entry) => entry !== undefined)!;
  const byStage = new Map(tokenPlans.map((entry) => [entry.token.stageKey, entry.token]));
  const marking: DriveMarking = {
    ...stepped.marking,
    tokens: stepped.marking.tokens.map((token) => {
      const stageKey = definition.stages.find((stage) => token.node === stageElementId(stage.key) && token.from === undefined)?.key;
      const decided = stageKey ? byStage.get(stageKey) : undefined;
      return decided ? { ...token, lastAction: decided.action, lastReason: decided.reason, lastCycleKey: cycle.cycleKey } : token;
    }),
  };
  return {
    ...chosen.plan,
    // The legacy stageKey is the first marked stage in document order (design §4.2).
    stageKey: marked[0] ?? null,
    ledger: tokenPlans.flatMap((entry) => entry.plan.ledger),
    tokens: tokenPlans.map((entry) => entry.token),
    marking,
  };
}
