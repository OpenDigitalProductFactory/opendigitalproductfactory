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
 * GATE VERDICTS (PR-3c-3, design §6.2). For a stage whose typed gate is
 * enforced, blocking and declares a refuse route, the verdict is read off the
 * stage's latest recorded decision since its token entered (deriveGateVerdict):
 * accept and patch admit, refuse refuses, and defer HOLDS the token at the gate
 * until an accept or a send-back (DI-0D9DFB0FC0EF, 2026-10-06). Every other
 * stage advances on its completing receipt exactly as today, so `defer` keeps
 * advancing wherever no refuse route is declared (founder decision
 * 2026-10-02). A refuse whose route is spent with no budget stop raises
 * `attention` / `gate_refused` to the gate's escalation role, else the stage
 * principal; a refuse to a stop ends the cycle with `stop` /
 * `refused_to_stop`, which stays the room's answer until the next cycle.
 *
 * STAGE DEADLINES (PR-3c-4, design §8). After the plan is built, every token
 * past its stage's deadline whose `<cycleKey>#<stageKey>#<iteration>` key is
 * not yet in `marking.deadlines` is raised there with `notifiedAt: null`
 * (drive-deadlines.ts). Nothing else changes: the deadline never moves work.
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
  gateHolds,
  iterationOf,
  latchPriorFor,
  markedStageKeys,
  readStoredDriveMarking,
  stageAwaitsVerdict,
  stageToken,
  stepDriveMarking,
  type DriveGateVerdict,
  type DriveGateVerdictKind,
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
import { raiseDueDeadlines } from "./drive-deadlines";
import type { RecordedEvidence } from "./stage-evidence-receipts";
import type { WorkShapeDefinitionContract } from "./work-shapes";
import { evaluateWorkroomShapeConformance } from "./workroom-shape-conformance";
import { STAGE_DECISION_EVIDENCE_KINDS } from "./workroom-stage-decision";
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

/**
 * A recorded stage decision's choice → the gate verdict (design §6.2).
 * `defer` holds (DI-0D9DFB0FC0EF): it is read only for a stage that declares a
 * refuse route, so on every other stage a deferral still advances.
 */
const VERDICT_BY_CHOICE: Readonly<Record<string, DriveGateVerdictKind>> = Object.freeze({
  accept: "admit",
  patch: "admit",
  defer: "hold",
  refuse: "refuse",
});

/**
 * The gate verdict for one stage at one iteration, or null (PR-3c-3). Read
 * only for a stage whose typed gate is enforced, blocking and declares a
 * refuse route; null for every other stage, which advances on its completing
 * receipt. The verdict is the latest completed `decision-record` evidence for
 * the stage, recorded at or after `since` (the token's own `enteredAt`, so a
 * decision from an earlier pass through the stage never counts), mapped from
 * its `choice`. Evidence with no choice, or one outside the vocabulary, gives
 * no verdict: a refuse never defaults to admit, and nothing defaults to refuse.
 */
export function deriveGateVerdict(
  definition: WorkShapeDefinitionContract,
  stageKey: string,
  evidence: readonly RecordedEvidence[],
  iteration: number,
  since: Date | null,
): DriveGateVerdict | null {
  const stage = definition.stages.find((entry) => entry.key === stageKey);
  if (!stage || stage.advance.kind !== "governed-decision" || !stage.advance.gate) return null;
  if (!stageAwaitsVerdict(definition, stageKey)) return null;
  const decisionKinds: readonly string[] = STAGE_DECISION_EVIDENCE_KINDS;
  let latest: RecordedEvidence | null = null;
  for (const row of evidence) {
    if (row.stageKey !== stageKey || row.outcome !== "completed" || typeof row.choice !== "string") continue;
    if (row.kind === null || !decisionKinds.includes(row.kind)) continue;
    if (since && row.recordedAt.getTime() < since.getTime()) continue;
    if (!latest || row.recordedAt.getTime() > latest.recordedAt.getTime()) latest = row;
  }
  const verdict = latest?.choice ? VERDICT_BY_CHOICE[latest.choice] : undefined;
  return verdict ? { verdict, mode: stage.advance.gate.mode, iteration } : null;
}

/** The verdict of every marked stage that waits on one, keyed by stage. */
export function gateVerdictsFor(
  definition: WorkShapeDefinitionContract,
  marking: DriveMarking,
  evidence: readonly RecordedEvidence[],
): Record<string, DriveGateVerdict> {
  const out: Record<string, DriveGateVerdict> = {};
  for (const stageKey of markedStageKeys(definition, marking)) {
    const token = stageToken(marking, stageKey);
    const since = token ? new Date(token.enteredAt) : null;
    const verdict = deriveGateVerdict(definition, stageKey, evidence, iterationOf(marking, stageKey), since);
    if (verdict) out[stageKey] = verdict;
  }
  return out;
}

/** Who a held gate waits on: the gate's escalation role, else the stage's principal. */
function gatePrincipalRef(stage: WorkShapeDefinitionContract["stages"][number]): string {
  const gate = stage.advance.kind === "governed-decision" ? stage.advance.gate : undefined;
  return gate?.escalation?.role ?? stage.accountablePrincipalRef;
}

/**
 * The graph drive's plan, with this tick's stage deadlines raised (PR-3c-4,
 * design §8). A deadline never changes what the plan does: it adds the overdue
 * notices to the marking the plan already persists (`notifiedAt: null`), one
 * ledger line each, and lists them as `deadlinesDue` for the runner's
 * `workroom-drive-deadline` activity. A plan that carries no readable marking
 * (the kill-switch and unreadable pauses) raises nothing.
 */
export function resolveGraphDrivePlan(input: DriveResolutionInput & { definition: WorkShapeDefinitionContract }): DrivePlan {
  const plan = planGraphDrive(input);
  if (!plan.marking || "raw" in plan.marking) return plan;
  const { marking, raised } = raiseDueDeadlines(input.definition, plan.marking, input.now ?? new Date(0));
  if (raised.length === 0) return plan;
  return {
    ...plan,
    marking,
    ledger: [
      ...plan.ledger,
      ...raised.map((due) => `Stage ${due.stageKey} is past its deadline (${due.description}; due ${due.dueAt}); it stays where it is and ${due.escalationRef} is told.`),
    ],
    deadlinesDue: raised,
  };
}

function planGraphDrive(input: DriveResolutionInput & { definition: WorkShapeDefinitionContract }): DrivePlan {
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

  // A cycle a refuse sent to a stop stays stopped, visibly, until the next cycle starts a fresh marking.
  const lastTick = input.priorDrive ?? null;
  if (read.data.source === "stored" && stored.tokens.length === 0
    && lastTick?.action === "stop" && lastTick.reason === "refused_to_stop" && lastTick.cycleKey === cycle.cycleKey) {
    return {
      ...emptyPlan(input, "stop", "refused_to_stop", { cycle, ledger: [`Cycle ${cycle.cycleKey} was ended by a refusal routed to a stop; the room starts again next cycle.`] }),
      marking: stored,
    };
  }

  // 3. One firing, then conformance over the flow.
  const verdicts = gateVerdictsFor(definition, stored, input.recordedEvidence ?? []);
  let stepped: DriveStepResult;
  try {
    stepped = stepDriveMarking(definition, stored, { receipts: input.receipts, verdicts }, now);
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
    flowOrder: {
      enabled: marked,
      delivered,
      ...(stepped.reworked?.toStageKey ? { reworkRoute: { from: stepped.reworked.fromStageKey, to: stepped.reworked.toStageKey } } : {}),
    },
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
    if (stepped.stopped.kind === "success") {
      return {
        ...emptyPlan(input, "stop", "success", { conformance, cycle, ledger: ["No further permitted stage; cycle complete."] }),
        marking: stepped.marking,
      };
    }
    // A refuse routed to a failure stop, or past its bound to the budget stop (PR-3c-3).
    return {
      ...emptyPlan(input, "stop", "refused_to_stop", {
        conformance,
        cycle,
        ledger: [`Stage ${stepped.fired ?? "unknown"} was sent back to the ${stepped.stopped.kind} stop ${stepped.stopped.stopId ?? ""} (${stepped.stopped.disposition ?? "no disposition"}); the cycle ends.`],
      }),
      marking: stepped.marking,
    };
  }
  const reworkLedger = stepped.reworked
    ? [`Stage ${stepped.reworked.fromStageKey} was sent back to ${stepped.reworked.toStageKey ?? "an earlier node"} over ${stepped.reworked.edgeId} (${stepped.marking.reworkTaken[stepped.reworked.edgeId] ?? 0} taken); stages ${stepped.reworked.clearedStageKeys.join(", ")} start a new iteration.`]
    : [];
  const holds = gateHolds(definition, stepped.marking, { receipts: input.receipts, verdicts });

  // 4. One plan per marked stage, in document order.
  const tokenPlans: Array<{ plan: DrivePlan; token: DriveTokenPlan }> = [];
  for (const stageKey of marked) {
    const stage = definition.stages.find((entry) => entry.key === stageKey);
    const token = stageToken(stepped.marking, stageKey);
    if (!stage || !token) continue;
    const iteration = iterationOf(stepped.marking, stageKey);
    const planned = planStage({ input, definition, stage, conformance, cycle, prior: latchPriorFor(token, stageKey), iteration });
    // A gate holding a completed stage (PR-3c-3) waits on a person, never on a re-dispatch:
    // a refuse with no route is `gate_refused`; no verdict, hold or escalate stays a governed decision.
    const gateHold = holds.get(stageKey);
    const gated: DrivePlan | null = gateHold === "refused_without_route"
      ? attentionPlan(planned, stage, "gate_refused", `Stage ${stageKey} was sent back, but its refuse route cannot be taken (bound spent, no budget stop); it waits on ${gatePrincipalRef(stage)}.`)
      : gateHold === "awaiting_verdict" && planned.action === "dispatch_agent"
        ? attentionPlan(planned, stage, "governed_decision", `Stage ${stageKey} is complete and waits at its gate for a decision from ${gatePrincipalRef(stage)}.`)
        : null;
    const decided = gated ?? planned;
    // A dispatch goes through the task id fixed on the token when it entered the stage.
    const plan = decided.action === "dispatch_agent" && token.taskId ? { ...decided, taskId: token.taskId } : decided;
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
    ledger: [...reworkLedger, ...tokenPlans.flatMap((entry) => entry.plan.ledger)],
    tokens: tokenPlans.map((entry) => entry.token),
    marking,
    ...(stepped.reworked ? { rework: stepped.reworked } : {}),
  };
}

/** A token plan turned into attention at its gate (PR-3c-3). */
function attentionPlan(
  planned: DrivePlan,
  stage: WorkShapeDefinitionContract["stages"][number],
  reason: "gate_refused" | "governed_decision",
  line: string,
): DrivePlan {
  return {
    ...planned,
    action: "attention",
    reason,
    stageKey: stage.key,
    accountablePrincipalRef: stage.accountablePrincipalRef,
    agentId: null,
    attentionPrincipalRef: gatePrincipalRef(stage),
    taskId: null,
    deviations: [],
    ledger: [line],
  };
}
