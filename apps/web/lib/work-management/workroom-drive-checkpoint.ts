import { isRecord } from "@/lib/shared/coerce";

export type DispatchScope = { runKey: string; cycleKey: string; iteration: number };
export type DispatchSource = { repositoryFullName: string | null; headSha: string | null };

/** Phase 2 capture boundary: enqueue is a database effect, never task completion.
 * Stored with the task in its lease-fenced transaction. Unknown executor-owned
 * artifacts/acceptance remain unknown; this record does not authorize replay.
 * Design: docs/architecture/workroom-cycle-continuity.md.
 */
export type DispatchCheckpoint = {
  version: 1;
  revision: number;
  /** Absent on legacy receipts: their dispatch boundary remains unknown. */
  dispatchScope?: DispatchScope;
  /** Absent on legacy receipts: source provenance remains unknown. */
  source?: DispatchSource;
  roomId: string;
  objective: string | null;
  remainingAcceptance: null;
  artifacts: null;
  dirtyOutputs: null;
  pendingIntent: null;
  confirmedEffect: { kind: "scheduled-task-enqueued"; taskId: string; recordedAt: string };
  stage: { shapeKey: string; shapeVersion: string; stageKey: string; tools: string[] };
  authority: { holderPrincipalId: string | null; leaseExpiresAt: string };
  nextAction: "reconcile-scheduled-task";
};

const date = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;

export function readDispatchCheckpoint(value: unknown): DispatchCheckpoint | null {
  if (!isRecord(value) || value.version !== 1 || !Number.isSafeInteger(value.revision)
    || (value.revision as number) < 1 || !text(value.roomId)
    || !(value.objective === null || typeof value.objective === "string")
    || value.remainingAcceptance !== null || value.artifacts !== null || value.dirtyOutputs !== null
    || value.pendingIntent !== null || value.nextAction !== "reconcile-scheduled-task") return null;
  if (value.dispatchScope !== undefined && (!isRecord(value.dispatchScope)
    || !text(value.dispatchScope.runKey) || !text(value.dispatchScope.cycleKey)
    || !Number.isSafeInteger(value.dispatchScope.iteration) || (value.dispatchScope.iteration as number) < 0)) return null;
  if (value.source !== undefined && (!isRecord(value.source)
    || !(value.source.repositoryFullName === null || text(value.source.repositoryFullName))
    || !(value.source.headSha === null || text(value.source.headSha)))) return null;
  const effect = value.confirmedEffect, stage = value.stage, authority = value.authority;
  if (!isRecord(effect) || effect.kind !== "scheduled-task-enqueued" || !text(effect.taskId)
    || !date(effect.recordedAt) || !isRecord(stage) || !text(stage.shapeKey) || !text(stage.shapeVersion)
    || !text(stage.stageKey) || !Array.isArray(stage.tools) || !stage.tools.every(text)
    || !isRecord(authority) || !(authority.holderPrincipalId === null || text(authority.holderPrincipalId))
    || !date(authority.leaseExpiresAt)) return null;
  return value as DispatchCheckpoint;
}

export function buildDispatchCheckpoint(previous: unknown, input: {
  taskId: string; roomId: string; objective: string | null;
  dispatchScope?: DispatchScope;
  source?: DispatchSource;
  stage: DispatchCheckpoint["stage"];
  holderPrincipalId: string | null; leaseExpiresAt: string; now: string;
}): DispatchCheckpoint {
  const prior = previous == null ? null : readDispatchCheckpoint(previous);
  if (previous != null && (!prior || prior.roomId !== input.roomId)) throw new Error("Unreadable or foreign dispatch checkpoint");
  const next: DispatchCheckpoint = {
    version: 1, revision: (prior?.revision ?? 0) + 1, roomId: input.roomId, objective: input.objective,
    ...(input.dispatchScope ? { dispatchScope: { ...input.dispatchScope } } : {}),
    ...(input.source !== undefined ? { source: { ...input.source } } : {}),
    remainingAcceptance: null, artifacts: null, dirtyOutputs: null, pendingIntent: null,
    confirmedEffect: { kind: "scheduled-task-enqueued", taskId: input.taskId, recordedAt: input.now },
    stage: { ...input.stage, tools: [...input.stage.tools] },
    authority: { holderPrincipalId: input.holderPrincipalId, leaseExpiresAt: input.leaseExpiresAt },
    nextAction: "reconcile-scheduled-task",
  };
  if (!readDispatchCheckpoint(next)) throw new Error("Invalid dispatch checkpoint");
  return next;
}
