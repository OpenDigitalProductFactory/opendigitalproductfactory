import { execFileSync } from "node:child_process";
import { prisma } from "@dpf/db";

/**
 * SHA of the currently-running application image.
 * Populated by the deploy pipeline via environment variable.
 */
export function getDeployedSha(): string | null {
  return process.env.DEPLOYED_SHA ?? null;
}

/**
 * Returns true if deployedSha is the same commit as mergeSha (including
 * short-SHA prefix matches) or is a git descendant of mergeSha — meaning
 * the deployed runtime's codebase includes the build's merged changes.
 */
export function shaContains(deployedSha: string, mergeSha: string): boolean {
  if (!deployedSha || !mergeSha) return false;
  // Prefix match covers full-SHA vs abbreviated-SHA comparisons.
  const minLen = Math.min(deployedSha.length, mergeSha.length);
  if (deployedSha.slice(0, minLen) === mergeSha.slice(0, minLen)) return true;
  // Git ancestry: is mergeSha reachable from (an ancestor of) deployedSha?
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", mergeSha, deployedSha], {
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the gitCommitHash on the most-recent ProductVersion for the build —
 * the SHA that was merged to main and tagged for this feature.
 */
export async function getBuildMergeSha(buildId: string): Promise<string | null> {
  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: {
      productVersions: {
        select: { gitCommitHash: true },
        orderBy: { shippedAt: "desc" },
        take: 1,
      },
    },
  });
  return build?.productVersions[0]?.gitCommitHash ?? null;
}

// ─── Legacy completion sweep API ─────────────────────────────────────────────

/** @deprecated Kept for backward-compat with portal-self-upgrade completion sweep */
export async function completePendingSelfUpgradeRuns(_limit = 5): Promise<{
  processedRunIds: string[];
}> {
  // Stub — completion now happens via isFeatureBuildDeployed checks in
  // reconcileBuildCompletion during normal flow.
  return { processedRunIds: [] };
}

/**
 * Returns true when the currently-deployed runtime SHA contains the
 * FeatureBuild's merge SHA, confirming the running app reflects the build's
 * changes.
 *
 * Returns false if DEPLOYED_SHA is absent (non-self-upgrade environment,
 * or the app has not yet restarted after promotion) or if the build has no
 * ProductVersion yet.
 */
export async function isFeatureBuildDeployed(buildId: string): Promise<boolean> {
  const deployedSha = getDeployedSha();
  if (!deployedSha) return false;
  const mergeSha = await getBuildMergeSha(buildId);
  if (!mergeSha) return false;
  return shaContains(deployedSha, mergeSha);
}
