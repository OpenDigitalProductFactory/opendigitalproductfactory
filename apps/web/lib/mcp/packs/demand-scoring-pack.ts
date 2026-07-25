// Demand-scoring tool pack (EP-DEMAND-MGMT).
//
// Exposes demand management's value/effort scoring as an MCP tool: set the
// scoring INPUTS on a backlog item and (re)compute its demandScore under a
// pluggable framework, advancing the demand funnel. The score itself lives in
// the pure engine apps/web/lib/demand/scoring.ts; this pack is the governed
// write door. Grant mirrors tak/agent-grants.ts TOOL_TO_GRANTS (the gating
// source); tool-registry.test asserts no drift.

import { prisma } from "@dpf/db";
import { DEMAND_SCORE_FRAMEWORKS, DEMAND_STAGE_VALUES, INVESTMENT_BUCKET_VALUES } from "@/lib/explore/backlog";
import type { DemandScoreFramework } from "@/lib/explore/backlog";
import type { DemandScoreInputs, DemandScoreResult } from "@/lib/demand/scoring";
import { resolveEstimateProvenance } from "@/lib/demand/estimate-provenance";
import { fundingRiskTier } from "@/lib/demand/funding-risk";
import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "score_demand_item",
    description:
      "Set demand-scoring inputs on a backlog item and (re)compute its demandScore under a pluggable framework. Store the INPUTS; the score is derived. reach falls back to occurrenceCount and jobSize to the t-shirt effortSize when the explicit field is omitted. When the minimum inputs for the framework are present the item advances demandStage from raw to screened. Framework defaults to rice.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string", description: "The item ID to score" },
        framework: { type: "string", enum: [...DEMAND_SCORE_FRAMEWORKS], description: "Scoring framework. Defaults to rice (the seeded default). rice=(reach*impact*confidence)/jobSize; wsjf=(businessValue+timeCriticality+riskOpportunity)/jobSize; value_effort=value/jobSize; weighted=weighted sum." },
        reach: { type: "integer", description: "RICE reach — users/instances affected per period. Falls back to occurrenceCount." },
        impact: { type: "number", description: "RICE impact / value magnitude (e.g. 3=massive,2=high,1=medium,0.5=low,0.25=minimal)." },
        confidence: { type: "number", description: "RICE confidence as a fraction (1.0 high, 0.8 medium, 0.5 low)." },
        businessValue: { type: "integer", description: "WSJF Cost-of-Delay term — relative business value." },
        timeCriticality: { type: "integer", description: "WSJF Cost-of-Delay term — relative time criticality." },
        riskOpportunity: { type: "integer", description: "WSJF Cost-of-Delay term — relative risk reduction / opportunity enablement." },
        jobSize: { type: "number", description: "Effort denominator (relative points). Falls back to the effortSize t-shirt map (small=1,medium=3,large=8,xlarge=20)." },
        demandStage: { type: "string", enum: [...DEMAND_STAGE_VALUES], description: "Optional explicit funnel stage override (raw|screened|shaped|ready). Normally derived." },
        investmentBucket: { type: "string", enum: [...INVESTMENT_BUCKET_VALUES], description: "Optional investment bucket (run|grow|transform). Auto-derived from workType when omitted (bug/chore/refactor=run, feature=grow)." },
      },
      required: ["itemId"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
  {
    name: "record_effort_estimate",
    description:
      "Record an attributed effort estimate — the value/effort score's denominator (jobSize) — for a backlog item and (re)compute its demandScore. by=ai captures an AI coworker's first-pass proposal; by=human sets or overrules it, and agree=true confirms the current AI estimate (marking the score reconciled). When the AI and human numbers differ the item surfaces as diverged for a human to reconcile; the human number leads when both exist, and the resolved estimate feeds demandScore. EP-DELIVERY-FLOW collaborative estimation.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string", description: "The item to estimate." },
        by: { type: "string", enum: ["ai", "human"], description: "Whose estimate this is: an AI coworker's proposal (ai) or a human's (human)." },
        jobSize: { type: "number", description: "Effort points (the RICE/WSJF denominator). Required for an AI estimate; for a human, required unless agree=true adopts the current AI estimate." },
        agentId: { type: "string", description: "For by=ai: the coworker/agent id that proposed the estimate (attribution)." },
        agree: { type: "boolean", description: "For by=human: confirm the current AI estimate — marks the score reconciled/trustworthy and adopts the AI number when jobSize is omitted." },
      },
      required: ["itemId", "by"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
  {
    name: "set_demand_policy",
    description:
      "Set the operator-owned demand-management policy: the active scoring framework and/or the investment-bucket target allocation. Without portfolioId this sets the org-wide default; with portfolioId it sets that portfolio's own targets (which the balance view uses in preference to the default). The demand engine and board read this instead of the built-in defaults. Every change is audited. Omitted fields are left unchanged.",
    inputSchema: {
      type: "object",
      properties: {
        framework: { type: "string", enum: [...DEMAND_SCORE_FRAMEWORKS], description: "Active scoring framework (rice|wsjf|value_effort|weighted). Org-wide; the default applied when an item is scored without an explicit framework. Ignored when portfolioId is given." },
        bucketTargets: {
          type: "object",
          description: "Investment allocation as percentages, e.g. { run: 70, grow: 20, transform: 10 }. Partial objects merge over the current values.",
          properties: {
            run: { type: "number" },
            grow: { type: "number" },
            transform: { type: "number" },
          },
        },
        portfolioId: { type: "string", description: "Optional portfolio slug or id. When set, bucketTargets apply to that portfolio only (not the org-wide default)." },
      },
      required: [],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
  {
    name: "set_backlog_delivery_budget",
    description:
      "View or set the operator-owned backlog delivery budget: how many backlog items the governed daily tee-up (and on-demand process_backlog_for_build_studio) is funded to promote into Build Studio per day, plus whether governed promotion is enabled at all. Called with no fields, it's a read: returns the current budget alongside live parallelism context. A bigger budget only affects INTAKE — it does not raise how many builds can execute at once (Build Studio's shared sandbox is hard-capped, separately, at BUILD_WIP_CAP=3; see buildWipCap/activeBuilds in the response). Every change is audited.",
    inputSchema: {
      type: "object",
      properties: {
        dailyBudget: {
          type: "integer",
          description: "Items/day funded for governed backlog→build promotion (0-50). Omit to leave unchanged (or, with enabled also omitted, to just read current state).",
        },
        enabled: {
          type: "boolean",
          description: "Turn governed backlog promotion on/off entirely (governedBacklogEnabled). Omit to leave unchanged.",
        },
      },
      required: [],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
  {
    name: "find_duplicate_candidates",
    description:
      "Find open backlog items that look like near-duplicates of a given item (by title/body similarity), so demand can be merged instead of fragmenting reach across duplicates. Read-only — returns ranked candidates; use merge_backlog_items to actually merge.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string", description: "The item to find duplicates of." },
        threshold: { type: "number", description: "Similarity cutoff 0..1 (default 0.5). Higher = stricter." },
        limit: { type: "number", description: "Max candidates to return (default 10)." },
      },
      required: ["itemId"],
    },
    requiredCapability: "view_operations",
    sideEffect: false,
  },
  {
    name: "merge_backlog_items",
    description:
      "Merge a duplicate backlog item into a canonical one: the duplicate's reach (occurrenceCount) is added to the canonical item so signal concentrates rather than fragments, and the duplicate is retired (status=deferred, duplicateOfId set to the canonical item). Audited.",
    inputSchema: {
      type: "object",
      properties: {
        canonicalItemId: { type: "string", description: "The surviving item that absorbs the duplicate." },
        duplicateItemId: { type: "string", description: "The item to retire into the canonical one." },
        rationale: { type: "string", description: "Short reason for the merge." },
      },
      required: ["canonicalItemId", "duplicateItemId"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
  {
    name: "run_capacity_drain",
    description:
      "Evaluate the use-it-or-lose-it capacity policy: near the weekly pre-paid LLM allocation reset, with a healthy pool and free build slots, dispatch the top demand-ranked ready work so allocation isn't wasted. dryRun=true (default) reports the decision without dispatching; dryRun=false actually dispatches (bounded by the WIP cap). Off unless capacityDrainEnabled.",
    inputSchema: {
      type: "object",
      properties: {
        dryRun: { type: "boolean", description: "true (default) = report the decision only; false = actually dispatch up to the WIP headroom." },
      },
      required: [],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
  {
    name: "sweep_duplicate_demand",
    description:
      "Scan the open backlog for likely-duplicate pairs (by title/body similarity) so recurring demand can be merged and reach concentrated. Read-only — returns ranked pairs across the whole open set; use merge_backlog_items to act on them. A safe on-demand alternative to auto-deduping at intake.",
    inputSchema: {
      type: "object",
      properties: {
        threshold: { type: "number", description: "Similarity cutoff 0..1 (default 0.6). Higher = stricter." },
        limit: { type: "number", description: "Max pairs to return (default 25)." },
        portfolioId: { type: "string", description: "Optional: restrict the sweep to one portfolio." },
      },
      required: [],
    },
    requiredCapability: "view_operations",
    sideEffect: false,
  },
  {
    name: "approve_demand_for_funding",
    description:
      "Route a scored demand item's funding decision through the organization's own WWWD stance (governed, audited) and, if approved, advance it to the 'ready' funnel stage so it can be promoted to build. This is the investment-approval gate: the decision is recorded to the decision ledger and surfaces in the decision-review workspace. When the org's stance escalates or defers, the item stays at its current stage for a human call.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string", description: "The scored demand item to consider funding (must have a demandScore)." },
        rationale: { type: "string", description: "Optional short reason recorded with the funding decision." },
      },
      required: ["itemId"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
];

/** The BacklogItem fields the score/funnel derivation reads. */
type ScorableItem = {
  demandStage: string | null;
  investmentBucket: string | null;
  workType: string | null;
};

/**
 * Shared: resolve the active framework, compute the demandScore under it, and
 * derive the funnel-stage + investment-bucket advance — returning the prisma
 * `data` patch that both score_demand_item and record_effort_estimate persist.
 * The scoring INPUTS in `inputs` (reach…jobSize) are written back; occurrenceCount
 * and effortSize are read-only fallbacks and are not part of the patch.
 */
async function buildScorePatch(
  item: ScorableItem,
  inputs: DemandScoreInputs,
  opts: { framework?: unknown; demandStage?: unknown; investmentBucket?: unknown } = {},
): Promise<{
  patch: Record<string, unknown>;
  result: DemandScoreResult;
  framework: DemandScoreFramework;
  nextStage: string;
}> {
  const { computeDemandScore } = await import("@/lib/demand/scoring");
  // Framework: explicit param wins; otherwise the operator-owned demand policy
  // (PlatformDevConfig), falling back to the built-in default.
  const { resolveDemandPolicy } = await import("@/lib/demand/policy");
  const policyConfig = await prisma.platformDevConfig.findUnique({
    where: { id: "singleton" },
    select: { demandFramework: true, demandBucketTargets: true },
  });
  const policyFramework = resolveDemandPolicy(policyConfig).framework;
  const f = typeof opts.framework === "string" ? String(opts.framework) : policyFramework;
  const framework = (DEMAND_SCORE_FRAMEWORKS as readonly string[]).includes(f)
    ? (f as DemandScoreFramework)
    : policyFramework;
  const result = computeDemandScore(inputs, framework);
  // Advance the funnel: a scored item is at least `screened`. Respect an
  // explicit stage override and never regress a manually-advanced stage.
  const stageOrder = DEMAND_STAGE_VALUES as readonly string[];
  const explicitStage = stageOrder.includes(String(opts.demandStage))
    ? (opts.demandStage as (typeof DEMAND_STAGE_VALUES)[number])
    : null;
  const derivedStage = result.score !== null ? "screened" : item.demandStage ?? "raw";
  const currentIdx = item.demandStage ? stageOrder.indexOf(item.demandStage) : -1;
  const derivedIdx = stageOrder.indexOf(derivedStage);
  const nextStage = explicitStage ?? (derivedIdx > currentIdx ? derivedStage : item.demandStage ?? derivedStage);
  // Investment bucket: explicit override, else keep what's set, else derive from
  // work-type (bug/chore/refactor=run, feature=grow, else unclassified).
  const { deriveBucket } = await import("@/lib/demand/buckets");
  const explicitBucket = (INVESTMENT_BUCKET_VALUES as readonly string[]).includes(String(opts.investmentBucket))
    ? (opts.investmentBucket as (typeof INVESTMENT_BUCKET_VALUES)[number])
    : null;
  const nextBucket = explicitBucket ?? item.investmentBucket ?? deriveBucket(item.workType);
  const patch: Record<string, unknown> = {
    reach: inputs.reach ?? null,
    impact: inputs.impact ?? null,
    confidence: inputs.confidence ?? null,
    businessValue: inputs.businessValue ?? null,
    timeCriticality: inputs.timeCriticality ?? null,
    riskOpportunity: inputs.riskOpportunity ?? null,
    jobSize: inputs.jobSize ?? null,
    demandScore: result.score,
    demandScoreFramework: framework,
    demandScoreComputedAt: new Date(),
    demandStage: nextStage,
    investmentBucket: nextBucket,
  };
  return { patch, result, framework, nextStage };
}

async function scoreDemandItemHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const itemId = String(params["itemId"] ?? "");
  const item = await prisma.backlogItem.findUnique({ where: { itemId } });
  if (!item) {
    return { success: false, error: "not_found", message: `Item ${itemId} not found` };
  }
  const numOrKeep = (key: string, current: number | null): number | null =>
    typeof params[key] === "number" ? (params[key] as number) : current;
  // Merge supplied inputs over what's already stored (partial updates).
  const inputs: DemandScoreInputs = {
    reach: numOrKeep("reach", item.reach),
    impact: numOrKeep("impact", item.impact),
    confidence: numOrKeep("confidence", item.confidence),
    businessValue: numOrKeep("businessValue", item.businessValue),
    timeCriticality: numOrKeep("timeCriticality", item.timeCriticality),
    riskOpportunity: numOrKeep("riskOpportunity", item.riskOpportunity),
    jobSize: numOrKeep("jobSize", item.jobSize),
    occurrenceCount: item.occurrenceCount,
    effortSize: item.effortSize,
  };
  const { patch, result, framework, nextStage } = await buildScorePatch(item, inputs, {
    framework: params["framework"],
    demandStage: params["demandStage"],
    investmentBucket: params["investmentBucket"],
  });
  await prisma.backlogItem.update({ where: { itemId }, data: patch });
  return {
    success: true,
    entityId: itemId,
    message:
      result.score !== null
        ? `Scored ${itemId}: ${framework} = ${result.score} (stage ${nextStage})`
        : `Recorded inputs for ${itemId}; ${framework} not computable — missing ${result.missing.join(", ")}`,
    data: {
      demandScore: result.score,
      framework,
      demandStage: nextStage,
      contributions: result.contributions,
      missing: result.missing,
    },
  };
}

async function recordEffortEstimateHandler(
  params: Record<string, unknown>,
  userId: string,
): Promise<ToolResult> {
  const itemId = String(params["itemId"] ?? "");
  const by = String(params["by"] ?? "");
  if (by !== "ai" && by !== "human") {
    return { success: false, error: "invalid_input", message: '`by` must be "ai" or "human".' };
  }
  const item = await prisma.backlogItem.findUnique({ where: { itemId } });
  if (!item) {
    return { success: false, error: "not_found", message: `Item ${itemId} not found` };
  }

  const agree = params["agree"] === true;
  const explicitJobSize =
    typeof params["jobSize"] === "number" && Number.isFinite(params["jobSize"]) && (params["jobSize"] as number) > 0
      ? (params["jobSize"] as number)
      : null;

  // Start from the item's current provenance, then apply this attributed edit.
  let estimateAiJobSize = item.estimateAiJobSize;
  let estimateAiById = item.estimateAiById;
  let estimateAiAt = item.estimateAiAt;
  let estimateHumanJobSize = item.estimateHumanJobSize;
  let estimateHumanById = item.estimateHumanById;
  let estimateHumanAt = item.estimateHumanAt;
  let agreedFlag: boolean | null = item.estimateAgreed;
  const now = new Date();

  if (by === "ai") {
    if (explicitJobSize === null) {
      return { success: false, error: "invalid_input", message: "An AI estimate requires a positive numeric jobSize." };
    }
    estimateAiJobSize = explicitJobSize;
    estimateAiById = typeof params["agentId"] === "string" ? (params["agentId"] as string) : item.estimateAiById;
    estimateAiAt = now;
    // A fresh AI proposal re-opens (or closes) reconcile against any human number.
    if (estimateHumanJobSize !== null) agreedFlag = estimateHumanJobSize === explicitJobSize;
  } else {
    // human: adopt the AI number on agree, else set/overrule with an explicit one.
    const humanVal = explicitJobSize ?? (agree ? item.estimateAiJobSize : null);
    if (humanVal === null) {
      return {
        success: false,
        error: "invalid_input",
        message: "A human estimate requires a positive numeric jobSize (or agree=true to adopt the current AI estimate).",
      };
    }
    estimateHumanJobSize = humanVal;
    estimateHumanById = userId || item.estimateHumanById;
    estimateHumanAt = now;
    // Reconciled when the human confirms, or their number matches the AI's.
    agreedFlag = agree || (estimateAiJobSize !== null && estimateAiJobSize === humanVal);
  }

  const provenance = resolveEstimateProvenance({
    aiJobSize: estimateAiJobSize,
    humanJobSize: estimateHumanJobSize,
    agreed: agreedFlag,
  });

  // Recompute the score with the resolved effective estimate mirrored into jobSize.
  const inputs: DemandScoreInputs = {
    reach: item.reach,
    impact: item.impact,
    confidence: item.confidence,
    businessValue: item.businessValue,
    timeCriticality: item.timeCriticality,
    riskOpportunity: item.riskOpportunity,
    jobSize: provenance.effectiveJobSize,
    occurrenceCount: item.occurrenceCount,
    effortSize: item.effortSize,
  };
  const { patch, result, framework, nextStage } = await buildScorePatch(item, inputs);

  await prisma.backlogItem.update({
    where: { itemId },
    data: {
      ...patch,
      estimateAiJobSize,
      estimateAiById,
      estimateAiAt,
      estimateHumanJobSize,
      estimateHumanById,
      estimateHumanAt,
      estimateSource: provenance.source,
      estimateAgreed: provenance.agreed,
    },
  });

  const divergeNote = provenance.diverged
    ? ` ⇄ AI ${estimateAiJobSize} ↔ human ${estimateHumanJobSize} — reconcile.`
    : "";
  const scoreNote =
    result.score !== null
      ? ` ${framework} score ${result.score} (stage ${nextStage}).`
      : ` ${framework} not computable — missing ${result.missing.join(", ")}.`;
  return {
    success: true,
    entityId: itemId,
    message:
      `Recorded ${by} effort estimate for ${itemId}: effective ${provenance.effectiveJobSize} (${provenance.source}).` +
      scoreNote +
      divergeNote,
    data: {
      effectiveJobSize: provenance.effectiveJobSize,
      estimateSource: provenance.source,
      agreed: provenance.agreed,
      diverged: provenance.diverged,
      estimateAiJobSize,
      estimateHumanJobSize,
      demandScore: result.score,
      demandStage: nextStage,
    },
  };
}

/** Merge a partial {run,grow,transform} object over a stored one, validating numbers. */
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

async function setDemandPolicyHandler(params: Record<string, unknown>): Promise<ToolResult> {
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
async function setBacklogDeliveryBudgetHandler(params: Record<string, unknown>): Promise<ToolResult> {
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

async function findDuplicateCandidatesHandler(params: Record<string, unknown>): Promise<ToolResult> {
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

async function mergeBacklogItemsHandler(params: Record<string, unknown>): Promise<ToolResult> {
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

async function sweepDuplicateDemandHandler(params: Record<string, unknown>): Promise<ToolResult> {
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

async function approveDemandForFundingHandler(
  params: Record<string, unknown>,
  userId: string,
  context?: { routeContext?: string; agentId?: string; threadId?: string; callerClient?: string; apiTokenId?: string; authSource?: string },
): Promise<ToolResult> {
  const itemId = String(params["itemId"] ?? "");
  const item = await prisma.backlogItem.findUnique({
    where: { itemId },
    select: { id: true, itemId: true, title: true, demandScore: true, demandStage: true, investmentBucket: true, effortSize: true, agentId: true, claimStatus: true },
  });
  if (!item) return { success: false, error: "not_found", message: `Item ${itemId} not found` };
  if (item.demandScore === null) {
    return { success: false, error: "unscored", message: `Score ${itemId} first (score_demand_item) before a funding decision.` };
  }
  const org = await prisma.organization.findFirst({ select: { id: true } });
  if (!org) return { success: false, error: "no_org", message: "No organization is configured for this install." };

  const { evaluateOrgBusinessDecisionGate } = await import("@/lib/decision-perspective/org-business-gate");
  const rationale = typeof params["rationale"] === "string" ? (params["rationale"] as string).trim() : "";
  const decision = await evaluateOrgBusinessDecisionGate({
    db: prisma,
    organizationId: org.id,
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
    await prisma.backlogItem.update({ where: { id: item.id }, data: { demandStage: "ready" } });
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
  const volunteerNote = volunteered.offered ? ` ${volunteered.agentId} volunteered — approve the pickup.` : "";
  return {
    success: true,
    entityId: item.itemId,
    message: funded
      ? `Funded ${item.itemId} → ready. ${decision.operatorMessage}${volunteerNote}`
      : `Not funded (${decision.evaluation.outcomeType}); stays at ${item.demandStage ?? "raw"}. ${decision.operatorMessage}`,
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

async function runCapacityDrainHandler(params: Record<string, unknown>, userId: string): Promise<ToolResult> {
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

export const demandScoringPack: ToolPack = {
  packId: "demand-scoring",
  definitions,
  handlers: {
    score_demand_item: (params) => scoreDemandItemHandler(params),
    record_effort_estimate: (params, userId) => recordEffortEstimateHandler(params, userId),
    set_demand_policy: (params) => setDemandPolicyHandler(params),
    set_backlog_delivery_budget: (params) => setBacklogDeliveryBudgetHandler(params),
    find_duplicate_candidates: (params) => findDuplicateCandidatesHandler(params),
    merge_backlog_items: (params) => mergeBacklogItemsHandler(params),
    sweep_duplicate_demand: (params) => sweepDuplicateDemandHandler(params),
    approve_demand_for_funding: (params, userId, ctx) => approveDemandForFundingHandler(params, userId, ctx),
    run_capacity_drain: (params, userId) => runCapacityDrainHandler(params, userId),
  },
  grants: {
    score_demand_item: ["backlog_write"],
    record_effort_estimate: ["backlog_write"],
    set_demand_policy: ["backlog_write"],
    set_backlog_delivery_budget: ["backlog_write"],
    find_duplicate_candidates: ["backlog_read"],
    merge_backlog_items: ["backlog_write"],
    sweep_duplicate_demand: ["backlog_read"],
    approve_demand_for_funding: ["backlog_write"],
    run_capacity_drain: ["backlog_write"],
  },
};
