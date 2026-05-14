"use server";

import path from "node:path";

import { prisma } from "@dpf/db";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  getWorktreeDirtySummary,
  scanGitWorktrees,
  type WorktreeInfo,
} from "@/lib/work-capsules/git-scanner";
import { presentCapsuleRow } from "@/lib/work-capsules/work-capsule-presenter";

async function requireBuildAccess(): Promise<string> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "view_platform")) {
    throw new Error("Unauthorized");
  }
  return user.id;
}

function resolveRepoRoot(): string {
  const override = process.env.DPF_REPO_ROOT?.trim();
  if (override) return path.resolve(override);
  return process.cwd();
}

async function loadAdoptableRows(repoRoot: string, adoptedBranches: Set<string>) {
  let worktrees: WorktreeInfo[];
  try {
    worktrees = await scanGitWorktrees(repoRoot);
  } catch {
    return [];
  }

  return Promise.all(
    worktrees
      .filter((worktree) => worktree.branch && worktree.branch !== "main" && !adoptedBranches.has(worktree.branch))
      .map(async (worktree) => {
        try {
          const dirty = await getWorktreeDirtySummary(worktree.path);
          return {
            path: worktree.path,
            branch: worktree.branch,
            modifiedCount: dirty.modifiedCount,
            untrackedCount: dirty.untrackedCount,
          };
        } catch {
          return {
            path: worktree.path,
            branch: worktree.branch,
            modifiedCount: 0,
            untrackedCount: 0,
          };
        }
      }),
  );
}

export async function getWorkControlData() {
  await requireBuildAccess();

  const capsules = await prisma.workCapsule.findMany({
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: {
      capsuleId: true,
      title: true,
      status: true,
      source: true,
      executorKind: true,
      headBranch: true,
      worktreePath: true,
      pullRequestUrl: true,
      leaseExpiresAt: true,
      lastSyncedAt: true,
      updatedAt: true,
    },
  });

  const adoptedBranches = new Set(
    capsules.map((capsule) => capsule.headBranch).filter((branch): branch is string => Boolean(branch)),
  );
  const adoptable = await loadAdoptableRows(resolveRepoRoot(), adoptedBranches);

  return {
    capsules: capsules.map((row) => presentCapsuleRow(row)),
    adoptable,
  };
}
