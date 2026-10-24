// Capture and restore the Workrooms that bind backlog work to a branch.
//
// Split out of `backlog-recovery-bundle.ts` because it is a different concern:
// that module owns the BUNDLE FORMAT for epics and backlog items, this one owns
// the Workroom rows that say where the work actually is. Bolting the second onto
// the first pushed it past the substrate soft ceiling, which was the honest
// signal that they were two things (BI-F9939341 capture, BI-E2507972 restore).

// ── Workroom capture ─────────────────────────────────────────────────────────
//
// A backlog bundle preserves WHAT was asked for. It says nothing about WHERE the
// work is: the Workroom rows that bind a backlog item to a branch, a worktree, a
// lease holder and the evidence recorded along the way live only in Postgres and
// die with it on reinstall (BI-F9939341). The teardown stance calls that work
// "irreplaceable" and asks for a bundle before teardown, so the bundle has to
// carry the Workrooms too. This record is a faithful, non-reconcilable capture:
// a later slice rebinds it to worktrees that still exist on disk.

export interface WorkroomCaptureActivityRow {
  id: string;
  kind: string;
  summary: string;
  payload: unknown;
  recordedAt: Date | string;
}

export interface WorkroomCaptureRow {
  capsuleId: string;
  title: string;
  objective: string;
  status: string;
  source: string;
  executorKind: string | null;
  executorRef: string | null;
  backlogItemId: string | null;
  epicId: string | null;
  repositoryFullName: string | null;
  baseBranch: string | null;
  baseSha: string | null;
  headBranch: string | null;
  headSha: string | null;
  worktreePath: string | null;
  pullRequestUrl: string | null;
  pullRequestNumber: number | null;
  contributionMode: string | null;
  branchTaxonomy: string | null;
  idempotencyKey: string | null;
  scopeClaims: unknown;
  workspaceState: unknown;
  verificationState: unknown;
  leaseHolderPrincipalId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  lastSyncedAt: Date | string | null;
  archivedAt: Date | string | null;
  activities: WorkroomCaptureActivityRow[];
}

export interface WorkroomCaptureRecord {
  schemaVersion: 1;
  capturedAt: string;
  /** Every Workroom in the record. */
  workroomCount: number;
  /** Workrooms that name a branch — the ones a reinstall would otherwise orphan on disk. */
  boundBranchCount: number;
  /** Workrooms in a non-terminal status: the work someone would still expect to find. */
  openCount: number;
  workrooms: Array<
    Omit<WorkroomCaptureRow, "createdAt" | "updatedAt" | "lastSyncedAt" | "archivedAt" | "activities"> & {
      createdAt: string;
      updatedAt: string;
      lastSyncedAt: string | null;
      archivedAt: string | null;
      activities: Array<Omit<WorkroomCaptureActivityRow, "recordedAt"> & { recordedAt: string }>;
    }
  >;
}

const TERMINAL_WORKROOM_STATUSES = new Set(["complete", "abandoned", "archived"]);

function isoOrNull(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * Serialize Workroom rows into the bundle's `workrooms.json` record. Pure and
 * deterministic: rows sort by `capsuleId`, activities by `recordedAt` then id,
 * every date is ISO, and nothing is dropped — a Workroom with no branch is still
 * a Workroom someone opened.
 */
export function buildWorkroomCaptureRecord(
  rows: readonly WorkroomCaptureRow[],
  capturedAt: string,
): WorkroomCaptureRecord {
  const workrooms = [...rows]
    .sort((a, b) => a.capsuleId.localeCompare(b.capsuleId))
    .map((row) => ({
      ...row,
      createdAt: isoOrNull(row.createdAt) as string,
      updatedAt: isoOrNull(row.updatedAt) as string,
      lastSyncedAt: isoOrNull(row.lastSyncedAt),
      archivedAt: isoOrNull(row.archivedAt),
      activities: [...row.activities]
        .map((activity) => ({ ...activity, recordedAt: isoOrNull(activity.recordedAt) as string }))
        .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id)),
    }));
  return {
    schemaVersion: 1,
    capturedAt,
    workroomCount: workrooms.length,
    boundBranchCount: workrooms.filter((room) => room.headBranch !== null && room.headBranch !== "").length,
    openCount: workrooms.filter((room) => !TERMINAL_WORKROOM_STATUSES.has(room.status)).length,
    workrooms,
  };
}

// ── Workroom restore ─────────────────────────────────────────────────────────
//
// The counterpart to `buildWorkroomCaptureRecord` (BI-E2507972). Slice 1
// (BI-F9939341) made the rows SURVIVE a reinstall: the install scripts dump the
// database before destroying it, and the backlog bundle carries workrooms.json.
// Nothing put them back. A fresh install seeds from scratch and knows nothing
// about the rooms, while the worktrees they point at are still on disk — which
// is the orphaned-work state the whole exercise exists to prevent.
//
// This planner is PURE and decides nothing it cannot justify:
//   - a room already present is left alone, so a re-run is a no-op rather than a
//     second copy or an overwrite of work done since the capture;
//   - a room whose worktree is gone is still restored, as `archived` with the
//     reason recorded, because "we destroyed the evidence" is not the same claim
//     as "this work never existed";
//   - every captured room lands in exactly one bucket, so the caller can assert
//     restored + archived + skipped == workroomCount and know nothing was lost.
//
// Whether a worktree exists is injected rather than read here: the caller owns
// the filesystem, and a pure planner is what makes the arithmetic testable.

/** What the restore should do with one captured room. */
export type WorkroomRestoreAction = {
  capsuleId: string;
  /** The captured row, ready for the caller to write. */
  room: WorkroomCaptureRecord["workrooms"][number];
  /** Status to restore it under — the captured status, or `archived` when its worktree is gone. */
  status: string;
  /** Present only when the restore changed the status; recorded on the room. */
  archivedReason?: string;
};

export type WorkroomRestoreSkip = {
  capsuleId: string;
  reason: "already-present";
};

export type WorkroomRestorePlan = {
  /** Rooms to recreate under their captured status. */
  restore: WorkroomRestoreAction[];
  /** Rooms to recreate as `archived` because their worktree no longer exists. */
  archiveMissingWorktree: WorkroomRestoreAction[];
  /** Rooms this install already has; left untouched. */
  skipped: WorkroomRestoreSkip[];
  /** From the record, so the caller can assert the buckets account for all of it. */
  capturedCount: number;
};

/**
 * Decide what a Workroom restore should do, without doing any of it.
 *
 * `worktreeExists` is asked only for a room that names a worktree path. A room
 * with no path (a Build Studio room, for example) is restored under its captured
 * status: there is no worktree for its absence to mean anything about.
 */
export function planWorkroomRestore(input: {
  record: WorkroomCaptureRecord;
  /** capsuleIds this install already has, in any status. */
  existingCapsuleIds: Iterable<string>;
  worktreeExists: (worktreePath: string) => boolean;
}): WorkroomRestorePlan {
  const existing = new Set(input.existingCapsuleIds);
  const restore: WorkroomRestoreAction[] = [];
  const archiveMissingWorktree: WorkroomRestoreAction[] = [];
  const skipped: WorkroomRestoreSkip[] = [];

  for (const room of [...input.record.workrooms].sort((a, b) =>
    a.capsuleId.localeCompare(b.capsuleId),
  )) {
    if (existing.has(room.capsuleId)) {
      skipped.push({ capsuleId: room.capsuleId, reason: "already-present" });
      continue;
    }
    const path = room.worktreePath?.trim() ? room.worktreePath : null;
    if (path && !input.worktreeExists(path)) {
      archiveMissingWorktree.push({
        capsuleId: room.capsuleId,
        room,
        status: "archived",
        archivedReason:
          `Restored from a capture taken ${input.record.capturedAt}, but its worktree ${path} no longer exists on this install. ` +
          `The room and its history are preserved; the working tree is not.`,
      });
      continue;
    }
    restore.push({ capsuleId: room.capsuleId, room, status: room.status });
  }

  return {
    restore,
    archiveMissingWorktree,
    skipped,
    capturedCount: input.record.workroomCount,
  };
}

/**
 * Does the plan account for every captured room?
 *
 * A restore that quietly drops rooms is the failure this whole path exists to
 * prevent, so the arithmetic is checkable rather than assumed.
 */
export function workroomRestorePlanBalances(plan: WorkroomRestorePlan): boolean {
  return (
    plan.restore.length + plan.archiveMissingWorktree.length + plan.skipped.length ===
    plan.capturedCount
  );
}
