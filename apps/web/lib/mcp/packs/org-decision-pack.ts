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
import { getErrorMessage } from "@/lib/shared/get-error-message";

const definitions: ToolDefinition[] = [
  {
    name: "record_org_business_answer",
    description:
      "Capture a CONFIRMED first-party answer about how this business operates into the organization's decision corpus (WWWD). Use after the employee/operator has confirmed an answer to a question about the business — what it sells, who it serves, how it decides something, how work gets done — so future decisions can cite it. The answer lands as DRAFT knowledge for the operator to review and publish; nothing becomes authoritative without human review. Use ONLY for confirmed statements from the operator about their own business, never for speculation, research findings, or platform matters.",
    inputSchema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The business question that was asked, e.g. 'Who are your most important customers?'",
        },
        answer: {
          type: "string",
          description: "The operator's confirmed answer, as close to their own words as practical.",
        },
        topic: {
          type: "string",
          description: "Optional short label for the knowledge, e.g. 'key customers'. Defaults to the question.",
        },
      },
      required: ["question", "answer"],
    },
    requiredCapability: "view_operations",
    executionMode: "immediate",
    sideEffect: true,
  },
  {
    name: "evaluate_org_business_decision",
    description:
      "Weigh a business decision against your organization's own recorded stance (its mission and how-we-decide profile), returning a confidence-scored recommendation and recording the outcome to the decision ledger. Falls back to platform defaults only as advisory when your organization has not recorded a stance for this kind of decision, and escalates to a human when confidence is low or no applicable guidance exists. Use this to ground a business call in what the organization would do, rather than deciding unaided.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "The business decision to weigh, e.g. 'Should we send this customer a free replacement?'" },
        options: { type: "array", items: { type: "string" }, description: "The distinct options under consideration (at least one)." },
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

type PackCallerContext = {
  routeContext?: string;
  threadId?: string;
  agentId?: string;
  callerClient?: string;
  apiTokenId?: string;
  authSource?: string;
};

/** Shape the dispatch context into the ledger's caller-attribution block. */
function callerFromContext(context: PackCallerContext | undefined) {
  return {
    client: context?.callerClient ?? null,
    apiTokenId: context?.apiTokenId ?? null,
    authSource: context?.authSource ?? null,
    agentId: context?.agentId ?? null,
    threadId: context?.threadId ?? null,
  };
}

async function evaluateOrgBusinessDecision(
  params: Record<string, unknown>,
  userId: string,
  context?: PackCallerContext,
): Promise<ToolResult> {
  const { evaluateOrgBusinessDecisionGate } = await import("@/lib/decision-perspective/org-business-gate");
  const { DECISION_DOMAIN_CLASSES, DECISION_RISK_TIERS } = await import("@/lib/decision-perspective/types");
  const { parseOptionFeatures } = await import("@/lib/decision-perspective/scored-option-input");
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

  const parsedFeatures = parseOptionFeatures(options, params["optionFeatures"]);
  if (!parsedFeatures.ok) {
    return { success: false, error: "invalid_params", message: parsedFeatures.message };
  }

  const decision = await evaluateOrgBusinessDecisionGate({
    db: prisma,
    organizationId: org.id,
    question,
    options,
    scoredOptions: parsedFeatures.scoredOptions,
    domainClass: domainClass as Parameters<typeof evaluateOrgBusinessDecisionGate>[0]["domainClass"],
    riskTier: riskTier as Parameters<typeof evaluateOrgBusinessDecisionGate>[0]["riskTier"],
    routeContext: context?.routeContext ?? "/coworker-business",
    triggeredByUserId: userId,
    caller: callerFromContext(context),
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
      // Content-aware directional verdict (BI-7E1F128A): approve/decline/mixed/none
      // and the [-1,1] alignment behind it, so an off-mission decision surfaces a
      // confident decline and an on-mission one a confident approve.
      stanceAlignment: decision.evaluation.stanceAlignment ?? null,
      alignmentScore: decision.evaluation.alignmentScore ?? null,
      relevanceMethod: decision.evaluation.relevanceMethod ?? null,
      orgProfileSelected: decision.orgProfileSelected,
      recommendedOptionId: decision.evaluation.recommendedOptionId ?? null,
      rationale: rationale.length > 500 ? `${rationale.slice(0, 500)}...` : rationale,
    },
  };
}

// The qa elicitation feeder (BI-44526F3E Phase C): a confirmed operator answer
// enters the org's WWWD corpus through the SAME governed enrichment façade
// every other source uses (enrichOrgCorpus) — qa provenance, first-party
// trust, draft-by-default per BI-1378. This closes the elicitation half of the
// review loop: evaluate_org_business_decision surfaces where the org is silent
// (gap findings on /coworker-decisions/review), and this tool captures the operator's answer
// once so the silence doesn't repeat.
async function recordOrgBusinessAnswer(
  params: Record<string, unknown>,
  userId: string,
  agentId?: string | null,
): Promise<ToolResult> {
  const { captureOrgBusinessAnswer } = await import("@/lib/wiki/capture-org-answer");
  const { createProductionInference } = await import("@/lib/wiki/inference-adapter");
  const { prisma } = await import("@dpf/db");

  const org = await prisma.organization.findFirst({ select: { id: true } });
  if (!org) return { success: false, error: "no_org", message: "No organization is configured for this install." };

  const question = String(params["question"] ?? "").trim();
  const answer = String(params["answer"] ?? "").trim();
  const topic = String(params["topic"] ?? "").trim();
  if (!question || !answer) {
    return {
      success: false,
      error: "invalid_params",
      message: "Provide both the question that was asked and the operator's confirmed answer.",
    };
  }

  try {
    const result = await captureOrgBusinessAnswer({
      organizationId: org.id,
      question,
      answer,
      topic,
      agentId: agentId ?? null,
      userId,
      infer: createProductionInference({ taskType: "wiki_proposal" }),
    });

    const pageCount = result.committed.length;
    return {
      success: true,
      entityId: result.rawSourceId,
      message:
        pageCount > 0
          ? `Captured. ${pageCount} draft knowledge page(s) await the operator's review before they become authoritative.`
          : "Captured the answer, but no reviewable knowledge could be extracted from it — consider rephrasing or adding detail.",
      data: {
        rawSourceId: result.rawSourceId,
        committed: result.committed,
        warnings: result.warnings,
      },
    };
  } catch (e) {
    return {
      success: false,
      error: "enrichment_failed",
      message: `Could not capture the answer: ${getErrorMessage(e)}`,
    };
  }
}

export const orgDecisionPack: ToolPack = {
  packId: "org-decision",
  definitions,
  handlers: {
    evaluate_org_business_decision: (params, userId, context) =>
      evaluateOrgBusinessDecision(params, userId, context),
    record_org_business_answer: (params, userId, context) =>
      recordOrgBusinessAnswer(params, userId, context?.agentId ?? null),
  },
  grants: {
    evaluate_org_business_decision: ["work_capsule_read"],
    record_org_business_answer: ["registry_write"],
  },
};
