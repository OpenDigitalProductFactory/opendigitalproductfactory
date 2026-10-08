// The drive's persist merge, as one pure function (BI-8875C9DF, GPP Phase 3c
// PR-3c-1). Design: docs/superpowers/specs/
// 2026-10-02-gpp-phase-3c-drive-graph-execution-design.md §4.2, §5; plan:
// docs/superpowers/plans/2026-10-02-gpp-phase-3c-drive-graph-execution.md
// (PR-3c-1, first commit).
//
// `persist` (apps/web/lib/queue/functions/workroom-drive.ts) replaces the whole
// `workspaceState.workroomDrive` snapshot. Before it writes, it merges back the
// completing receipts the row already holds, when the row is on the same cycle
// as the snapshot, so a receipt recorded between the drive's read and its write
// is never lost. That merge used to live inline in the transaction. It is
// extracted here as a pure move so the persist transaction and the
// characterization golden (drive-sequential-identity.test.ts) run the very same
// function.

import { driveRunKeyOf, readStoredWorkroomDriveState } from "./workroom-drive-state";
import { appendCompletingWorkroomDriveReceipt, WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND } from "./workroom-drive-receipts";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * The snapshot `persist` writes, given the row's current `workspaceState` and
 * the snapshot the drive built. Pure: neither input is mutated.
 *
 * `graphShape` (GPP Phase 3c PR-3c-1, BI-8875C9DF): the snapshot is for a
 * shape on the graph path. Under the same compare-and-set and the same
 * `lastCycleKey` condition as receipts, a `marking` or `pendingAttentions` the
 * row holds and the snapshot lacks is kept, so no persist can drop a graph
 * room's marking. A snapshot that carries its own keeps them (it was built
 * from what the drive read).
 *
 * The "same cycle" condition compares RUN keys, read through driveRunKeyOf:
 * a graph room's marking `cycleKey` (BI-086DC167), a sequential room's
 * `runKey` (BI-853120EE). On the graph path a snapshot that carries no
 * marking of its own is on the row's run. A run crosses UTC midnight, so a
 * receipt recorded during the tick that crosses it belongs to the same run
 * and is kept, where comparing the calendar `lastCycleKey` would drop it; and
 * the first tick of a new run never merges the concluded run's receipts back.
 * Either side without a readable run key falls back to `lastCycleKey`,
 * exactly as before.
 */
function sameCycle(currentDrive: Record<string, unknown>, next: Record<string, unknown>, graphShape: boolean): boolean {
  const current = driveRunKeyOf(currentDrive);
  // A graph snapshot without a marking of its own carries the row's forward, so it is on the row's run.
  const snapshot = graphShape && !(Object.hasOwn(next, "marking") && next.marking !== undefined) ? current : driveRunKeyOf(next);
  if (current !== null && snapshot !== null) return current === snapshot;
  return currentDrive.lastCycleKey === next.lastCycleKey;
}

export function mergeWorkroomDriveSnapshot(
  currentWorkspaceState: unknown,
  next: Record<string, unknown>,
  options: { graphShape?: boolean } = {},
): Record<string, unknown> {
  const currentDrive = asRecord(asRecord(currentWorkspaceState)?.workroomDrive);
  let snapshot = next;
  if (currentDrive && sameCycle(currentDrive, next, options.graphShape === true)) {
    let receipts = readStoredWorkroomDriveState({ workroomDrive: snapshot }).receipts;
    // A sequential snapshot names its run (BI-853120EE): a row receipt merged
    // into it belongs to that run, so it is stamped, and deduplicates against
    // the run's own receipts.
    const sequentialRunKey = !options.graphShape && typeof next.runKey === "string" ? next.runKey : null;
    for (const stored of readStoredWorkroomDriveState(currentWorkspaceState).receipts) {
      if (stored.kind === WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND) continue;
      const receipt = sequentialRunKey !== null && stored.runKey === undefined ? { ...stored, runKey: sequentialRunKey } : stored;
      const merged = appendCompletingWorkroomDriveReceipt(receipts, receipt);
      if (merged.ok) receipts = merged.data;
    }
    snapshot = { ...snapshot, receipts };
    if (options.graphShape) {
      for (const key of ["marking", "pendingAttentions"] as const) {
        if (!Object.hasOwn(snapshot, key) && Object.hasOwn(currentDrive, key) && currentDrive[key] !== undefined) {
          snapshot = { ...snapshot, [key]: currentDrive[key] };
        }
      }
    }
  }
  return snapshot;
}
