import { narrowRoomToolGrant } from "./room-definition-contract";
import type { WorkCaseRoomTrigger } from "./room-definition-contract";
import { getWorkCaseSourceEntry } from "./source-registry";

/** Resolve the effective grant for a source key against an agent's standing grants. */
export function resolveRoomToolGrantForSource(
  sourceKey: string | null | undefined,
  standingGrantKeys: readonly string[],
): { granted: string[]; refused: string[] } | null {
  const entry = getWorkCaseSourceEntry(sourceKey);
  if (!entry) return null;
  return narrowRoomToolGrant(entry.toolGrant, standingGrantKeys);
}

export function getWorkCaseRoomTrigger(
  sourceKey: string | null | undefined,
): WorkCaseRoomTrigger | null {
  return getWorkCaseSourceEntry(sourceKey)?.trigger ?? null;
}
