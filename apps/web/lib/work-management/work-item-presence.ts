// BI-B416B12A (EP-WORK-CONVERGENCE): presence on a work item — who is currently
// viewing/working it. Clients heartbeat `lastSeenAt`; "who's active now" is a
// pure time-window filter over the rows. Kept DB-free and unit-testable; the
// server action persists heartbeats and reads rows, then calls this.

export const PRESENCE_ACTIVE_WINDOW_MS = 45_000;

export interface PresenceRow {
  principalType: string;
  principalId: string;
  displayLabel?: string | null;
  lastSeenAt: Date;
}

export interface ActiveViewer {
  principalType: string;
  principalId: string;
  label: string;
}

/**
 * Return the viewers seen within the active window, newest-first, one per
 * principal. `excludePrincipalId` drops the current viewer (you don't show
 * yourself as "also here"). Pure.
 */
export function filterActivePresence(
  rows: PresenceRow[],
  nowMs: number,
  options?: { windowMs?: number; excludePrincipalId?: string },
): ActiveViewer[] {
  const windowMs = options?.windowMs ?? PRESENCE_ACTIVE_WINDOW_MS;
  const seen = new Set<string>();
  return rows
    .filter((row) => nowMs - row.lastSeenAt.getTime() <= windowMs)
    .filter((row) => row.principalId !== options?.excludePrincipalId)
    .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime())
    .filter((row) => {
      const key = `${row.principalType}:${row.principalId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((row) => ({
      principalType: row.principalType,
      principalId: row.principalId,
      label: row.displayLabel?.trim() || (row.principalType === "agent" ? "A coworker" : "Someone"),
    }));
}
