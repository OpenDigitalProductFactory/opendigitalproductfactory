import { generateBuildId } from "@/lib/feature-build-types";

const ELIGIBLE_EFFORT_SIZES = new Set(["small", "medium", "large"]);
const ACTIVE_EPIC_STATUSES = new Set(["open", "in-progress"]);
const DEFAULT_DAILY_CAP = 3;

export type GovernedBacklogTeeUpTrigger = "daily" | "manual";

export type GovernedBacklogTeeUpCandidate = {
  id: string;
  itemId: string;
  title: string;
  body: string | null;
  status: string;
  triageOutcome: string | null;
  effortSize: string | null;
  activeBuildId: string | null;
  digitalProductId: string | null;
  epicId: string | null;
  createdAt: Date;
  epic: { status: string } | null;
};

type GovernedBacklogConfig = {
  governedBacklogEnabled: boolean;
  backlogTeeUpDailyCap: number | null;
} | null;

type GovernedBacklogTeeUpPrisma = {
  platformDevConfig: {
    findUnique(args: any): Promise<any>;
  };
  backlogItem: {
    findMany(args: any): Promise<any>;
    findUnique(args: any): Promise<any>;
    update(args: any): Promise<any>;
  };
  featureBuild: {
    create(args: any): Promise<any>;
  };
  buildActivity: {
    create(args: any): Promise<any>;
  };
  $transaction<T>(callback: (tx: GovernedBacklogTeeUpPrisma) => Promise<T>): Promise<T>;
};

type PromoteBacklogItemToBuildDraftInput = {
  tx: GovernedBacklogTeeUpPrisma;
  itemId: string;
  userId: string;
  governedBacklogEnabled: boolean;
  activity?:
    | {
      tool: string;
      summary: string;
    }
    | null;
};

type PromoteBacklogItemToBuildDraftResult =
  | {
    kind: "success";
    build: { id: string; buildId: string };
    backlogItemId: string;
  }
  | {
    kind: "error";
    error: string;
    message: string;
  };

function isEligibleCandidate(item: GovernedBacklogTeeUpCandidate): boolean {
  return (
    item.status === "open"
    && item.triageOutcome === "build"
    && item.activeBuildId == null
    && item.effortSize != null
    && ELIGIBLE_EFFORT_SIZES.has(item.effortSize)
  );
}

function candidatePriority(item: GovernedBacklogTeeUpCandidate): number {
  return ACTIVE_EPIC_STATUSES.has(item.epic?.status ?? "") ? 0 : 1;
}

export function selectGovernedBacklogTeeUpCandidates(
  items: GovernedBacklogTeeUpCandidate[],
  limit: number,
): GovernedBacklogTeeUpCandidate[] {
  if (limit <= 0) return [];

  return items
    .filter(isEligibleCandidate)
    .sort((left, right) => {
      const priorityDiff = candidatePriority(left) - candidatePriority(right);
      if (priorityDiff !== 0) return priorityDiff;

      const createdAtDiff = left.createdAt.getTime() - right.createdAt.getTime();
      if (createdAtDiff !== 0) return createdAtDiff;

      return left.itemId.localeCompare(right.itemId);
    })
    .slice(0, limit);
}

export async function promoteBacklogItemToBuildDraft(
  input: PromoteBacklogItemToBuildDraftInput,
): Promise<PromoteBacklogItemToBuildDraftResult> {
  const { tx, itemId, userId, governedBacklogEnabled, activity } = input;
  const item = await tx.backlogItem.findUnique({ where: { itemId } });

  if (!item) {
    return { kind: "error", error: "Item not found", message: `Item ${itemId} not found` };
  }

  if (item.status !== "open" || item.triageOutcome !== "build") {
    return {
      kind: "error",
      error: "Item is not eligible for Build Studio promotion",
      message: `Item ${itemId} must be open with triageOutcome=build`,
    };
  }

  if (item.activeBuildId) {
    return {
      kind: "error",
      error: "Item already has an active build",
      message: `Item ${itemId} already has an active build`,
    };
  }

  const created = await tx.featureBuild.create({
    data: {
      buildId: generateBuildId(),
      title: item.title,
      ...(item.body ? { description: item.body } : {}),
      createdById: userId,
      digitalProductId: item.digitalProductId ?? null,
      originatingBacklogItemId: item.id,
      draftApprovedAt: null,
    },
  });

  await tx.backlogItem.update({
    where: { itemId },
    data: {
      activeBuildId: created.id,
      status: governedBacklogEnabled ? "open" : "in-progress",
    },
  });

  if (activity) {
    await tx.buildActivity.create({
      data: {
        buildId: created.buildId,
        tool: activity.tool,
        summary: activity.summary,
      },
    });
  }

  return {
    kind: "success",
    build: created,
    backlogItemId: itemId,
  };
}

function resolveRequestedLimit(config: GovernedBacklogConfig, requestedLimit?: number): number {
  const configuredCap = config?.backlogTeeUpDailyCap ?? DEFAULT_DAILY_CAP;
  if (requestedLimit == null || Number.isNaN(requestedLimit)) {
    return configuredCap;
  }

  const normalized = Math.max(0, Math.floor(requestedLimit));
  return Math.min(normalized, configuredCap);
}

export async function runGovernedBacklogTeeUp(input: {
  prisma: GovernedBacklogTeeUpPrisma;
  userId: string;
  trigger: GovernedBacklogTeeUpTrigger;
  limit?: number;
}): Promise<{
  trigger: GovernedBacklogTeeUpTrigger;
  requestedLimit: number;
  selectedCount: number;
  createdCount: number;
  skippedCount: number;
  builds: Array<{ backlogItemId: string; buildId: string }>;
}> {
  const { prisma, userId, trigger, limit } = input;
  const config = await prisma.platformDevConfig.findUnique({
    where: { id: "singleton" },
    select: {
      governedBacklogEnabled: true,
      backlogTeeUpDailyCap: true,
    },
  });

  const requestedLimit = resolveRequestedLimit(config, limit);
  if (config?.governedBacklogEnabled !== true || requestedLimit <= 0) {
    return {
      trigger,
      requestedLimit,
      selectedCount: 0,
      createdCount: 0,
      skippedCount: 0,
      builds: [],
    };
  }

  const items = await prisma.backlogItem.findMany({
    where: {
      status: "open",
      triageOutcome: "build",
      effortSize: { in: [...ELIGIBLE_EFFORT_SIZES] },
      activeBuildId: null,
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      itemId: true,
      title: true,
      body: true,
      status: true,
      triageOutcome: true,
      effortSize: true,
      activeBuildId: true,
      digitalProductId: true,
      epicId: true,
      createdAt: true,
      epic: {
        select: {
          status: true,
        },
      },
    },
  });

  const selected = selectGovernedBacklogTeeUpCandidates(items, requestedLimit);
  const builds: Array<{ backlogItemId: string; buildId: string }> = [];
  let skippedCount = 0;

  for (const item of selected) {
    const activitySummary =
      trigger === "daily"
        ? `Created by the daily backlog tee-up from ${item.itemId}.`
        : `Created by manual backlog processing from ${item.itemId}.`;

    const result = await prisma.$transaction((tx) =>
      promoteBacklogItemToBuildDraft({
        tx,
        itemId: item.itemId,
        userId,
        governedBacklogEnabled: config.governedBacklogEnabled === true,
        activity: {
          tool: "governed_backlog_tee_up",
          summary: activitySummary,
        },
      }),
    );

    if (result.kind === "success") {
      builds.push({
        backlogItemId: result.backlogItemId,
        buildId: result.build.buildId,
      });
    } else {
      skippedCount += 1;
    }
  }

  return {
    trigger,
    requestedLimit,
    selectedCount: selected.length,
    createdCount: builds.length,
    skippedCount,
    builds,
  };
}
