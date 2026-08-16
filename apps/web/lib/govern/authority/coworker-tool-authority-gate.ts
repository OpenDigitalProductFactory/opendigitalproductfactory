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

type AuthorityGateOverrides = {
  resolveCoworkerAuthorityInput?: CoworkerAuthorityInputResolver | null;
  authorizationDecisionCreate?: AuthorizationDecisionCreate | null;
  authorityApprovalEnvelopeCreate?: AuthorityApprovalEnvelopeCreate | null;
  authorityApprovalTaskResume?: AuthorityApprovalTaskResume | null;
  authorityApprovalEnvelopeFinalize?: AuthorityApprovalEnvelopeFinalize | null;
};

export type CoworkerToolAuthorityGateResult =
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
    organizationId: null,
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
    },
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

  const decision = evaluateCoworkerAuthority(input);
  const decisionId = await writeAuthorizationDecision(
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
    try {
      const envelope = await ensureApproval({
        binding: decision.approvalBinding,
        authorityDecisionId: decisionId,
        threadId: execution.context?.threadId ?? null,
        explanation: decision.explanation,
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
