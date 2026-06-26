// Org/WWWD decision tool pack (BI-ARCH-TOOLPACKS).
//
// Exposes the organization business-decision gate as a coworker-callable tool,
// registered in a scoped pack (not the frozen mcp-tools.ts inline switch). The
// handler resolves the single-install organization, routes the decision through
// evaluateOrgBusinessDecisionGate (the org's own WWWD profile, with platform
// doctrine as advisory fallback only), and records it to the DecisionInteraction
// ledger the trust dial reads for agreement. Advisory: it returns a
// recommendation; the human still validates the final action. The grant mirrors
// agent-grants.ts TOOL_TO_GRANTS, which stays the gating source.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "evaluate_org_business_decision",
    description:
      "Weigh a business decision against your organization's own recorded stance (its mission and how-we-decide profile), returning a confidence-scored recommendation and recording the outcome to the decision ledger. Falls back to platform defaults only as advisory when your organization has not recorded a stance for this kind of decision, and escalates to a human when confidence is low or no applicable guidance exists. Use this to ground a business call in what the organization would do, rather than deciding unaided.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "The business decision to weigh, e.g. 'Should we send this customer a free replacement?'" },
        options: { type: "array", items: { type: "string" }, description: "The distinct options under consideration (at least one)." },
        domainClass: {
          type: "string",
          enum: ["plan-readiness", "architecture-tradeoff", "risk-assessment", "professional-practice"],
          description: "Which kind of decision this is.",
        },
        riskTier: {
          type: "string",
          enum: ["low", "medium", "high", "critical"],
          description: "How consequential the decision is; higher tiers require more confidence before a recommendation.",
        },
      },
      required: ["question", "options", "domainClass", "riskTier"],
    },
    requiredCapability: "view_operations",
    executionMode: "immediate",
    sideEffect: false,
  },
];

async function evaluateOrgBusinessDecision(
  params: Record<string, unknown>,
  userId: string,
): Promise<ToolResult> {
  const { evaluateOrgBusinessDecisionGate } = await import("@/lib/decision-perspective/org-business-gate");
  const { DECISION_DOMAIN_CLASSES, DECISION_RISK_TIERS } = await import("@/lib/decision-perspective/types");
  const { prisma } = await import("@dpf/db");

  const org = await prisma.organization.findFirst({ select: { id: true } });
  if (!org) return { success: false, error: "no_org", message: "No organization is configured for this install." };

  const question = String(params["question"] ?? "").trim();
  const options = Array.isArray(params["options"]) ? params["options"].map((o) => String(o)) : [];
  const domainClass = String(params["domainClass"] ?? "");
  const riskTier = String(params["riskTier"] ?? "");
  if (
    !question ||
    options.length === 0 ||
    !(DECISION_DOMAIN_CLASSES as readonly string[]).includes(domainClass) ||
    !(DECISION_RISK_TIERS as readonly string[]).includes(riskTier)
  ) {
    return {
      success: false,
      error: "invalid_params",
      message: "Provide a question, a non-empty options array, a valid domainClass, and a valid riskTier.",
    };
  }

  const decision = await evaluateOrgBusinessDecisionGate({
    db: prisma,
    organizationId: org.id,
    question,
    options,
    domainClass: domainClass as Parameters<typeof evaluateOrgBusinessDecisionGate>[0]["domainClass"],
    riskTier: riskTier as Parameters<typeof evaluateOrgBusinessDecisionGate>[0]["riskTier"],
    routeContext: "/coworker-business",
    triggeredByUserId: userId,
  });

  const rationale = decision.evaluation.rationale;
  return {
    success: true,
    entityId: decision.interactionId,
    message: decision.operatorMessage,
    data: {
      interactionId: decision.interactionId,
      allowed: decision.allowed,
      outcomeType: decision.evaluation.outcomeType,
      confidenceScore: decision.evaluation.confidenceScore,
      orgProfileSelected: decision.orgProfileSelected,
      rationale: rationale.length > 500 ? `${rationale.slice(0, 500)}...` : rationale,
    },
  };
}

export const orgDecisionPack: ToolPack = {
  packId: "org-decision",
  definitions,
  handlers: {
    evaluate_org_business_decision: (params, userId) => evaluateOrgBusinessDecision(params, userId),
  },
  grants: {
    evaluate_org_business_decision: ["work_capsule_read"],
  },
};
