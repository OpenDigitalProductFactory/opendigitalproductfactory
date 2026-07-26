// apps/web/lib/integrate/sandbox/sandbox-build-gc.ts
//
// BI-8BD61C30 — Build Studio sandbox disk GC for leftover isolation worktrees
// and aged build/* branches.
//
// PRIMARY cleanup is transactional: releaseSandboxForTerminalBuild on promote /
// abandon / complete / fail / inert-reap / escalate. This module is the
// FLEET BACKSTOP for leftovers when those paths were skipped (crash mid-flight).
//
// Lives in the portal process and docker-execs into dpf-sandbox-1 — not a host
// CLI session hook.

import { prisma } from "@dpf/db";
import { envFlagEnabled } from "@/lib/runtime/env-flags";
import { sanitizeForLog } from "@/lib/security/safe-log";
import {
  BUILD_WORKTREE_ROOT_SEGMENT,
  isBuildWorktreeIsolationEnabled,
  teardownBuildWorktree,
} from "./build-branch";
import { execInSandbox, isSandboxRunning } from "./sandbox";

const SANDBOX_CONTAINER = process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1";
const WORKSPACE = "/workspace";

/**
 * Release sandbox disk for a terminal FeatureBuild (BI-8BD61C30).
 * Always tears down `.builds/<buildId>` when isolation is on.
 * Optionally deletes `build/<buildId>` (use after promote; abandon keeps branch for audit).
 * Lives here (not build-branch.ts) so the module-size ratchet on build-branch stays green.
 */
/** Reject shell-metacharacters so buildId is safe in git/docker argv fragments. */
export function assertSafeBuildId(buildId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,64}$/.test(buildId)) {
    throw new Error("invalid buildId for sandbox cleanup");
  }
  return buildId;
}

export async function releaseSandboxForTerminalBuild(
  buildId: string,
  options?: { deleteBranch?: boolean },
): Promise<void> {
  const safeId = assertSafeBuildId(buildId);
  await teardownBuildWorktree(safeId);
  if (options?.deleteBranch) {
    const branch = `build/${safeId}`;
    await execInSandbox(
      SANDBOX_CONTAINER,
      `git -C ${WORKSPACE} branch -D "${branch}" 2>/dev/null || true`,
    ).catch((err) => {
      console.warn(
        "[sandbox-build-gc] branch delete skipped for %s: %s",
        sanitizeForLog(branch),
        sanitizeForLog((err as Error).message?.slice(0, 160) ?? ""),
      );
    });
  }
}

/** Master switch for the scheduled GC (default OFF). */
export const SANDBOX_BUILD_GC_ENABLED_FLAG = "DPF_SANDBOX_BUILD_GC_ENABLED";

/**
 * When set with ENABLED, GC also deletes aged terminal build/* branches.
 * Worktree dirs for terminal/orphan builds are always removed when ENABLED.
 */
export const SANDBOX_BUILD_GC_DELETE_BRANCHES_FLAG = "DPF_SANDBOX_BUILD_GC_DELETE_BRANCHES";

/** Default 7d before terminal build/* branches are deleted by GC. */
export const SANDBOX_BUILD_BRANCH_GRACE_MS =
  Number(process.env.DPF_SANDBOX_BUILD_BRANCH_GRACE_MS) || 7 * 24 * 60 * 60 * 1000;

export const TERMINAL_SANDBOX_PHASES = ["complete", "failed", "abandoned"] as const;

export function isTerminalSandboxPhase(phase: string | null | undefined): boolean {
  if (!phase) return false;
  return (TERMINAL_SANDBOX_PHASES as readonly string[]).includes(phase);
}

/**
 * Pure: should the isolation worktree dir for this build be removed?
 * - no FeatureBuild row → orphan dir → yes
 * - terminal phase → yes
 * - active non-terminal → no
 */
export function shouldGcSandboxWorktreeDir(phase: string | null): boolean {
  if (phase === null) return true;
  return isTerminalSandboxPhase(phase);
}

/**
 * Pure: should the git branch build/<id> be deleted by the fleet GC?
 * Only terminal builds older than graceMs (audit retention window).
 */
export function shouldGcSandboxBuildBranch(args: {
  phase: string | null;
  updatedAt: Date | null;
  now: Date;
  graceMs: number;
}): boolean {
  if (!args.phase || !isTerminalSandboxPhase(args.phase)) return false;
  if (!args.updatedAt) return false;
  return args.now.getTime() - args.updatedAt.getTime() >= args.graceMs;
}

/** Parse `ls` of .builds — only FB-* style build ids. */
export function parseBuildWorktreeDirNames(lsOutput: string): string[] {
  return lsOutput
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => /^FB-[A-Za-z0-9_-]+$/i.test(s) || /^[A-Za-z0-9][A-Za-z0-9_-]{3,}$/.test(s));
}

/** Parse `git branch` lines for build/* names → buildId. */
export function parseBuildBranchIds(branchListOutput: string): string[] {
  const ids: string[] = [];
  for (const line of branchListOutput.split(/\r?\n/)) {
    const m = line.trim().replace(/^\*\s*/, "").match(/^build\/(.+)$/);
    if (m?.[1]) ids.push(m[1]);
  }
  return ids;
}

export type SandboxBuildGcResult = {
  skipped: boolean;
  reason?: string;
  worktreesRemoved: string[];
  branchesDeleted: string[];
  keptActive: string[];
};

export type RunSandboxBuildGcOptions = {
  env?: Record<string, string | undefined>;
  now?: Date;
  /** Injectable for tests */
  listWorktreeDirs?: () => Promise<string[]>;
  listBuildBranches?: () => Promise<string[]>;
  lookupPhases?: (
    buildIds: string[],
  ) => Promise<Map<string, { phase: string; updatedAt: Date }>>;
  removeWorktree?: (buildId: string) => Promise<void>;
  deleteBranch?: (buildId: string) => Promise<void>;
  sandboxUp?: () => Promise<boolean>;
};

async function defaultListWorktreeDirs(): Promise<string[]> {
  const out = await execInSandbox(
    SANDBOX_CONTAINER,
    `ls -1 ${WORKSPACE}/${BUILD_WORKTREE_ROOT_SEGMENT} 2>/dev/null || true`,
  );
  return parseBuildWorktreeDirNames(out);
}

async function defaultListBuildBranches(): Promise<string[]> {
  const out = await execInSandbox(
    SANDBOX_CONTAINER,
    `git -C ${WORKSPACE} branch --list 'build/*' 2>/dev/null || true`,
  );
  return parseBuildBranchIds(out);
}

async function defaultLookupPhases(
  buildIds: string[],
): Promise<Map<string, { phase: string; updatedAt: Date }>> {
  const map = new Map<string, { phase: string; updatedAt: Date }>();
  if (buildIds.length === 0) return map;
  const rows = await prisma.featureBuild.findMany({
    where: { buildId: { in: buildIds } },
    select: { buildId: true, phase: true, updatedAt: true },
  });
  for (const r of rows) {
    map.set(r.buildId, { phase: r.phase, updatedAt: r.updatedAt });
  }
  return map;
}

/**
 * Fleet backstop GC. Flag-gated. Never touches non-terminal active builds.
 */
export async function runSandboxBuildGc(
  options: RunSandboxBuildGcOptions = {},
): Promise<SandboxBuildGcResult> {
  const env = options.env ?? process.env;
  if (!envFlagEnabled(env, SANDBOX_BUILD_GC_ENABLED_FLAG)) {
    return {
      skipped: true,
      reason: `disabled (${SANDBOX_BUILD_GC_ENABLED_FLAG} not set)`,
      worktreesRemoved: [],
      branchesDeleted: [],
      keptActive: [],
    };
  }

  const sandboxUp = options.sandboxUp ?? (() => isSandboxRunning(SANDBOX_CONTAINER));
  if (!(await sandboxUp())) {
    return {
      skipped: true,
      reason: `sandbox ${SANDBOX_CONTAINER} not running`,
      worktreesRemoved: [],
      branchesDeleted: [],
      keptActive: [],
    };
  }

  if (!isBuildWorktreeIsolationEnabled() && !envFlagEnabled(env, SANDBOX_BUILD_GC_DELETE_BRANCHES_FLAG)) {
    // Still allow branch-only GC when isolation is off.
  }

  const now = options.now ?? new Date();
  const listDirs = options.listWorktreeDirs ?? defaultListWorktreeDirs;
  const listBranches = options.listBuildBranches ?? defaultListBuildBranches;
  const lookup = options.lookupPhases ?? defaultLookupPhases;
  const removeWorktree =
    options.removeWorktree ??
    (async (buildId: string) => {
      await teardownBuildWorktree(buildId);
    });
  const deleteBranch =
    options.deleteBranch ??
    (async (buildId: string) => {
      await execInSandbox(
        SANDBOX_CONTAINER,
        `git -C ${WORKSPACE} branch -D "build/${buildId}" 2>/dev/null || true`,
      );
    });

  const dirIds = await listDirs().catch(() => [] as string[]);
  const branchIds = await listBranches().catch(() => [] as string[]);
  const allIds = [...new Set([...dirIds, ...branchIds])];
  const phases = await lookup(allIds);

  const worktreesRemoved: string[] = [];
  const branchesDeleted: string[] = [];
  const keptActive: string[] = [];
  const deleteBranches = envFlagEnabled(env, SANDBOX_BUILD_GC_DELETE_BRANCHES_FLAG);
  const graceMs = SANDBOX_BUILD_BRANCH_GRACE_MS;

  for (const buildId of dirIds) {
    const row = phases.get(buildId);
    const phase = row?.phase ?? null;
    if (!shouldGcSandboxWorktreeDir(phase)) {
      keptActive.push(buildId);
      continue;
    }
    try {
      await removeWorktree(buildId);
      worktreesRemoved.push(buildId);
      console.warn(
        "[sandbox-build-gc] removed worktree .builds/%s (phase=%s)",
        sanitizeForLog(buildId),
        sanitizeForLog(phase ?? "missing"),
      );
    } catch (err) {
      console.warn(
        "[sandbox-build-gc] worktree remove failed for %s: %s",
        sanitizeForLog(buildId),
        sanitizeForLog((err as Error).message?.slice(0, 160) ?? ""),
      );
    }
  }

  if (deleteBranches) {
    for (const buildId of branchIds) {
      const row = phases.get(buildId);
      if (
        !shouldGcSandboxBuildBranch({
          phase: row?.phase ?? null,
          updatedAt: row?.updatedAt ?? null,
          now,
          graceMs,
        })
      ) {
        continue;
      }
      try {
        await deleteBranch(buildId);
        branchesDeleted.push(buildId);
        console.warn("[sandbox-build-gc] deleted branch build/%s", sanitizeForLog(buildId));
      } catch (err) {
        console.warn(
          "[sandbox-build-gc] branch delete failed for %s: %s",
          sanitizeForLog(buildId),
          sanitizeForLog((err as Error).message?.slice(0, 160) ?? ""),
        );
      }
    }
  }

  const result: SandboxBuildGcResult = {
    skipped: false,
    worktreesRemoved,
    branchesDeleted,
    keptActive,
  };
  console.warn(`[sandbox-build-gc] summary: ${JSON.stringify(result)}`);
  return result;
}

