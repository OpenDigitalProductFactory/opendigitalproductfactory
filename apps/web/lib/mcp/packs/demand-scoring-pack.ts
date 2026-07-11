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
];

async function scoreDemandItemHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const itemId = String(params["itemId"] ?? "");
  const item = await prisma.backlogItem.findUnique({ where: { itemId } });
  if (!item) {
    return { success: false, error: "not_found", message: `Item ${itemId} not found` };
  }
  const { computeDemandScore } = await import("@/lib/demand/scoring");
  const numOrKeep = (key: string, current: number | null): number | null =>
    typeof params[key] === "number" ? (params[key] as number) : current;
  const f = String(params["framework"] ?? "rice");
  const framework = (DEMAND_SCORE_FRAMEWORKS as readonly string[]).includes(f)
    ? (f as (typeof DEMAND_SCORE_FRAMEWORKS)[number])
    : "rice";
  // Merge supplied inputs over what's already stored (partial updates).
  const inputs = {
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
  const result = computeDemandScore(inputs, framework);
  // Advance the funnel: a scored item is at least `screened`. Respect an
  // explicit stage override and never regress a manually-advanced stage.
  const stageOrder = DEMAND_STAGE_VALUES as readonly string[];
  const explicitStage = stageOrder.includes(String(params["demandStage"]))
    ? (params["demandStage"] as (typeof DEMAND_STAGE_VALUES)[number])
    : null;
  const derivedStage = result.score !== null ? "screened" : item.demandStage ?? "raw";
  const currentIdx = item.demandStage ? stageOrder.indexOf(item.demandStage) : -1;
  const derivedIdx = stageOrder.indexOf(derivedStage);
  const nextStage = explicitStage ?? (derivedIdx > currentIdx ? derivedStage : item.demandStage ?? derivedStage);
  // Investment bucket: explicit override, else keep what's set, else derive from
  // work-type (bug/chore/refactor=run, feature=grow, else unclassified).
  const { deriveBucket } = await import("@/lib/demand/buckets");
  const explicitBucket = (INVESTMENT_BUCKET_VALUES as readonly string[]).includes(String(params["investmentBucket"]))
    ? (params["investmentBucket"] as (typeof INVESTMENT_BUCKET_VALUES)[number])
    : null;
  const nextBucket = explicitBucket ?? item.investmentBucket ?? deriveBucket(item.workType);
  await prisma.backlogItem.update({
    where: { itemId },
    data: {
      reach: inputs.reach,
      impact: inputs.impact,
      confidence: inputs.confidence,
      businessValue: inputs.businessValue,
      timeCriticality: inputs.timeCriticality,
      riskOpportunity: inputs.riskOpportunity,
      jobSize: inputs.jobSize,
      demandScore: result.score,
      demandScoreFramework: framework,
      demandScoreComputedAt: new Date(),
      demandStage: nextStage,
      investmentBucket: nextBucket,
    },
  });
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

export const demandScoringPack: ToolPack = {
  packId: "demand-scoring",
  definitions,
  handlers: {
    score_demand_item: (params) => scoreDemandItemHandler(params),
  },
  grants: {
    score_demand_item: ["backlog_write"],
  },
};
