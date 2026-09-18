import { prisma } from "@dpf/db";

import type { ConstitutionalAlignmentResult } from "@/lib/decision-perspective/alignment-criteria";
import type { GovernedExecuteArgs } from "@/lib/mcp-governed-execute";
import type { SpecialistAlignmentDelegationResult } from "./alignment-specialist-delegation";

export type AlignmentGateDecision = {
  verdict: "approve" | "decline" | "escalate";
  interactionId: string;
  rationale: string;
  alignment: ConstitutionalAlignmentResult;
  specialistDelegation?: SpecialistAlignmentDelegationResult;
  policyVersion?: string;
  amendmentLineage?: string[];
};
export type AlignmentGate = (input: {
  organizationId?: string;
  statement: string;
  toolName: string;
  args: GovernedExecuteArgs;
}) => Promise<AlignmentGateDecision>;

let overrideForTests: AlignmentGate | null = null;
export function setAlignmentGateOverrideForTests(override: AlignmentGate | null): void {
  overrideForTests = override;
}

const STATEMENT_FIELDS = [
  "name", "title", "description", "summary", "question", "product", "offer",
  "market", "segment", "motion", "geography", "customerType",
] as const;
const STATEMENT_FALLBACK_MAX_PARAMS = 6;
const STATEMENT_FALLBACK_MAX_VALUE = 80;

/**
 * The question the WWWD gate is asked. Prefers the tool's descriptive fields;
 * when a tool carries none of them the statement used to collapse to a bare
 * `"<tool name>: "`, which reached the owner's review queue as a card with no
 * question on it (BI-63B14D4B). A gate that cannot state its question must at
 * least state what was requested, so the fallback names the scalar parameters
 * it was given and says so plainly when there were none.
 */
export function alignmentStatement(toolName: string, params: Record<string, unknown>): string {
  const label = toolName.replaceAll("_", " ");
  const values = STATEMENT_FIELDS.map((field) => params[field])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (values.length > 0) return `${label}: ${values.join(". ")}`;
  const scalars = Object.entries(params)
    .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
    .slice(0, STATEMENT_FALLBACK_MAX_PARAMS)
    .map(([key, value]) => `${key}=${String(value).slice(0, STATEMENT_FALLBACK_MAX_VALUE)}`);
  return scalars.length > 0
    ? `${label} with ${scalars.join(", ")}`
    : `${label} (no parameters describe this request)`;
}

export function composeAlignmentVerdicts(
  alignment: ConstitutionalAlignmentResult["verdict"],
  specialist: SpecialistAlignmentDelegationResult["verdict"],
): AlignmentGateDecision["verdict"] {
  if (alignment === "decline" || specialist === "decline") return "decline";
  if (alignment === "escalate" || specialist === "escalate") return "escalate";
  return "approve";
}

export async function runTakAlignmentGate(args: GovernedExecuteArgs): Promise<AlignmentGateDecision> {
  const statement = alignmentStatement(args.toolName, args.rawParams);
  if (overrideForTests) return overrideForTests({
    organizationId: args.context?.organizationId, statement, toolName: args.toolName, args,
  });
  const organizationId = args.context?.organizationId
    ?? (await prisma.organization.findFirst({ select: { id: true } }))?.id;
  if (!organizationId) {
    const { extractAlignmentCriteria } = await import("@/lib/decision-perspective/alignment-criteria");
    return {
      verdict: "escalate",
      interactionId: "unrecorded:no-organization",
      rationale: "No organization identity was available for the WWWD alignment gate.",
      alignment: {
        verdict: "escalate", criteria: extractAlignmentCriteria(statement), checks: [], veto: null,
      },
    };
  }
  const { evaluateOrgBusinessDecisionGate } = await import("@/lib/decision-perspective/org-business-gate");
  const result = await evaluateOrgBusinessDecisionGate({
    db: prisma,
    organizationId,
    question: statement,
    options: ["Proceed", "Decline"],
    scoredOptions: [
      { id: "proceed", description: "Proceed", features: { mission_fit: 1, market_fit: 1, product_fit: 1, gtm_fit: 1 } },
      { id: "decline", description: "Decline", features: { reversibility: 1, blast_radius: 0 } },
    ],
    domainClass: "plan-readiness",
    riskTier: "medium",
    routeContext: args.context?.routeContext ?? `/tool/${args.toolName}`,
    triggeredByUserId: args.userId,
    taskRunId: args.context?.taskRunId,
    caller: {
      client: args.context?.callerClient ?? args.source,
      apiTokenId: args.context?.apiTokenId ?? null,
      authSource: args.context?.authSource ?? null,
      agentId: args.context?.agentId ?? null,
      threadId: args.context?.threadId ?? null,
    },
  });
  const alignment = result.evaluation.constitutionalAlignment;
  if (alignment) {
    const { runAlignmentSpecialistDelegation } = await import("./alignment-specialist-delegation");
    const specialistDelegation = await runAlignmentSpecialistDelegation({
      alignment,
      statement,
      userId: args.userId,
      coordinatorAgentId: args.context?.agentId ?? "tak-alignment-coordinator",
      routeContext: args.context?.routeContext ?? `/tool/${args.toolName}`,
    });
    const verdict = composeAlignmentVerdicts(alignment.verdict, specialistDelegation.verdict);
    return {
      verdict,
      interactionId: result.interactionId,
      rationale: verdict === alignment.verdict
        ? result.evaluation.rationale
        : `${result.evaluation.rationale} TAK-JSI specialist result: ${specialistDelegation.verdict}.`,
      alignment,
      specialistDelegation,
      policyVersion: result.alignmentPolicyVersion,
      amendmentLineage: result.amendmentLineage,
    };
  }
  const { extractAlignmentCriteria } = await import("@/lib/decision-perspective/alignment-criteria");
  return {
    verdict: "escalate",
    interactionId: result.interactionId,
    rationale: "The WWWD gate produced no constitutional alignment receipt.",
    alignment: {
      verdict: "escalate", criteria: extractAlignmentCriteria(statement), checks: [], veto: null,
    },
  };
}
