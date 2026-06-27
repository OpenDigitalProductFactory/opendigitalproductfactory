import type { WorkCaseActionDescriptor } from "./action-registry";
import type { WorkCasePolicyDecision } from "./policy-envelope";
import type { ReceiptEnvelope } from "./receipt-envelope";
import type { WorkCaseStateProjection } from "./status-projection";

export type WorkCaseReceiptCoverageDenialReason =
  | "policy_denied"
  | "terminal_case_sealed"
  | "missing_receipt"
  | "receipt_not_governed"
  | "receipt_not_observed"
  | "receipt_invalid";

export type WorkCaseReceiptCoverageResult =
  | {
      ok: true;
      enforcementMode: ReceiptEnvelope["enforcementMode"];
      receiptId?: string;
    }
  | {
      ok: false;
      reason: WorkCaseReceiptCoverageDenialReason;
      message: string;
    };

function deny(
  reason: WorkCaseReceiptCoverageDenialReason,
  message: string,
): WorkCaseReceiptCoverageResult {
  return { ok: false, reason, message };
}

export function assertWorkCaseReceiptCoverage(input: {
  action: WorkCaseActionDescriptor;
  policyDecision: WorkCasePolicyDecision;
  projectedState: Pick<WorkCaseStateProjection, "state" | "terminal">;
  receipt?: ReceiptEnvelope | null;
}): WorkCaseReceiptCoverageResult {
  if (!input.policyDecision.ok) {
    return deny(
      "policy_denied",
      `Policy denied Work Case action '${input.action.action}': ${input.policyDecision.message}`,
    );
  }

  if (input.action.consequential && input.projectedState.terminal) {
    return deny(
      "terminal_case_sealed",
      `Terminal Work Case state '${input.projectedState.state}' cannot complete consequential action '${input.action.action}'.`,
    );
  }

  if (input.action.requiresReceipt && !input.receipt) {
    return deny(
      "missing_receipt",
      `Work Case action '${input.action.action}' requires a receipt.`,
    );
  }

  if (!input.receipt) {
    return {
      ok: true,
      enforcementMode: input.policyDecision.enforcementMode,
    };
  }

  if (
    input.policyDecision.enforcementMode === "governed-action" &&
    input.receipt.enforcementMode !== "governed-action"
  ) {
    return deny(
      "receipt_not_governed",
      `Work Case action '${input.action.action}' requires a governed-action receipt.`,
    );
  }

  if (
    input.policyDecision.enforcementMode === "observed-event" &&
    input.receipt.enforcementMode !== "observed-event"
  ) {
    return deny(
      "receipt_not_observed",
      `Observed Work Case event '${input.action.action}' requires an observed-event receipt.`,
    );
  }

  if (input.receipt.status === "invalid" || input.receipt.status === "failed") {
    return deny(
      "receipt_invalid",
      `Receipt ${input.receipt.receiptId} is '${input.receipt.status}'.`,
    );
  }

  return {
    ok: true,
    enforcementMode: input.receipt.enforcementMode,
    receiptId: input.receipt.receiptId,
  };
}
