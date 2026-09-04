"use server";

import path from "node:path";

import { prisma } from "@dpf/db";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  isWorkCapsuleBranchTaxonomy,
  type WorkCapsuleBranchTaxonomy,
} from "@/lib/work-capsules";
import {
  getWorktreeDirtySummary,
  listLocalBranches,
  scanGitWorktrees,
  type WorktreeInfo,
} from "@/lib/work-capsules/git-scanner";
import {
  createWorkCapsule,
  planCapsuleWorkspace,
  type CapsuleDb,
} from "@/lib/work-capsules/work-capsule-store";
import { presentCapsuleRow } from "@/lib/work-capsules/work-capsule-presenter";
import { loadCapsuleLivenessInventory } from "@/lib/work-capsules/liveness-inventory";

async function requireCapability(capability: "view_platform" | "manage_backlog"): Promise<string> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, capability)) {
    throw new Error("Unauthorized");
  }
  return user.id;
}

async function requireBuildAccess(): Promise<string> {
  return requireCapability("view_platform");
}

async function requireGovernedWorkWriteAccess(): Promise<string> {
  return requireCapability("manage_backlog");
}

function resolveRepoRoot(): string {
  // The UX route sweep runs under more than one GitHub checkout mode:
  // workflow_dispatch has a named branch, while pull_request is detached. If
  // Work Control scans that ambient checkout, the same source tree renders a
  // populated or empty "Adoptable work" table solely because of the trigger.
  // Give the sweep one narrow fixture seam; production keeps using the
  // canonical host clone via DPF_REPO_ROOT.
  const workControlFixture = process.env.DPF_WORK_CONTROL_REPO_ROOT?.trim();
  if (workControlFixture) return path.resolve(workControlFixture);
  const override = process.env.DPF_REPO_ROOT?.trim();
  if (override) return path.resolve(override);
  return process.cwd();
}

function workCapsuleDb(): CapsuleDb {
  return prisma as unknown as CapsuleDb;
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

  const inventory = await loadCapsuleLivenessInventory(prisma, {
    where: {
      OR: [
        { source: { in: ["build-studio", "external-adoption", "git-promotion"] } },
        { repositoryFullName: { not: null } },
        { headBranch: { not: null } },
      ],
    },
    take: 100,
  });
  const capsules = inventory.capsulesAll;

  const adoptedBranches = new Set(
    capsules.map((capsule) => capsule.headBranch).filter((branch): branch is string => Boolean(branch)),
  );
  const adoptable = await loadAdoptableRows(resolveRepoRoot(), adoptedBranches);

  return {
    capsules: capsules.filter((row) => row.isLive).map((row) =>
      presentCapsuleRow(row as never, new Date(), {
        liveness: row.liveness as never,
        isLive: Boolean(row.isLive),
        isReapable: Boolean(row.isReapable),
        disposition: (row.disposition ?? null) as never,
        reason: String(row.livenessReason),
        trueLivenessAt: row.trueLivenessAt ? new Date(String(row.trueLivenessAt)) : null,
      }),
    ),
    livenessSummary: inventory.livenessSummary,
    adoptable,
  };
}

export async function createGovernedWorkAction(input: {
  title: string;
  objective: string;
  taxonomy: WorkCapsuleBranchTaxonomy;
  idempotencyKey: string;
}) {
  const userId = await requireGovernedWorkWriteAccess();
  if (!isWorkCapsuleBranchTaxonomy(input.taxonomy)) {
    throw new Error("Invalid taxonomy");
  }

  const actor = { userId, agentId: null, principalId: null };
  const capsule = await createWorkCapsule({
    db: workCapsuleDb(),
    input: {
      title: input.title,
      objective: input.objective,
      source: "manual",
      idempotencyKey: input.idempotencyKey,
      executorKind: null,
    },
    actor,
  });

  let existingBranches = new Set<string>();
  try {
    existingBranches = await listLocalBranches(resolveRepoRoot());
  } catch {
    // Best effort only. The store still checks existing active capsules.
  }

  const planned = await planCapsuleWorkspace({
    db: workCapsuleDb(),
    capsuleId: capsule.capsuleId,
    taxonomy: input.taxonomy,
    os: process.platform,
    home: process.env.HOME ?? process.env.USERPROFILE,
    existingBranches,
    releaseOverride: process.env.DPF_RELEASE_WORKTREE_PATH,
    actor,
  });

  return {
    capsuleId: planned.capsuleId,
    headBranch: planned.headBranch,
    worktreePath: planned.worktreePath,
  };
}

export async function getCapsuleDetail(capsuleId: string) {
  await requireBuildAccess();
  return prisma.workroom.findUnique({
    where: { capsuleId },
    include: {
      activities: {
        orderBy: { recordedAt: "desc" },
        take: 25,
      },
    },
  });
}
