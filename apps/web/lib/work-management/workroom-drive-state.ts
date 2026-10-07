import { isRecord } from "@/lib/shared/coerce";
import type { PriorWorkroomDrive } from "./workroom-drive-receipts";

export type StoredWorkroomDriveState = {
  currentStageKey: string | null;
  /** `iteration` is present only on graph-shape receipts that carry a valid one (Phase 3c). */
  receipts: { stageKey: string; kind: string; iteration?: number }[];
  budgetUsage: { kind: string; used: number }[];
  stopConditionHits: string[];
  reviewDue: boolean;
  lastAction: string | null;
  lastReason: string | null;
  /** The cycle the last tick belonged to. The writeback latch is bounded by it,
   *  so a room can retry once per cycle instead of locking forever. */
  lastCycleKey: string | null;
};

/** Read only verifier-relevant observations from the persisted runner snapshot. */
export function readStoredWorkroomDriveState(workspaceState: unknown): StoredWorkroomDriveState {
  const drive = isRecord(workspaceState) && isRecord(workspaceState.workroomDrive)
    ? workspaceState.workroomDrive
    : null;
  const receipts = Array.isArray(drive?.receipts)
    ? drive.receipts.flatMap((entry) => isRecord(entry)
      && typeof entry.stageKey === "string"
      && typeof entry.kind === "string"
      ? [{
        stageKey: entry.stageKey,
        kind: entry.kind,
        // Copied only when it is a finite non-negative integer, so a legacy
        // receipt round-trips byte-identically and a malformed one reads as
        // iteration 0 (BI-8875C9DF, Phase 3c).
        ...(Number.isInteger(entry.iteration) && (entry.iteration as number) >= 0 ? { iteration: entry.iteration as number } : {}),
      }]
      : [])
    : [];
  const budgetUsage = Array.isArray(drive?.budgetUsage)
    ? drive.budgetUsage.flatMap((entry) => isRecord(entry)
      && typeof entry.kind === "string"
      && typeof entry.used === "number"
      && Number.isFinite(entry.used)
      ? [{ kind: entry.kind, used: entry.used }]
      : [])
    : [];
  return {
    currentStageKey: typeof drive?.stageKey === "string" ? drive.stageKey : null,
    receipts,
    budgetUsage,
    stopConditionHits: Array.isArray(drive?.stopConditionHits)
      ? drive.stopConditionHits.filter((entry): entry is string => typeof entry === "string")
      : [],
    reviewDue: drive?.reviewDue === true,
    lastAction: typeof drive?.action === "string" ? drive.action : null,
    lastReason: typeof drive?.reason === "string" ? drive.reason : null,
    lastCycleKey: typeof drive?.lastCycleKey === "string" ? drive.lastCycleKey : null,
  };
}

export function priorDriveFromStored(stored: StoredWorkroomDriveState): PriorWorkroomDrive | null {
  if (!stored.lastAction) return null;
  return {
    action: stored.lastAction,
    reason: stored.lastReason ?? "",
    stageKey: stored.currentStageKey,
    cycleKey: stored.lastCycleKey,
  };
}

/**
 * A graph room's marked stages, read off its stored `marking` (GPP Phase 3c
 * PR-3c-2, design §4.3 "Room view"): every stage token (`stage:<key>`, no
 * join `from`), with each stage's current iteration. Null for a room with no
 * marking (every sequential room) or one whose tokens cannot be read; the
 * drive itself validates the marking strictly and pauses on a malformed one.
 */
function markedStagesOf(drive: Record<string, unknown> | null): { keys: string[]; iterations: Record<string, number> } | null {
  const marking = isRecord(drive?.marking) ? drive.marking : null;
  if (!marking || !Array.isArray(marking.tokens)) return null;
  const keys: string[] = [];
  for (const token of marking.tokens) {
    if (!isRecord(token) || typeof token.node !== "string" || token.from !== undefined) continue;
    if (!token.node.startsWith("stage:")) continue;
    const key = token.node.slice("stage:".length);
    if (key && !keys.includes(key)) keys.push(key);
  }
  const iterations: Record<string, number> = {};
  if (isRecord(marking.iterations)) {
    for (const [key, value] of Object.entries(marking.iterations)) {
      if (Number.isInteger(value) && (value as number) >= 0) iterations[key] = value as number;
    }
  }
  return { keys, iterations };
}

/** One observation contract for anchored and standalone room inspectors. */
export function projectStoredWorkroomDriveObservation(workspaceState: unknown) {
  const stored = readStoredWorkroomDriveState(workspaceState);
  const drive = isRecord(workspaceState) && isRecord(workspaceState.workroomDrive)
    ? workspaceState.workroomDrive : null;
  const pending = isRecord(drive?.pendingAttention) ? drive.pendingAttention : null;
  const attentionReason = stored.lastAction === "attention" && stored.currentStageKey
    && pending?.stageKey === stored.currentStageKey
    && typeof pending.principalRef === "string" && pending.principalRef.trim()
    ? `Stage ${stored.currentStageKey} is waiting on ${pending.principalRef.trim()}.` : null;
  const marked = markedStagesOf(drive);
  return {
    currentStageKey: stored.currentStageKey, proposedStageKey: stored.currentStageKey,
    receipts: stored.receipts, budgetUsage: stored.budgetUsage,
    stopConditionHits: stored.stopConditionHits, reviewDue: stored.reviewDue, attentionReason,
    // Graph rooms only: several stages can be current at once. Absent means today's single stage.
    ...(marked ? { currentStageKeys: marked.keys, stageIterations: marked.iterations } : {}),
  };
}
