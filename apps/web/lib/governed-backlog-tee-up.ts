import * as crypto from "crypto";
import { generateBuildId, mergeHappyPathStateIntoPlan } from "@/lib/feature-build-types";
import {
  deriveBuildProcessType,
  deriveBuildProcessSize,
} from "@/lib/explore/build-process-matrix";
import { warrantForBacklogItem } from "@/lib/decision/warrant-for-item";
import { loadOrgWarrantContext } from "@/lib/decision/org-warrant-context";
import {
  attachBuildStudioWorkCapsule,
  type BuildStudioCapsuleDb,
} from "@/lib/work-capsules/build-studio-attachment";
import { admitRuntimeGuardedWork } from "@/lib/platform-runtime/work-admission";
import {
  resolveAutonomousTeeUpStart,
  shouldAutoApproveGovernedDraft,
  type AutonomousTeeUpStart,
} from "@/lib/build/autonomous-tee-up";
export { shouldAutoApproveGovernedDraft } from "@/lib/build/autonomous-tee-up";

const ELIGIBLE_EFFORT_SIZES = new Set(["small", "medium", "large"]);
const ACTIVE_EPIC_STATUSES = new Set(["open", "in-progress"]);
const DEFAULT_DAILY_CAP = 3;

/** Structured Fix Context fields carried on FeatureBrief.fixContext for kind=fix. */
export type ParsedFixContextFields = {
  reproSteps?: string;
  expected?: string;
  actual?: string;
  rootCause?: string;
  fixApproach?: string;
};

/**
 * Map operator-authored Fix Context labels (markdown headings or `Label:` lines)
 * onto FixContext keys. BI-E7BB3816: promote must not drop an explicit diagnosis.
 */
const FIX_CONTEXT_LABEL_TO_KEY: Record<string, keyof ParsedFixContextFields> = {
  "reproduction steps": "reproSteps",
  "reproduction step": "reproSteps",
  "repro steps": "reproSteps",
  "repro step": "reproSteps",
  reprosteps: "reproSteps",
  repro: "reproSteps",
  expected: "expected",
  "expected behavior": "expected",
  "expected result": "expected",
  actual: "actual",
  "actual behavior": "actual",
  "actual result": "actual",
  "root cause": "rootCause",
  rootcause: "rootCause",
  "fix approach": "fixApproach",
  fixapproach: "fixApproach",
  "proposed fix": "fixApproach",
  remediation: "fixApproach",
};

const FIX_CONTEXT_LABEL_PATTERN =
  /^(?:#{1,6}\s*|\*\*|__)?\s*(reproduction steps?|repro steps?|reprosteps|repro|expected(?:\s+behavior|\s+result)?|actual(?:\s+behavior|\s+result)?|root\s*cause|fix\s*approach|proposed fix|remediation)\s*(?:\*\*|__)?\s*:?\s*/i;

/**
 * Parse a structured Fix Context section from a backlog body into FixContext
 * fields. Supports markdown headings (`## Root cause`) and label lines
 * (`Root cause: …` / `**Root cause:** …`). Body text outside recognized
 * labels is ignored (report description still seeds `actual` as fallback).
 *
 * Exported for unit tests (BI-E7BB3816).
 */
export function parseFixContextFromBody(body: string | null | undefined): ParsedFixContextFields {
  if (!body?.trim()) return {};

  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const out: ParsedFixContextFields = {};
  let currentKey: keyof ParsedFixContextFields | null = null;
  const buckets: Partial<Record<keyof ParsedFixContextFields, string[]>> = {};

  const flush = () => {
    if (!currentKey) return;
    const text = (buckets[currentKey] ?? []).join("\n").trim();
    if (text) out[currentKey] = text;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const match = line.match(FIX_CONTEXT_LABEL_PATTERN);
    if (match) {
      flush();
      const label = match[1]!.toLowerCase().replace(/\s+/g, " ").trim();
      currentKey = FIX_CONTEXT_LABEL_TO_KEY[label] ?? null;
      if (!currentKey) continue;
      buckets[currentKey] = buckets[currentKey] ?? [];
      const remainder = line.slice(match[0].length).trim();
      if (remainder) buckets[currentKey]!.push(remainder);
      continue;
    }
    // Stop capturing when a new top-level markdown section starts that is not a fix-context label.
    if (currentKey && /^#{1,3}\s+\S/.test(line) && !FIX_CONTEXT_LABEL_PATTERN.test(line)) {
      flush();
      currentKey = null;
      continue;
    }
    if (currentKey) {
      buckets[currentKey] = buckets[currentKey] ?? [];
      buckets[currentKey]!.push(line);
    }
  }
  flush();
  return out;
}

export type GovernedBacklogTeeUpTrigger = "daily" | "manual" | "capacity-drain";

export type GovernedBacklogTeeUpCandidate = {
  id: string;
  itemId: string;
  title: string;
  body: string | null;
  status: string;
  triageOutcome: string | null;
  effortSize: string | null;
  workType?: string | null;
  activeBuildId: string | null;
  /**
   * Set to the decomposition Epic when a prior build for this item was
   * decomposed (approve-decomposition swaps activeBuildId → activeEpicId). Its
   * child builds already carry the work, so the item must NOT be re-promoted.
   * Distinct from `epicId`, which is only the grouping epic. See BI-1D0CA7A0.
   */
  activeEpicId: string | null;
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
  workroom: {
    create(args: any): Promise<any>;
    findUnique(args: any): Promise<any>;
    findFirst?(args: any): Promise<any>;
    update?(args: any): Promise<any>;
  };
  // WWWD context read (BI-EE211BFA). Optional so existing test doubles — which
  // model only the write path — keep satisfying this type; loadOrgWarrantContext
  // degrades to a null context when they're absent.
  organization?: {
    findFirst(args: any): Promise<any>;
  };
  storefrontConfig?: {
    findFirst(args: any): Promise<any>;
  };
  workroomActivity: {
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
  autonomousStart?: AutonomousTeeUpStart;
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
    // Do not re-promote an item whose prior build was decomposed: its
    // activeEpicId points at a live Epic whose child builds already deliver the
    // work. Re-promoting mints a duplicate build that parks at the
    // decompose-required gate and collides on Epic.originatingBacklogItemId,
    // spamming a restart-path prisma:error (BI-1D0CA7A0). This is the generator
    // of that duplicate; the approve-decomposition guard is the safety net.
    && item.activeEpicId == null
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
  const {
    tx,
    itemId,
    userId,
    governedBacklogEnabled,
    autonomousStart,
    activity,
  } = input;
  if ("$executeRaw" in tx && "platformCapability" in tx && "runtimeCapabilityTransition" in tx) {
    await admitRuntimeGuardedWork(tx as never, "build-studio-active");
  }
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
  const { readBoundWorkShapeRef } = await import("@/lib/backlog/initiative-readiness/bound-work-shape");
  const boundWorkShape = (tx as { workroom?: { findFirst?: unknown } }).workroom?.findFirst
    ? await readBoundWorkShapeRef(tx as unknown as Parameters<typeof readBoundWorkShapeRef>[0], item.itemId).catch(() => null)
    : null;
  const processSize = deriveBuildProcessSize({ effortSize: item.effortSize ?? null, workShape: boundWorkShape });
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
  // Decision-altitude control plane (EP-7B169558 / BI-8AB0E66D): derive the
  // WorkWarrant + gate rightsizing-opts from day-one structural signals and
  // persist them on the plan so checkPhaseGate right-sizes rigor by altitude +
  // blast-radius, not effort size alone. deliverableSensitivity/qualityFirst are
  // what the gate reads (rightsizingOptsFromEvidence); workWarrant carries the
  // fuller object (lane/model tier/evidence/reporting) for downstream consumers.
  // WWWD context (BI-EE211BFA): the org's industry + chosen archetype. deriveWarrant
  // already escalates evidence to "compliance" when a vertical/jurisdiction
  // obligation is present — this is what finally feeds it, so a regulated install
  // demands compliance evidence without the operator re-stating it per build.
  const warrantContext = await loadOrgWarrantContext(tx);
  const { warrant: workWarrant, opts: rightsizingOpts } = warrantForBacklogItem({
    effortSize: item.effortSize ?? null,
    workType: item.workType ?? null,
    text: `${item.title} ${item.body ?? ""}`,
    context: warrantContext,
  });
  const plan = {
    ...planBase,
    processSize,
    workWarrant,
    deliverableSensitivity: rightsizingOpts.sensitivity,
    qualityFirst: rightsizingOpts.qualityFirst,
  };

  // Work-kind derivation + fix-context carry-through.
  // deriveBuildProcessType is the single source of truth for "given this BI,
  // what build-process type does it become?" — see build-process-matrix.ts.
  // After BI-FD37173A (this PR) it reads the clean `BacklogItem.workType`
  // closed enum: workType="bug" -> "fix", "doc" -> "doc", "chore" -> "chore",
  // everything else (feature | tool | skill | refactor) -> "feature".
  // Pre-2026-05-30 BIs whose source was "bug" were backfilled to
  // workType="bug" in 20260530170000_backlog_item_work_type, so this is
  // byte-identical for every existing row.
  //
  // For fixes we pull the originating PlatformIssueReport (linked from the
  // triage-created BI body as "Source report: PIR-XXXXX") so the build starts
  // from the real diagnosis (severity, route, error stack) instead of a blank
  // brief. When the BI body already carries a structured Fix Context section,
  // map those fields onto fixContext so ideate→plan does not abandon a complete
  // operator diagnosis (BI-E7BB3816). Remaining gaps stay for ideate to fill.
  const kind = deriveBuildProcessType({ workType: item.workType ?? null, body: item.body });
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
    const parsed = parseFixContextFromBody(item.body);
    const fallbackActual = report?.description ?? (parsed.actual ? null : item.body);
    const fixContext: Record<string, unknown> = {
      ...(report?.severity ? { severity: report.severity } : {}),
      ...(report?.id ? { originatingIssueReportId: report.id } : {}),
      ...(report?.reportId ? { originatingIssueReportPublicId: report.reportId } : {}),
      ...(report?.routeContext ? { routeContext: report.routeContext } : {}),
      ...(report?.errorStack ? { errorStackExcerpt: report.errorStack.slice(0, 2000) } : {}),
      // Structured body fields win over report/body fallbacks (operator diagnosis).
      ...(parsed.reproSteps ? { reproSteps: parsed.reproSteps } : {}),
      ...(parsed.expected ? { expected: parsed.expected } : {}),
      ...(parsed.actual
        ? { actual: parsed.actual }
        : fallbackActual
          ? { actual: fallbackActual.slice(0, 2000) }
          : {}),
      ...(parsed.rootCause ? { rootCause: parsed.rootCause } : {}),
      ...(parsed.fixApproach ? { fixApproach: parsed.fixApproach } : {}),
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
      portfolioId: item.portfolioId ?? null,
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
  const autoApproveAllowed = shouldAutoApproveGovernedDraft({
    governedBacklogEnabled,
    hasBody: (item.body ?? "").trim().length > 0,
    autonomousStart,
  });
  if (autoApproveAllowed) {
    const approvedAt = new Date();
    await tx.featureBuild.update({
      where: { id: created.id },
      data: { draftApprovedAt: approvedAt },
    });
    await tx.buildActivity.create({
      data: {
        buildId: created.buildId,
        tool: "approve_start",
        summary: autonomousStart?.mode === "enforce"
          ? `Auto-approved by governed playbook at ${approvedAt.toISOString()} (active pattern v${autonomousStart.eligibility?.activePatternVersion ?? "?"}; evidence-cleared low-risk lane).`
          : `Auto-approved by governed backlog flow at ${approvedAt.toISOString()} (BI body present — operator confirmation captured at triage+promote).`,
      },
    });
  }
  if (autonomousStart?.mode === "shadow" && autonomousStart.eligibility) {
    await tx.buildActivity.create({
      data: {
        buildId: created.buildId,
        tool: "autonomous_playbook_shadow",
        summary:
          `Shadow decision: ${autonomousStart.eligibility.eligible ? "would auto-start" : "would not auto-start"}; `
          + `next=${autonomousStart.eligibility.nextGovernedAction}; `
          + `blockers=${autonomousStart.eligibility.blockers.join(",") || "none"}.`,
      },
    });
  }

  return {
    kind: "success",
    build: created,
    backlogItemId: itemId,
    capsuleId: capsule.capsuleId,
    autoApprovedDispatchEligible: autoApproveAllowed,
  };
}

function resolveRequestedLimit(
  config: GovernedBacklogConfig,
  requestedLimit?: number,
  capOverride?: number,
): number {
  // capOverride replaces the daily cap as the ceiling for this run — used by the
  // capacity-drain path to fill idle build slots up to the WIP cap near the
  // weekly-allocation reset, rather than being held to the normal daily cadence.
  const configuredCap =
    typeof capOverride === "number" && capOverride >= 0
      ? Math.floor(capOverride)
      : config?.backlogTeeUpDailyCap ?? DEFAULT_DAILY_CAP;
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
  /** Overrides the daily cap as the per-run ceiling (capacity-drain path). */
  capOverride?: number;
}): Promise<{
  trigger: GovernedBacklogTeeUpTrigger;
  requestedLimit: number;
  selectedCount: number;
  createdCount: number;
  skippedCount: number;
  builds: Array<{ backlogItemId: string; buildId: string }>;
}> {
  const { prisma, userId, trigger, limit, capOverride } = input;
  const config = await prisma.platformDevConfig.findUnique({
    where: { id: "singleton" },
    select: {
      governedBacklogEnabled: true,
      backlogTeeUpDailyCap: true,
    },
  });

  const requestedLimit = resolveRequestedLimit(config, limit, capOverride);
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
      // Exclude items already being delivered by a decomposition Epic (BI-1D0CA7A0).
      activeEpicId: null,
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
      workType: true,
      activeBuildId: true,
      activeEpicId: true,
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

    const autonomousStart = await resolveAutonomousTeeUpStart({
      item,
      db: prisma,
    });
    const result = await prisma.$transaction((tx) =>
      promoteBacklogItemToBuildDraft({
        tx,
        itemId: item.itemId,
        userId,
        governedBacklogEnabled: config.governedBacklogEnabled === true,
        autonomousStart,
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
