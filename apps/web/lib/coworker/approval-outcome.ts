import { SOURCE_CATALOG, type MessageKey } from "@dpf/i18n";
import { isRecord } from "@/lib/shared/coerce";
import { envelopeInboxRoute } from "./envelope-routes";

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
};
export type ApprovalOutcomeRow = {
  id: string;
  status: string;
  expiresAt: Date | null;
  createdAt: Date;
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
  const nextActionKey: MessageKey<"approvals"> = state === "not-run" && reason ? `recovery.${reason}` : `states.${state}.next`;
  return {
    envelopeId: row.id, state, label,
    nextAction: state === "not-run" && reason ? RECOVERY[reason] : nextAction,
    nextActionKey,
    inboxHref: envelopeInboxRoute(row.id),
    createdAtIso: row.createdAt.toISOString(),
  };
}
