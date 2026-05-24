"use server";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma, type Prisma } from "@dpf/db";
import { lazyChildProcess, lazyUtil } from "@/lib/shared/lazy-node";
import { revalidatePath } from "next/cache";
import { generateRfcId } from "./change-management";
import { generatePromotionId } from "@/lib/version-tracking";
import {
  getSelfUpgradeConfig,
  isInMaintenanceWindow,
  resolveTargetSha,
  isShaFresh,
  getDeployedSha,
  getLatestRun,
} from "@/lib/self-upgrade";
import { inngest } from "@/lib/queue/inngest-client";
import { SELF_UPGRADE_EVENT } from "@/lib/queue/functions/self-upgrade";

async function requireOpsAccess(): Promise<string> {
  const session = await auth();
  const user = session?.user;
  if (
    !user ||
    !can(
      { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
      "view_operations"
    )
  ) {
    throw new Error("Unauthorized");
  }
  return user.id!;
}

export async function getPromotions(status?: string) {
  await requireOpsAccess();
  return prisma.changePromotion.findMany({
    where: status ? { status } : {},
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      productVersion: {
        select: {
          version: true,
          gitTag: true,
          gitCommitHash: true,
          shippedBy: true,
          shippedAt: true,
          changeCount: true,
          changeSummary: true,
          digitalProduct: { select: { productId: true, name: true } },
        },
      },
    },
  });
}

export async function getGitPromotionCandidates() {
  await requireOpsAccess();
  const candidates = await prisma.gitPromotionCandidate.findMany({
    orderBy: { createdAt: "desc" },
    take: 25,
    select: {
      id: true,
      candidateId: true,
      provider: true,
      repositoryFullName: true,
      branch: true,
      afterSha: true,
      status: true,
      statusReason: true,
      sandboxProviderId: true,
      sandboxId: true,
      verificationStartedAt: true,
      verificationCompletedAt: true,
      verificationResult: true,
      createdAt: true,
    },
  });

  const refs = candidates.map((candidate) => candidateReviewRef(candidate.candidateId));
  const reviewItems = refs.length > 0
    ? await prisma.changeItem.findMany({
        where: { externalSystemRef: { in: refs } },
        select: {
          externalSystemRef: true,
          changePromotion: { select: { promotionId: true, status: true } },
          changeRequest: { select: { rfcId: true, status: true } },
        },
      })
    : [];
  const reviewsByRef = new Map(reviewItems.map((item) => [item.externalSystemRef, item]));

  return candidates.map((candidate) => {
    const review = reviewsByRef.get(candidateReviewRef(candidate.candidateId));
    return {
      ...candidate,
      promotionReview: review?.changePromotion && review.changeRequest
        ? {
            promotionId: review.changePromotion.promotionId,
            promotionStatus: review.changePromotion.status,
            rfcId: review.changeRequest.rfcId,
            rfcStatus: review.changeRequest.status,
          }
        : null,
    };
  });
}

// Re-export Promotion type shape for the UI component
export type PromotionRow = Awaited<ReturnType<typeof getPromotions>>[number];
export type GitPromotionCandidateRow = Awaited<ReturnType<typeof getGitPromotionCandidates>>[number];

function candidateReviewRef(candidateId: string): string {
  return `git-promotion-candidate:${candidateId}`;
}

function shortSha(value: string | null): string {
  return value?.slice(0, 12) ?? "unknown";
}

function slugPart(value: string | null): string {
  const slug = (value ?? "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "unknown";
}

function buildCandidateImpactReport(candidate: {
  candidateId: string;
  provider: string;
  repositoryFullName: string;
  repositoryCloneUrl: string | null;
  branch: string | null;
  beforeSha: string | null;
  afterSha: string | null;
  sandboxProviderId: string | null;
  sandboxId: string | null;
  verificationStartedAt: Date | null;
  verificationCompletedAt: Date | null;
  verificationResult: Prisma.JsonValue | null;
  payload: Prisma.JsonValue | null;
}): Prisma.InputJsonObject {
  return {
    source: "git-promotion-candidate",
    candidateId: candidate.candidateId,
    provider: candidate.provider,
    repository: {
      fullName: candidate.repositoryFullName,
      cloneUrl: candidate.repositoryCloneUrl,
      branch: candidate.branch,
      beforeSha: candidate.beforeSha,
      afterSha: candidate.afterSha,
    },
    sandbox: {
      providerId: candidate.sandboxProviderId,
      id: candidate.sandboxId,
      verificationStartedAt: candidate.verificationStartedAt?.toISOString() ?? null,
      verificationCompletedAt: candidate.verificationCompletedAt?.toISOString() ?? null,
    },
    verificationResult: candidate.verificationResult ?? null,
    webhookPayload: candidate.payload ?? null,
  };
}

function buildCandidateDeploymentLog(candidate: {
  candidateId: string;
  repositoryFullName: string;
  branch: string | null;
  afterSha: string | null;
  sandboxProviderId: string | null;
  sandboxId: string | null;
  verificationCompletedAt: Date | null;
}): string {
  return [
    `Git promotion candidate: ${candidate.candidateId}`,
    `Repository: ${candidate.repositoryFullName}`,
    `Branch: ${candidate.branch ?? "unknown"}`,
    `Commit: ${candidate.afterSha ?? "unknown"}`,
    `Sandbox provider: ${candidate.sandboxProviderId ?? "unknown"}`,
    `Sandbox ID: ${candidate.sandboxId ?? "unknown"}`,
    `Sandbox verification completed: ${candidate.verificationCompletedAt?.toISOString() ?? "unknown"}`,
    "Production deployment has not been executed. This record is waiting for operator review in /ops/promotions.",
  ].join("\n");
}

export async function createPromotionReviewFromGitCandidate(candidateId: string): Promise<{
  created: boolean;
  promotionId: string;
  rfcId: string;
}> {
  const userId = await requireOpsAccess();
  const candidate = await prisma.gitPromotionCandidate.findUnique({
    where: { candidateId },
    select: {
      candidateId: true,
      provider: true,
      repositoryFullName: true,
      repositoryCloneUrl: true,
      branch: true,
      beforeSha: true,
      afterSha: true,
      status: true,
      sandboxProviderId: true,
      sandboxId: true,
      verificationStartedAt: true,
      verificationCompletedAt: true,
      verificationResult: true,
      payload: true,
    },
  });

  if (!candidate) throw new Error(`Git promotion candidate not found: ${candidateId}`);
  if (candidate.status !== "sandbox-verification-complete") {
    throw new Error("Only sandbox-verified Git candidates can enter promotion review.");
  }
  if (!candidate.afterSha) {
    throw new Error("Git promotion candidate is missing the verified commit SHA.");
  }

  const externalSystemRef = candidateReviewRef(candidate.candidateId);
  const existingReview = await prisma.changeItem.findFirst({
    where: { externalSystemRef, itemType: "promotion" },
    select: {
      changePromotion: { select: { promotionId: true } },
      changeRequest: { select: { rfcId: true } },
    },
  });
  if (existingReview?.changePromotion && existingReview.changeRequest) {
    return {
      created: false,
      promotionId: existingReview.changePromotion.promotionId,
      rfcId: existingReview.changeRequest.rfcId,
    };
  }

  const platformProduct = await prisma.digitalProduct.findUnique({
    where: { productId: "DP-ODPF" },
    select: { id: true },
  });
  if (!platformProduct) {
    throw new Error("Platform product DP-ODPF is not seeded; cannot create a governed promotion review.");
  }

  const afterSha = candidate.afterSha;
  const promotionId = generatePromotionId();
  const rfcId = await generateRfcId();
  const sha = shortSha(afterSha);
  const branch = slugPart(candidate.branch);
  const summary = `Sandbox-verified Git update ${candidate.repositoryFullName}@${sha}`;

  const result = await prisma.$transaction(async (tx) => {
    const productVersion = await tx.productVersion.create({
      data: {
        digitalProductId: platformProduct.id,
        version: `git-${candidate.candidateId.toLowerCase()}`,
        gitTag: `git-${branch}-${sha}`,
        gitCommitHash: afterSha,
        shippedBy: userId,
        changeCount: 1,
        changeSummary: summary,
      },
      select: { id: true },
    });

    const promotion = await tx.changePromotion.create({
      data: {
        promotionId,
        productVersionId: productVersion.id,
        status: "pending",
        requestedBy: userId,
        deploymentLog: buildCandidateDeploymentLog(candidate),
      },
      select: { id: true },
    });

    const rfc = await tx.changeRequest.create({
      data: {
        rfcId,
        title: `Review Git update ${sha}`,
        description: summary,
        type: "normal",
        scope: "platform",
        riskLevel: "medium",
        status: "draft",
        impactReport: buildCandidateImpactReport(candidate),
      },
      select: { id: true },
    });

    await tx.changeItem.create({
      data: {
        changeRequestId: rfc.id,
        changePromotionId: promotion.id,
        itemType: "promotion",
        title: `Promote Git update ${sha}`,
        description: summary,
        impactDescription: "Sandbox verification completed successfully; operator approval is required before production deployment.",
        digitalProductId: platformProduct.id,
        externalSystemRef,
        status: "pending",
      },
    });

    return { promotionId, rfcId };
  });

  revalidatePath("/ops/promotions");
  return { created: true, ...result };
}

export async function createPromotionReviewFromGitCandidateForm(formData: FormData) {
  const candidateId = String(formData.get("candidateId") ?? "");
  if (!candidateId) throw new Error("candidateId is required");
  await createPromotionReviewFromGitCandidate(candidateId);
}

export async function approvePromotion(promotionId: string, rationale: string) {
  const userId = await requireOpsAccess();
  await prisma.changePromotion.update({
    where: { promotionId },
    data: {
      status: "approved",
      approvedBy: userId,
      approvedAt: new Date(),
      rationale: rationale || null,
    },
  });
}

export async function rejectPromotion(promotionId: string, rationale: string) {
  const userId = await requireOpsAccess();
  await prisma.changePromotion.update({
    where: { promotionId },
    data: {
      status: "rejected",
      rejectedBy: userId,
      rejectedAt: new Date(),
      rationale: rationale || null,
    },
  });
}

export async function markDeployed(promotionId: string, deploymentLog?: string) {
  const userId = await requireOpsAccess();
  await prisma.changePromotion.update({
    where: { promotionId },
    data: {
      status: "deployed",
      deployedAt: new Date(),
      ...(deploymentLog ? { deploymentLog } : {}),
    },
  });
}

/**
 * Execute an approved promotion. Tries the Docker promoter service first
 * (autonomous pipeline: backup, build, swap, health check). Falls back to
 * in-portal execution if Docker is not available.
 */
export async function executePromotionAction(
  promotionId: string,
  overrideReason?: string,
) {
  await requireOpsAccess();

  if (!promotionId || !/^[a-zA-Z0-9_-]+$/.test(promotionId)) {
    return { success: false, step: "validate", message: "Invalid promotion ID." };
  }

  const promo = await prisma.changePromotion.findFirst({
    where: { promotionId },
    include: { productVersion: { include: { featureBuild: { select: { sandboxId: true } } } } },
  });
  if (!promo) return { success: false, step: "validate", message: "Promotion not found." };
  if (promo.status !== "approved") return { success: false, step: "validate", message: `Status is ${promo.status}, not approved.` };

  const sandboxId = promo.productVersion?.featureBuild?.sandboxId;

  // Try Docker promoter first (production path)
  try {
    const cp = lazyChildProcess();
    const { promisify } = lazyUtil();
    const execFileAsync = promisify(cp.execFile);
    const execAsync = promisify(cp.exec);

    await execAsync("docker info", { timeout: 5_000 });
    await execAsync("docker rm dpf-promoter-1 2>/dev/null || true");

    // Build the promoter image just-in-time if it doesn't exist.
    // The build files are baked into the portal image at /promoter/.
    // Layout mirrors the repo root: Dockerfile (portal), Dockerfile.promoter,
    // scripts/promote.sh — so the same Dockerfile.promoter works for both
    // repo-root builds and JIT builds from the portal container.
    try {
      await execAsync("docker image inspect dpf-promoter", { timeout: 5_000 });
    } catch {
      await execAsync(
        "sh -c '" +
          "BDIR=$(mktemp -d) && " +
          "cp /promoter/portal.Dockerfile $BDIR/Dockerfile && " +
          "cp /promoter/Dockerfile.promoter $BDIR/Dockerfile.promoter && " +
          "mkdir -p $BDIR/scripts && " +
          "cp /promoter/promote.sh $BDIR/scripts/promote.sh && " +
          "tar -C $BDIR -c . | docker build -t dpf-promoter -f Dockerfile.promoter - && " +
          "rm -rf $BDIR" +
          "'",
        { timeout: 120_000 },
      );
    }

    // Resolve the host path where docker-compose.yml and .env live.
    // DPF_HOST_INSTALL_PATH is the host-side path of the install directory
    // (e.g. "D:/DPF" on Windows, "/opt/dpf" on Linux). The promoter needs
    // these mounted at /host-source/ to restart the portal via compose.
    const hostPath = process.env.DPF_HOST_INSTALL_PATH ?? "";
    if (!hostPath) {
      return {
        success: false,
        step: "validate",
        message: "DPF_HOST_INSTALL_PATH is not configured. Set it in .env to the host-side install directory (e.g. D:/DPF) and restart the portal.",
      };
    }

    const envArgs: string[] = [
      "run", "-d",
      "--name", "dpf-promoter-1",
      "--network", `${process.env.DPF_COMPOSE_PROJECT ?? "dpf"}_default`,
      "-v", "/var/run/docker.sock:/var/run/docker.sock",
      "-v", "dpf_backups:/backups",
    ];
    if (hostPath) {
      envArgs.push("-v", `${hostPath}/docker-compose.yml:/host-source/docker-compose.yml:ro`);
      envArgs.push("-v", `${hostPath}/.env:/host-source/.env:ro`);
    }
    envArgs.push(
      "-e", `PROMOTION_ID=${promotionId}`,
      "-e", `DPF_PRODUCTION_DB_CONTAINER=${process.env.DPF_PRODUCTION_DB_CONTAINER ?? "dpf-postgres-1"}`,
      "-e", "DPF_PORTAL_CONTAINER=dpf-portal-1",
      "-e", `DPF_COMPOSE_PROJECT=${process.env.DPF_COMPOSE_PROJECT ?? "dpf"}`,
      "-e", `POSTGRES_USER=${process.env.POSTGRES_USER ?? "dpf"}`,
    );
    if (sandboxId) envArgs.push("-e", `DPF_SANDBOX_CONTAINER=${sandboxId}`);
    if (overrideReason) envArgs.push("-e", `DPF_WINDOW_OVERRIDE=${overrideReason}`);
    envArgs.push("dpf-promoter");

    await execFileAsync("docker", envArgs);
    return { success: true, step: "started", message: "Promoter started. Deployment in progress -- monitor in promotions list." };
  } catch {
    // Docker not available -- fall back to in-portal execution
    const { executePromotion } = await import("@/lib/sandbox-promotion");
    return executePromotion(promotionId, overrideReason);
  }
}

/**
 * Acknowledge destructive operations in a promotion's migrations.
 * Required before deploying promotions that contain DROP, TRUNCATE, etc.
 */
export async function acknowledgeDestructiveOps(promotionId: string) {
  await requireOpsAccess();
  await prisma.changePromotion.update({
    where: { promotionId },
    data: { destructiveAcknowledged: true },
  });
}

/**
 * Get deployment window availability for a promotion.
 * Returns current window status without requiring the promotion to be approved.
 */
export async function getPromotionWindowStatus(promotionId: string) {
  await requireOpsAccess();

  const promotion = await prisma.changePromotion.findUnique({
    where: { promotionId },
    include: {
      changeItem: {
        include: { changeRequest: { select: { type: true, riskLevel: true } } },
      },
    },
  });
  if (!promotion) return { available: false, message: "Promotion not found" };

  const rfcType = promotion.changeItem?.changeRequest?.type ?? "normal";
  const riskLevel = promotion.changeItem?.changeRequest?.riskLevel ?? "low";

  const profile = await prisma.businessProfile.findFirst({
    where: { isActive: true },
    include: { deploymentWindows: true, blackoutPeriods: true },
  });

  if (!profile) return { available: true, message: "No business profile configured — deployment unrestricted." };

  const now = new Date();

  // Check blackouts
  const activeBlackout = profile.blackoutPeriods.find(
    (bp) => bp.startAt <= now && bp.endAt >= now && !bp.exceptions.includes(rfcType),
  );
  if (activeBlackout) {
    return {
      available: false,
      message: `Blackout active until ${activeBlackout.endAt.toISOString()}. Reason: ${activeBlackout.reason ?? "Scheduled blackout"}.`,
      blackoutEnd: activeBlackout.endAt.toISOString(),
    };
  }

  // Check windows
  const { isNowInWindow } = await import("@/lib/sandbox-promotion");
  const matchingWindows = profile.deploymentWindows.filter(
    (w) => w.allowedChangeTypes.includes(rfcType) && w.allowedRiskLevels.includes(riskLevel),
  );

  if (matchingWindows.length === 0) {
    return { available: true, message: "No deployment windows configured — deployment unrestricted." };
  }

  if (isNowInWindow(matchingWindows)) {
    return { available: true, message: "Deployment window is open now." };
  }

  const windowSummary = matchingWindows
    .map((w) => `${w.name}: days ${w.dayOfWeek.join(",")}, ${w.startTime}-${w.endTime}`)
    .join("; ");

  return {
    available: false,
    message: `Not in a deployment window. Available: ${windowSummary}`,
    windows: windowSummary,
  };
}

export type SelfUpgradeRunDto = {
  runId: string;
  status: string;
  trigger: string | null;       // schema: trigger (was: triggeredBy)
  currentSha: string | null;    // schema: currentSha (was: fromVersion)
  targetSha: string | null;     // schema: targetSha (was: toVersion)
  deployedSha: string | null;   // schema: deployedSha (was: absent — adding for completeness)
  startedAt: Date | null;
  completedAt: Date | null;
  failureLog: string | null;    // schema: failureLog (was: error)
  createdAt: Date;
};

export async function listSelfUpgradeRuns(opts?: {
  limit?: number;
  cursor?: string;
}): Promise<{ runs: SelfUpgradeRunDto[]; nextCursor: string | null }> {
  await requireOpsAccess();

  const limit = Math.min(opts?.limit ?? 20, 50);
  const cursor = opts?.cursor;

  const rows = await prisma.selfUpgradeRun.findMany({
    ...(cursor ? { cursor: { runId: cursor }, skip: 1 } : {}),
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    select: {
      runId: true,
      status: true,
      trigger: true,
      currentSha: true,
      targetSha: true,
      deployedSha: true,
      startedAt: true,
      completedAt: true,
      failureLog: true,
      createdAt: true,
    },
  });

  const hasNext = rows.length > limit;
  const runs = hasNext ? rows.slice(0, limit) : rows;
  const nextCursor = hasNext ? runs[runs.length - 1].runId : null;
  return { runs, nextCursor };
}

export async function getSelfUpgradeStatus() {
  await requireOpsAccess();

  const [config, latestRun] = await Promise.all([
    getSelfUpgradeConfig(),
    getLatestRun(),
  ]);

  const inMaintenanceWindow = isInMaintenanceWindow(config);
  const deployedSha = getDeployedSha();
  const targetSha = await resolveTargetSha(config.channel);
  const isFresh = targetSha ? isShaFresh(deployedSha, targetSha) : false;

  return {
    enabled: config.enabled,
    channel: config.channel,
    inMaintenanceWindow,
    deployedSha,
    targetSha,
    isFresh,
    latestRun,
  };
}

export async function triggerSelfUpgrade(opts?: { dryRun?: boolean }) {
  const userId = await requireOpsAccess();

  if (!opts?.dryRun) {
    const config = await getSelfUpgradeConfig();
    if (!config.enabled) {
      return { queued: false, reason: "disabled" } as const;
    }
  }

  const latestRun = await getLatestRun();
  if (latestRun?.status === "running") {
    return { queued: false, reason: "already-running", runId: latestRun.runId } as const;
  }

  await inngest.send({
    name: SELF_UPGRADE_EVENT,
    data: {
      triggeredBy: `manual:${userId}`,
      ...(opts?.dryRun !== undefined ? { dryRun: opts.dryRun } : {}),
    },
  });
  return { queued: true } as const;
}
