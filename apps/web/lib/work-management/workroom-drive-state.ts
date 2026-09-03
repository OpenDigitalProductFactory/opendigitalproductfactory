import { isRecord } from "@/lib/shared/coerce";

export type StoredWorkroomDriveState = {
  currentStageKey: string | null;
  receipts: { stageKey: string; kind: string }[];
  budgetUsage: { kind: string; used: number }[];
  stopConditionHits: string[];
  reviewDue: boolean;
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
  };
}
