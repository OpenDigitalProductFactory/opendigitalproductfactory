import { prisma } from "@dpf/db";

import type { AutonomousWorkRunInput } from "@/lib/tak/autonomous-work-run";
import { getToolGrantMapping } from "@/lib/tak/agent-grants";
import {
  mapCapacityCandidateToAutonomousWorkRunInput,
  type CapacityContinuityCandidate,
} from "./candidates";
import { getCapacityProviderFinanceSignals } from "./finance-signals";
import { planCapacityFinanceRouting } from "./finance-routing";

type BacklogCandidateRow = {
  itemId: string;
  title: string;
  body: string | null;
  priority: number | null;
  updatedAt: Date;
  epic: {
    epicId: string;
    title: string;
  } | null;
};

type CapacityTaskRunRow = {
  a2aMetadata: unknown;
};

export type BacklogReviewCapacityOptions = {
  agentId: string;
  ownerPrincipalId: string;
  capacityWindowId?: string;
  limit?: number;
};

export type BacklogReviewCapacityWorkInputOptions = BacklogReviewCapacityOptions & {
  resolvedTools?: Array<{ name: string }>;
};

export type BacklogReviewCapacityWorkInputResult = {
  inputs: AutonomousWorkRunInput[];
  rejections: Array<{
    candidateId: string;
    rejection: Exclude<
      ReturnType<typeof mapCapacityCandidateToAutonomousWorkRunInput>,
      { ok: true }
    >["rejection"];
  }>;
};

const DEFAULT_LIMIT = 5;

export async function selectBacklogReviewCapacityCandidates(
  options: BacklogReviewCapacityOptions,
): Promise<CapacityContinuityCandidate[]> {
  const [items, recentDedupeKeys, financeSignals] = await Promise.all([
    listSafeBacklogReviewRows(options.limit ?? DEFAULT_LIMIT),
    listRecentCapacityDedupeKeys(),
    getCapacityProviderFinanceSignals(),
  ]);

  return items
    .map((item) => buildBacklogReviewCandidate(item, options, financeSignals))
    .filter((candidate) => !recentDedupeKeys.has(candidate.dedupeKey));
}

export async function selectBacklogReviewCapacityWorkInputs(
  options: BacklogReviewCapacityWorkInputOptions,
): Promise<BacklogReviewCapacityWorkInputResult> {
  const candidates = await selectBacklogReviewCapacityCandidates(options);
  const toolGrantMapping = getToolGrantMapping();
  const result: BacklogReviewCapacityWorkInputResult = {
    inputs: [],
    rejections: [],
  };

  for (const candidate of candidates) {
    const mapped = mapCapacityCandidateToAutonomousWorkRunInput(candidate, {
      resolvedTools: options.resolvedTools,
      toolGrantMapping,
      existingDedupeKeys: candidates
        .filter((other) => other.candidateId !== candidate.candidateId)
        .map((other) => other.dedupeKey),
    });

    if (mapped.ok) {
      result.inputs.push(mapped.input);
    } else {
      result.rejections.push({
        candidateId: candidate.candidateId,
        rejection: mapped.rejection,
      });
    }
  }

  return result;
}

async function listSafeBacklogReviewRows(limit: number): Promise<BacklogCandidateRow[]> {
  return prisma.backlogItem.findMany({
    where: {
      status: "open",
      activeBuildId: null,
      duplicateOfId: null,
      claimedAt: null,
    },
    orderBy: [{ priority: "asc" }, { updatedAt: "asc" }],
    take: limit,
    select: {
      itemId: true,
      title: true,
      body: true,
      priority: true,
      updatedAt: true,
      epic: {
        select: {
          epicId: true,
          title: true,
        },
      },
    },
  });
}

async function listRecentCapacityDedupeKeys() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const runs = await prisma.taskRun.findMany({
    where: {
      createdAt: { gte: since },
      a2aMetadata: {
        path: ["trigger"],
        equals: "capacity-continuity",
      },
      status: { in: ["submitted", "working", "input-required", "completed"] },
    },
    select: {
      a2aMetadata: true,
    },
  });

  return new Set(
    (runs as CapacityTaskRunRow[])
      .map((run) => extractDedupeKey(run.a2aMetadata))
      .filter((key): key is string => typeof key === "string" && key.length > 0),
  );
}

function buildBacklogReviewCandidate(
  item: BacklogCandidateRow,
  options: BacklogReviewCapacityOptions,
  financeSignals: Awaited<ReturnType<typeof getCapacityProviderFinanceSignals>>,
): CapacityContinuityCandidate {
  const baseCandidate: CapacityContinuityCandidate = {
    candidateId: `backlog-review:${item.itemId}`,
    dedupeKey: `capacity:backlog-review:${item.itemId}`,
    source: "backlog",
    title: `Review backlog item ${item.itemId}: ${item.title}`,
    objective: buildObjective(item),
    routeContext: "/workspace/my-queue",
    agentId: options.agentId,
    ownerPrincipalId: options.ownerPrincipalId,
    riskClass: "read-only",
    evidenceRequired: [
      "Backlog item reviewed against current docs and runtime signals",
      "Recommended next action captured with evidence or blocker reason",
    ],
    capacityFit: {
      providerClassHint: "fixed-cost",
      modelTierHint: "standard",
      reason: "Read-only backlog review can use already-paid background capacity.",
    },
    sourceRef: {
      kind: "backlog-item",
      id: item.itemId,
    },
    capacityState: "surplus",
    ...(options.capacityWindowId ? { capacityWindowId: options.capacityWindowId } : {}),
  };

  const financePlan = planCapacityFinanceRouting(baseCandidate, {
    financeSignals,
  });

  return {
    ...baseCandidate,
    routingHints: financePlan.routingHints,
    financeTracking: financePlan.financeTracking,
  };
}

function buildObjective(item: BacklogCandidateRow) {
  const epicContext = item.epic ? ` Epic: ${item.epic.epicId} - ${item.epic.title}.` : "";
  const bodyContext = item.body ? ` Notes: ${item.body.slice(0, 500)}` : "";

  return `Review backlog item ${item.itemId} for safe next action, stale assumptions, missing evidence, and capacity-suitable follow-up.${epicContext}${bodyContext}`;
}

function extractDedupeKey(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  const cognitiveLoad = (metadata as { cognitiveLoad?: unknown }).cognitiveLoad;
  if (!cognitiveLoad || typeof cognitiveLoad !== "object") {
    return null;
  }

  const dedupeKey = (cognitiveLoad as { dedupeKey?: unknown }).dedupeKey;
  return typeof dedupeKey === "string" ? dedupeKey : null;
}
