// BI-80532D5C — propose-interception for scheduled coworker runs.
//
// The proactivity plan's `actionBoundary === "propose"` is the middle rung
// between `advise` (side-effecting tools stripped entirely — the coworker can
// only recommend) and `act` (side-effecting tools run directly). BI-754C9E82
// enforced advise (strip) and left propose behaving like act. This closes that
// gap: under a propose boundary, a side-effecting tool the coworker calls is
// NOT executed — it is captured as an `AgentActionProposal` (status "proposed")
// bound to the run's thread + taskRun, and a synthetic tool result tells the
// model the action is queued for the human's approval so the run finishes
// cleanly instead of stalling. The existing `approveProposal` server action
// already executes `actionType` as a tool name with `parameters` as its args,
// so a diverted proposal runs verbatim once approved — no approval-side code.
//
// Curated artifacts (knowledge articles, campaign briefs) carry
// `coworkerArtifact` — idempotent, groundable, non-fact-mutating writes that are
// the whole point of a registered self-task — so they still run directly. Only
// side-effecting, non-artifact tools (the ones that create business-fact rows or
// reach customers) are diverted. This is the safety precondition that lets the
// self-task pattern extend beyond the curated roster (BI-E962B9CD): a
// non-curated coworker can run at `propose`, and every business write it
// attempts becomes a human-approved proposal rather than an unreviewed mutation.
import { randomUUID } from "crypto";

import { prisma, Prisma } from "@dpf/db";

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";

/** Minimal shape of the persistence layer, injected so the decision + wording
 *  logic stays unit-testable without a database. */
export type ProposalPersistence = {
  createAssistantMessage(input: {
    threadId: string;
    agentId: string;
    routeContext: string;
    content: string;
    taskRunId: string | null;
  }): Promise<{ id: string }>;
  createProposal(input: {
    proposalId: string;
    threadId: string;
    messageId: string;
    taskRunId: string | null;
    agentId: string;
    actionType: string;
    parameters: Record<string, unknown>;
  }): Promise<{ proposalId: string }>;
};

/**
 * True when a tool the model called must be diverted to a proposal instead of
 * executed. Only fires under an active propose boundary, for side-effecting
 * tools that are NOT curated artifacts and NOT already proposal-mode (those take
 * the loop's own approval-return path). Pure — no I/O.
 */
export function shouldProposeToolCall(
  toolDef: Pick<ToolDefinition, "sideEffect" | "coworkerArtifact" | "executionMode"> | undefined,
  proposeSideEffects: boolean,
): boolean {
  if (!proposeSideEffects || !toolDef) return false;
  if (toolDef.sideEffect !== true) return false;
  if (toolDef.coworkerArtifact) return false;
  if (toolDef.executionMode === "proposal") return false;
  return true;
}

/** The synthetic tool result handed back to the model after a divert, so it
 *  understands the action is pending approval and can summarize rather than
 *  retry or fabricate success. Pure. */
export function buildProposalToolResult(toolName: string, proposalId: string): ToolResult {
  const readable = toolName.replace(/_/g, " ");
  return {
    success: true,
    entityId: proposalId,
    message:
      `Proposed "${readable}" for the owner's approval instead of running it now ` +
      `(this coworker is set to propose, not act). It will run exactly as proposed ` +
      `once approved from the Needs-you inbox. Do not retry it — continue with any ` +
      `remaining read-only work and summarize what you proposed.`,
    data: { proposalId, status: "proposed" },
  };
}

/**
 * Persist the diverted tool call as an `AgentActionProposal` and return the
 * synthetic tool result. The proposal's `actionType` is the tool name and
 * `parameters` are its args, matching what `approveProposal` executes on accept.
 */
export async function divertToolCallToProposal(input: {
  persistence: ProposalPersistence;
  toolName: string;
  args: Record<string, unknown>;
  agentId: string;
  threadId: string;
  routeContext: string;
  taskRunId: string | null;
}): Promise<ToolResult> {
  const { persistence, toolName, args, agentId, threadId, routeContext, taskRunId } = input;
  const proposalId = `prop-${randomUUID()}`;
  const readable = toolName.replace(/_/g, " ");
  const message = await persistence.createAssistantMessage({
    threadId,
    agentId,
    routeContext,
    content: `Proposed \`${readable}\` for your approval.`,
    taskRunId,
  });
  const proposal = await persistence.createProposal({
    proposalId,
    threadId,
    messageId: message.id,
    taskRunId,
    agentId,
    actionType: toolName,
    parameters: args,
  });
  return buildProposalToolResult(toolName, proposal.proposalId);
}

/**
 * The agentic loop's single entry point: decide + divert + fail-closed, in one
 * call so the hot loop stays thin. Returns the synthetic tool result when the
 * call was captured as a proposal, or `null` when the tool should execute
 * normally (not a propose boundary, or a read-only / artifact tool).
 */
export async function interceptToolCallAsProposal(input: {
  toolDef: Pick<ToolDefinition, "sideEffect" | "coworkerArtifact" | "executionMode"> | undefined;
  proposeSideEffects: boolean;
  toolName: string;
  args: Record<string, unknown>;
  agentId: string;
  threadId: string;
  routeContext: string;
  taskRunId: string | null;
}): Promise<ToolResult | null> {
  if (!shouldProposeToolCall(input.toolDef, input.proposeSideEffects)) return null;
  try {
    return await divertToolCallToProposal({
      persistence: prismaProposalPersistence(),
      toolName: input.toolName,
      args: input.args,
      agentId: input.agentId,
      threadId: input.threadId,
      routeContext: input.routeContext,
      taskRunId: input.taskRunId,
    });
  } catch (err) {
    console.warn(`[agentic-tool] propose-divert failed tool=${input.toolName}:`, err);
    // Fail closed: never execute the side effect when the proposal could not be
    // persisted — report failure so the model summarizes rather than acting.
    return {
      success: false,
      error: "propose_divert_failed",
      message: `Could not queue \`${input.toolName}\` for approval; it was not run. Continue without it.`,
    };
  }
}

/** The live Prisma-backed persistence port. Kept here (not in the agentic loop)
 *  so the loop's divert call is a one-liner and this DB shape lives with the
 *  interception logic it serves. */
export function prismaProposalPersistence(): ProposalPersistence {
  return {
    createAssistantMessage: (m) =>
      prisma.agentMessage.create({
        data: {
          threadId: m.threadId,
          role: "assistant",
          content: m.content,
          agentId: m.agentId,
          routeContext: m.routeContext,
          ...(m.taskRunId ? { taskRunId: m.taskRunId } : {}),
        },
        select: { id: true },
      }),
    createProposal: (p) =>
      prisma.agentActionProposal.create({
        data: {
          proposalId: p.proposalId,
          threadId: p.threadId,
          messageId: p.messageId,
          ...(p.taskRunId ? { taskRunId: p.taskRunId } : {}),
          agentId: p.agentId,
          actionType: p.actionType,
          parameters: p.parameters as Prisma.InputJsonValue,
          status: "proposed",
        },
        select: { proposalId: true },
      }),
  };
}
