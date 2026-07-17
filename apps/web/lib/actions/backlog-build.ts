"use server";

import { requireCapability } from "@/lib/actions/shared/guards";
import { promoteBacklogItemToBuildDraft } from "@/lib/governed-backlog-tee-up";
import { prisma } from "@dpf/db";
import * as crypto from "crypto";
import { revalidatePath } from "next/cache";

// A build in one of these phases is no longer live, so it must not block a
// re-start of the backlog item (BI-08AE51DC). Mirrors the same set used by
// coworker-tool-filter.ts; kept local to avoid coupling to wip-cap's variant,
// which intentionally omits "abandoned".
const TERMINAL_BUILD_PHASES = new Set<string>(["complete", "failed", "abandoned"]);

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

export type BuildStudioBacklogIntakeResult =
  | {
    status: "created";
    item: {
      itemId: string;
      title: string;
      portfolioId: string;
      portfolioName: string;
    };
  }
  | {
    status: "blocked";
    error: string;
  };

export async function createBuildStudioBacklogIntake(input: {
  title: string;
  portfolioId: string;
}): Promise<BuildStudioBacklogIntakeResult> {
  const userId = await requireBuildAccess();
  const title = input.title.trim();
  const portfolioId = input.portfolioId.trim();
  if (!title) return { status: "blocked", error: "Title is required." };
  if (!portfolioId) return { status: "blocked", error: "Portfolio is required." };

  const portfolio = await prisma.portfolio.findUnique({
    where: { id: portfolioId },
    select: { id: true, name: true },
  });
  if (!portfolio) return { status: "blocked", error: "Choose a valid portfolio." };

  const item = await prisma.backlogItem.create({
    data: {
      itemId: `BI-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      title,
      type: "portfolio",
      workType: "feature",
      source: "user-request",
      status: "open",
      triageOutcome: "build",
      effortSize: "medium",
      portfolioId: portfolio.id,
      submittedById: userId,
      body: title,
    },
    select: {
      id: true,
      itemId: true,
      title: true,
      portfolioId: true,
    },
  });

  await prisma.backlogItemActivity.create({
    data: {
      backlogItemId: item.id,
      kind: "build-studio-intake",
      summary: `Build Studio intake filed ${item.itemId} for ${portfolio.name}.`,
      recordedById: userId,
      payload: {
        portfolioId: portfolio.id,
        portfolioName: portfolio.name,
      },
    },
  }).catch(() => {});

  revalidatePath("/ops");
  revalidatePath("/build");

  return {
    status: "created",
    item: {
      itemId: item.itemId,
      title: item.title,
      portfolioId: item.portfolioId ?? portfolio.id,
      portfolioName: portfolio.name,
    },
  };
}

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

  // BI-08AE51DC: only a LIVE build blocks re-start. A terminal build
  // (complete/failed/abandoned — e.g. the un-audited bulk-abandon incident that
  // set phase='abandoned' with no reason) previously left the item permanently
  // wedged: Start-build routed to the corpse and nothing detached it. Route to
  // the build only when it is still live; a terminal activeBuild falls through
  // to a fresh draft.
  const activeBuild = existing.activeBuild;
  if (activeBuild?.buildId && !TERMINAL_BUILD_PHASES.has(activeBuild.phase)) {
    const href = buildHref(activeBuild.buildId);
    return {
      status: "existing",
      buildId: activeBuild.buildId,
      href,
    };
  }
  // Past this point any activeBuild is terminal; capture its id so we can clear
  // the stale 1:1 link (activeBuildId is @unique and promoteBacklogItemToBuildDraft
  // refuses when it is set) inside the promote transaction below.
  const staleTerminalBuildId = activeBuild?.buildId ?? null;

  const config = await prisma.platformDevConfig.findUnique({
    where: { id: "singleton" },
    select: { governedBacklogEnabled: true },
  });

  const result = await prisma.$transaction(async (tx) => {
    if (staleTerminalBuildId) {
      // Detach the corpse so promote can create a fresh draft. Atomic with the
      // promote below; promote re-reads the item inside this same tx.
      await tx.backlogItem.update({
        where: { itemId: semanticItemId },
        data: { activeBuildId: null },
      });
    }
    return promoteBacklogItemToBuildDraft({
      tx,
      itemId: semanticItemId,
      userId,
      governedBacklogEnabled: config?.governedBacklogEnabled === true,
      activity: {
        tool: "backlog_row_start_build",
        summary: `Build Studio draft created from backlog row ${semanticItemId}.`,
      },
    });
  });

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
