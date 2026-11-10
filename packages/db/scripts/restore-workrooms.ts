// Put the Workrooms back after a reinstall (BI-E2507972).
//
// The counterpart to the `workrooms.json` that `capture-backlog-bundle.ts`
// writes. Slice 1 (BI-F9939341) made the rows SURVIVE: the install scripts dump
// the database before destroying it, and the bundle carries the rooms. Nothing
// put them back, so a fresh install seeded from scratch and knew nothing about
// the worktrees still sitting on disk — the orphaned-work state the whole
// exercise exists to prevent.
//
// DRY RUN BY DEFAULT. Pass --apply to write. Same posture as the worktree
// janitor and the binding reconciler, and for the same reason: a sweep that
// mutates the coordination plane on a typo is worse than one that has to be
// asked twice.
//
// A room whose worktree no longer exists is still restored, as `archived` with
// the reason recorded. "We destroyed the working tree" is a different claim from
// "this work never existed", and only one of them is true.
//
//   pnpm --filter @dpf/db workrooms:restore -- --from <dir>
//   pnpm --filter @dpf/db workrooms:restore -- --from <dir> --apply

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  planWorkroomRestore,
  workroomRestorePlanBalances,
  type WorkroomCaptureRecord,
  type WorkroomRestoreAction,
} from "../src/backlog-recovery-bundle";
import { prisma } from "../src/client";

function usage(): string {
  return [
    "Usage: pnpm --filter @dpf/db workrooms:restore -- --from <dir> [--apply]",
    "",
    "Restores the Workrooms captured in <dir>/workrooms.json.",
    "  --from <dir>   Directory holding workrooms.json (required).",
    "  --apply        Write. Without it this reports and changes nothing.",
    "",
    "A room already present on this install is left untouched, so re-running is safe.",
  ].join("\n");
}

function parseArgs(rawArgv: string[]): { from: string; apply: boolean } {
  // `pnpm run script -- --from x` forwards the literal `--` on some pnpm
  // versions; it is a separator, not an option.
  const argv = rawArgv.filter((arg) => arg !== "--");
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }
  const fromIndex = argv.indexOf("--from");
  if (fromIndex === -1 || !argv[fromIndex + 1]) {
    throw new Error(`--from <dir> is required.\n\n${usage()}`);
  }
  return {
    from: resolve(process.cwd(), argv[fromIndex + 1] as string),
    apply: argv.includes("--apply"),
  };
}

/** Recreate one captured room, with its activity history. */
async function writeRoom(action: WorkroomRestoreAction): Promise<void> {
  const { room } = action;
  const created = await prisma.workroom.create({
    data: {
      capsuleId: room.capsuleId,
      title: room.title,
      objective: room.objective,
      status: action.status,
      source: room.source,
      executorKind: room.executorKind,
      executorRef: room.executorRef,
      backlogItemId: room.backlogItemId,
      epicId: room.epicId,
      repositoryFullName: room.repositoryFullName,
      baseBranch: room.baseBranch,
      baseSha: room.baseSha,
      headBranch: room.headBranch,
      headSha: room.headSha,
      worktreePath: room.worktreePath,
      pullRequestUrl: room.pullRequestUrl,
      pullRequestNumber: room.pullRequestNumber,
      // Prisma types these as optional string, not nullable, so a captured null
      // must become undefined rather than an explicit null write.
      contributionMode: room.contributionMode ?? undefined,
      branchTaxonomy: room.branchTaxonomy ?? undefined,
      // The captured key is deliberately dropped: it guarded the ORIGINAL claim
      // on an install that no longer exists, and carrying it forward would let a
      // stale key collide with a fresh claim on this one.
      scopeClaims: room.scopeClaims as never,
      workspaceState: room.workspaceState as never,
      verificationState: room.verificationState as never,
      // The lease is NOT restored. It belonged to a session on the old install
      // and cannot be live here; restoring it would recreate exactly the
      // "held by nobody" state BI-7271460C exists to remove.
      leaseHolderPrincipalId: null,
      leaseExpiresAt: null,
      createdAt: new Date(room.createdAt),
      lastSyncedAt: room.lastSyncedAt ? new Date(room.lastSyncedAt) : null,
    },
    select: { id: true },
  });

  if (room.activities.length > 0) {
    await prisma.workroomActivity.createMany({
      data: room.activities.map((activity) => ({
        workCapsuleId: created.id,
        kind: activity.kind,
        summary: activity.summary,
        payload: activity.payload as never,
        recordedAt: new Date(activity.recordedAt),
      })),
    });
  }

  if (action.archivedReason) {
    await prisma.workroomActivity.create({
      data: {
        workCapsuleId: created.id,
        kind: "restored-from-capture",
        summary: action.archivedReason,
        payload: {},
      },
    });
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const path = resolve(args.from, "workrooms.json");
  if (!existsSync(path)) {
    throw new Error(
      `No workrooms.json in ${args.from}. Capture writes it beside the backlog bundles; ` +
        `a pre-destructive Postgres dump restores through pg_restore instead.`,
    );
  }

  const record = JSON.parse(readFileSync(path, "utf8")) as WorkroomCaptureRecord;
  const existing = await prisma.workroom.findMany({ select: { capsuleId: true } });

  const plan = planWorkroomRestore({
    record,
    existingCapsuleIds: existing.map((row) => row.capsuleId),
    worktreeExists: (worktreePath) => existsSync(worktreePath),
  });

  // The arithmetic is asserted, not assumed: a restore that quietly drops rooms
  // is the failure this path exists to prevent.
  if (!workroomRestorePlanBalances(plan)) {
    throw new Error(
      `Restore plan does not account for every captured room ` +
        `(${plan.restore.length} + ${plan.archiveMissingWorktree.length} + ${plan.skipped.length} != ${plan.capturedCount}). Refusing to apply.`,
    );
  }

  const lines = [
    `Captured rooms: ${plan.capturedCount} (from ${record.capturedAt})`,
    `  restore under captured status: ${plan.restore.length}`,
    `  restore as archived, worktree gone: ${plan.archiveMissingWorktree.length}`,
    `  already on this install, untouched: ${plan.skipped.length}`,
  ];

  if (!args.apply) {
    lines.push("", "DRY RUN — nothing was written. Pass --apply to restore.");
    process.stdout.write(`${lines.join("\n")}\n`);
    return;
  }

  for (const action of [...plan.restore, ...plan.archiveMissingWorktree]) {
    await writeRoom(action);
  }
  lines.push("", `Restored ${plan.restore.length + plan.archiveMissingWorktree.length} Workroom(s).`);
  process.stdout.write(`${lines.join("\n")}\n`);
}

void main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
