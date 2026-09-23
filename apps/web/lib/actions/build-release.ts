"use server";

import { requireUserId } from "@/lib/actions/shared/guards";
import { currentOperationAuthority } from "@/lib/govern/operation-authority";
import { governedExecuteTool } from "@/lib/mcp-governed-execute";
import { prisma } from "@dpf/db";
import type { ToolResult } from "@/lib/mcp-tools";

type VersionBump = "major" | "minor" | "patch";

async function executeReleaseOperation(toolName: string, rawParams: Record<string, unknown>,
  userId: string, context: { routeContext: string }): Promise<ToolResult> {
  const userContext = await currentOperationAuthority(userId, toolName);
  if (!userContext) throw new Error("You do not have permission for this build operation.");
  return governedExecuteTool({ toolName, rawParams, userId, userContext, context, source: "rest" });
}

async function requireBuildReleaseAccess(buildId: string): Promise<{ userId: string }> {
  const userId = await requireUserId();

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
  const userId = await requireUserId();

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
  return executeReleaseOperation("deploy_feature", { buildId }, userId, { routeContext: "/build" });
}

export async function registerBuildRelease(input: {
  buildId: string;
  name: string;
  portfolioSlug: string;
  versionBump: VersionBump;
}): Promise<ToolResult> {
  const { userId } = await requireBuildReleaseAccess(input.buildId);
  return executeReleaseOperation(
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
  return executeReleaseOperation("contribute_to_hive", { buildId }, userId, { routeContext: "/build" });
}

export async function setBuildChangeDisposition(
  buildId: string,
  disposition: "private" | "shareable",
  reason?: string,
): Promise<ToolResult> {
  const { userId } = await requireBuildReleaseAccess(buildId);
  return executeReleaseOperation(
    "set_change_disposition",
    { buildId, disposition, reason },
    userId,
    { routeContext: "/build" },
  );
}

export async function shareBuildContribution(buildId: string, reason?: string): Promise<ToolResult> {
  const marked = await setBuildChangeDisposition(buildId, "shareable", reason);
  if (marked.success === false) return marked;
  return submitBuildContribution(buildId);
}

export async function executeBuildPromotion(promotionId: string): Promise<ToolResult> {
  const { userId } = await requirePromotionAccess(promotionId);
  return executeReleaseOperation("execute_promotion", { promotion_id: promotionId }, userId, { routeContext: "/build" });
}

export async function scheduleBuildPromotion(promotionId: string): Promise<ToolResult> {
  const { userId } = await requirePromotionAccess(promotionId);
  return executeReleaseOperation("schedule_promotion", { promotion_id: promotionId }, userId, { routeContext: "/build" });
}
