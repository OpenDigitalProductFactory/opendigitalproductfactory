// Profession/WSID decision tool pack (BI-9900B365, EP-8DC217EB BET-0c).
//
// Exposes the profession decision gate as a coworker-callable tool, registered
// in a scoped pack (not the frozen mcp-tools.ts inline switch). The handler
// resolves the CALLING coworker's profession family (registry-driven), routes
// the decision through evaluateProfessionDecisionGate (the coworker's own WSID
// craft profile, with platform doctrine as advisory fallback only), and
// records it to the DecisionInteraction ledger. Advisory: it returns a
// recommendation; consequential actions still pass their own authority gates.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "evaluate_profession_decision",
    description:
      "Weigh a craft or professional-practice decision against your profession's recorded techniques and standards (your role's how-should-I-do-this corpus), returning a confidence-scored recommendation and recording the outcome to the decision ledger. Falls back to platform defaults only as advisory when your profession has no recorded guidance for this kind of decision, and escalates to a human when confidence is low. Use this to ground a technique/approach call in your profession's craft rather than deciding unaided.",
    inputSchema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description:
            "The craft decision to weigh, e.g. 'Should this consolidation land behind a compatibility view or as a hard cutover?'",
        },
        options: {
          type: "array",
          items: { type: "string" },
          description: "The distinct options under consideration (at least one).",
        },
        optionFeatures: {
          type: "array",
          items: { type: "object", additionalProperties: { type: "number" } },
          description:
            "Optional. Per-option feature vectors, index-aligned to `options` (optionFeatures[i] scores options[i]). Each is an axis→score map in [0,1] over the platform decision axes (e.g. speed_to_value, reversibility, blast_radius, human_cognitive_load, governance_compliance, long_term_maintainability). Provide one map per option to receive a real recommendedOptionId scored against kernel commandments; omit entirely for a coverage-based verdict only.",
        },
        domainClass: {
          type: "string",
          enum: ["plan-readiness", "architecture-tradeoff", "risk-assessment", "professional-practice"],
          description: "Which kind of decision this is.",
        },
        riskTier: {
          type: "string",
          enum: ["low", "medium", "high", "critical"],
          description:
            "How consequential the decision is; higher tiers require more confidence before a recommendation.",
        },
      },
      required: ["question", "options", "domainClass", "riskTier"],
    },
    requiredCapability: "view_operations",
    executionMode: "immediate",
    sideEffect: false,
  },
];

type PackCallerContext = {
  routeContext?: string;
  threadId?: string;
  agentId?: string;
  callerClient?: string;
  apiTokenId?: string;
  authSource?: string;
};

async function evaluateProfessionDecision(
  params: Record<string, unknown>,
  userId: string,
  context?: PackCallerContext,
): Promise<ToolResult> {
  const { evaluateProfessionDecisionGate } = await import(
    "@/lib/decision-perspective/profession-gate"
  );
  const { DECISION_DOMAIN_CLASSES, DECISION_RISK_TIERS } = await import(
    "@/lib/decision-perspective/types"
  );
  const { parseOptionFeatures } = await import("@/lib/decision-perspective/scored-option-input");
  const { prisma } = await import("@dpf/db");

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

  const parsedFeatures = parseOptionFeatures(options, params["optionFeatures"]);
  if (!parsedFeatures.ok) {
    return { success: false, error: "invalid_params", message: parsedFeatures.message };
  }

  if (!context?.agentId) {
    return {
      success: false,
      error: "no_agent_identity",
      message:
        "A profession decision is scoped to the calling coworker, but no agent identity reached the tool. Route the call through a coworker session.",
    };
  }

  const agent = await prisma.agent.findFirst({
    where: { OR: [{ agentId: context.agentId }, { slugId: context.agentId }] },
    select: { agentId: true, name: true, slugId: true },
  });

  const decision = await evaluateProfessionDecisionGate({
    db: prisma,
    agentIdentity: {
      agentId: agent?.agentId ?? context.agentId,
      agentName: agent?.name ?? null,
      slugId: agent?.slugId ?? context.agentId,
    },
    question,
    options,
    scoredOptions: parsedFeatures.scoredOptions,
    domainClass: domainClass as Parameters<typeof evaluateProfessionDecisionGate>[0]["domainClass"],
    riskTier: riskTier as Parameters<typeof evaluateProfessionDecisionGate>[0]["riskTier"],
    routeContext: context?.routeContext ?? "/coworker",
    triggeredByUserId: userId,
    caller: {
      client: context?.callerClient ?? null,
      apiTokenId: context?.apiTokenId ?? null,
      authSource: context?.authSource ?? null,
      agentId: context?.agentId ?? null,
      threadId: context?.threadId ?? null,
    },
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
      professionKey: decision.professionKey,
      professionProfileSelected: decision.professionProfileSelected,
      recommendedOptionId: decision.evaluation.recommendedOptionId ?? null,
      rationale: rationale.length > 500 ? `${rationale.slice(0, 500)}...` : rationale,
    },
  };
}

export const professionDecisionPack: ToolPack = {
  packId: "profession-decision",
  definitions,
  handlers: {
    evaluate_profession_decision: (params, userId, context) =>
      evaluateProfessionDecision(params, userId, context),
  },
  // Mirrors agent-grants.ts TOOL_TO_GRANTS, which stays the gating source;
  // tool-registry.test.ts asserts the two never drift. Advertising
  // `work_capsule_read` here while TOOL_TO_GRANTS held no entry at all is how
  // BI-88B77204 hid: the pack looked authoritative and named a plausible
  // grant, but gating denied the tool by default for everyone.
  grants: {
    evaluate_profession_decision: ["registry_read"],
  },
};
