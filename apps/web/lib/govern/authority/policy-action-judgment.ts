import "server-only";

import type { ToolPackHandler } from "@/lib/mcp/tool-pack";
import type { KernelConsultPolicyProjection } from "@/lib/decision/kernel-consult-ledger";
import type { PolicyAuthorityProjectionAttempt } from "./coworker-tool-authority-gate";

type JudgmentInput = Parameters<PolicyAuthorityProjectionAttempt>[0];
type PrincipleRunner = (
  params: Record<string, unknown>,
  context: Parameters<ToolPackHandler>[2],
  policyProjection: KernelConsultPolicyProjection,
) => Promise<unknown>;

export type PolicyActionJudgmentRequest = {
  params: Record<string, unknown>;
  context: Parameters<ToolPackHandler>[2];
  policyRecord: KernelConsultPolicyProjection;
};

/**
 * Build the one action-specific WWMD question from verified server context.
 * Raw tool arguments are deliberately absent: callers cannot inject a policy
 * binding, option vector, affirmative option, or dual-control disposition.
 */
export function buildPolicyActionJudgmentRequest(
  { execution, authorityInput, approvalBinding }: JudgmentInput,
): PolicyActionJudgmentRequest {
  if (!authorityInput.subject) {
    throw new Error("policy action judgment requires a verified subject");
  }

  const actionKey = execution.toolName;
  const subjectRef = `${authorityInput.subject.kind}:${authorityInput.subject.id}`;
  const routeContext = authorityInput.action.routeContext;
  const policyRecord: KernelConsultPolicyProjection = {
    policyAffirmativeOptionId: "proceed",
    dualControlRequired: false,
    policyActionBinding: {
      actionKey,
      subject: authorityInput.subject,
      organizationId: authorityInput.organizationId ?? null,
      professionId: null,
      routeContext,
      artifactFingerprint: approvalBinding.inputFingerprint,
    },
  };

  return {
    params: {
      context:
        `Should WWMD authorize the exact bounded initiative-readiness action ${actionKey} ` +
        `for ${subjectRef} at ${routeContext}, bound to immutable input fingerprint ` +
        `${approvalBinding.inputFingerprint}? Apply Mark's current promoted DPF principles. ` +
        "Proceed only when the bounded action is justified; defer on ambiguity and decline when policy opposes it.",
      callingPopulation: "in_platform_coworker",
      callingSurface: "policy-action-authority",
      consumerContexts: ["build-studio", "initiative-readiness"],
      ringScope: ["ring-2-workflow", "ring-4-sandbox-prod"],
      stakes: "elevated",
      maxPrinciples: 20,
      tieMargin: 0.2,
      options: [
        {
          id: "proceed",
          description:
            "Authorize this exact evidence-producing action once, with its current binding, expiry, audit, grants, and reviewer separation unchanged.",
          features: {
            governance_compliance: 1,
            evidence_density: 1,
            evidence_confidence: 0.95,
            legibility_of_consequence: 1,
            schema_grounding: 1,
            long_term_maintainability: 0.9,
            reusability: 0.85,
            speed_to_value: 0.9,
            reversibility: 0.95,
            blast_radius: 0.1,
            human_cognitive_load: 0.05,
            operator_effort: 0.05,
          },
        },
        {
          id: "defer",
          description:
            "Do not authorize yet; require bounded human resolution because the policy evidence or consequence is ambiguous.",
          features: {
            governance_compliance: 0.65,
            evidence_density: 0.6,
            evidence_confidence: 0.55,
            legibility_of_consequence: 0.65,
            schema_grounding: 0.8,
            long_term_maintainability: 0.55,
            reusability: 0.35,
            speed_to_value: 0.15,
            reversibility: 1,
            blast_radius: 0.02,
            human_cognitive_load: 0.8,
            operator_effort: 0.8,
          },
        },
        {
          id: "decline",
          description:
            "Deny the exact action because it conflicts with the governing principles or exceeds the bounded authority envelope.",
          features: {
            governance_compliance: 0.5,
            evidence_density: 0.55,
            evidence_confidence: 0.7,
            legibility_of_consequence: 0.75,
            schema_grounding: 0.7,
            long_term_maintainability: 0.4,
            reusability: 0.2,
            speed_to_value: 0.05,
            reversibility: 1,
            blast_radius: 0,
            human_cognitive_load: 0.35,
            operator_effort: 0.2,
          },
        },
      ],
    },
    context: {
      ...execution.context,
      agentId: authorityInput.authContext.actingAgentId ?? execution.context?.agentId,
      taskRunId: authorityInput.task?.taskRunId ?? execution.context?.taskRunId,
      threadId: execution.context?.threadId,
      routeContext: routeContext ?? undefined,
    },
    policyRecord,
  };
}

export async function producePolicyActionJudgment(
  input: JudgmentInput,
  overrides: { runPrincipleDecision?: PrincipleRunner } = {},
): Promise<void> {
  const request = buildPolicyActionJudgmentRequest(input);
  const runPrincipleDecision = overrides.runPrincipleDecision
    ?? (await import("@/lib/mcp/packs/principle-decide-pack")).runPrincipleDecision;
  await runPrincipleDecision(request.params, request.context, request.policyRecord);
}
