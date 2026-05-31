import * as crypto from "crypto";
import { generateBuildId, mergeHappyPathStateIntoPlan } from "@/lib/feature-build-types";
import {
  deriveBuildProcessType,
  deriveBuildProcessSize,
} from "@/lib/explore/build-process-matrix";
import {
  attachBuildStudioWorkCapsule,
  type BuildStudioCapsuleDb,
} from "@/lib/work-capsules/build-studio-attachment";

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

type GovernedBacklogTeeUpTx = {
  backlogItem: {
    findUnique(args: any): Promise<any>;
    update(args: any): Promise<any>;
  };
  epic: {
    create(args: any): Promise<any>;
  };
  featureBuild: {
    create(args: any): Promise<any>;
    update(args: any): Promise<any>;
  };
  buildActivity: {
    create(args: any): Promise<any>;
  };
  backlogItemActivity: {
    create(args: any): Promise<any>;
  };
  workCapsule: {
    create(args: any): Promise<any>;
    findUnique(args: any): Promise<any>;
    findFirst?(args: any): Promise<any>;
    update?(args: any): Promise<any>;
  };
  workCapsuleActivity: {
    create(args: any): Promise<any>;
  };
  platformIssueReport: {
    findUnique(args: any): Promise<any>;
    findFirst(args: any): Promise<any>;
    updateMany(args: any): Promise<any>;
  };
};

type GovernedBacklogTeeUpPrisma = GovernedBacklogTeeUpTx & {
  platformDevConfig: {
    findUnique(args: any): Promise<any>;
  };
  backlogItem: GovernedBacklogTeeUpTx["backlogItem"] & {
    findMany(args: any): Promise<any>;
  };
  $transaction<T>(callback: (tx: GovernedBacklogTeeUpTx) => Promise<T>): Promise<T>;
};

type PromoteBacklogItemToBuildDraftInput = {
  tx: GovernedBacklogTeeUpTx;
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
    capsuleId: string;
    /** BI-52022707 axis D. True when the promotion auto-approved the draft
     *  (governed mode + non-empty BI body). The caller is expected to fire
     *  `dispatchIdeateForApprovedBuild` outside the transaction on this
     *  build to complete the autopilot path. False on non-governed installs
     *  or empty-body BIs — those preserve the manual approve-start gate. */
    autoApprovedDispatchEligible: boolean;
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
  const item = await tx.backlogItem.findUnique({
    where: { itemId },
    include: { epic: { select: { epicId: true } } },
  });

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

  // Resolve or auto-create the epic semantic id. The happy-path-rescue spec
  // requires an epic anchor in FeatureBuild.plan.happyPathState.intake; if the
  // BacklogItem isn't linked, mint a solo epic from the item title and link it
  // so the ideate→plan gate clears at promote time.
  let epicSemanticId: string;
  let epicRowId: string | null = item.epicId ?? null;
  if (item.epicId && item.epic?.epicId) {
    epicSemanticId = item.epic.epicId;
  } else {
    epicSemanticId = `EP-BUILD-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    const epicTitle = item.title.trim().slice(0, 200) || "Build Studio feature";
    const createdEpic = await tx.epic.create({
      data: { epicId: epicSemanticId, title: epicTitle, status: "open" },
      select: { id: true, epicId: true },
    });
    epicRowId = createdEpic.id;
    await tx.backlogItem.update({
      where: { itemId },
      data: { epicId: createdEpic.id },
    });
  }

  const constrainedGoal = item.title.trim().slice(0, 280);
  // Right-sizing matrix: persist the BI's effortSize onto the build's plan
  // so the prompt selector + phase gate can pick the matching lifecycle
  // policy. Default "medium" preserves today's behavior for BIs without an
  // explicit effortSize. See build-process-matrix.ts.
  const processSize = deriveBuildProcessSize({ effortSize: item.effortSize ?? null });
  const planBase = mergeHappyPathStateIntoPlan(null, {
    intake: {
      status: "ready",
      backlogItemId: item.itemId,
      epicId: epicSemanticId,
      // Use the BI's persisted taxonomy node when present, else anchor on the
      // triaged BI itself — its existence + triage outcome IS the
      // categorization signal for the gate. Mirrors the auto-intake fallback
      // in reviewDesignDoc (apps/web/lib/mcp-tools.ts:5153) so promote-time
      // and review-time paths produce the same shape.
      taxonomyNodeId: item.taxonomyNodeId ?? `triaged-bi:${item.id}`,
      constrainedGoal,
    },
  });
  const plan = { ...planBase, processSize };

  // Work-kind derivation + fix-context carry-through.
  // deriveBuildProcessType is the single source of truth for source→kind
  // mapping; today it returns "fix" for bug-sourced BIs, "doc" for doc-gap,
  // "chore" for body-marked chores, "feature" otherwise. For fixes we pull
  // the originating PlatformIssueReport (linked from the triage-created BI
  // body as "Source report: PIR-XXXXX") so the build starts from the real
  // diagnosis (severity, route, error stack) instead of a blank brief.
  // reproSteps/rootCause/fixApproach are left for ideate to fill.
  const kind = deriveBuildProcessType({ source: item.source ?? null, body: item.body });
  let fixBrief: Record<string, unknown> | null = null;
  let originatingReportId: string | null = null;
  if (kind === "fix") {
    let report: {
      id: string;
      reportId: string;
      severity: string | null;
      routeContext: string | null;
      errorStack: string | null;
      description: string | null;
    } | null = null;
    try {
      const publicIdMatch = (item.body ?? "").match(/PIR-[A-Z0-9]+/);
      if (publicIdMatch) {
        report = await tx.platformIssueReport.findUnique({
          where: { reportId: publicIdMatch[0] },
          select: { id: true, reportId: true, severity: true, routeContext: true, errorStack: true, description: true },
        });
      }
    } catch {
      // Non-fatal — proceed with a body-only fix context.
    }
    originatingReportId = report?.id ?? null;
    const fixContext: Record<string, unknown> = {
      ...(report?.severity ? { severity: report.severity } : {}),
      ...(report?.id ? { originatingIssueReportId: report.id } : {}),
      ...(report?.reportId ? { originatingIssueReportPublicId: report.reportId } : {}),
      ...(report?.routeContext ? { routeContext: report.routeContext } : {}),
      ...(report?.errorStack ? { errorStackExcerpt: report.errorStack.slice(0, 2000) } : {}),
      // Seed "actual" from the report/BI body; ideate refines repro/expected/root cause/fix approach.
      ...((report?.description ?? item.body) ? { actual: (report?.description ?? item.body).slice(0, 2000) } : {}),
    };
    fixBrief = {
      title: item.title,
      description: item.body ?? item.title,
      portfolioContext: "",
      targetRoles: [],
      inputs: [],
      dataNeeds: "",
      acceptanceCriteria: [],
      fixContext,
    };
  }

  const created = await tx.featureBuild.create({
    data: {
      buildId: generateBuildId(),
      title: item.title,
      kind,
      ...(item.body ? { description: item.body } : {}),
      ...(fixBrief ? { brief: fixBrief } : {}),
      createdById: userId,
      digitalProductId: item.digitalProductId ?? null,
      originatingBacklogItemId: item.id,
      draftApprovedAt: null,
      plan,
    },
  });

  // Back-link the originating issue report to this build, in-transaction so a
  // rollback cannot orphan the link. updateMany avoids a throw if the report
  // was already linked/removed.
  if (originatingReportId) {
    try {
      await tx.platformIssueReport.updateMany({
        where: { id: originatingReportId, featureBuildId: null },
        data: { featureBuildId: created.id },
      });
    } catch {
      // Non-fatal — the build is the source of truth; the link is a convenience.
    }
  }

  await tx.backlogItem.update({
    where: { itemId },
    data: {
      activeBuildId: created.id,
      status: governedBacklogEnabled ? "open" : "in-progress",
    },
  });

  const capsule = await attachBuildStudioWorkCapsule({
    db: tx as unknown as BuildStudioCapsuleDb,
    build: {
      id: created.id,
      buildId: created.buildId,
      title: item.title,
      description: item.body,
      phase: "ideate",
    },
    backlogItem: {
      id: item.id,
      itemId: item.itemId,
      title: item.title,
      body: item.body,
      epicId: epicRowId,
      epicSemanticId,
      taxonomyNodeId: item.taxonomyNodeId ?? null,
    },
    actor: { userId, agentId: null, principalId: null },
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

  // Auto-Approve-Start for backlog-promoted drafts when conditions allow.
  //
  // BI-52022707 axis D — the Dale-autopilot pipeline gap. After promotion, the
  // draft sits at `draftApprovedAt = null` until an operator clicks the
  // "Record Approve Start" button in /build. That button is the only path
  // that fires `dispatchIdeateForApprovedBuild`, so without the click the
  // build is invisible — no Ideate research, no designDoc, no progress.
  //
  // Dale's autopilot promise is: the BI title+body IS the human signal.
  // Under governed-backlog mode, the operator has already confirmed they
  // want the build by triaging the BI to outcome=build and promoting it.
  // Requiring a separate "approve start" click for backlog-promoted drafts
  // duplicates that confirmation. Auto-fire the approval inside the
  // promotion transaction when:
  //   - governedBacklogEnabled is true (opt-in flag — preserves the manual
  //     gate for non-governed installs that may want operator review)
  //   - the BI body is non-empty (gives Ideate a real research seed)
  //
  // The async dispatchIdeateForApprovedBuild fire-and-forget runs OUTSIDE
  // the transaction (the dynamic import + DB writes don't compose with the
  // outer prisma.$transaction safely). Wired through the same approveBuildStart
  // path so the BuildActivity audit trail stays consistent.
  if (governedBacklogEnabled && (item.body ?? "").trim().length > 0) {
    const approvedAt = new Date();
    await tx.featureBuild.update({
      where: { id: created.id },
      data: { draftApprovedAt: approvedAt },
    });
    await tx.buildActivity.create({
      data: {
        buildId: created.buildId,
        tool: "approve_start",
        summary: `Auto-approved by governed backlog flow at ${approvedAt.toISOString()} (BI body present — operator confirmation captured at triage+promote).`,
      },
    });
  }

  return {
    kind: "success",
    build: created,
    backlogItemId: itemId,
    capsuleId: capsule.capsuleId,
    autoApprovedDispatchEligible:
      governedBacklogEnabled && (item.body ?? "").trim().length > 0,
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
