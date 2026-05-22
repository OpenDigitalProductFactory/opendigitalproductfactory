"use server";

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getLatestBomSummaryForBuild, missingBomSummary } from "@/lib/assurance/bom-read";
import type { BomSummary } from "@/lib/assurance/bom-read";
import { queueBuildBomGeneration } from "@/lib/assurance/bom-trigger";

async function requirePlatformUser(): Promise<string> {
  const session = await auth();
  const user = session?.user;

  if (!user?.id || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "view_platform")) {
    throw new Error("Unauthorized");
  }

  return user.id;
}

export async function requestBuildBomGeneration(buildId: string): Promise<{ queued: true }> {
  const requestedByUserId = await requirePlatformUser();
  await queueBuildBomGeneration({ buildId, requestedByUserId });
  return { queued: true };
}

export async function getBuildBomSummary(buildId: string): Promise<BomSummary> {
  try {
    return await getLatestBomSummaryForBuild(prisma, buildId);
  } catch (err) {
    console.error(
      `[tool-trace] failed to load build BOM summary buildId=${buildId} error=${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return missingBomSummary();
  }
}
