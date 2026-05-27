import { execFileSync } from "node:child_process";
import { prisma } from "@dpf/db";
import { readImageVersion } from "@/lib/platform/image-version";

/**
 * Identity of the currently-running application image.
 *
 * Resolution order:
 *   1. DEPLOYED_SHA env var — set by the deploy pipeline when it has
 *      authoritative information (the SHA it just promoted).
 *   2. /app/.dpf-image-version — baked into the image at build time. Contains
 *      either a 40-char git SHA (when DPF_VERSION was passed as a build arg,
 *      e.g. via scripts/build-images.{ps1,sh}) or a 64-char content hash of
 *      the bundled source as a fallback. Either way, the image has *some*
 *      identity — returning that is strictly better than "unknown" for the
 *      operator-facing self-upgrade panel.
 *
 * Returns null only when neither source is available (e.g. local `next dev`
 * outside a built image).
 */
export async function getDeployedSha(): Promise<string | null> {
  const envSha = process.env.DEPLOYED_SHA;
  if (envSha && envSha.length > 0) return envSha;
  const image = await readImageVersion();
  return image?.raw ?? null;
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
  const deployedSha = await getDeployedSha();
  if (!deployedSha) return false;
  const mergeSha = await getBuildMergeSha(buildId);
  if (!mergeSha) return false;
  return shaContains(deployedSha, mergeSha);
}
