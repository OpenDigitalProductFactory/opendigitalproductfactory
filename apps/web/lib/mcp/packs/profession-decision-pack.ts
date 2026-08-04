// Profession/WSID decision tool pack (BI-9900B365, EP-8DC217EB BET-0c).
//
// Exposes the profession decision gate as a coworker-callable tool, registered
// in a scoped pack (not the frozen mcp-tools.ts inline switch). The handler
// resolves the CALLING coworker's profession family (registry-driven), routes
// the decision through evaluateProfessionDecisionGate (the coworker's own WSID
// craft profile, with platform doctrine as advisory fallback only), and
// records it to the DecisionInteraction ledger. Advisory: it returns a
// recommendation; consequential actions still pass their own authority gates.
//
// BI-52839DEA — declared borrow. WSID used to be reachable ONLY from an
// in-portal coworker session, while its WWMD sibling `principle_decide` had
// accepted an explicit `callingPopulation` from external development surfaces
// all along. That asymmetry meant a coworker's craft judgment could not
// participate in the Claude Code / Codex / Grok review process at all. An
// external caller now declares its population and NAMES the craft it wants to
// consult; the gate serves the real profile and corpus and stamps the ledger
// with `declaredBorrow`. What crosses the boundary is a consult, never a copy —
// the coworker definition stays single-homed in the platform.

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
        callingPopulation: {
          type: "string",
          enum: ["in_platform_coworker", "external_coding_agent", "human"],
          description:
            "Who is calling. In-platform coworkers may omit this — the profession is derived from their own identity. An EXTERNAL development surface (Claude Code / Codex / Grok) has no coworker identity, so it declares its population here and names `professionKey` to borrow that craft's judgment. The borrow is stamped on the decision ledger; it is never recorded as the coworker's own reasoning.",
        },
        professionKey: {
          type: "string",
          description:
            "Required for a declared borrow (external population, no coworker identity): the professionKey to consult, e.g. 'ux-design'. Must be a family registered in docs/professions/registry.json — an unknown key fails rather than degrading to platform defaults. Ignored for in-platform callers, who always reason from the craft they practise.",
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

  // Declared borrow (BI-52839DEA). An external development surface holds no
  // coworker identity, so it names the population it belongs to and the craft it
  // wants to consult. `principle_decide` already externalizes WWMD this way;
  // this closes the same door on WSID.
  const declaredPopulation = String(params["callingPopulation"] ?? "").trim();
  const declaredProfessionKey = String(params["professionKey"] ?? "").trim();
  const isExternalPopulation =
    declaredPopulation === "external_coding_agent" || declaredPopulation === "human";

  if (!context?.agentId && !isExternalPopulation) {
    return {
      success: false,
      error: "no_agent_identity",
      message:
        "A profession decision is scoped to the calling coworker, but no agent identity reached the tool. " +
        "Route the call through a coworker session, or — from an external development surface — declare " +
        "callingPopulation ('external_coding_agent' or 'human') together with the professionKey to consult.",
    };
  }

  if (!context?.agentId && isExternalPopulation && !declaredProfessionKey) {
    return {
      success: false,
      error: "no_profession_declared",
      message:
        "A declared borrow must name the craft it is consulting. Pass professionKey (e.g. 'ux-design'); " +
        "there is no default profession, because borrowing an unnamed craft would return platform doctrine " +
        "wearing a profession's name.",
    };
  }

  const agent = context?.agentId
    ? await prisma.agent.findFirst({
        where: { OR: [{ agentId: context.agentId }, { slugId: context.agentId }] },
        select: { agentId: true, name: true, slugId: true },
      })
    : null;

  const decision = await evaluateProfessionDecisionGate({
    db: prisma,
    agentIdentity: {
      agentId: agent?.agentId ?? context?.agentId ?? null,
      agentName: agent?.name ?? null,
      slugId: agent?.slugId ?? context?.agentId ?? null,
    },
    // The gate itself refuses a borrow from a caller that already carries an
    // agent identity, so an in-portal coworker cannot name its way into another
    // craft even if it passes these fields.
    declaredBorrow: isExternalPopulation
      ? { callingPopulation: declaredPopulation, professionKey: declaredProfessionKey }
      : null,
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
      // Echoed so an external caller can see, without reading the ledger, that
      // it consulted a real craft profile rather than platform doctrine.
      declaredBorrow: !context?.agentId && isExternalPopulation,
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
