"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@dpf/db";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { inngest } from "@/lib/queue/inngest-client";
import { SELF_UPGRADE_EVENT } from "@/lib/queue/functions/self-upgrade";
import { getSelfUpgradeConfig } from "@/lib/self-upgrade/config";
import { getUpgradeVersionState, type UpgradeVersionState } from "@/lib/self-upgrade/version";

async function requireSelfUpgradeOperator(
  capability: "view_operations" | "manage_provider_connections",
): Promise<{ userId: string | null }> {
  const session = await auth();
  const user = session?.user;
  if (
    !user ||
    !can(
      { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
      capability,
    )
  ) {
    throw new Error("Unauthorized");
  }
  return { userId: user.id ?? null };
}

export type SelfUpgradeRunListItem = {
  runId: string;
  status: string;
  trigger: string;
  currentSha: string | null;
  targetSha: string | null;
  deployedSha: string | null;
  reason: string | null;
  promoterContainerName: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SelfUpgradeDashboard = {
  config: {
    enabled: boolean;
    channel?: string;
    checkIntervalHours?: number;
    healthTarget?: number;
    hostInstallPath: string | null;
    hostSourceMountPath: string | null;
    composeProject: string | null;
    portalContainerName: string | null;
    dbContainerName: string | null;
    repositoryRemote: string | null;
    repositoryBranch: string | null;
    healthUrl: string | null;
  };
  versionState: UpgradeVersionState | null;
  versionError: string | null;
  runs: SelfUpgradeRunListItem[];
};

function toOperatorVersionError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (
    message.includes("not a git repository") ||
    message.includes("Command failed: git")
  ) {
    return "Configured source mount is not readable as a Linux git checkout. Point self-upgrade at a clean root checkout, not a Windows Git worktree, before running it.";
  }
  return message;
}

export async function getSelfUpgradeDashboardAction(): Promise<SelfUpgradeDashboard> {
  await requireSelfUpgradeOperator("view_operations");
  const config = await getSelfUpgradeConfig();
  let versionState: UpgradeVersionState | null = null;
  let versionError: string | null = null;

  try {
    versionState = await getUpgradeVersionState(config);
  } catch (err) {
    versionError = toOperatorVersionError(err);
  }

  const runs = await prisma.selfUpgradeRun.findMany({
    orderBy: { createdAt: "desc" },
    take: 25,
    select: {
      runId: true,
      status: true,
      trigger: true,
      currentSha: true,
      targetSha: true,
      deployedSha: true,
      reason: true,
      promoterContainerName: true,
      startedAt: true,
      completedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return {
    config: {
      enabled: config.enabled,
      channel: config.channel,
      checkIntervalHours: config.checkIntervalHours,
      healthTarget: config.healthTarget,
      hostInstallPath: null,
      hostSourceMountPath: null,
      composeProject: null,
      portalContainerName: null,
      dbContainerName: null,
      repositoryRemote: null,
      repositoryBranch: null,
      healthUrl: null,
    },
    versionState,
    versionError,
    runs: runs.map((run) => ({
      ...run,
      startedAt: run.startedAt?.toISOString() ?? null,
      completedAt: run.completedAt?.toISOString() ?? null,
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
    })),
  };
}

export async function requestPortalSelfUpgradeAction(): Promise<void> {
  const { userId } = await requireSelfUpgradeOperator("manage_provider_connections");
  await inngest.send({
    name: SELF_UPGRADE_EVENT,
    data: {
      triggeredBy: userId ?? "manual",
    },
  });
  revalidatePath("/ops/self-upgrade");
}
