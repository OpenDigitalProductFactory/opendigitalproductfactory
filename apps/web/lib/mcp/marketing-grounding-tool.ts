// record_marketing_grounding (BI-06BB96F0) — the missing write path.
//
// Definition and handler live here rather than in marketing-ops-pack.ts because
// that pack sits at 787 of its 800-line ceiling, and beside the other
// lib/mcp/*-handler(s).ts modules rather than under packs/ so the tool-surface
// pack count keeps measuring packs (see BI-C26FE785 for the same call).
//
// The tool exists because MarketingStrategy's grounding fields had no writer:
// the strategist-review path updates seven fields and none of these, so
// targetSegments / idealCustomerProfiles / proofAssets were bootstrap-only and
// permanently empty on installs that never had them derived. draft-builder.ts
// reads all three.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";

export const recordMarketingGroundingDefinition: ToolDefinition = {
  name: "record_marketing_grounding",
  description:
    "Record the durable business facts a marketing plan stands on: who this organization serves (target segments and ideal customer profiles), what proof it can point to, what makes it different, and what constrains it. Use this after the operator answers questions about their audience — NOT for a recommendation, which is save_marketing_review. Only supplied fields are written, so an interview can be captured across several turns without a later round blanking an earlier one.",
  inputSchema: {
    type: "object",
    properties: {
      primaryGoal: { type: "string", description: "What this organization is trying to achieve through marketing, in the operator's own words" },
      geographicScope: { type: "string", description: "Where it operates, for example a city, county or radius" },
      seasonalityNotes: { type: "string", description: "Seasonal patterns that change demand or capacity" },
      targetSegments: {
        type: "array",
        description: "The groups this organization serves. Use the archetype's own vocabulary — adopters, donors, volunteers, patients — not a generic 'customers'.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Segment name" },
            description: { type: "string", description: "Who they are and what they need" },
          },
          required: ["name"],
        },
      },
      idealCustomerProfiles: {
        type: "array",
        description: "Fuller profiles for the most important segments, with traits and the pains they feel.",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            traits: { type: "array", items: { type: "string" } },
            painPoints: { type: "array", items: { type: "string" } },
          },
          required: ["name"],
        },
      },
      proofAssets: {
        type: "array",
        description: "Evidence this organization can point to — testimonials, outcomes, credentials, press.",
        items: {
          type: "object",
          properties: {
            type: { type: "string", description: "Proof asset type" },
            label: { type: "string", description: "Short human label" },
            url: { type: "string", description: "Where it lives, if anywhere" },
          },
          required: ["type", "label"],
        },
      },
      differentiators: {
        type: "array",
        description: "What this organization does that comparable ones do not.",
        items: { type: "string" },
      },
      constraints: {
        type: "object",
        description: "What limits marketing: compliance rules, geography, capacity.",
        properties: {
          compliance: { type: "string" },
          geography: { type: "string" },
          capacity: { type: "string" },
        },
      },
    },
    required: [],
  },
  requiredCapability: "operate_marketing",
  sideEffect: true,
  coworkerArtifact: true,
};

export async function recordMarketingGroundingHandler(
  params: Record<string, unknown>,
): Promise<ToolResult> {
  const { recordMarketingGrounding, assessMarketingGrounding } = await import(
    "@/lib/marketing/strategy-grounding"
  );
  const { prisma } = await import("@dpf/db");

  const strategy = await prisma.marketingStrategy.findFirst({
    select: {
      strategyId: true,
      targetSegments: true,
      idealCustomerProfiles: true,
      proofAssets: true,
      lastReviewedAt: true,
      sourceSummary: true,
    },
  });
  if (!strategy) {
    return {
      success: false,
      message: "No marketing strategy exists yet for this organization.",
      error: "no_strategy",
    };
  }

  const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

  const result = await recordMarketingGrounding({
    strategyId: strategy.strategyId,
    grounding: {
      primaryGoal: typeof params["primaryGoal"] === "string" ? params["primaryGoal"] : undefined,
      geographicScope:
        typeof params["geographicScope"] === "string" ? params["geographicScope"] : undefined,
      seasonalityNotes:
        typeof params["seasonalityNotes"] === "string" ? params["seasonalityNotes"] : undefined,
      targetSegments: Array.isArray(params["targetSegments"])
        ? (params["targetSegments"] as never)
        : undefined,
      idealCustomerProfiles: Array.isArray(params["idealCustomerProfiles"])
        ? (params["idealCustomerProfiles"] as never)
        : undefined,
      proofAssets: Array.isArray(params["proofAssets"])
        ? (params["proofAssets"] as never)
        : undefined,
      differentiators: Array.isArray(params["differentiators"])
        ? (params["differentiators"] as string[])
        : undefined,
      constraints:
        params["constraints"] && typeof params["constraints"] === "object"
          ? (params["constraints"] as never)
          : undefined,
    },
  });

  // Re-read so the caller learns what is STILL missing rather than assuming the
  // plan is now grounded because one field landed.
  const after = await prisma.marketingStrategy.findUnique({
    where: { strategyId: strategy.strategyId },
    select: {
      targetSegments: true,
      idealCustomerProfiles: true,
      proofAssets: true,
      lastReviewedAt: true,
      sourceSummary: true,
    },
  });

  const assessment = after
    ? assessMarketingGrounding({
        targetSegments: asArray(after.targetSegments),
        idealCustomerProfiles: asArray(after.idealCustomerProfiles),
        proofAssets: asArray(after.proofAssets),
        lastReviewedAt: after.lastReviewedAt,
        sourceSummary: after.sourceSummary,
      })
    : null;

  const stillMissing =
    assessment && !assessment.grounded
      ? ` Still missing: ${assessment.missing.join(", ")}.`
      : " The plan now has an audience and proof to generate against.";

  return {
    success: true,
    message: `${result.message}${stillMissing}`,
    data: { ...result, grounded: assessment?.grounded ?? false, missing: assessment?.missing ?? [] },
  };
}
