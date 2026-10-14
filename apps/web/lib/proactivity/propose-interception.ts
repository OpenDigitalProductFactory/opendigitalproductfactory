// BI-80532D5C — propose-interception for scheduled coworker runs.
//
// The proactivity plan's `actionBoundary === "propose"` is the middle rung
// between `advise` (side-effecting tools stripped entirely — the coworker can
// only recommend) and `act` (side-effecting tools run directly). Under a
// propose boundary a side-effecting tool the coworker calls is NOT executed:
// it becomes a request for a person to authorize, and a synthetic tool result
// tells the model the action is queued so the run finishes cleanly instead of
// stalling.
//
// BI-7BCC87BB (approval convergence PR-B, spec D2 S2): the request is a
// CoworkerActionEnvelope the reference monitor raises, bound to the exact
// call. This module no longer writes an AgentActionProposal. It hands the call
// to the governed executor with `proposeBoundary` (the escalation gate's
// propose-boundary branch puts it to a person, and policy projection is off)
// and `approvalCompletion: "platform"` (the approve route runs it once on
// Authorize, through the monitor again). The run is never paused for it.
//
// Curated artifacts (knowledge articles, campaign briefs) carry
// `coworkerArtifact` — idempotent, groundable, non-fact-mutating writes that are
// the whole point of a registered self-task — so they still run directly. Only
// side-effecting, non-artifact tools (the ones that create business-fact rows or
// reach customers) are diverted.
import { prisma } from "@dpf/db";

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tool-types";

/** The assistant-message writer, injected so the wording logic stays unit-testable without a database. */
export type ProposeMessagePersistence = {
  createAssistantMessage(input: {
    threadId: string;
    agentId: string;
    routeContext: string;
    content: string;
    taskRunId: string | null;
  }): Promise<{ id: string }>;
};

/** The server-set context a diverted call is executed under. Never from a transport (AC-TRANSPORT). */
export type ProposeBoundaryContext = { proposeBoundary: true; approvalCompletion: "platform" };

/** Runs the diverted call through the governed executor; the agentic loop supplies the rest of its context. */
export type ProposeBoundaryExecute = (boundary: ProposeBoundaryContext) => Promise<ToolResult>;

/**
 * True when a tool the model called must be diverted instead of executed.
 * Only fires under an active propose boundary, for side-effecting tools that
 * are NOT curated artifacts and NOT already proposal-mode (those take the
 * loop's own declared-proposal path). Pure — no I/O.
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

function schemaHasWriteOnly(schema: unknown): boolean {
  if (!schema || typeof schema !== "object") return false;
  const record = schema as Record<string, unknown>;
  if (record["writeOnly"] === true) return true;
  return Object.values(record).some((value) => schemaHasWriteOnly(value));
}

/**
 * True when the tool takes a secret (`writeOnly`) input. Such a call cannot be
 * queued: the approved run must replay the exact arguments, and keeping a
 * secret around for that is what waiver W5 refuses. Pure.
 */
export function toolTakesSecretInput(toolDef: Pick<ToolDefinition, "inputSchema"> | { inputSchema?: unknown }): boolean {
  return schemaHasWriteOnly(toolDef.inputSchema);
}

/** The synthetic tool result handed back to the model once the request is
 *  raised, so it understands the action is pending approval and can summarize
 *  rather than retry or fabricate success. Pure. */
export function buildProposalToolResult(toolName: string, envelopeId: string, expiresAt?: string | null): ToolResult {
  const readable = toolName.replace(/_/g, " ");
  const until = expiresAt ? `, open until ${expiresAt}` : "";
  return {
    success: true,
    entityId: envelopeId,
    message:
      `Proposed "${readable}" for the owner's approval instead of running it now ` +
      `(this coworker is set to propose, not act). It will run exactly as proposed ` +
      `once approved from the Needs-you inbox (approval request ${envelopeId}${until}). ` +
      `If nobody answers before then, it shows as expired unanswered and can be asked again. ` +
      `Do not retry it — continue with any remaining read-only work and summarize what you proposed.`,
    data: { envelopeId, expiresAt: expiresAt ?? null, status: "proposed" },
  };
}

function secretRefusal(toolName: string): ToolResult {
  return {
    success: false,
    error: "propose_secret_refused",
    message: `${toolName} needs a secret and cannot be queued for approval; it was not run. Ask the owner to run it themselves.`,
  };
}

function failedDivert(toolName: string): ToolResult {
  return {
    success: false,
    error: "propose_divert_failed",
    message: `Could not queue \`${toolName}\` for approval; it was not run. Continue without it.`,
  };
}

function pendingEnvelope(result: ToolResult): { envelopeId: string; expiresAt: string | null } | null {
  if (result.success || result.error !== "approval_required") return null;
  const data = result.data as Record<string, unknown> | undefined;
  const envelopeId = typeof data?.["envelopeId"] === "string" ? data["envelopeId"] : null;
  if (!envelopeId) return null;
  return { envelopeId, expiresAt: typeof data?.["expiresAt"] === "string" ? data["expiresAt"] : null };
}

/**
 * The agentic loop's single entry point. Returns `null` when the tool should
 * execute normally (not a propose boundary, a read-only or artifact tool, or
 * a write the run's room mandate declares). Otherwise the call goes through
 * the monitor under the boundary, and the result depends on the gate:
 *   - approval required: the request is raised; the synthetic success with
 *     its envelope id and expiry, and the "Proposed `X`" thread message;
 *   - allow: an approval for this exact call already existed, so the tool ran;
 *     its real result;
 *   - settled: the recorded outcome of the identical approved call;
 *   - any refusal: a not-run `success: false` (waiver W2). Nothing ran.
 */
export async function interceptToolCallAsProposal(input: {
  toolDef: (Pick<ToolDefinition, "sideEffect" | "coworkerArtifact" | "executionMode"> & { inputSchema?: unknown }) | undefined;
  proposeSideEffects: boolean;
  toolName: string;
  args: Record<string, unknown>;
  agentId: string;
  threadId: string;
  routeContext: string;
  taskRunId: string | null;
  execute: ProposeBoundaryExecute;
}, deps: {
  persistence?: ProposeMessagePersistence;
  /** Test seam; production reads room-stage-mandate.ts. */
  resolveMandatedTools?: (input: { taskRunId: string | null; agentId: string }) => Promise<readonly string[]>;
} = {}): Promise<ToolResult | null> {
  if (!shouldProposeToolCall(input.toolDef, input.proposeSideEffects)) return null;
  // BI-C1781121: a write the run's Workroom stage declares is a recorded
  // decision (the same one the escalation gate steers as `scheduled-mandate`),
  // so it runs. The propose boundary stays in force for every other write, and
  // an unreadable mandate diverts as before.
  if (await runMandatesTool(input, deps.resolveMandatedTools)) return null;
  if (input.toolDef && toolTakesSecretInput(input.toolDef)) return secretRefusal(input.toolName);

  let result: ToolResult;
  try {
    result = await input.execute({ proposeBoundary: true, approvalCompletion: "platform" });
  } catch (err) {
    console.warn(`[agentic-tool] propose-divert failed tool=${input.toolName}:`, err);
    // Fail closed: report failure so the model summarizes rather than acting.
    return failedDivert(input.toolName);
  }

  const pending = pendingEnvelope(result);
  if (!pending) {
    if (result.success) return result;
    const message = result.message ?? result.error ?? "refused";
    return /not run/i.test(message) ? result : { ...result, message: `${message} It was not run.` };
  }

  const readable = input.toolName.replace(/_/g, " ");
  try {
    await (deps.persistence ?? prismaProposeMessagePersistence()).createAssistantMessage({
      threadId: input.threadId,
      agentId: input.agentId,
      routeContext: input.routeContext,
      content: `Proposed \`${readable}\` for your approval.`,
      taskRunId: input.taskRunId,
    });
  } catch (err) {
    // The request is raised and visible in Needs-you; the thread note is a convenience.
    console.warn(`[agentic-tool] propose message not written tool=${input.toolName}:`, err);
  }
  return buildProposalToolResult(input.toolName, pending.envelopeId, pending.expiresAt);
}

async function runMandatesTool(
  input: { toolName: string; agentId: string; taskRunId: string | null },
  resolve?: (input: { taskRunId: string | null; agentId: string }) => Promise<readonly string[]>,
): Promise<boolean> {
  try {
    const load = resolve
      ?? (await import("@/lib/work-management/room-stage-mandate")).loadScheduledRoomMandateLive;
    return (await load({ taskRunId: input.taskRunId, agentId: input.agentId })).includes(input.toolName);
  } catch {
    return false;
  }
}

/** The live thread-message writer. */
export function prismaProposeMessagePersistence(): ProposeMessagePersistence {
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
  };
}
