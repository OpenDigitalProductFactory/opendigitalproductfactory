import "server-only";

import type { ToolPackHandler } from "@/lib/mcp/tool-pack";
import type { KernelConsultPolicyProjection } from "@/lib/decision/kernel-consult-ledger";
import { INITIATIVE_READINESS_LANES } from "@/lib/tak/initiative-readiness-tool-grants";
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

export type RoutinePolicyActionIneligibility =
  | "platform-scope-required"
  | "backlog-subject-required"
  | "immutable-review-binding-required"
  | "review-binding-mismatch"
  | "workroom-binding-required"
  | "workroom-binding-mismatch"
  | "gate-not-authorized"
  | "internal-action-required"
  | "immediate-action-required"
  | "side-effect-required"
  | "consequential-action-requires-human"
  | "operator-policy-requires-approval"
  | "non-pass-decision"
  | "findings-present";

export type RoutinePolicyActionEligibility =
  | { eligible: true }
  | { eligible: false; reason: RoutinePolicyActionIneligibility };

/**
 * Admit bounded evidence recording whose writer, backlog item,
 * canonical blob and Workroom head are all fixed by server-validated TaskRun
 * metadata. This is deliberately narrower than generic coworker authority.
 */
export function routinePolicyActionEligibility(
  input: JudgmentInput["authorityInput"],
): RoutinePolicyActionEligibility {
  if (input.organizationId !== "platform") {
    return { eligible: false, reason: "platform-scope-required" };
  }
  if (input.subject?.kind !== "backlog-item") {
    return { eligible: false, reason: "backlog-subject-required" };
  }
  const binding = input.task?.initiativeReviewBinding;
  if (!binding) {
    return { eligible: false, reason: "immutable-review-binding-required" };
  }
  if (
    binding.writerToolName !== input.action.toolName
    || binding.itemId !== input.subject.id
  ) {
    return { eligible: false, reason: "review-binding-mismatch" };
  }
  const workroom = binding.workroomRef;
  if (!workroom) {
    return { eligible: false, reason: "workroom-binding-required" };
  }
  if (
    binding.artifactRef.repositoryFullName !== workroom.repositoryFullName
    || binding.artifactRef.commitSha !== workroom.headSha
  ) {
    return { eligible: false, reason: "workroom-binding-mismatch" };
  }
  const lane = INITIATIVE_READINESS_LANES[input.action.toolName];
  if (!lane || !lane.gates.some((gate) => gate === binding.gate)) {
    return { eligible: false, reason: "gate-not-authorized" };
  }
  if (
    input.integration.required
    || input.dataPolicy.sensitivity !== "internal"
  ) {
    return { eligible: false, reason: "internal-action-required" };
  }
  if (input.action.executionMode !== "immediate") {
    return { eligible: false, reason: "immediate-action-required" };
  }
  if (!input.action.sideEffect) {
    return { eligible: false, reason: "side-effect-required" };
  }
  if (input.action.consequence) {
    return { eligible: false, reason: "consequential-action-requires-human" };
  }
  if (input.action.policyProjectionAllowed === false) {
    return { eligible: false, reason: "operator-policy-requires-approval" };
  }
  const findings = input.rawParams.findings;
  const resolved = input.rawParams.resolvedFindingRefs;
  if (
    !Array.isArray(findings)
    || !Array.isArray(resolved)
    || resolved.length > 0
  ) {
    return { eligible: false, reason: "findings-present" };
  }
  // Recording an unresolved failure produces evidence, not permission to
  // proceed. The receipt writer validates the findings; readiness retains the
  // failed gate. Waivers and finding resolutions never enter this class.
  if (input.rawParams.decision === "fail" && findings.length > 0) {
    return { eligible: true };
  }
  if (input.rawParams.decision !== "pass") {
    return { eligible: false, reason: "non-pass-decision" };
  }
  return findings.length === 0
    ? { eligible: true }
    : { eligible: false, reason: "findings-present" };
}

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
  const eligibility = routinePolicyActionEligibility(input.authorityInput);
  if (!eligibility.eligible) {
    throw new Error(`routine policy action is ineligible: ${eligibility.reason}`);
  }
  const request = buildPolicyActionJudgmentRequest(input);
  const runPrincipleDecision = overrides.runPrincipleDecision
    ?? (await import("@/lib/mcp/packs/principle-decide-pack")).runPrincipleDecision;
  await runPrincipleDecision(request.params, request.context, request.policyRecord);
}
