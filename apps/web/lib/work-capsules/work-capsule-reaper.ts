// apps/web/lib/work-capsules/work-capsule-reaper.ts
//
// WS9 (BI-CBAAEA94 / EP-PROCESS-SPINE) — the governed WorkCapsule reaper.
//
// The liveness contract (liveness.ts) makes a dead capsule READ as dead on every
// surface. This reaper makes the STORED status catch up: a capsule whose lease
// expired without renewal (or whose linked build is terminal, or that has sat
// idle past the floor) is transitioned working/blocked → abandoned instead of
// lingering as "working" and jamming the WIP cap.
//
// Governance (kernel: destructive-actions-require-explicit-go):
//   - DRY-RUN IS THE DEFAULT. `reapStaleWorkCapsules` returns the candidate set
//     and writes NOTHING unless the caller passes `dryRun: false`.
//   - The scheduled caller (taskrun-watchdog) gates live actuation behind
//     DPF_WORKCAPSULE_REAPER_AUTO_REAP=1 (observe-only otherwise), mirroring the
//     runtime-artifact / worktree janitors.
//   - Abandon is REVERSIBLE: re-promoting the backlog item (or re-adopting the
//     branch) restarts the work cleanly. No data is deleted.
//
// Junction-safety: this module writes DB rows ONLY. It never touches the
// filesystem, so it cannot damage a worktree junction or the root clone.
// Worktree removal is a separate, explicitly-gated step (dpf-worktree-hygiene).

import { WORK_CAPSULE_IDLE_STALE_MS } from "@/lib/work-capsules";
import {
  classifyWorkCapsuleLiveness,
  type CapsuleLivenessInput,
  type WorkCapsuleLiveness,
} from "./liveness";
import { updateWorkCapsuleStatus, type CapsuleDb, type WorkCapsuleActor } from "./work-capsule-store";

/** Capsule statuses the reaper will never touch — already closed out. */
const TERMINAL_STATUSES = new Set(["complete", "abandoned", "archived"]);

const SYSTEM_ACTOR: WorkCapsuleActor = {
  userId: "system:workcapsule-reaper",
  agentId: null,
  principalId: null,
};

export type ReapCandidate = {
  capsuleId: string;
  title: string;
  status: string;
  source: string;
  executorKind: string | null;
  headBranch: string | null;
  worktreePath: string | null;
  liveness: WorkCapsuleLiveness;
  reason: string;
  trueLivenessAt: string | null;
};

/** The linked-build snapshot the reaper joins onto build-studio capsules. */
export type ReaperBuildSnapshot = { phase: string | null; lastActivityAt: Date | null };

type ReaperCapsuleRow = CapsuleLivenessInput & {
  capsuleId: string;
  title: string;
  source: string;
  headBranch: string | null;
  worktreePath: string | null;
  featureBuildId: string | null;
};

/**
 * Pure core: pick the reapable capsules. A capsule is a candidate when its
 * status is non-terminal AND {@link classifyWorkCapsuleLiveness} says it is
 * reapable (lease-expired, build-terminal, or idle-stale). `buildsById` supplies
 * the linked FeatureBuild snapshot keyed by `featureBuildId`. No DB, fully tested.
 */
export function selectReapCandidates(
  capsules: readonly ReaperCapsuleRow[],
  buildsById: ReadonlyMap<string, ReaperBuildSnapshot>,
  now: Date = new Date(),
  idleMs: number = WORK_CAPSULE_IDLE_STALE_MS,
): ReapCandidate[] {
  const candidates: ReapCandidate[] = [];
  for (const row of capsules) {
    if (TERMINAL_STATUSES.has(row.status)) continue;
    const featureBuild = row.featureBuildId ? buildsById.get(row.featureBuildId) ?? null : null;
    const verdict = classifyWorkCapsuleLiveness({ ...row, featureBuild }, now, idleMs);
    if (!verdict.isReapable) continue;
    candidates.push({
      capsuleId: row.capsuleId,
      title: row.title,
      status: row.status,
      source: row.source,
      executorKind: row.executorKind,
      headBranch: row.headBranch,
      worktreePath: row.worktreePath,
      liveness: verdict.liveness,
      reason: verdict.reason,
      trueLivenessAt: verdict.trueLivenessAt ? verdict.trueLivenessAt.toISOString() : null,
    });
  }
  return candidates;
}

export type ReapResult = {
  dryRun: boolean;
  scanned: number;
  candidates: ReapCandidate[];
  reaped: number;
};

type ReaperDb = CapsuleDb & {
  featureBuild?: { findMany(args: unknown): Promise<any[]> };
};

const NON_TERMINAL_STATUSES = [
  "draft",
  "ready",
  "working",
  "blocked",
  "verifying",
  "ready-for-review",
  "ready-for-promotion",
];

/**
 * DB wrapper: scan non-terminal capsules, classify each against its true
 * liveness signals, and (when `dryRun` is false) transition the dead ones to
 * `abandoned`. DRY-RUN by default — a caller must pass `dryRun: false` to write.
 * Best-effort per row: one failed transition never aborts the sweep. The reap
 * SET is always returned so an operator can review before acting.
 */
export async function reapStaleWorkCapsules(args: {
  db: ReaperDb;
  now?: Date;
  /** DEFAULT true. Pass false to actually transition dead capsules. */
  dryRun?: boolean;
  idleMs?: number;
  actor?: WorkCapsuleActor;
}): Promise<ReapResult> {
  const now = args.now ?? new Date();
  const idleMs = args.idleMs ?? WORK_CAPSULE_IDLE_STALE_MS;
  const dryRun = args.dryRun ?? true;

  const capsules: ReaperCapsuleRow[] = await args.db.workCapsule.findMany({
    where: { status: { in: NON_TERMINAL_STATUSES }, archivedAt: null },
    select: {
      capsuleId: true,
      title: true,
      status: true,
      source: true,
      executorKind: true,
      leaseExpiresAt: true,
      lastSyncedAt: true,
      updatedAt: true,
      pullRequestUrl: true,
      pullRequestNumber: true,
      headBranch: true,
      worktreePath: true,
      featureBuildId: true,
    },
    take: 500,
  });

  // Batch-load the linked FeatureBuild snapshot for the build-studio capsules
  // (their only real liveness signal). FeatureBuild.updatedAt advances on genuine
  // phase progress — unlike the capsule's own updatedAt, which the 14:00 tee-up
  // freezes at birth.
  const buildIds = capsules
    .map((c) => c.featureBuildId)
    .filter((id): id is string => Boolean(id));
  const buildsById = new Map<string, ReaperBuildSnapshot>();
  if (buildIds.length > 0 && args.db.featureBuild) {
    const builds = await args.db.featureBuild.findMany({
      where: { id: { in: [...new Set(buildIds)] } },
      select: { id: true, phase: true, updatedAt: true },
    });
    for (const b of builds) {
      buildsById.set(b.id, { phase: b.phase ?? null, lastActivityAt: b.updatedAt ?? null });
    }
  }

  const candidates = selectReapCandidates(capsules, buildsById, now, idleMs);

  if (dryRun) {
    return { dryRun: true, scanned: capsules.length, candidates, reaped: 0 };
  }

  let reaped = 0;
  const actor = args.actor ?? SYSTEM_ACTOR;
  for (const candidate of candidates) {
    try {
      await updateWorkCapsuleStatus({
        db: args.db,
        capsuleId: candidate.capsuleId,
        status: "abandoned",
        reason:
          `Auto-abandoned by the governed WorkCapsule reaper (WS9/BI-CBAAEA94): ${candidate.reason} ` +
          "Re-promote the backlog item or re-adopt the branch to resume. Worktree left untouched.",
        actor,
        now,
      });
      reaped += 1;
      console.warn(
        `[work-capsule-reaper] abandoned ${candidate.capsuleId} (${candidate.liveness}): ${candidate.reason}`,
      );
    } catch (err) {
      console.warn(`[work-capsule-reaper] failed to abandon ${candidate.capsuleId}:`, err);
    }
  }
  return { dryRun: false, scanned: capsules.length, candidates, reaped };
}

/**
 * Close the loop when a Build Studio build is abandoned/completed: transition its
 * attached WorkCapsule out of `working` so a terminal build never leaves a zombie
 * "working" capsule behind (the largest slice of the WS9 sprawl). Best-effort and
 * idempotent — a missing or already-terminal capsule is a no-op. Called from the
 * inert-build reaper inside the same watchdog tick that abandons the build, so
 * the capsule dies with its build without waiting for the periodic reaper. Since
 * the build reaper is itself the governed actor here, this needs no extra flag.
 */
export async function transitionCapsuleForTerminalBuild(
  buildId: string,
  reason: string,
  now: Date = new Date(),
): Promise<boolean> {
  const { prisma } = await import("@dpf/db");
  const db = prisma as unknown as CapsuleDb;
  const capsule = await db.workCapsule.findFirst({
    where: {
      idempotencyKey: `build-studio:${buildId}`,
      status: { notIn: [...TERMINAL_STATUSES] },
    },
    select: { capsuleId: true },
  });
  if (!capsule) return false;
  await updateWorkCapsuleStatus({
    db,
    capsuleId: capsule.capsuleId,
    status: "abandoned",
    reason: `Linked build ${buildId} was abandoned: ${reason} Re-promote the backlog item to resume.`,
    actor: SYSTEM_ACTOR,
    now,
  });
  return true;
}
