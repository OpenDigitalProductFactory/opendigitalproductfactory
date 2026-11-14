import { SOURCE_CATALOG, type MessageKey } from "@dpf/i18n";
import { isRecord } from "@/lib/shared/coerce";
import { envelopeInboxRoute, envelopeResultRoute } from "./envelope-routes";
import { readOnBehalfDecision, type OnBehalfDecision } from "./on-behalf-decision";
import type { RuntimeApprovalActionEvidence } from "./approval-action-evidence";

/** A read model, not an authority or execution state machine. */
export type ApprovalOutcomeState = "waiting" | "executed" | "failed" | "not-run" | "expired" | "declined" | "cancelled" | "unknown";
export type ApprovalOutcome = {
  envelopeId: string;
  state: ApprovalOutcomeState;
  label: string;
  nextAction: string;
  nextActionKey: MessageKey<"approvals">;
  inboxHref: string;
  createdAtIso: string;
  failureEvidence?: ApprovalFailureEvidence;
  failureExplanation?: string;
  failureExplanationKey?: MessageKey<"approvals">;
  runtimeEvidence?: RuntimeApprovalActionEvidence | UnavailableApprovalEvidence;
  runtimeExplanation?: string;
  runtimeExplanationKey?: MessageKey<"approvals">;
  /** BI-7BCC87BB: an admin decided this request on the owner's behalf. */
  decidedOnBehalf?: OnBehalfDecision;
};

/** Closed absence reasons shared by approval evidence readers. */
export type UnavailableApprovalEvidence = {
  state: "missing" | "conflicting" | "unsupported";
  reason: "not-settled" | "binding-unproven" | "operation-unsupported" | "execution-missing" | "execution-ambiguous" | "execution-binding-mismatch" | "result-unproven";
};

/** Safe recorded failure facts; raw operation data stays server-only. */
export type ApprovalFailureEvidence =
  | UnavailableApprovalEvidence
  | { state: "available"; code: "handoff-transaction-required"; executionId: string; executedAtIso: string;
      threadBinding: "matched" | "not-recorded"; roomHref?: string; roomAccess: "available" | "unavailable" };

export function withApprovalFailureEvidence(outcome: ApprovalOutcome, evidence: ApprovalFailureEvidence): ApprovalOutcome {
  if (outcome.state !== "failed") return outcome;
  const key = evidence.state === "available" ? "handoff-transaction-required" : evidence.state === "conflicting" ? "conflicting" : "unproven";
  const copy = SOURCE_CATALOG.approvals.failure[key];
  return { ...outcome, failureEvidence: evidence, failureExplanation: copy.reason,
    failureExplanationKey: `failure.${key}.reason`, nextAction: copy.next, nextActionKey: `failure.${key}.next` };
}

/** Approval settlement, recorded operation and verified host proof are separate. */
export function withApprovalRuntimeEvidence(outcome: ApprovalOutcome, evidence: RuntimeApprovalActionEvidence | UnavailableApprovalEvidence): ApprovalOutcome {
  const copy = SOURCE_CATALOG.approvals.runtime;
  let explanation: keyof typeof copy = "unproven";
  let next: "inspect" | "inspectRecovery" | "continue" = "inspect";
  if (evidence.state === "available") {
    const host = evidence.hostEvidence;
    if (host.state === "recorded" && (host.recoveryRequired === "recorded" || host.status === "rollback_failed" || host.status === "compensating")) {
      explanation = "recovery"; next = "inspectRecovery";
    } else if (host.state === "recorded" && host.receiptVerification === "verified" && host.receiptStatus === "applied") {
      if (host.status === "succeeded" && evidence.outcome === "succeeded") {
        explanation = "verified"; next = "continue";
      } else explanation = "appliedPending";
    } else if (evidence.failureCode === "runtime_transition_database_stale" || evidence.failureCode === "runtime_transition_database_baseline_changed") {
      explanation = "settingsChanged";
    } else if (evidence.outcome === "incomplete") explanation = "incomplete";
    else if (evidence.outcome === "succeeded") explanation = "reportedCompletion";
  }
  return { ...outcome, runtimeEvidence: evidence, runtimeExplanation: copy[explanation], runtimeExplanationKey: `runtime.${explanation}`,
    nextAction: copy[next], nextActionKey: `runtime.${next}` };
}

export type ApprovalOutcomeRow = {
  id: string;
  status: string;
  expiresAt: Date | null;
  createdAt: Date;
  argsJson?: unknown;
  toolExecutions: Array<{ executionMode: string; success: boolean; result: unknown }>;
};

const COPY = SOURCE_CATALOG.approvals.states;
const RECOVERY = SOURCE_CATALOG.approvals.recovery;

/** Never expose arguments, raw errors, result payloads, or another task's data. */
export function projectApprovalOutcome(row: ApprovalOutcomeRow, now: Date): ApprovalOutcome {
  const receipt = row.toolExecutions.find((execution) => execution.executionMode === "approval-outcome");
  const saved = isRecord(receipt?.result) ? receipt.result : {};
  let state: ApprovalOutcomeState = "unknown";
  // The executor's terminal state wins over an earlier not-run attempt.
  if (row.status === "executed" || row.status === "failed" || row.status === "declined" || row.status === "cancelled") {
    state = row.status;
  } else if (saved.status === "executed" || saved.status === "failed" || saved.status === "not-run") {
    state = saved.status;
  } else if (row.status === "expired" || (row.status === "proposed" && row.expiresAt && row.expiresAt <= now)) {
    state = "expired";
  } else if (row.status === "proposed") {
    state = "waiting";
  }
  const { label, next: nextAction } = COPY[state];
  const reason = typeof saved.reason === "string" && Object.hasOwn(RECOVERY, saved.reason)
    ? saved.reason as keyof typeof RECOVERY : null;
  const onBehalf = readOnBehalfDecision(row.argsJson);
  const nextActionKey: MessageKey<"approvals"> = state === "not-run" && reason ? `recovery.${reason}` : `states.${state}.next`;
  return {
    envelopeId: row.id, state, label,
    nextAction: state === "not-run" && reason ? RECOVERY[reason] : nextAction,
    nextActionKey,
    inboxHref: state === "waiting" ? envelopeInboxRoute(row.id) : envelopeResultRoute(row.id),
    createdAtIso: row.createdAt.toISOString(),
    ...(onBehalf ? { decidedOnBehalf: onBehalf } : {}),
  };
}
