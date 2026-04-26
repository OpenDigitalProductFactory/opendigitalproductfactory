"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";
import { executeTool, type ToolResult } from "@/lib/mcp-tools";

type VersionBump = "major" | "minor" | "patch";

async function requireBuildReleaseAccess(buildId: string): Promise<{ userId: string }> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    throw new Error("Unauthorized");
  }

  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: { createdById: true },
  });
  if (!build) {
    throw new Error("Build not found");
  }
  if (build.createdById !== userId) {
    throw new Error("Forbidden");
  }

  return { userId };
}

async function requirePromotionAccess(promotionId: string): Promise<{ userId: string }> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    throw new Error("Unauthorized");
  }

  const promotion = await prisma.changePromotion.findUnique({
    where: { promotionId },
    select: {
      productVersion: {
        select: {
          featureBuild: {
            select: {
              createdById: true,
            },
          },
        },
      },
    },
  });
  const ownerId = promotion?.productVersion?.featureBuild?.createdById;
  if (!ownerId) {
    throw new Error("Promotion not found");
  }
  if (ownerId !== userId) {
    throw new Error("Forbidden");
  }

  return { userId };
}

export async function prepareBuildRelease(buildId: string): Promise<ToolResult> {
  const { userId } = await requireBuildReleaseAccess(buildId);
  return executeTool("deploy_feature", { buildId }, userId, { routeContext: "/build" });
}

export async function registerBuildRelease(input: {
  buildId: string;
  name: string;
  portfolioSlug: string;
  versionBump: VersionBump;
}): Promise<ToolResult> {
  const { userId } = await requireBuildReleaseAccess(input.buildId);
  return executeTool(
    "register_digital_product_from_build",
    {
      buildId: input.buildId,
      name: input.name,
      portfolioSlug: input.portfolioSlug,
      versionBump: input.versionBump,
    },
    userId,
    { routeContext: "/build" },
  );
}

export async function submitBuildContribution(buildId: string): Promise<ToolResult> {
  const { userId } = await requireBuildReleaseAccess(buildId);
  return executeTool("contribute_to_hive", { buildId }, userId, { routeContext: "/build" });
}

export async function executeBuildPromotion(promotionId: string): Promise<ToolResult> {
  const { userId } = await requirePromotionAccess(promotionId);
  return executeTool("execute_promotion", { promotion_id: promotionId }, userId, { routeContext: "/build" });
}

export async function scheduleBuildPromotion(promotionId: string): Promise<ToolResult> {
  const { userId } = await requirePromotionAccess(promotionId);
  return executeTool("schedule_promotion", { promotion_id: promotionId }, userId, { routeContext: "/build" });
}
