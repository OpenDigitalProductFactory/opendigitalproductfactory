/**
 * The runner's graph-room bookkeeping, pure (BI-8875C9DF, GPP Phase 3c
 * PR-3c-1; branch dispatch and deactivation PR-3c-2).
 *
 * Design: docs/superpowers/specs/2026-10-02-gpp-phase-3c-drive-graph-execution-design.md
 * §4.2 ("A graph room's marking survives every tick", "Evidence across
 * iterations"), §4.3 (hold); plan:
 * docs/superpowers/plans/2026-10-02-gpp-phase-3c-drive-graph-execution.md
 * (PR-3c-1, workroom-drive.ts).
 *
 * The drive job (lib/queue/functions/workroom-drive.ts) calls these
 * functions only for a graph room (and workroom-drive-graph.ts applies the
 * graph plan), so a sequential room's tick is untouched: graphSnapshotFields
 * and earnGraphReceipts return null for a shape that uses no graph construct.
 *
 * - graphSnapshotFields: what a graph room's snapshot adds. A plan that
 *   carries a marking persists it, with `pendingAttentions` from its attention
 *   tokens. A plan that carries `{ raw }` persists the unreadable stored value
 *   verbatim. A plan that carries none (the posture and substrate early
 *   returns, `quiet`, the kill-switch pause, `lease_held`) copies the stored
 *   `marking` and `pendingAttentions` forward verbatim, because `persist`
 *   replaces the whole snapshot (review blocker 1). It also gives the hold key
 *   its `stageKey#iteration` list and says whether any token's stage or
 *   iteration changed, which is always news.
 * - earnGraphReceipts: receipts earned per marked stage, each at that stage's
 *   iteration and in the marking's run (BI-086DC167), and bounded by that
 *   stage's own dispatch time. Only when a
 *   stored marking is present: a graph room's first tick has none, holds no
 *   dispatch yet, and earns through the ordinary path. A sub-shape stage
 *   (PR-3c-5) earns only from `child-completion` evidence recorded after its
 *   token entered the stage.
 */
import type { DrivePlan } from "./drive-resolution";

/** The evidence kind a sub-shape child's success records on its parent stage (PR-3c-5). */
export const CHILD_COMPLETION_EVIDENCE_KIND = "child-completion";
import {
  iterationOf,
  markedKeysWithIteration,
  markedStageKeys,
  readStoredDriveMarking,
  stageToken,
  usesGraphConstructs,
  type DriveMarking,
  type DriveMarkingToken,
  type DriveTokenPlan,
} from "./drive-marking";
import { workroomDriveTaskId } from "./drive-plan-stage";
import { stageEvidenceKinds } from "./stage-briefing";
import { earnEvidenceReceipts, type RecordedEvidence, type StageReceipt } from "./stage-evidence-receipts";
import type { WorkShapeDefinitionContract } from "./work-shapes";
import {
  EXECUTOR_WRITEBACK_UNAVAILABLE_REASON,
  WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND,
  receiptInRun,
  type WorkroomDriveReceipt,
} from "./workroom-drive-receipts";

function storedDrive(workspaceState: unknown): Record<string, unknown> | null {
  const state = workspaceState && typeof workspaceState === "object" && !Array.isArray(workspaceState)
    ? (workspaceState as Record<string, unknown>) : null;
  const drive = state?.workroomDrive;
  return drive && typeof drive === "object" && !Array.isArray(drive) ? (drive as Record<string, unknown>) : null;
}

/** Whether the stored drive snapshot carries a marking (any value, readable or not). */
export function hasStoredDriveMarking(workspaceState: unknown): boolean {
  const drive = storedDrive(workspaceState);
  return drive !== null && Object.hasOwn(drive, "marking") && drive.marking !== undefined;
}

export type GraphSnapshotFields = {
  /** Keys to add to (or, for `stageKey`, overwrite in) the snapshot. */
  fields: Record<string, unknown>;
  /** Sorted `stageKey#iteration` of the persisted marking, for the hold key; absent when it cannot be read. */
  markedKeys?: string[];
  /** A token's stage or iteration changed since the stored marking. */
  iterationChanged: boolean;
  /** The plan dispatches at least one agent branch: always news, so the dispatch row is written (PR-3c-2). */
  dispatching: boolean;
};

export function graphSnapshotFields(plan: DrivePlan, workspaceState: unknown): GraphSnapshotFields | null {
  const definition = plan.definition;
  if (!definition || !usesGraphConstructs(definition)) return null;
  const drive = storedDrive(workspaceState);
  const storedRead = hasStoredDriveMarking(workspaceState) ? readStoredDriveMarking(workspaceState, definition, null) : null;
  const storedKeys = storedRead?.ok ? markedKeysWithIteration(definition, storedRead.data.marking) : null;
  const carry = (key: string, fields: Record<string, unknown>) => {
    if (drive && Object.hasOwn(drive, key) && drive[key] !== undefined) fields[key] = drive[key];
  };

  const fields: Record<string, unknown> = {};
  let persisted: DriveMarking | null = null;
  if (plan.marking && "raw" in plan.marking) {
    fields.marking = plan.marking.raw;
    carry("pendingAttentions", fields);
  } else if (plan.marking) {
    persisted = plan.marking;
    fields.marking = plan.marking;
    const pendingAttentions = (plan.tokens ?? [])
      .filter((token) => token.action === "attention")
      .map((token) => ({ principalRef: token.attentionPrincipalRef, stageKey: token.stageKey, reason: token.reason }));
    fields.pendingAttentions = pendingAttentions;
    // The legacy single reader sees the first waiting stage (design §4.2).
    fields.pendingAttention = pendingAttentions[0] ?? null;
  } else {
    carry("marking", fields);
    carry("pendingAttentions", fields);
    if (storedRead?.ok) {
      persisted = storedRead.data.marking;
      fields.stageKey = markedStageKeys(definition, storedRead.data.marking)[0] ?? null;
    }
  }
  const markedKeys = persisted ? markedKeysWithIteration(definition, persisted) : undefined;
  const iterationChanged = markedKeys !== undefined && storedKeys !== null && storedKeys.join("\n") !== markedKeys.join("\n");
  const dispatching = (plan.tokens ?? []).some((token) => token.action === "dispatch_agent" && token.taskId !== null);
  return { fields, ...(markedKeys ? { markedKeys } : {}), iterationChanged, dispatching };
}

function storedMarking(workspaceState: unknown, definition: WorkShapeDefinitionContract): DriveMarking | null {
  if (!hasStoredDriveMarking(workspaceState)) return null;
  const read = readStoredDriveMarking(workspaceState, definition, null);
  return read.ok ? read.data.marking : null;
}

function taskIdsOf(marking: DriveMarking | null): string[] {
  return marking ? marking.tokens.flatMap((token) => (token.taskId ? [token.taskId] : [])) : [];
}

export type GraphTaskEffects = {
  /** Agent branches to dispatch this tick, each through the task id fixed on its token. */
  dispatch: DriveTokenPlan[];
  /** Task ids to deactivate this tick. Never one that is dispatched this tick. */
  deactivate: string[];
};

/**
 * Which branch tasks a graph tick dispatches and deactivates (PR-3c-2, design
 * §6 "Dispatch every tick").
 *
 * - Every token whose plan is `dispatch_agent` is dispatched, whatever the
 *   aggregate action: one branch latched on the writeback latch (a token-level
 *   pause, which outranks dispatch in the aggregate) never blocks another.
 * - A token that LEFT its stage (it fired, waits as a join arrival, or was
 *   cleared) has its task deactivated in the same tick, because the upsert
 *   reactivates a task and resets nextRunAt, so a task left active keeps
 *   running for a stage that is no longer marked.
 * - A token paused at its stage has its task deactivated, as the sequential
 *   drive deactivates its task on a pause.
 * - A plan with no token plans (stop, success, do_not_wake, a conformance or
 *   fail-closed pause) deactivates every task the prior marking names, plus
 *   the room's primary id, as the sequential drive does.
 */
export function graphTaskEffects(plan: DrivePlan, workspaceState: unknown, roomId: string): GraphTaskEffects {
  const definition = plan.definition;
  if (!definition) return { dispatch: [], deactivate: [] };
  const prior = taskIdsOf(storedMarking(workspaceState, definition));
  const next = plan.marking && !("raw" in plan.marking) ? plan.marking : null;
  if (!plan.tokens) {
    if (plan.action === "dispatch_agent" || plan.action === "attention") return { dispatch: [], deactivate: [] };
    const primary = plan.shapeKey ? [workroomDriveTaskId(roomId, plan.shapeKey)] : [];
    return { dispatch: [], deactivate: [...new Set([...prior, ...taskIdsOf(next), ...primary])] };
  }
  const dispatch = plan.tokens.filter((token) => token.action === "dispatch_agent" && token.taskId !== null && token.agentId !== null);
  const dispatched = new Set(dispatch.map((token) => token.taskId as string));
  const live = new Set(taskIdsOf(next));
  const left = prior.filter((taskId) => !live.has(taskId));
  const paused = plan.tokens
    .filter((token) => token.action === "pause" || token.action === "escalate" || token.action === "stop")
    .flatMap((token) => {
      const taskId = next ? stageToken(next, token.stageKey)?.taskId : undefined;
      return taskId ? [taskId] : [];
    });
  return { dispatch, deactivate: [...new Set([...left, ...paused])].filter((taskId) => !dispatched.has(taskId)) };
}

/**
 * The room's receipts with a `blocked` receipt for every branch latched on the
 * writeback latch this tick. Each is scoped to the token's iteration (PR-3c-3),
 * written only when it is not 0 so an iteration-0 receipt keeps its PR-3c-2
 * bytes (absent reads 0): a pass the stage is sent back from never latches the
 * next pass. Each also carries the plan's run key (BI-086DC167), so a later
 * run's pass through the same stage is never latched by this one.
 */
export function withLatchedBlockedReceipts<R extends WorkroomDriveReceipt>(plan: DrivePlan, receipts: readonly R[]): Array<R | WorkroomDriveReceipt> {
  const out: Array<R | WorkroomDriveReceipt> = [...receipts];
  const runKey = plan.marking && !("raw" in plan.marking) ? plan.marking.cycleKey : undefined;
  for (const token of plan.tokens ?? []) {
    if (token.reason !== EXECUTOR_WRITEBACK_UNAVAILABLE_REASON) continue;
    if (out.some((receipt) => receipt.stageKey === token.stageKey && receipt.kind === WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND
      && (receipt.iteration ?? 0) === token.iteration && receiptInRun(receipt, runKey))) continue;
    out.push({
      stageKey: token.stageKey,
      kind: WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND,
      ...(token.iteration > 0 ? { iteration: token.iteration } : {}),
      ...(runKey !== undefined ? { runKey } : {}),
    });
  }
  return out;
}

/**
 * The marking to persist when some dispatches failed to schedule: each failed
 * branch's token gets back its prior last action, reason and cycle, so the
 * per-token writeback latch does not hold a stage that was never dispatched
 * (the sequential drive persists nothing when its one dispatch fails).
 */
export function withUndispatchedTokensRestored(
  marking: DriveMarking,
  workspaceState: unknown,
  definition: WorkShapeDefinitionContract,
  failedStageKeys: readonly string[],
): DriveMarking {
  if (failedStageKeys.length === 0) return marking;
  const prior = storedMarking(workspaceState, definition);
  const failed = new Set(failedStageKeys);
  return {
    ...marking,
    tokens: marking.tokens.map((token) => {
      const stageKey = definition.stages.find((stage) => stageToken({ tokens: [token] }, stage.key) !== null)?.key;
      if (!stageKey || !failed.has(stageKey)) return token;
      const before = prior ? stageToken(prior, stageKey) : null;
      const restored: DriveMarkingToken = { node: token.node, enteredAt: token.enteredAt, ...(token.taskId ? { taskId: token.taskId } : {}) };
      for (const key of ["lastAction", "lastReason", "lastCycleKey"] as const) {
        if (before?.[key] !== undefined) restored[key] = before[key];
      }
      return restored;
    }),
  };
}

/** Receipts earned for every marked stage of a graph room, or null when the sequential path applies. */
export function earnGraphReceipts(input: {
  definition: WorkShapeDefinitionContract | null;
  workspaceState: unknown;
  evidence: readonly RecordedEvidence[];
  dispatchedAtByStage?: ReadonlyMap<string, Date> | null;
  existing: readonly StageReceipt[];
}): readonly StageReceipt[] | null {
  const definition = input.definition;
  if (!definition || !usesGraphConstructs(definition) || !hasStoredDriveMarking(input.workspaceState)) return null;
  const read = readStoredDriveMarking(input.workspaceState, definition, null);
  // An unreadable marking earns nothing; the planner pauses the room on it.
  if (!read.ok) return input.existing;
  let receipts = input.existing;
  for (const stageKey of markedStageKeys(definition, read.data.marking)) {
    // A sub-shape stage (PR-3c-5) is completed only by its child: the `child-completion` evidence the runner
    // records on success, recorded after this pass's token entered the stage (so an earlier pass's never counts).
    const subShape = definition.stages.find((stage) => stage.key === stageKey)?.subShape !== undefined;
    const enteredAt = subShape ? stageToken(read.data.marking, stageKey)?.enteredAt : undefined;
    receipts = earnEvidenceReceipts({
      stageKey,
      declaredKinds: subShape ? [CHILD_COMPLETION_EVIDENCE_KIND] : stageEvidenceKinds(definition, stageKey),
      evidence: input.evidence,
      dispatchedAt: subShape ? (enteredAt ? new Date(enteredAt) : null) : input.dispatchedAtByStage?.get(stageKey) ?? null,
      existing: receipts,
      iteration: iterationOf(read.data.marking, stageKey),
      // The run this receipt belongs to (BI-086DC167): the next run never replays it.
      runKey: read.data.marking.cycleKey,
    });
  }
  return receipts;
}
