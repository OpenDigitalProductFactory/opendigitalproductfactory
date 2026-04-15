"use server";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import { lazyChildProcess, lazyUtil } from "@/lib/shared/lazy-node";

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

// Re-export Promotion type shape for the UI component
export type PromotionRow = Awaited<ReturnType<typeof getPromotions>>[number];

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
