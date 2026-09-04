// apps/web/lib/work-capsules/work-capsule-reaper.ts
//
// WS9 (BI-CBAAEA94 / EP-PROCESS-SPINE) — the governed Workroom reaper.
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
  type WorkCapsuleDisposition,
  type WorkCapsuleLiveness,
} from "./liveness";
import { isReachableFromTrunk, trunkRefExists } from "./git-scanner";
import { updateWorkCapsuleStatus, type CapsuleDb, type WorkCapsuleActor } from "./work-capsule-store";

/** Capsule statuses the reaper will never touch — already closed out. */
const TERMINAL_STATUSES = new Set(["complete", "abandoned", "archived"]);

export type TerminalBacklogReconciliationPlan = {
  changed: boolean;
  targetStatus: "open" | null;
  clearActiveBuild: boolean;
  releaseClaim: boolean;
  completionEvidenceRequired: boolean;
  outcome: "retryable" | "awaiting-governed-completion" | "already-reconciled";
};

/**
 * Carrier-terminal → backlog lifecycle decision core. Completion is deliberately
 * evidence-gated: this projector may clear a stale execution link, but it never
 * fabricates `done`. A separate governed completion call must cite server-resolved
 * evidence. Abandon/failure returns in-progress work to open so restart intent is
 * preserved instead of silently retiring demand.
 */
export function planTerminalBacklogReconciliation(input: {
  backlogStatus: string;
  activeBuildId: string | null;
  buildPhase: string | null;
  capsuleStatus: string | null;
  hasCompletionEvidence: boolean;
}): TerminalBacklogReconciliationPlan {
  const statuses = [input.buildPhase, input.capsuleStatus]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());
  const completed = statuses.includes("complete") || statuses.includes("completed");
  const retryable = statuses.some((status) => ["abandoned", "failed", "canceled", "cancelled"].includes(status));
  const clearActiveBuild = Boolean(input.activeBuildId) && (completed || retryable);

  if (retryable) {
    const targetStatus = input.backlogStatus === "in-progress" ? "open" : null;
    return {
      changed: clearActiveBuild || targetStatus !== null,
      targetStatus,
      clearActiveBuild,
      releaseClaim: targetStatus !== null,
      completionEvidenceRequired: false,
      outcome: clearActiveBuild || targetStatus !== null ? "retryable" : "already-reconciled",
    };
  }
  if (completed && input.backlogStatus !== "done") {
    return {
      changed: clearActiveBuild,
      targetStatus: null,
      clearActiveBuild,
      releaseClaim: false,
      completionEvidenceRequired: !input.hasCompletionEvidence,
      outcome: "awaiting-governed-completion",
    };
  }
  return {
    changed: clearActiveBuild,
    targetStatus: null,
    clearActiveBuild,
    releaseClaim: false,
    completionEvidenceRequired: false,
    outcome: clearActiveBuild ? "awaiting-governed-completion" : "already-reconciled",
  };
}

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
  /** How to close out: `delivered` (merged → archive; worktree + merged branch
   *  are safe to reap) vs `abandoned` (dead, UNMERGED → abandon; branch protected
   *  from deletion, its commits live only there). */
  disposition: WorkCapsuleDisposition;
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
  headSha: string | null;
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
      // Reapable verdicts always carry a disposition; default defensively.
      disposition: verdict.disposition ?? "abandoned",
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
  backlogReconciled?: number;
};

type ReaperDb = CapsuleDb & {
  featureBuild?: { findMany(args: unknown): Promise<any[]> };
  backlogItem?: {
    findFirst(args: unknown): Promise<any>;
    update(args: unknown): Promise<any>;
  };
  backlogItemActivity?: {
    count(args: unknown): Promise<number>;
    create(args: unknown): Promise<any>;
  };
};

/** Idempotent repair sweep for terminal capsules whose owning BI still carries execution state. */
export async function reconcileTerminalCapsuleBacklogs(args: {
  db: ReaperDb;
  dryRun?: boolean;
  now?: Date;
}): Promise<{ scanned: number; reconciled: number }> {
  if (!args.db.backlogItem || !args.db.backlogItemActivity) return { scanned: 0, reconciled: 0 };
  const capsules = await args.db.workroom.findMany({
    where: {
      status: { in: [...TERMINAL_STATUSES] },
      backlogItemId: { not: null },
    },
    select: { capsuleId: true, status: true, backlogItemId: true, featureBuildId: true },
    take: 500,
  });
  const buildIds = capsules.map((capsule: any) => capsule.featureBuildId).filter(Boolean);
  const phases = new Map<string, string | null>();
  if (buildIds.length > 0 && args.db.featureBuild) {
    const rows = await args.db.featureBuild.findMany({
      where: { id: { in: [...new Set(buildIds)] } },
      select: { id: true, phase: true },
    });
    for (const row of rows) phases.set(row.id, row.phase ?? null);
  }
  let reconciled = 0;
  for (const capsule of capsules) {
    const item = await args.db.backlogItem.findFirst({
      where: { itemId: capsule.backlogItemId },
      select: { id: true, itemId: true, status: true, activeBuildId: true },
    });
    if (!item) continue;
    const evidenceCount = await args.db.backlogItemActivity.count({
      where: {
        backlogItemId: item.id,
        kind: { in: ["completion_evidence", "execution_evidence", "runtime_verification"] },
      },
    });
    const plan = planTerminalBacklogReconciliation({
      backlogStatus: item.status,
      activeBuildId: item.activeBuildId,
      buildPhase: capsule.featureBuildId ? phases.get(capsule.featureBuildId) ?? null : null,
      capsuleStatus: capsule.status,
      hasCompletionEvidence: evidenceCount > 0,
    });
    if (!plan.changed || args.dryRun !== false) continue;
    await args.db.backlogItem.update({
      where: { id: item.id },
      data: {
        ...(plan.clearActiveBuild ? { activeBuildId: null } : {}),
        ...(plan.targetStatus ? { status: plan.targetStatus } : {}),
        ...(plan.releaseClaim ? { claimStatus: "released" } : {}),
      },
    });
    await args.db.backlogItemActivity.create({
      data: {
        backlogItemId: item.id,
        kind: "execution_reconciled",
        summary: `${capsule.capsuleId} terminal execution reconciled (${plan.outcome})`,
        payload: {
          capsuleId: capsule.capsuleId,
          capsuleStatus: capsule.status,
          buildPhase: capsule.featureBuildId ? phases.get(capsule.featureBuildId) ?? null : null,
          fromStatus: item.status,
          targetStatus: plan.targetStatus,
          completionEvidenceRequired: plan.completionEvidenceRequired,
          rule: "terminal execution never infers backlog done",
        },
        recordedAt: args.now ?? new Date(),
        recordedByAgentId: "workcapsule-reaper",
      },
    });
    reconciled += 1;
  }
  return { scanned: capsules.length, reconciled };
}

const NON_TERMINAL_STATUSES = [
  "draft",
  "ready",
  "working",
  "blocked",
  "verifying",
  "ready-for-review",
  "ready-for-promotion",
];

/** The local repo the reaper checks branch reachability against. */
function resolveReaperRepoRoot(): string {
  return process.env.DPF_REPO_ROOT || process.cwd();
}

/**
 * PROCEDURAL delivered-detection, no LLM and no GitHub API: for every row with a
 * headSha, set `deliveredSignal` from LOCAL git reachability (branch head an
 * ancestor of the trunk = merged). Mutates rows in place. Best-effort by design:
 *   - a single `trunkRefExists` probe short-circuits the whole batch when there
 *     is no local repo/trunk (the portal runtime), so it never fans out hundreds
 *     of failing git spawns — every row then stays null and lease/grace governs;
 *   - a per-row null (sha not fetched locally) leaves just that row null.
 * Injectable git fns keep the pure-ish core unit-testable.
 */
export async function annotateDeliveredSignals(
  rows: ReaperCapsuleRow[],
  deps: {
    repoRoot?: string;
    hasTrunk?: (root: string) => Promise<boolean>;
    reachable?: (root: string, sha: string | null | undefined) => Promise<boolean | null>;
  } = {},
): Promise<void> {
  const repoRoot = deps.repoRoot ?? resolveReaperRepoRoot();
  const hasTrunk = deps.hasTrunk ?? trunkRefExists;
  const reachable = deps.reachable ?? isReachableFromTrunk;

  const withSha = rows.filter((r) => Boolean(r.headSha));
  if (withSha.length === 0) return;
  if (!(await hasTrunk(repoRoot))) return; // repo-less runtime → skip; null everywhere.

  for (const row of withSha) {
    try {
      const merged = await reachable(repoRoot, row.headSha);
      if (merged !== null) row.deliveredSignal = { merged };
    } catch {
      // Best-effort: a single git failure never aborts the sweep.
    }
  }
}

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

  const capsules: ReaperCapsuleRow[] = await args.db.workroom.findMany({
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
      headSha: true,
      worktreePath: true,
      featureBuildId: true,
    },
    take: 500,
  });

  // DELIVERED detection — PROCEDURAL, LOCAL, no LLM, no GitHub API: a room whose
  // branch head is reachable from the trunk has merged and is closed out as
  // delivered (not abandoned). Reads git objects only (never a worktree), so it
  // is junction-safe; degrades gracefully to null (→ lease/grace logic) wherever
  // the local repo or the trunk ref is unavailable.
  await annotateDeliveredSignals(capsules);

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
    // Disposition decides the closeout, NOT a single blanket "abandoned":
    //   - delivered (merged) → ARCHIVE as delivered. The worktree + the merged
    //     branch are safe to reap (their commits are on the trunk); worktree
    //     removal + branch deletion stay with their own explicitly-gated janitors
    //     — this DB-only step never touches them.
    //   - abandoned (dead, UNMERGED) → ABANDON, reversibly. The branch is
    //     PROTECTED from deletion: its commits live only there, and a paused
    //     session may still hold it. Re-promote / re-adopt to resume.
    const delivered = candidate.disposition === "delivered";
    const nextStatus = delivered ? "archived" : "abandoned";
    const reason = delivered
      ? `Auto-archived as DELIVERED by the governed Workroom reaper (EP-WORKROOM-CLOSEOUT): ${candidate.reason} ` +
        "Branch merged to trunk; its worktree and merged branch are safe to reap by their janitors."
      : `Auto-abandoned by the governed Workroom reaper (WS9/BI-CBAAEA94): ${candidate.reason} ` +
        "Re-promote the backlog item or re-adopt the branch to resume. Worktree and UNMERGED branch left untouched.";
    try {
      await updateWorkCapsuleStatus({
        db: args.db,
        capsuleId: candidate.capsuleId,
        status: nextStatus,
        reason,
        actor,
        now,
      });
      reaped += 1;
      console.warn(
        `[work-capsule-reaper] ${delivered ? "archived (delivered)" : "abandoned"} ${candidate.capsuleId} (${candidate.liveness}): ${candidate.reason}`,
      );
    } catch (err) {
      console.warn(`[work-capsule-reaper] failed to close out ${candidate.capsuleId}:`, err);
    }
  }
  const backlogRepair = await reconcileTerminalCapsuleBacklogs({ db: args.db, dryRun: false, now });
  return {
    dryRun: false,
    scanned: capsules.length,
    candidates,
    reaped,
    backlogReconciled: backlogRepair.reconciled,
  };
}

/**
 * Close the loop when a Build Studio build is abandoned/completed: transition its
 * attached Workroom out of `working` so a terminal build never leaves a zombie
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
  const capsule = await db.workroom.findFirst({
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
