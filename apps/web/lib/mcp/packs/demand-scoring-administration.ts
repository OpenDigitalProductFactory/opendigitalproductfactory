import { prisma } from "@dpf/db";
import { DEMAND_SCORE_FRAMEWORKS, INVESTMENT_BUCKET_VALUES } from "@/lib/explore/backlog";
import type { DemandTransitionDb } from "@/lib/demand/transition-repository";
import { fundingRiskTier } from "@/lib/demand/funding-risk";
import type { ToolResult } from "@/lib/mcp-tools";
import { queueProductManagementPlaybookRefreshForBacklogItem } from "@/lib/product-management/product-management-playbook-refresh";

function mergeBucketTargets(current: unknown, incoming: unknown): Record<string, number> {
  const merged: Record<string, number> =
    current && typeof current === "object" ? { ...(current as Record<string, number>) } : {};
  if (incoming && typeof incoming === "object") {
    for (const b of INVESTMENT_BUCKET_VALUES) {
      const v = (incoming as Record<string, unknown>)[b];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) merged[b] = v;
    }
  }
  return merged;
}
export async function setDemandPolicyHandler(params: Record<string, unknown>): Promise<ToolResult> {
  // Per-portfolio targets: set this portfolio's own allocation, not the org default.
  const portfolioRef = typeof params["portfolioId"] === "string" ? (params["portfolioId"] as string).trim() : "";
  if (portfolioRef) {
    const rawTargets = params["bucketTargets"];
    if (!rawTargets || typeof rawTargets !== "object") {
      return { success: false, error: "no_change", message: "bucketTargets is required when portfolioId is set." };
    }
    const portfolio = await prisma.portfolio.findFirst({
      where: { OR: [{ id: portfolioRef }, { slug: portfolioRef }] },
      select: { id: true, slug: true, name: true, bucketTargets: true },
    });
    if (!portfolio) {
      return { success: false, error: "not_found", message: `No portfolio matched ${portfolioRef}` };
    }
    const merged = mergeBucketTargets(portfolio.bucketTargets, rawTargets);
    await prisma.portfolio.update({ where: { id: portfolio.id }, data: { bucketTargets: merged } });
    return {
      success: true,
      entityId: portfolio.slug,
      message: `Portfolio ${portfolio.name} targets set: ${merged.run ?? "?"}/${merged.grow ?? "?"}/${merged.transform ?? "?"}.`,
      data: { portfolioId: portfolio.slug, bucketTargets: merged },
    };
  }

  const data: { demandFramework?: string; demandBucketTargets?: Record<string, number> } = {};
  const f = params["framework"];
  if (typeof f === "string" && (DEMAND_SCORE_FRAMEWORKS as readonly string[]).includes(f)) {
    data.demandFramework = f;
  }
  const rawTargets = params["bucketTargets"];
  if (rawTargets && typeof rawTargets === "object") {
    // Merge partial targets over whatever is currently stored.
    const current = await prisma.platformDevConfig.findUnique({
      where: { id: "singleton" },
      select: { demandBucketTargets: true },
    });
    const merged: Record<string, number> =
      current?.demandBucketTargets && typeof current.demandBucketTargets === "object"
        ? { ...(current.demandBucketTargets as Record<string, number>) }
        : {};
    for (const b of INVESTMENT_BUCKET_VALUES) {
      const v = (rawTargets as Record<string, unknown>)[b];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) merged[b] = v;
    }
    data.demandBucketTargets = merged;
  }
  if (Object.keys(data).length === 0) {
    return { success: false, error: "no_change", message: "Provide framework and/or bucketTargets." };
  }
  await prisma.platformDevConfig.upsert({
    where: { id: "singleton" },
    update: data,
    create: { id: "singleton", ...data },
  });
  const { resolveDemandPolicy } = await import("@/lib/demand/policy");
  const fresh = await prisma.platformDevConfig.findUnique({
    where: { id: "singleton" },
    select: { demandFramework: true, demandBucketTargets: true },
  });
  const policy = resolveDemandPolicy(fresh);
  return {
    success: true,
    entityId: "singleton",
    message: `Demand policy updated: framework=${policy.framework}, targets ${policy.bucketTargets.run}/${policy.bucketTargets.grow}/${policy.bucketTargets.transform}.`,
    data: policy,
  };
}

const MAX_BACKLOG_DELIVERY_BUDGET = 50;

/**
 * View or set the backlog delivery budget (BI-5556CC2D): items/day funded for
 * governed backlog->build promotion, framed as an operator-owned allocation
 * (mirrors setDemandPolicyHandler's PlatformDevConfig upsert shape) rather than
 * a bare rate-limit constant. Always returns live parallelism context alongside
 * the budget — BUILD_WIP_CAP (apps/web/lib/build/wip-cap.ts) is a SEPARATE,
 * hard, correctness-driven ceiling on concurrent Build Studio sandbox execution
 * (one shared sandbox; concurrent BUILD-phase work corrupts it) that this budget
 * does not and must not change. A bigger budget only funds more intake into
 * ideate/plan/review; it does not raise execution parallelism.
 */
export async function setBacklogDeliveryBudgetHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const data: { backlogTeeUpDailyCap?: number; governedBacklogEnabled?: boolean } = {};

  const rawBudget = params["dailyBudget"];
  if (typeof rawBudget === "number" && Number.isFinite(rawBudget)) {
    if (rawBudget < 0 || rawBudget > MAX_BACKLOG_DELIVERY_BUDGET) {
      return {
        success: false,
        error: "invalid_input",
        message: `dailyBudget must be between 0 and ${MAX_BACKLOG_DELIVERY_BUDGET}.`,
      };
    }
    data.backlogTeeUpDailyCap = Math.floor(rawBudget);
  }

  const rawEnabled = params["enabled"];
  if (typeof rawEnabled === "boolean") {
    data.governedBacklogEnabled = rawEnabled;
  }

  if (Object.keys(data).length > 0) {
    await prisma.platformDevConfig.upsert({
      where: { id: "singleton" },
      update: data,
      create: { id: "singleton", ...data },
    });
  }

  const fresh = await prisma.platformDevConfig.findUnique({
    where: { id: "singleton" },
    select: { backlogTeeUpDailyCap: true, governedBacklogEnabled: true },
  });

  const { BUILD_WIP_CAP, TERMINAL_BUILD_PHASES } = await import("@/lib/build/wip-cap");
  const activeBuilds = await prisma.featureBuild.count({
    where: { phase: { notIn: [...TERMINAL_BUILD_PHASES] }, abandonedAt: null, parentEpicId: null },
  });

  const dailyBudget = fresh?.backlogTeeUpDailyCap ?? 3;
  const enabled = fresh?.governedBacklogEnabled === true;
  const parallelismNote =
    activeBuilds >= BUILD_WIP_CAP
      ? ` Build Studio's shared sandbox is already at its ${BUILD_WIP_CAP}-build execution limit (${activeBuilds} active) — new intake will queue behind it, not run in parallel. For more parallel throughput, use external worktree builds (unbounded — AGENTS.md §17), not a bigger budget.`
      : ` ${activeBuilds}/${BUILD_WIP_CAP} of Build Studio's shared-sandbox execution slots are in use.`;

  return {
    success: true,
    entityId: "singleton",
    message:
      Object.keys(data).length > 0
        ? `Backlog delivery budget set to ${dailyBudget}/day (governed promotion ${enabled ? "enabled" : "disabled"}).${parallelismNote}`
        : `Backlog delivery budget is ${dailyBudget}/day (governed promotion ${enabled ? "enabled" : "disabled"}).${parallelismNote}`,
    data: { dailyBudget, enabled, activeBuilds, buildWipCap: BUILD_WIP_CAP },
  };
}

export async function findDuplicateCandidatesHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const itemId = String(params["itemId"] ?? "");
  const target = await prisma.backlogItem.findUnique({
    where: { itemId },
    select: { itemId: true, title: true, body: true, portfolioId: true },
  });
  if (!target) return { success: false, error: "not_found", message: `Item ${itemId} not found` };
  const threshold = typeof params["threshold"] === "number" ? (params["threshold"] as number) : 0.5;
  const limit = typeof params["limit"] === "number" ? Math.max(1, Math.min(50, params["limit"] as number)) : 10;
  // Compare against open, non-terminal items (optionally same portfolio).
  const pool = await prisma.backlogItem.findMany({
    where: {
      status: { notIn: ["done", "deferred"] },
      itemId: { not: itemId },
      ...(target.portfolioId ? { portfolioId: target.portfolioId } : {}),
    },
    select: { itemId: true, title: true, body: true },
    take: 500,
  });
  const { findDuplicateCandidates } = await import("@/lib/demand/dedup");
  const candidates = findDuplicateCandidates(target, pool, threshold).slice(0, limit);
  return {
    success: true,
    entityId: itemId,
    message:
      candidates.length > 0
        ? `${candidates.length} possible duplicate(s) of ${itemId}.`
        : `No open items above similarity ${threshold} for ${itemId}.`,
    data: { candidates },
  };
}

export async function mergeBacklogItemsHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const canonicalItemId = String(params["canonicalItemId"] ?? "");
  const duplicateItemId = String(params["duplicateItemId"] ?? "");
  if (canonicalItemId === duplicateItemId) {
    return { success: false, error: "same_item", message: "Cannot merge an item into itself." };
  }
  const [canonical, duplicate] = await Promise.all([
    prisma.backlogItem.findUnique({ where: { itemId: canonicalItemId }, select: { id: true, occurrenceCount: true } }),
    prisma.backlogItem.findUnique({ where: { itemId: duplicateItemId }, select: { id: true, occurrenceCount: true, status: true } }),
  ]);
  if (!canonical) return { success: false, error: "not_found", message: `Canonical ${canonicalItemId} not found` };
  if (!duplicate) return { success: false, error: "not_found", message: `Duplicate ${duplicateItemId} not found` };
  const { computeMerge } = await import("@/lib/demand/dedup");
  const { mergedOccurrenceCount } = computeMerge({
    survivorOccurrenceCount: canonical.occurrenceCount,
    duplicateOccurrenceCount: duplicate.occurrenceCount,
  });
  await prisma.$transaction([
    prisma.backlogItem.update({
      where: { itemId: canonicalItemId },
      data: { occurrenceCount: mergedOccurrenceCount, lastSeenAt: new Date() },
    }),
    prisma.backlogItem.update({
      where: { itemId: duplicateItemId },
      data: { status: "deferred", triageOutcome: "duplicate", duplicateOfId: canonical.id },
    }),
  ]);
  return {
    success: true,
    entityId: canonicalItemId,
    message: `Merged ${duplicateItemId} into ${canonicalItemId}; reach now ${mergedOccurrenceCount}.`,
    data: { canonicalItemId, duplicateItemId, mergedOccurrenceCount },
  };
}

export async function sweepDuplicateDemandHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const threshold = typeof params["threshold"] === "number" ? (params["threshold"] as number) : 0.6;
  const limit = typeof params["limit"] === "number" ? Math.max(1, Math.min(100, params["limit"] as number)) : 25;
  const portfolioId = typeof params["portfolioId"] === "string" ? (params["portfolioId"] as string) : undefined;
  const items = await prisma.backlogItem.findMany({
    where: {
      status: { notIn: ["done", "deferred"] },
      ...(portfolioId ? { portfolioId } : {}),
    },
    select: { itemId: true, title: true, body: true },
    take: 500,
  });
  const { findDuplicatePairs } = await import("@/lib/demand/dedup");
  const pairs = findDuplicatePairs(items, threshold).slice(0, limit);
  return {
    success: true,
    message:
      pairs.length > 0
        ? `${pairs.length} likely-duplicate pair(s) across ${items.length} open item(s).`
        : `No pairs above similarity ${threshold} across ${items.length} open item(s).`,
    data: { pairs, scanned: items.length },
  };
}

export async function approveDemandForFundingHandler(
  params: Record<string, unknown>,
  userId: string,
  context?: { routeContext?: string; agentId?: string; threadId?: string; callerClient?: string; apiTokenId?: string; authSource?: string },
): Promise<ToolResult> {
  const itemId = String(params["itemId"] ?? "");
  const item = await prisma.backlogItem.findUnique({
    where: { itemId },
    select: {
      id: true,
      itemId: true,
      title: true,
      organizationId: true,
      demandScore: true,
      demandStage: true,
      investmentBucket: true,
      effortSize: true,
      agentId: true,
      claimStatus: true,
    },
  });
  if (!item) return { success: false, error: "not_found", message: `Item ${itemId} not found` };
  const {
    loadDemandActivation,
    transitionDemandItem,
  } = await import("@/lib/demand/transition-repository");
  const { evaluateDemandTransition } = await import("@/lib/demand/activation");
  const activation = await loadDemandActivation(
    prisma as unknown as DemandTransitionDb,
    itemId,
  );
  if (!activation) {
    return { success: false, error: "not_found", message: `Item ${itemId} not found` };
  }
  const readiness = evaluateDemandTransition(activation.input, "ready");
  if (
    readiness.allowed ||
    readiness.code !== "funding-decision-required"
  ) {
    return {
      success: false,
      error: readiness.allowed ? "invalid_state" : readiness.code,
      message: readiness.allowed
        ? "Funding readiness could not be established."
        : readiness.message,
    };
  }
  if (!item.organizationId) {
    return {
      success: false,
      error: "organization_required",
      message:
        "Classify this demand to an organization before requesting funding.",
    };
  }

  const { evaluateOrgBusinessDecisionGate } = await import("@/lib/decision-perspective/org-business-gate");
  const rationale = typeof params["rationale"] === "string" ? (params["rationale"] as string).trim() : "";
  const decision = await evaluateOrgBusinessDecisionGate({
    db: prisma,
    organizationId: item.organizationId,
    question:
      `Should we fund "${item.title}" (demand score ${item.demandScore}, ${item.investmentBucket ?? "unclassified"} bucket) for build now?` +
      (rationale ? ` Rationale: ${rationale}` : ""),
    options: ["fund now", "defer"],
    domainClass: "risk-assessment",
    riskTier: fundingRiskTier(item.investmentBucket, item.effortSize),
    routeContext: context?.routeContext ?? "/ops/demand",
    triggeredByUserId: userId,
    caller: {
      client: context?.callerClient ?? null,
      apiTokenId: context?.apiTokenId ?? null,
      authSource: context?.authSource ?? null,
      agentId: context?.agentId ?? null,
      threadId: context?.threadId ?? null,
    },
  });

  // Only advance to `ready` (funded) when the org's stance recommends/arbitrates.
  const funded = decision.allowed;
  let volunteered: { offered: boolean; agentId: string | null } = { offered: false, agentId: null };
  if (funded) {
    const transition = await transitionDemandItem(
      prisma as unknown as DemandTransitionDb,
      {
        itemId,
        to: "ready",
        rationale,
        fundingDecisionAllowed: true,
        recordedByUserId: userId,
        recordedByAgentId: context?.agentId ?? null,
      },
    );
    if (!transition.ok) {
      return {
        success: false,
        error: transition.code,
        message: transition.message,
      };
    }
    // AI-led execution (EP-DELIVERY-FLOW BI-A6648529): crossing the bet pulls a
    // coworker forward. Kernel decision (high conf) = ask-first — raise a
    // coworker-pickup offer for a human to approve, not an autonomous claim.
    // Best-effort: the funding decision stands even if the offer can't be recorded.
    try {
      const { offerFundedItemToCoworker } = await import("@/lib/demand/volunteering.server");
      volunteered = await offerFundedItemToCoworker(item);
    } catch {
      // non-fatal
    }
    // Shadow-measure what an autonomous auto-claim WOULD do (kernel: shadow_first)
    // — resolves the coworker's autonomy envelope and records it against the
    // ask-first act, building graduation evidence without acting on it. Its own
    // try so the measurement records even if the offer above failed.
    try {
      const { recordVolunteeringAutonomyShadow } = await import("@/lib/demand/volunteering.server");
      await recordVolunteeringAutonomyShadow(item);
    } catch {
      // non-fatal
    }
  }
  await prisma.backlogItemActivity.create({
    data: {
      backlogItemId: item.id,
      kind: "demand_funding_decision",
      summary: funded ? "Funding approved" : "Funding not approved",
      payload: {
        funded,
        rationale: rationale || null,
        interactionId: decision.interactionId,
        outcomeType: decision.evaluation.outcomeType,
        orgProfileSelected: decision.orgProfileSelected,
        demandScore: item.demandScore,
        investmentBucket: item.investmentBucket,
      },
      recordedById: userId,
      recordedByAgentId: context?.agentId ?? null,
    },
  });
  await queueProductManagementPlaybookRefreshForBacklogItem({
    itemId: item.itemId,
    sourceId: decision.interactionId,
    changedAt: new Date(),
  });
  const volunteerNote = volunteered.offered ? ` ${volunteered.agentId} volunteered — approve the pickup.` : "";
  return {
    success: true,
    entityId: item.itemId,
    message: funded
      ? `Funded ${item.itemId} → ready. ${decision.operatorMessage}${volunteerNote}`
      : `Not funded (${decision.evaluation.outcomeType}); stays at ${item.demandStage ?? "unclassified"}. ${decision.operatorMessage}`,
    data: {
      funded,
      demandStage: funded ? "ready" : item.demandStage,
      volunteered: volunteered.offered,
      volunteeredAgentId: volunteered.agentId,
      interactionId: decision.interactionId,
      outcomeType: decision.evaluation.outcomeType,
      orgProfileSelected: decision.orgProfileSelected,
    },
  };
}

export async function runCapacityDrainHandler(params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  const dryRun = params["dryRun"] !== false; // default true (report only)
  const { evaluateAndDrainCapacity } = await import("@/lib/capacity/evaluate-drain");
  const r = await evaluateAndDrainCapacity({ prisma, userId, dryRun });
  const suffix = r.drained
    ? ` — dispatched ${r.dispatched} build(s)`
    : dryRun && r.decision.drain
      ? " (would dispatch; dry run)"
      : "";
  return { success: true, message: `${r.decision.reason}${suffix}`, data: r };
}
