import { isRecord } from "@/lib/shared/coerce";
import type { PriorWorkroomDrive } from "./workroom-drive-receipts";

export type StoredWorkroomDriveState = {
  currentStageKey: string | null;
  receipts: { stageKey: string; kind: string }[];
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
      ? [{ stageKey: entry.stageKey, kind: entry.kind }]
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
  return {
    currentStageKey: stored.currentStageKey, proposedStageKey: stored.currentStageKey,
    receipts: stored.receipts, budgetUsage: stored.budgetUsage,
    stopConditionHits: stored.stopConditionHits, reviewDue: stored.reviewDue, attentionReason,
  };
}
