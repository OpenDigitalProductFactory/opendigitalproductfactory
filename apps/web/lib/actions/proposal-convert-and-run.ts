// Convert-and-run: a person's approval of a legacy AgentActionProposal runs
// through the reference monitor (approval convergence, BI-C8EC05C9 spec D5;
// PR-C, BI-04E5A511).
//
// Before this, approveProposal and the superuser execute-proposal route each
// called executeTool directly, so an approved proposal ran outside every grant,
// room, hook and audit check: the last two dynamic paths around the monitor
// (GPP OBJ-MEDIATION). Both now call this one core, which keeps the decision
// with the person and mediates the execution:
//   1. Compare-and-set the row from `proposed` to `approved`. Losing the race
//      means another click already decided it, so nothing runs twice.
//   2. governedExecuteTool with exactly today's handler context
//      { agentId, threadId }, the approver as the user, source "rest", and
//      approvalCompletion "platform" so an approval the gate asks for can be
//      completed here.
//   3. Every gate outcome:
//        allow             → the tool already ran: executed / failed;
//        approval_required → the approver approves the envelope the monitor
//                            minted for them, and the platform runner runs it
//                            once (it writes the thread message itself);
//        settled           → an identical approved call already ran: its
//                            recorded outcome;
//        any refusal       → nothing ran: the row goes back to `proposed` and
//                            the refusal is returned, so the card can say the
//                            request can no longer run as proposed.
//   4. The row ends as characterised (executed/failed, executedAt,
//      resultEntityId/resultError), with the decision log and thread message
//      when the caller writes a thread record, and approval_outcome recorded
//      once when an envelope was approved here.
import * as crypto from "crypto";

import { prisma } from "@dpf/db";

import { governedExecuteTool } from "@/lib/mcp-governed-execute";
import type { GovernedExecuteResult } from "@/lib/mcp-governed-execute-types";
import type { ToolResult } from "@/lib/mcp-tool-types";
import type { UserContext } from "@/lib/permissions";
import type { ApprovedRequestRun, PlatformRequestRun } from "@/lib/coworker/approved-request-run-types";

export type LegacyProposal = {
  proposalId: string;
  actionType: string;
  parameters: unknown;
  agentId: string;
  threadId: string;
};

export type ProposalApprover = { userId: string; userContext: UserContext };

export type ConvertAndRunOutcome =
  /** The compare-and-set lost: someone already decided this proposal. */
  | { kind: "already-decided" }
  /** Nothing ran and the row is `proposed` again; `message` says why. */
  | { kind: "refused"; message: string; result: ToolResult }
  /** The call ran (now or earlier, for a settled replay); the row is executed or failed. */
  | { kind: "ran"; result: ToolResult };

type ProposalDb = {
  agentActionProposal: {
    updateMany(args: unknown): Promise<{ count: number }>;
    update(args: unknown): Promise<unknown>;
  };
  authorizationDecisionLog: { create(args: unknown): Promise<unknown> };
  agentMessage: { create(args: unknown): Promise<unknown> };
};

type ApproveEnvelope = (envelopeId: string, userId: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
type RunApproved = (envelopeId: string) => Promise<PlatformRequestRun | null>;
type RecordOutcome = (envelopeId: string, userId: string, outcome: ApprovedRequestRun) => Promise<void>;

export type ConvertAndRunDeps = {
  db?: ProposalDb;
  execute?: typeof governedExecuteTool;
  approveEnvelope?: ApproveEnvelope;
  runApproved?: RunApproved;
  recordOutcome?: RecordOutcome;
  now?: () => Date;
};

// The approval-path modules reach the envelope store and the platform runner;
// they load only when a gate actually asks for an approval.
const approveEnvelopeLive: ApproveEnvelope = async (envelopeId, userId) =>
  (await import("@/lib/coworker/envelope-actions")).approveEnvelope(envelopeId, userId);
const runApprovedLive: RunApproved = async (envelopeId) =>
  (await import("@/lib/coworker/approved-request-run")).runApprovedPlatformRequest(envelopeId);
const recordOutcomeLive: RecordOutcome = async (envelopeId, userId, outcome) =>
  (await import("@/lib/coworker/approval-outcome-store")).recordApprovalOutcome(envelopeId, userId, outcome);

/** A settled run is recorded as its outcome, as the envelope approve route does. */
function recordable(run: PlatformRequestRun): ApprovedRequestRun {
  if (run.status !== "settled") return run;
  return run.outcome === "executed"
    ? { status: "executed", message: run.message, ...(run.entityId ? { entityId: run.entityId } : {}) }
    : { status: "failed", message: run.message };
}

/** The platform runner's result as the tool result the proposal records. */
function runResult(run: Exclude<PlatformRequestRun, { status: "not-run" }>): ToolResult {
  const executed = run.status === "executed" || (run.status === "settled" && run.outcome === "executed");
  const entityId = "entityId" in run && run.entityId ? run.entityId : undefined;
  return executed
    ? { success: true, message: run.message, ...(entityId ? { entityId } : {}) }
    : { success: false, error: run.message, message: run.message };
}

/** A gate answer that ran nothing. `unknown_tool` is a run that cannot happen (characterised S4: failed). */
function isRefusal(result: GovernedExecuteResult): boolean {
  const rejected = result.governance?.rejected;
  return rejected !== undefined && rejected !== "unknown_tool" && rejected !== "approval_required";
}

export async function convertAndRunProposal(
  proposal: LegacyProposal,
  approver: ProposalApprover,
  options: { threadRecord: boolean },
  deps: ConvertAndRunDeps = {},
): Promise<ConvertAndRunOutcome> {
  const db = deps.db ?? (prisma as unknown as ProposalDb);
  const now = deps.now ?? (() => new Date());
  const { proposalId } = proposal;

  const claimed = await db.agentActionProposal.updateMany({
    where: { proposalId, status: "proposed" },
    data: { status: "approved", decidedAt: now(), decidedById: approver.userId },
  });
  if (claimed.count === 0) return { kind: "already-decided" };

  const refuse = async (result: ToolResult): Promise<ConvertAndRunOutcome> => {
    await db.agentActionProposal.updateMany({
      where: { proposalId, status: "approved" },
      data: { status: "proposed", decidedAt: null, decidedById: null },
    });
    return { kind: "refused", message: result.message ?? result.error ?? "It was refused.", result };
  };

  const governed = await (deps.execute ?? governedExecuteTool)({
    toolName: proposal.actionType,
    rawParams: proposal.parameters as Record<string, unknown>,
    userId: approver.userId,
    userContext: approver.userContext,
    context: { agentId: proposal.agentId, threadId: proposal.threadId, approvalCompletion: "platform" },
    source: "rest",
  });

  let result: ToolResult = governed;
  // The platform runner already told the thread on the approval path.
  let threadMessageWritten = false;
  if (governed.governance?.rejected === "approval_required") {
    const envelopeId = typeof governed.data?.envelopeId === "string" ? governed.data.envelopeId : null;
    if (!envelopeId) return refuse(governed);
    const approved = await (deps.approveEnvelope ?? approveEnvelopeLive)(envelopeId, approver.userId);
    if (!approved.ok) return refuse({ success: false, error: "approval_unavailable", message: approved.reason });
    const run: PlatformRequestRun = await (deps.runApproved ?? runApprovedLive)(envelopeId)
      .then((platform) => platform ?? {
        status: "not-run" as const, reason: "no-pending-call" as const,
        message: "The original request could not be found, so it was not run.",
      })
      .catch((error: unknown) => ({
        status: "failed" as const,
        message: error instanceof Error ? error.message : "The approved action could not be run.",
      }));
    await (deps.recordOutcome ?? recordOutcomeLive)(envelopeId, approver.userId, recordable(run)).catch((error: unknown) => {
      console.error(
        "[proposal-convert-and-run] approval outcome not recorded envelope=%s: %s",
        JSON.stringify(envelopeId),
        error instanceof Error ? JSON.stringify(error.message) : JSON.stringify(String(error)),
      );
    });
    if (run.status === "not-run") return refuse({ success: false, error: run.reason, message: run.message });
    result = runResult(run);
    threadMessageWritten = true;
  } else if (isRefusal(governed)) {
    return refuse(governed);
  }

  await db.agentActionProposal.update({
    where: { proposalId },
    data: result.success
      ? { status: "executed", executedAt: now(), ...(result.entityId !== undefined ? { resultEntityId: result.entityId } : {}) }
      : { status: "failed", ...(result.error !== undefined ? { resultError: result.error } : {}) },
  });

  if (options.threadRecord) {
    await db.authorizationDecisionLog.create({
      data: {
        decisionId: `DEC-${crypto.randomUUID()}`,
        actionKey: proposal.actionType,
        objectRef: proposalId,
        actorType: "user",
        actorRef: approver.userId,
        decision: "allow",
        rationale: { proposalId, parameters: proposal.parameters, result: result.message },
      },
    });
    // Tell the coworker in the thread it asked from, so it does not ask again.
    if (!threadMessageWritten) {
      const summary = result.success
        ? `${proposal.actionType} completed successfully.${result.message ? ` ${result.message.slice(0, 500)}` : ""}`
        : `${proposal.actionType} failed: ${result.error ?? result.message ?? "unknown error"}`;
      await db.agentMessage.create({
        data: { threadId: proposal.threadId, role: "system", content: summary, agentId: proposal.agentId },
      }).catch(() => {});
    }
  }

  return { kind: "ran", result };
}
