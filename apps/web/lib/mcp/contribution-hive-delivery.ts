import { prisma } from "@dpf/db";
import { initializeAndReconcileBuildPrDelivery } from "@/lib/build/build-pr-delivery-reconciler";
import { reconcileBuildCompletion } from "@/lib/build-flow-state";
import { logBuildActivity } from "@/lib/mcp/build-tool-helpers";
import { getErrorMessage } from "@/lib/shared/get-error-message";

export async function reconcileHiveContributionDelivery(input: {
  buildId: string;
  prUrl: string | null;
  token: string;
  eligible: boolean;
}): Promise<void> {
  if (!input.prUrl) return;

  const pullRequest = input.prUrl.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/)?$/,
  );
  if (!pullRequest) {
    logBuildActivity(
      input.buildId,
      "build-pr-delivery",
      "Pull request recovery is waiting because the contribution URL was not recognized.",
    );
    return;
  }

  const prNumber = Number(pullRequest[3]);
  try {
    const outcome = await initializeAndReconcileBuildPrDelivery({
      db: prisma,
      featureBuildId: input.buildId,
      owner: pullRequest[1],
      repo: pullRequest[2],
      prNumber,
      prUrl: input.prUrl,
      token: input.token,
      eligible: input.eligible,
    });
    logBuildActivity(
      input.buildId,
      "build-pr-delivery",
      `PR #${prNumber}: ${outcome.action?.kind ?? "withheld"}; delivery state ${outcome.state.status}; actuated=${outcome.actuated}; capsules=${outcome.captured}.`,
    );
  } catch (error) {
    logBuildActivity(
      input.buildId,
      "build-pr-delivery",
      `PR #${prNumber} recovery will retry after initial observation failed: ${getErrorMessage(error).slice(0, 180)}`,
    );
  }
}

export async function finalizeHiveContribution(input: {
  buildId: string;
  packId: string;
  prUrl: string | null;
  prError: string | null;
  totalFiles: number;
  dcoAttestation: string;
}): Promise<void> {
  await prisma.improvementProposal
    .updateMany({
      where: { buildId: input.buildId, contributionStatus: "local" },
      data: { contributionStatus: "contributed" },
    })
    .catch(() => {});

  logBuildActivity(
    input.buildId,
    "contribute_to_hive",
    input.prUrl
      ? `FeaturePack ${input.packId} created + PR ${input.prUrl}. ${input.totalFiles} files. DCO: ${input.dcoAttestation}`
      : `FeaturePack ${input.packId} created but upstream PR FAILED: ${input.prError ?? "unknown"}. ${input.totalFiles} files. DCO: ${input.dcoAttestation}`,
  );

  await reconcileBuildCompletion(input.buildId).catch(() => {});
}
