/**
 * The runner's graph-room bookkeeping, pure (BI-8875C9DF, GPP Phase 3c
 * PR-3c-1).
 *
 * Design: docs/superpowers/specs/2026-10-02-gpp-phase-3c-drive-graph-execution-design.md
 * §4.2 ("A graph room's marking survives every tick", "Evidence across
 * iterations"), §4.3 (hold); plan:
 * docs/superpowers/plans/2026-10-02-gpp-phase-3c-drive-graph-execution.md
 * (PR-3c-1, workroom-drive.ts).
 *
 * The drive job (lib/queue/functions/workroom-drive.ts) calls these two
 * functions and nothing else of the graph path, so a sequential room's tick is
 * untouched: both return null for a shape that uses no graph construct.
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
 *   iteration and bounded by that stage's own dispatch time. Only when a
 *   stored marking is present: a graph room's first tick has none, holds no
 *   dispatch yet, and earns through the ordinary path.
 */
import type { DrivePlan } from "./drive-resolution";
import {
  iterationOf,
  markedKeysWithIteration,
  markedStageKeys,
  readStoredDriveMarking,
  usesGraphConstructs,
  type DriveMarking,
} from "./drive-marking";
import { stageEvidenceKinds } from "./stage-briefing";
import { earnEvidenceReceipts, type RecordedEvidence, type StageReceipt } from "./stage-evidence-receipts";
import type { WorkShapeDefinitionContract } from "./work-shapes";

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
};

export function graphSnapshotFields(plan: DrivePlan, workspaceState: unknown): GraphSnapshotFields | null {
  const definition = plan.definition;
  if (!definition || !usesGraphConstructs(definition)) return null;
  const drive = storedDrive(workspaceState);
  const storedRead = hasStoredDriveMarking(workspaceState) ? readStoredDriveMarking(workspaceState, definition, null) : null;
  const storedKeys = storedRead?.ok ? markedKeysWithIteration(definition, storedRead.marking) : null;
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
    fields.pendingAttentions = (plan.tokens ?? [])
      .filter((token) => token.action === "attention")
      .map((token) => ({ principalRef: token.attentionPrincipalRef, stageKey: token.stageKey, reason: token.reason }));
  } else {
    carry("marking", fields);
    carry("pendingAttentions", fields);
    if (storedRead?.ok) {
      persisted = storedRead.marking;
      fields.stageKey = markedStageKeys(definition, storedRead.marking)[0] ?? null;
    }
  }
  const markedKeys = persisted ? markedKeysWithIteration(definition, persisted) : undefined;
  const iterationChanged = markedKeys !== undefined && storedKeys !== null && storedKeys.join("\n") !== markedKeys.join("\n");
  return { fields, ...(markedKeys ? { markedKeys } : {}), iterationChanged };
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
  for (const stageKey of markedStageKeys(definition, read.marking)) {
    receipts = earnEvidenceReceipts({
      stageKey,
      declaredKinds: stageEvidenceKinds(definition, stageKey),
      evidence: input.evidence,
      dispatchedAt: input.dispatchedAtByStage?.get(stageKey) ?? null,
      existing: receipts,
      iteration: iterationOf(read.marking, stageKey),
    });
  }
  return receipts;
}
