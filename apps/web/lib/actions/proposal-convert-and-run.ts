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
//        a settled no      → nothing ran: the row goes back to `proposed` with
//                            the reason in resultError (so a reload still
//                            says it can no longer run as proposed), and with a
//                            thread record the approval and refusal are logged
//                            and the coworker is told;
//        any other no      → a hold (permit_required), an inconclusive check,
//                            or an escalation: nothing ran, the row goes back
//                            to `proposed` and Approve can be tried again.
//      When the approver approved an envelope here and the runner then could
//      not run it, that envelope is cancelled, so a later approve can never
//      spend it past the reason it was not run (waiver W5).
//   4. The row ends as characterised (executed/failed, executedAt,
//      resultEntityId/resultError), with the decision log and thread message
//      when the caller writes a thread record, and approval_outcome recorded
//      once when an envelope was approved here.
//   5. A throw after the claim never strands the row `approved`: it is
//      compare-and-set to `failed` and reported as `threw`.
import * as crypto from "crypto";

import { prisma } from "@dpf/db";

import { getErrorMessage } from "@/lib/shared/get-error-message";

import { governedExecuteTool } from "@/lib/mcp-governed-execute";
import type { GovernedExecuteResult } from "@/lib/mcp-governed-execute-types";
import type { ToolResult } from "@/lib/mcp-tool-types";
import { isGovernedToolRefusal } from "@/lib/govern/authority/governed-rejection-disposition";
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
  /** A settled no: nothing ran, the row is `proposed` again with `message` as its resultError. */
  | { kind: "refused"; message: string; result: ToolResult }
  /** Not a settled no (a hold, an inconclusive check): nothing ran, the row is `proposed`, retryable. */
  | { kind: "held"; message: string; result: ToolResult }
  /** The call ran (now or earlier, for a settled replay); the row is executed or failed. */
  | { kind: "ran"; result: ToolResult }
  /** Something threw after the claim; the row was compare-and-set from `approved` to `failed`. */
  | { kind: "threw"; error: string };

type ProposalDb = {
  agentActionProposal: {
    updateMany(args: unknown): Promise<{ count: number }>;
    update(args: unknown): Promise<unknown>;
  };
  authorizationDecisionLog: { create(args: unknown): Promise<unknown> };
  agentMessage: { create(args: unknown): Promise<unknown> };
};

/** An envelope decision as convert-and-run reads it (EnvelopeActionResult fits it). */
type EnvelopeDecision = { ok: boolean; reason?: string };
type ApproveEnvelope = (envelopeId: string, userId: string) => Promise<EnvelopeDecision>;
type RunApproved = (envelopeId: string) => Promise<PlatformRequestRun | null>;
type RecordOutcome = (envelopeId: string, userId: string, outcome: ApprovedRequestRun) => Promise<void>;
type CancelEnvelope = (envelopeId: string, userId: string) => Promise<EnvelopeDecision>;

export type ConvertAndRunDeps = {
  db?: ProposalDb;
  execute?: typeof governedExecuteTool;
  approveEnvelope?: ApproveEnvelope;
  runApproved?: RunApproved;
  recordOutcome?: RecordOutcome;
  cancelEnvelope?: CancelEnvelope;
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
const cancelEnvelopeLive: CancelEnvelope = async (envelopeId, userId) =>
  (await import("@/lib/coworker/envelope-actions")).cancelEnvelope(envelopeId, userId);

/** A settled run is recorded as its outcome, as the envelope approve route does. */
function recordable(run: PlatformRequestRun): ApprovedRequestRun {
  if (run.status !== "settled") return run;
  return run.outcome === "executed"
    ? { status: "executed", message: run.message, ...(run.entityId ? { entityId: run.entityId } : {}) }
    : { status: "failed", message: run.message };
}

/** The platform runner's result as the tool result the proposal records: a short code in `error`, its prose in `message`. */
function runResult(run: Exclude<PlatformRequestRun, { status: "not-run" }>): ToolResult {
  const executed = run.status === "executed" || (run.status === "settled" && run.outcome === "executed");
  const entityId = "entityId" in run && run.entityId ? run.entityId : undefined;
  return executed
    ? { success: true, message: run.message, ...(entityId ? { entityId } : {}) }
    : { success: false, error: "approval_run_failed", message: run.message };
}

/**
 * A gate answer that ran nothing, other than approval_required (handled here)
 * and `unknown_tool`, a run that cannot happen (characterised S4: failed).
 * "refused" is a settled no; anything else (permit_required, an inconclusive
 * check, an escalation) is a hold the approver can try again after.
 */
function gateAnswer(result: GovernedExecuteResult): "refused" | "held" | null {
  const rejected = result.governance?.rejected;
  if (rejected === undefined || rejected === "unknown_tool" || rejected === "approval_required") return null;
  return isGovernedToolRefusal(result) ? "refused" : "held";
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

  // Once the row is finalised, a later throw (the decision log, say) must not
  // turn a run that happened into a reported failure.
  let finalised: ConvertAndRunOutcome | null = null;
  try {
    finalised = await runClaimed(proposal, approver, options, deps, db, now, (outcome) => { finalised = outcome; });
    return finalised;
  } catch (error) {
    if (finalised) {
      console.error(
        "[proposal-convert-and-run] record after the run failed proposal=%s: %s",
        JSON.stringify(proposalId), JSON.stringify(getErrorMessage(error)),
      );
      return finalised;
    }
    // Never strand the row `approved`: only the claimed row moves, so a row
    // another path already settled is left alone.
    const message = getErrorMessage(error) || "Execution failed";
    await db.agentActionProposal.updateMany({
      where: { proposalId, status: "approved" },
      data: { status: "failed", resultError: message },
    }).catch((writeError: unknown) => {
      console.error(
        "[proposal-convert-and-run] could not mark proposal=%s failed: %s",
        JSON.stringify(proposalId), JSON.stringify(getErrorMessage(writeError)),
      );
    });
    return { kind: "threw", error: message };
  }
}

async function runClaimed(
  proposal: LegacyProposal,
  approver: ProposalApprover,
  options: { threadRecord: boolean },
  deps: ConvertAndRunDeps,
  db: ProposalDb,
  now: () => Date,
  markFinalised: (outcome: ConvertAndRunOutcome) => void,
): Promise<ConvertAndRunOutcome> {
  const { proposalId } = proposal;

  /** Nothing ran: the row goes back to `proposed`. A settled no keeps its reason on the row. */
  const revert = async (kind: "refused" | "held", result: ToolResult): Promise<ConvertAndRunOutcome> => {
    const message = result.message ?? result.error ?? "It was refused.";
    await db.agentActionProposal.updateMany({
      where: { proposalId, status: "approved" },
      data: { status: "proposed", decidedAt: null, decidedById: null, resultError: kind === "refused" ? message : null },
    });
    const outcome: ConvertAndRunOutcome = { kind, message, result };
    markFinalised(outcome);
    if (kind === "refused" && options.threadRecord) {
      await db.authorizationDecisionLog.create({
        data: {
          decisionId: `DEC-${crypto.randomUUID()}`,
          actionKey: proposal.actionType,
          objectRef: proposalId,
          actorType: "user",
          actorRef: approver.userId,
          decision: "allow",
          rationale: { proposalId, refusedByMonitor: true, reason: message },
        },
      });
      await db.agentMessage.create({
        data: {
          threadId: proposal.threadId, role: "system", agentId: proposal.agentId,
          content: `${proposal.actionType} was approved but could not run as proposed: ${message}`,
        },
      }).catch(() => {});
    }
    return outcome;
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
  // A fresh platform-runner run already told the thread; a recorded settled
  // outcome did not. On a failure, the runner's prose (not its code) is the detail.
  let threadMessageWritten = false;
  let failureDetail: string | undefined = governed.error ?? governed.message;
  if (governed.governance?.rejected === "approval_required") {
    const envelopeId = typeof governed.data?.envelopeId === "string" ? governed.data.envelopeId : null;
    if (!envelopeId) return revert("refused", governed);
    const approved = await (deps.approveEnvelope ?? approveEnvelopeLive)(envelopeId, approver.userId);
    if (!approved.ok) return revert("refused", { success: false, error: "approval_unavailable", message: approved.reason ?? "The approval could not be recorded." });
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
        JSON.stringify(getErrorMessage(error)),
      );
    });
    if (run.status === "not-run") {
      // The approver's envelope is approved but did not run. Cancel it so a
      // later approve cannot spend it past the reason it was not run (W5).
      // The runner may already have settled it; a refused cancel changes nothing.
      await (deps.cancelEnvelope ?? cancelEnvelopeLive)(envelopeId, approver.userId).catch((error: unknown) => {
        console.error(
          "[proposal-convert-and-run] approved envelope not cancelled after not-run envelope=%s: %s",
          JSON.stringify(envelopeId), JSON.stringify(getErrorMessage(error)),
        );
      });
      return revert("refused", { success: false, error: run.reason, message: run.message });
    }
    result = runResult(run);
    failureDetail = run.message;
    threadMessageWritten = run.status === "executed" || run.status === "failed";
  } else {
    const answer = gateAnswer(governed);
    if (answer) return revert(answer, governed);
  }

  await db.agentActionProposal.update({
    where: { proposalId },
    data: result.success
      ? { status: "executed", executedAt: now(), ...(result.entityId !== undefined ? { resultEntityId: result.entityId } : {}) }
      : { status: "failed", ...(result.error !== undefined ? { resultError: result.error } : {}) },
  });
  const outcome: ConvertAndRunOutcome = { kind: "ran", result };
  markFinalised(outcome);

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
        : `${proposal.actionType} failed: ${failureDetail ?? "unknown error"}`;
      await db.agentMessage.create({
        data: { threadId: proposal.threadId, role: "system", content: summary, agentId: proposal.agentId },
      }).catch(() => {});
    }
  }

  return outcome;
}
