"use server";

import { requireCapability } from "@/lib/actions/shared/guards";
import { promoteBacklogItemToBuildDraft } from "@/lib/governed-backlog-tee-up";
import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";

export type StartBacklogBuildResult =
  | {
    status: "created" | "existing";
    buildId: string;
    href: string;
  }
  | {
    status: "blocked";
    error: string;
  };

export async function startBacklogBuild(itemId: string): Promise<StartBacklogBuildResult> {
  const userId = await requireBuildAccess();
  const semanticItemId = itemId.trim();
  if (!semanticItemId) {
    return { status: "blocked", error: "Backlog item id is required." };
  }

  const existing = await prisma.backlogItem.findUnique({
    where: { itemId: semanticItemId },
    select: {
      itemId: true,
      activeBuild: {
        select: {
          buildId: true,
          phase: true,
        },
      },
    },
  });

  if (!existing) {
    return { status: "blocked", error: `Backlog item ${semanticItemId} was not found.` };
  }

  if (existing.activeBuild?.buildId) {
    const href = buildHref(existing.activeBuild.buildId);
    return {
      status: "existing",
      buildId: existing.activeBuild.buildId,
      href,
    };
  }

  const config = await prisma.platformDevConfig.findUnique({
    where: { id: "singleton" },
    select: { governedBacklogEnabled: true },
  });

  const result = await prisma.$transaction((tx) =>
    promoteBacklogItemToBuildDraft({
      tx,
      itemId: semanticItemId,
      userId,
      governedBacklogEnabled: config?.governedBacklogEnabled === true,
      activity: {
        tool: "backlog_row_start_build",
        summary: `Build Studio draft created from backlog row ${semanticItemId}.`,
      },
    }),
  );

  if (result.kind !== "success") {
    return { status: "blocked", error: result.message || result.error };
  }

  revalidatePath("/ops");
  revalidatePath("/build");

  return {
    status: "created",
    buildId: result.build.buildId,
    href: buildHref(result.build.buildId),
  };
}

async function requireBuildAccess(): Promise<string> {
  return (await requireCapability("view_platform")).userId;
}

function buildHref(buildId: string): string {
  return `/build?buildId=${encodeURIComponent(buildId)}`;
}
