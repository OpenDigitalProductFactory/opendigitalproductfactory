import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

import { Prisma, prisma } from "@dpf/db";

import { loadSelfUpgradeConfig } from "./config";
import { notifySelfUpgradeEvent } from "./notification";

const execFile = promisify(execFileCb);
export const MAX_COMPLETION_ATTEMPTS = 4;

type BuildHeadInput = {
  buildBranch?: string | null;
  gitCommitHashes?: string[] | null;
};

type BuildCompletionEvidenceInput = {
  productionSha: string;
  buildBranchSha: string;
  selfUpgradeRunId: string;
  confirmedAt?: Date;
};

type FeatureBuildRow = {
  buildId: string;
  buildBranch?: string | null;
  gitCommitHashes?: string[] | null;
};

type CompletionDb = {
  featureBuild: {
    findMany(args: unknown): Promise<FeatureBuildRow[]>;
    update(args: unknown): Promise<unknown>;
  };
  buildActivity?: {
    create(args: unknown): Promise<unknown>;
  };
};

type CompletionGit = {
  resolveRef(candidate: string): Promise<string | null>;
  isAncestor(candidateSha: string, productionSha: string): Promise<boolean>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function getCompletionAttempts(completionEvidence: unknown): number {
  if (!isRecord(completionEvidence)) return 0;
  const attempts = completionEvidence.completionAttempts;
  return typeof attempts === "number" && Number.isInteger(attempts) && attempts > 0
    ? attempts
    : 0;
}

export function buildCompletionFailureUpdate(input: {
  completionEvidence: unknown;
  message: string;
  failedAt?: Date;
}) {
  const completionAttempts = getCompletionAttempts(input.completionEvidence) + 1;
  const exhausted = completionAttempts >= MAX_COMPLETION_ATTEMPTS;
  const failedAt = input.failedAt ?? new Date();
  const failureEvidence = {
    ...(isRecord(input.completionEvidence) ? input.completionEvidence : {}),
    completionAttempts,
    lastCompletionError: input.message.slice(0, 12000),
    lastCompletionErrorAt: failedAt.toISOString(),
  } satisfies Prisma.InputJsonObject;

  return {
    completionAttempts,
    exhausted,
    data: {
      status: exhausted ? "failed" : "completing",
      reason: exhausted ? "completion-retries-exhausted" : "completion-failed",
      failureLog: input.message.slice(0, 12000),
      completedAt: exhausted ? failedAt : undefined,
      completionEvidence: failureEvidence,
    },
  };
}

export function resolveBuildHeadCandidates(build: BuildHeadInput): string[] {
  const candidates: string[] = [];
  const hashes = build.gitCommitHashes ?? [];
  if (hashes.length > 0) candidates.push(hashes[hashes.length - 1]);
  if (build.buildBranch) {
    candidates.push(build.buildBranch);
    candidates.push(`origin/${build.buildBranch}`);
  }
  return [...new Set(candidates.filter(Boolean))];
}

export function buildCompletionEvidence(input: BuildCompletionEvidenceInput) {
  return {
    productionSha: input.productionSha,
    buildBranchSha: input.buildBranchSha,
    ancestryConfirmed: true,
    confirmedAt: (input.confirmedAt ?? new Date()).toISOString(),
    selfUpgradeRunId: input.selfUpgradeRunId,
  };
}

export async function completeMergedShipBuilds(input: {
  db: CompletionDb;
  git: CompletionGit;
  productionSha: string;
  selfUpgradeRunId: string;
}): Promise<{ completedBuildIds: string[] }> {
  const builds = await input.db.featureBuild.findMany({
    where: {
      phase: "ship",
      buildBranch: { not: null },
    },
    select: {
      buildId: true,
      buildBranch: true,
      gitCommitHashes: true,
    },
  });

  const completedBuildIds: string[] = [];

  for (const build of builds) {
    for (const candidate of resolveBuildHeadCandidates(build)) {
      const candidateSha = await input.git.resolveRef(candidate);
      if (!candidateSha) continue;
      const merged = await input.git.isAncestor(candidateSha, input.productionSha);
      if (!merged) continue;

      await input.db.featureBuild.update({
        where: { buildId: build.buildId },
        data: {
          phase: "complete",
          acceptanceMet: buildCompletionEvidence({
            productionSha: input.productionSha,
            buildBranchSha: candidateSha,
            selfUpgradeRunId: input.selfUpgradeRunId,
          }),
        },
      });

      await input.db.buildActivity?.create({
        data: {
          buildId: build.buildId,
          tool: "self-upgrade",
          summary: `Completed by portal self-upgrade ${input.selfUpgradeRunId}. Production ${input.productionSha.slice(0, 12)} includes ${candidateSha.slice(0, 12)}.`,
        },
      });

      completedBuildIds.push(build.buildId);
      break;
    }
  }

  return { completedBuildIds };
}

export function createGitCompletionClient(hostSourcePath: string): CompletionGit {
  return {
    async resolveRef(candidate: string) {
      try {
        const result = await execFile("git", [
          "-C",
          hostSourcePath,
          "rev-parse",
          "--verify",
          candidate,
        ]);
        return result.stdout.trim() || null;
      } catch {
        return null;
      }
    },
    async isAncestor(candidateSha: string, productionSha: string) {
      try {
        await execFile("git", [
          "-C",
          hostSourcePath,
          "merge-base",
          "--is-ancestor",
          candidateSha,
          productionSha,
        ]);
        return true;
      } catch {
        return false;
      }
    },
  };
}

export async function completeSelfUpgradeRun(runId: string): Promise<{
  completedBuildIds: string[];
  skipped?: boolean;
  reason?: string;
}> {
  const run = await prisma.selfUpgradeRun.findUnique({
    where: { runId },
    select: {
      runId: true,
      status: true,
      targetSha: true,
      deployedSha: true,
      completionEvidence: true,
    },
  });

  if (!run) return { completedBuildIds: [], skipped: true, reason: "run-not-found" };
  if (run.status !== "completing") {
    return { completedBuildIds: [], skipped: true, reason: `status-${run.status}` };
  }

  const productionSha = run.deployedSha ?? run.targetSha;
  if (!productionSha) {
    await prisma.selfUpgradeRun.update({
      where: { runId },
      data: { status: "completing", reason: "missing-production-sha" },
    });
    return { completedBuildIds: [], skipped: true, reason: "missing-production-sha" };
  }

  try {
    const config = await loadSelfUpgradeConfig();
    const result = await completeMergedShipBuilds({
      db: prisma,
      git: createGitCompletionClient(config.hostSourceMountPath),
      productionSha,
      selfUpgradeRunId: run.runId,
    });

    await prisma.selfUpgradeRun.update({
      where: { runId },
      data: {
        status: "succeeded",
        completedAt: new Date(),
        completionEvidence: {
          productionSha,
          completedBuildIds: result.completedBuildIds,
          completedAt: new Date().toISOString(),
        } satisfies Prisma.InputJsonObject,
      },
    });

    await notifySelfUpgradeEvent({
      type: "completed",
      runId,
      targetSha: productionSha,
      completedBuildIds: result.completedBuildIds,
    });

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failure = buildCompletionFailureUpdate({
      completionEvidence: run.completionEvidence,
      message,
    });
    await prisma.selfUpgradeRun.update({
      where: { runId },
      data: failure.data,
    });
    await notifySelfUpgradeEvent({
      type: "failed",
      runId,
      reason: failure.exhausted
        ? `Completion failed ${failure.completionAttempts} times; self-upgrade marked failed: ${message}`
        : `Completion attempt ${failure.completionAttempts} failed; will retry on the next sweep: ${message}`,
    });
    return {
      completedBuildIds: [],
      skipped: true,
      reason: failure.exhausted ? "completion-retries-exhausted" : "completion-failed",
    };
  }
}

export async function completePendingSelfUpgradeRuns(limit = 5): Promise<{
  processedRunIds: string[];
}> {
  const runs = await prisma.selfUpgradeRun.findMany({
    where: { status: "completing" },
    orderBy: { updatedAt: "asc" },
    take: limit,
    select: { runId: true },
  });

  const processedRunIds: string[] = [];
  for (const run of runs) {
    await completeSelfUpgradeRun(run.runId);
    processedRunIds.push(run.runId);
  }

  return { processedRunIds };
}
