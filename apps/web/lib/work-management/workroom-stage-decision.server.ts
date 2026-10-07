// Server side of the governed stage decision (see workroom-stage-decision.ts).
//
// Two reads share one set of checks so the page and the write cannot disagree:
// the room must be waiting on a governed decision for THIS stage, the shape
// must make that stage a governed decision with a declared decision evidence
// kind, and the caller must be the resolved decider. Anything short of that is
// refused (fail closed); the write goes through recordWorkCapsuleEvidence and
// nowhere else — the drive earns the receipt from it.

import { err, ok, type ActionResult } from "@/lib/shared/action-result";
import { recordWorkCapsuleEvidence } from "@/lib/work-capsules/work-capsule-activity-store";
import type { CapsuleDb } from "@/lib/work-capsules/work-capsule-store-types";
import { loadRoomAccountabilityBatch, type RoomWorkforceDb } from "./room-workforce.server";
import { readWorkShapeDefinitionContract } from "./work-shapes";
import { resolveWorkShapeClaim } from "./workroom-shape-claim";
import {
  buildStageDecisionEvidence,
  governedDecisionStage,
  priorStageFindings,
  readPendingGovernedDecisions,
  resolveStageDecider,
  stageDeciderRefusal,
  validateStageDecision,
  type GovernedDecisionStage,
  type StageDecider,
  type StageDecisionInput,
  type WorkroomStageDecisionView,
} from "./workroom-stage-decision";

type FindFirst = { findFirst(args: unknown): Promise<Record<string, unknown> | null> };

export type StageDecisionDb = RoomWorkforceDb & CapsuleDb & {
  principal: FindFirst & { findMany(args: unknown): Promise<Array<Record<string, unknown>>> };
  workroomActivity: { findMany(args: unknown): Promise<Array<Record<string, unknown>>> };
};

type RoomRow = { id: string; capsuleId: string; scopeClaims: unknown; workspaceState: unknown; archivedAt: Date | null };

type DecisionContext = {
  room: RoomRow;
  stage: GovernedDecisionStage;
  decider: StageDecider;
  callerPrincipalId: string | null;
};

/** The caller's active human Principal row id (same alias read as delivery-room-ownership). */
async function callerHumanPrincipalId(db: StageDecisionDb, userId: string): Promise<string | null> {
  const principal = await db.principal.findFirst({
    where: {
      kind: "human",
      status: "active",
      aliases: { some: { aliasType: "user", issuer: "", aliasValue: userId } },
    },
    select: { id: true },
  });
  return typeof principal?.id === "string" ? principal.id : null;
}

async function loadDecisionContext(
  db: StageDecisionDb,
  input: { roomRowId: string; userId: string; stageKey?: string },
): Promise<ActionResult<DecisionContext>> {
  const room = await db.workroom.findUnique({
    where: { id: input.roomRowId },
    select: { id: true, capsuleId: true, scopeClaims: true, workspaceState: true, archivedAt: true },
  }) as RoomRow | null;
  if (!room || room.archivedAt) return err("That room could not be found.");
  // Several parallel branches may wait on decisions at once (GPP Phase 3c
  // PR-3c-2): the stage the control posts must be one of them. Without a stage
  // key, the first is read, as for a sequential room.
  const waiting = readPendingGovernedDecisions(room.workspaceState);
  const pending = input.stageKey !== undefined
    ? waiting.find((entry) => entry.stageKey === input.stageKey)
    : waiting[0];
  if (!pending) {
    return err("This room is not waiting on a decision for that stage.");
  }
  const shape = resolveWorkShapeClaim(room.scopeClaims);
  const stage = governedDecisionStage(shape ? readWorkShapeDefinitionContract(shape) : null, pending.stageKey);
  if (!stage) return err("That stage is not a decision a person records here.");
  const owner = (await loadRoomAccountabilityBatch(db, [room.id])).get(room.id)!;
  const decider = resolveStageDecider(owner.accountability, owner.accountableDisplayName);
  const callerPrincipalId = await callerHumanPrincipalId(db, input.userId);
  return ok({ room, stage, decider, callerPrincipalId });
}

function callerMayDecide(context: DecisionContext): boolean {
  return context.decider.state === "resolved"
    && context.callerPrincipalId !== null
    && context.callerPrincipalId === context.decider.principalId;
}

/**
 * Record the decision a governed stage is waiting on, as that stage's evidence.
 * Exactly one evidence row on success; nothing written on any refusal.
 */
export async function recordWorkroomStageDecisionForUser(
  db: StageDecisionDb,
  input: StageDecisionInput & { userId: string; roomRowId: string; now?: Date },
): Promise<ActionResult> {
  const loaded = await loadDecisionContext(db, input);
  if (!loaded.ok) return err(loaded.error);
  const context = loaded.data;
  if (!callerMayDecide(context)) return err(stageDeciderRefusal(context.decider));
  const valid = validateStageDecision(input, context.stage, input.now ?? new Date());
  if (!valid.ok) return err(valid.error);
  const decider = context.decider as Extract<StageDecider, { state: "resolved" }>;
  const evidence = buildStageDecisionEvidence({
    stage: context.stage,
    decision: valid.data,
    decidedBy: decider.decidedBy,
    deciderName: decider.name,
  });
  await recordWorkCapsuleEvidence({
    db,
    capsuleId: context.room.capsuleId,
    evidence: evidence as Parameters<typeof recordWorkCapsuleEvidence>[0]["evidence"],
    actor: { userId: input.userId, agentId: null, principalId: context.callerPrincipalId },
  });
  return ok();
}

/** The room page's read model; null when the room is not waiting on a decision a person records. */
export async function loadWorkroomStageDecisionView(
  db: StageDecisionDb,
  input: { caseKey: string; roomRowId: string; userId: string },
): Promise<WorkroomStageDecisionView | null> {
  const loaded = await loadDecisionContext(db, input);
  if (!loaded.ok) return null;
  const { room, stage, decider } = loaded.data;
  const canDecide = callerMayDecide(loaded.data);
  const evidence = await db.workroomActivity.findMany({
    where: { workCapsuleId: room.id, kind: "evidence-recorded" },
    orderBy: { recordedAt: "desc" },
    take: 50,
    select: { payload: true, summary: true },
  });
  return {
    caseKey: input.caseKey,
    roomRowId: room.id,
    stageKey: stage.key,
    stageTitle: stage.title,
    choices: stage.choices,
    deciderName: decider.state === "resolved" ? decider.name : null,
    canDecide,
    refusal: canDecide ? null : stageDeciderRefusal(decider),
    findings: priorStageFindings(stage, evidence.map((row) => ({
      payload: row.payload,
      summary: typeof row.summary === "string" ? row.summary : "",
    }))),
  };
}
