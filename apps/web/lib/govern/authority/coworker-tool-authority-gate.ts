import "server-only";

import { prisma } from "@dpf/db";
import { randomUUID } from "crypto";

import type {
  GovernedExecuteArgs,
  GovernedExecuteRejection,
} from "@/lib/mcp-governed-execute";
import type { ToolDefinition } from "@/lib/mcp-tools";

import {
  evaluateCoworkerAuthority,
  type CoworkerAuthorityDecision,
  type CoworkerAuthorityInput,
} from "./coworker-authority-decision";
import { escalationReasonSentence } from "./escalation-gate";

export type CoworkerAuthorityInputResolver = (args: {
  execution: GovernedExecuteArgs;
  tool: ToolDefinition;
  agentGrantAllowed: boolean;
}) => Promise<CoworkerAuthorityInput>;

export type AuthorizationDecisionCreate = (
  data: Record<string, unknown>,
) => Promise<unknown>;

export type AuthorityApprovalEnvelopeCreate = (input: {
  binding: Extract<
    CoworkerAuthorityDecision,
    { outcome: "require-approval" }
  >["approvalBinding"];
  authorityDecisionId: string;
  threadId: string | null;
  explanation: string;
}) => Promise<{ id: string; status: string; expiresAt: Date | null }>;

export type AuthorityApprovalTaskResume = (taskRunId: string) => Promise<void>;

export type AuthorityApprovalEnvelopeFinalize = (
  envelopeId: string,
  success: boolean,
) => Promise<void>;

export type PolicyAuthorityEnvelopeReserve = (envelopeId: string) => Promise<boolean>;

export type PolicyAuthorityProjectionAttempt = (input: {
  execution: GovernedExecuteArgs;
  authorityInput: CoworkerAuthorityInput;
  approvalBinding: Extract<CoworkerAuthorityDecision, { outcome: "require-approval" }>["approvalBinding"];
}) => Promise<{
  outcome: "approved";
  authorityDecisionId: string;
  envelopeId: string;
  expiresAt: Date;
} | { outcome: "not-authorized"; explanation?: string }
  | {
      outcome: "denied";
      reasonCode: "policy-declined" | "policy-authorization-invalid";
      explanation: string;
    }
  | {
      outcome: "resolution-required";
      reasonCode: "dual-control-required";
      explanation: string;
    }>;

type AuthorityGateOverrides = {
  resolveCoworkerAuthorityInput?: CoworkerAuthorityInputResolver | null;
  authorizationDecisionCreate?: AuthorizationDecisionCreate | null;
  authorityApprovalEnvelopeCreate?: AuthorityApprovalEnvelopeCreate | null;
  authorityApprovalTaskResume?: AuthorityApprovalTaskResume | null;
  authorityApprovalEnvelopeFinalize?: AuthorityApprovalEnvelopeFinalize | null;
  policyAuthorityProjectionAttempt?: PolicyAuthorityProjectionAttempt | null;
  policyAuthorityEnvelopeReserve?: PolicyAuthorityEnvelopeReserve | null;
  authorityExecutedOutcome?: AuthorityExecutedOutcome | null;
};

/** BI-12E5DD91: the recorded outcome of an identical call that already ran on approval. */
export type AuthorityExecutedOutcome = (
  binding: Extract<CoworkerAuthorityDecision, { outcome: "require-approval" }>["approvalBinding"],
) => Promise<{ envelopeId: string; result: unknown } | null>;

export type CoworkerToolAuthorityGateResult =
  | {
      /** The identical call already ran once on a person's approval. */
      outcome: "settled";
      envelopeId: string;
      result: unknown;
    }
  | {
      outcome: "allow";
      approvedEnvelopeId: string | null;
      authorityDecisionId: string;
    }
  | {
      outcome: "reject";
      rejection: Extract<
        GovernedExecuteRejection,
        | "authority_denied"
        | "approval_required"
        | "authority_evidence_unavailable"
      >;
      message: string;
      authorityReason?: CoworkerAuthorityDecision["reasonCode"];
      data?: {
        approvalBinding: Extract<
          CoworkerAuthorityDecision,
          { outcome: "require-approval" }
        >["approvalBinding"];
        envelopeId: string;
        expiresAt: string | null;
      };
    };

let overrides: AuthorityGateOverrides = {};

export function setCoworkerToolAuthorityOverridesForTests(
  next: AuthorityGateOverrides,
): void {
  if ("resolveCoworkerAuthorityInput" in next) {
    overrides.resolveCoworkerAuthorityInput =
      next.resolveCoworkerAuthorityInput ?? null;
  }
  if ("authorizationDecisionCreate" in next) {
    overrides.authorizationDecisionCreate =
      next.authorizationDecisionCreate ?? null;
  }
  if ("authorityApprovalEnvelopeCreate" in next) {
    overrides.authorityApprovalEnvelopeCreate =
      next.authorityApprovalEnvelopeCreate ?? null;
  }
  if ("authorityApprovalTaskResume" in next) {
    overrides.authorityApprovalTaskResume =
      next.authorityApprovalTaskResume ?? null;
  }
  if ("authorityApprovalEnvelopeFinalize" in next) {
    overrides.authorityApprovalEnvelopeFinalize =
      next.authorityApprovalEnvelopeFinalize ?? null;
  }
  if ("policyAuthorityProjectionAttempt" in next) {
    overrides.policyAuthorityProjectionAttempt = next.policyAuthorityProjectionAttempt ?? null;
  }
  if ("policyAuthorityEnvelopeReserve" in next) {
    overrides.policyAuthorityEnvelopeReserve = next.policyAuthorityEnvelopeReserve ?? null;
  }
  if ("authorityExecutedOutcome" in next) {
    overrides.authorityExecutedOutcome = next.authorityExecutedOutcome ?? null;
  }
}

async function executedOutcome(
  binding: Parameters<AuthorityExecutedOutcome>[0],
): Promise<{ envelopeId: string; result: unknown } | null> {
  if (overrides.authorityExecutedOutcome) return overrides.authorityExecutedOutcome(binding);
  const { findExecutedAuthorityOutcome } = await import("@/lib/coworker/authority-approval-envelope");
  return findExecutedAuthorityOutcome(binding);
}

async function attemptPolicyAuthorityProjection(input: Parameters<PolicyAuthorityProjectionAttempt>[0]) {
  const projector = overrides.policyAuthorityProjectionAttempt
    ?? (await import("./resolve-policy-action-authority")).resolveAndPersistPolicyActionAuthority;
  return projector(input);
}

/**
 * Claim an approved envelope for exactly one run: a compare-and-set on
 * `resolvedAt`. Every approved run reserves (BI-12E5DD91), not only
 * policy-derived ones, because a person's approval can now be spent by the
 * platform's own replay and by a client retry at the same moment.
 */
async function reserveApprovedEnvelope(envelopeId: string): Promise<boolean> {
  if (overrides.policyAuthorityEnvelopeReserve) {
    return overrides.policyAuthorityEnvelopeReserve(envelopeId);
  }
  const result = await prisma.coworkerActionEnvelope.updateMany({
    where: { id: envelopeId, status: "approved", resolvedAt: null },
    data: { resolvedAt: new Date() },
  });
  return result.count === 1;
}

async function resolveAuthorityInput(
  execution: GovernedExecuteArgs,
  tool: ToolDefinition,
  agentGrantAllowed: boolean,
): Promise<CoworkerAuthorityInput> {
  const resolver = overrides.resolveCoworkerAuthorityInput
    ?? (await import("./resolve-coworker-tool-authority"))
      .resolveCoworkerToolAuthorityInput;
  const resolved = await resolver({ execution, tool, agentGrantAllowed });
  return {
    ...resolved,
    action: {
      ...resolved.action,
      agentGrantAllowed,
    },
    rawParams: execution.rawParams,
  };
}

async function writeAuthorizationDecision(
  input: CoworkerAuthorityInput,
  decision: CoworkerAuthorityDecision,
  execution: GovernedExecuteArgs,
): Promise<string | null> {
  const subject = input.subject
    ? `${input.subject.kind}:${input.subject.id}`
    : null;
  const row = {
    decisionId: `AUTH-${randomUUID()}`,
    actorType: "ai-coworker",
    actorRef:
      input.authContext.actingAgentId
      ?? execution.context?.agentId
      ?? "unknown",
    humanContextRef:
      input.authContext.actingHumanUserId ?? execution.userId,
    agentContextRef:
      input.authContext.actingAgentId ?? execution.context?.agentId ?? null,
    delegationGrantId: null,
    // `organizationId` is a tenant Organization FK. Platform-scoped initiatives
    // deliberately use the in-memory `platform` authority sentinel, but that
    // sentinel is not (and must never become) a synthetic tenant row.
    organizationId: input.organizationId === "platform"
      ? null
      : input.organizationId ?? null,
    purposeOfUse: execution.context?.workCase?.action ?? "tool-execution",
    policyVersion: input.dataPolicy.decisionVersionIds?.join(",") || null,
    actionKey: execution.toolName,
    objectRef: subject,
    decision: decision.outcome,
    rationale: {
      reasonCode: decision.reasonCode,
      nextAction: decision.nextAction,
      chainId: input.delegation?.chainId ?? null,
      taskRunId:
        input.task?.taskRunId ?? execution.context?.taskRunId ?? null,
      subjectKind: input.subject?.kind ?? null,
      authorityOrganizationScope: input.organizationId ?? null,
      ...(input.action.consequenceRefinement
        ? { consequenceRefinement: input.action.consequenceRefinement }
        : {}),
      // BI-12E5DD91: which escalation branch decided, so "why did this need a
      // person?" is answerable from the record instead of re-derived.
      ...("escalation" in decision && decision.escalation
        ? {
            escalationReason: decision.escalation.reasonCode,
            escalationSteering: decision.escalation.steering,
            damaging: decision.escalation.damaging,
          }
        : {}),
    },
    // The OAuth consent this call ran under, when it ran under one.
    authorityBindingId:
      execution.context?.connectionDelegation?.authorityBindingId ?? null,
    endpointUsed: execution.source,
    mode: input.action.executionMode,
    routeContext: input.action.routeContext,
    sensitivityLevel: input.dataPolicy.sensitivity,
    sensitivityOverride: false,
  };
  try {
    if (overrides.authorizationDecisionCreate) {
      await overrides.authorizationDecisionCreate(row);
    } else {
      await prisma.authorizationDecisionLog.create({ data: row });
    }
    return row.decisionId;
  } catch (error) {
    console.error(
      "[governed-execute] authority decision write failed tool=%s source=%s: %s",
      JSON.stringify(execution.toolName),
      JSON.stringify(execution.source),
      error instanceof Error
        ? JSON.stringify(error.message)
        : JSON.stringify(String(error)),
    );
    return null;
  }
}

/** The envelope's stored reason: the rule, then the branch that decided it. */
export function approvalExplanation(
  decision: Extract<CoworkerAuthorityDecision, { outcome: "require-approval" }>,
): string {
  const why = decision.escalation
    ? escalationReasonSentence(decision.escalation.reasonCode)
    : null;
  return why ? `${decision.explanation} ${why}` : decision.explanation;
}

async function ensureApproval(
  input: Parameters<AuthorityApprovalEnvelopeCreate>[0],
): Promise<Awaited<ReturnType<AuthorityApprovalEnvelopeCreate>>> {
  if (overrides.authorityApprovalEnvelopeCreate) {
    return overrides.authorityApprovalEnvelopeCreate(input);
  }
  const { ensureAuthorityApprovalEnvelope } = await import(
    "@/lib/coworker/authority-approval-envelope"
  );
  return ensureAuthorityApprovalEnvelope(input);
}

async function resumeApprovedTask(taskRunId: string): Promise<void> {
  if (overrides.authorityApprovalTaskResume) {
    await overrides.authorityApprovalTaskResume(taskRunId);
    return;
  }
  const { resumeAuthorityApprovalTask } = await import(
    "@/lib/coworker/authority-approval-envelope"
  );
  await resumeAuthorityApprovalTask(taskRunId);
}

export async function finalizeCoworkerAuthorityApproval(
  envelopeId: string,
  success: boolean,
): Promise<void> {
  if (overrides.authorityApprovalEnvelopeFinalize) {
    await overrides.authorityApprovalEnvelopeFinalize(envelopeId, success);
    return;
  }
  const { finalizeAuthorityApprovalEnvelope } = await import(
    "@/lib/coworker/authority-approval-envelope"
  );
  await finalizeAuthorityApprovalEnvelope(envelopeId, success);
}

export async function enforceCoworkerToolAuthority(
  execution: GovernedExecuteArgs,
  tool: ToolDefinition,
  agentGrantAllowed: boolean,
): Promise<CoworkerToolAuthorityGateResult> {
  let input: CoworkerAuthorityInput;
  try {
    input = await resolveAuthorityInput(execution, tool, agentGrantAllowed);
  } catch (error) {
    console.error(
      "[governed-execute] authority context unavailable tool=%s source=%s: %s",
      JSON.stringify(execution.toolName),
      JSON.stringify(execution.source),
      error instanceof Error
        ? JSON.stringify(error.message)
        : JSON.stringify(String(error)),
    );
    return {
      outcome: "reject",
      rejection: "authority_evidence_unavailable",
      message: "verified authority context is unavailable",
    };
  }

  let decision = evaluateCoworkerAuthority(input);
  let projectedDecisionId: string | null = null;
  if (decision.outcome === "require-approval") {
    const projected = await attemptPolicyAuthorityProjection({
      execution,
      authorityInput: input,
      approvalBinding: decision.approvalBinding,
    });
    if (projected.outcome === "approved") {
      input = {
        ...input,
        approval: {
          envelopeId: projected.envelopeId,
          status: "approved",
          expiresAt: projected.expiresAt,
          binding: decision.approvalBinding,
        },
      };
      decision = evaluateCoworkerAuthority(input);
      projectedDecisionId = projected.authorityDecisionId;
    } else if (projected.outcome === "denied") {
      decision = {
        outcome: "deny",
        reasonCode: projected.reasonCode,
        explanation: projected.explanation,
        nextAction: "request-authority",
      };
    } else if (projected.outcome === "resolution-required") {
      decision = {
        outcome: "deny",
        reasonCode: projected.reasonCode,
        explanation: projected.explanation,
        nextAction: "request-authority",
      };
    } else if (projected.explanation) {
      decision = {
        ...decision,
        explanation: projected.explanation,
      };
    }
  }
  const decisionId = projectedDecisionId ?? await writeAuthorizationDecision(
    input,
    decision,
    execution,
  );
  if (!decisionId) {
    return {
      outcome: "reject",
      rejection: "authority_evidence_unavailable",
      message: "authority evidence could not be recorded",
    };
  }

  if (decision.outcome === "deny") {
    return {
      outcome: "reject",
      rejection: "authority_denied",
      message: decision.explanation,
      authorityReason: decision.reasonCode,
    };
  }

  if (decision.outcome === "require-approval") {
    // A lookup failure only loses the shortcut; it falls back to asking.
    const settled = await executedOutcome(decision.approvalBinding).catch(() => null);
    if (settled) return { outcome: "settled", ...settled };
    try {
      const envelope = await ensureApproval({
        binding: decision.approvalBinding,
        authorityDecisionId: decisionId,
        threadId: execution.context?.threadId ?? null,
        explanation: approvalExplanation(decision),
      });
      return {
        outcome: "reject",
        rejection: "approval_required",
        message: decision.explanation,
        authorityReason: decision.reasonCode,
        data: {
          approvalBinding: decision.approvalBinding,
          envelopeId: envelope.id,
          expiresAt: envelope.expiresAt?.toISOString() ?? null,
        },
      };
    } catch (error) {
      console.error(
        "[governed-execute] approval envelope unavailable tool=%s source=%s: %s",
        JSON.stringify(execution.toolName),
        JSON.stringify(execution.source),
        error instanceof Error
          ? JSON.stringify(error.message)
          : JSON.stringify(String(error)),
      );
      return {
        outcome: "reject",
        rejection: "authority_evidence_unavailable",
        message: "approval evidence could not be recorded",
      };
    }
  }

  const approvedEnvelopeId = input.approval?.envelopeId ?? null;
  if (approvedEnvelopeId && !await reserveApprovedEnvelope(approvedEnvelopeId)) {
    return {
      outcome: "reject",
      rejection: "authority_evidence_unavailable",
      message: projectedDecisionId
        ? "the policy-derived single-use authorization was already consumed"
        : "the approval was already used by another run of this exact request",
    };
  }
  if (approvedEnvelopeId && input.task?.taskRunId) {
    try {
      await resumeApprovedTask(input.task.taskRunId);
    } catch (error) {
      console.error(
        "[governed-execute] approved task resume failed task=%s tool=%s: %s",
        JSON.stringify(input.task.taskRunId),
        JSON.stringify(execution.toolName),
        error instanceof Error
          ? JSON.stringify(error.message)
          : JSON.stringify(String(error)),
      );
      return {
        outcome: "reject",
        rejection: "authority_evidence_unavailable",
        message: "the approved task could not be resumed",
      };
    }
  }

  return { outcome: "allow", approvedEnvelopeId, authorityDecisionId: decisionId };
}
