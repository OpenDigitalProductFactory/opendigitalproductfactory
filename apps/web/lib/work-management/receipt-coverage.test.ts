import { describe, expect, it } from "vitest";

import { getWorkCaseAction } from "./action-registry";
import type { WorkCasePolicyDecision } from "./policy-envelope";
import {
  fromRuntimeVerification,
  fromToolExecutionReceipt,
} from "./receipt-envelope";
import { assertWorkCaseReceiptCoverage } from "./receipt-coverage";

const ACTIVE_STATE = {
  state: "active",
  terminal: false,
} as const;

const TERMINAL_STATE = {
  state: "closed",
  terminal: true,
} as const;

const ALLOWED_GOVERNED_POLICY = {
  ok: true,
  enforcementMode: "governed-action",
  requiredReceiptKind: "governed-action",
} as const satisfies WorkCasePolicyDecision;

const ALLOWED_OBSERVED_POLICY = {
  ok: true,
  enforcementMode: "observed-event",
  requiredReceiptKind: "observed-event",
} as const satisfies WorkCasePolicyDecision;

const DENIED_POLICY = {
  ok: false,
  reason: "unsupported_transition",
  message: "Source does not support this action.",
  // A transition the source does not have never yields to a retry (BI-81780B4A).
  disposition: "hard-no",
  shapeHint: null,
} as const satisfies WorkCasePolicyDecision;

const GOVERNED_RECEIPT = fromToolExecutionReceipt({
  id: "ter-1",
  toolExecutionId: "te-1",
  receiptKind: "work-case-governed-action",
  receiptStatus: "valid",
  executionStatus: "success",
  inputFingerprint: "sha256:input",
  outputDigest: { ok: true },
  createdAt: "2026-06-27T21:00:00.000Z",
});

const OBSERVED_RECEIPT = fromRuntimeVerification({
  id: "rv-row-1",
  verificationId: "RV-1",
  kind: "unit-test",
  status: "passed",
  result: { ok: true },
  createdAt: "2026-06-27T21:00:00.000Z",
});

describe("assertWorkCaseReceiptCoverage", () => {
  it("returns missing_receipt for consequential governed actions with no receipt", () => {
    expect(
      assertWorkCaseReceiptCoverage({
        action: getWorkCaseAction("complete")!,
        policyDecision: ALLOWED_GOVERNED_POLICY,
        projectedState: ACTIVE_STATE,
        receipt: null,
      }),
    ).toMatchObject({
      ok: false,
      reason: "missing_receipt",
    });
  });

  it("returns receipt_not_governed when only an observed-event receipt exists", () => {
    expect(
      assertWorkCaseReceiptCoverage({
        action: getWorkCaseAction("complete")!,
        policyDecision: ALLOWED_GOVERNED_POLICY,
        projectedState: ACTIVE_STATE,
        receipt: OBSERVED_RECEIPT,
      }),
    ).toMatchObject({
      ok: false,
      reason: "receipt_not_governed",
    });
  });

  it("returns policy_denied when the policy evaluator denied the action", () => {
    expect(
      assertWorkCaseReceiptCoverage({
        action: getWorkCaseAction("complete")!,
        policyDecision: DENIED_POLICY,
        projectedState: ACTIVE_STATE,
        receipt: GOVERNED_RECEIPT,
      }),
    ).toMatchObject({
      ok: false,
      reason: "policy_denied",
    });
  });

  it("returns terminal_case_sealed for terminal projected state", () => {
    expect(
      assertWorkCaseReceiptCoverage({
        action: getWorkCaseAction("complete")!,
        policyDecision: ALLOWED_GOVERNED_POLICY,
        projectedState: TERMINAL_STATE,
        receipt: GOVERNED_RECEIPT,
      }),
    ).toMatchObject({
      ok: false,
      reason: "terminal_case_sealed",
    });
  });

  it("allows non-consequential observed source events with observed receipts", () => {
    expect(
      assertWorkCaseReceiptCoverage({
        action: getWorkCaseAction("respond")!,
        policyDecision: ALLOWED_OBSERVED_POLICY,
        projectedState: ACTIVE_STATE,
        receipt: OBSERVED_RECEIPT,
      }),
    ).toEqual({
      ok: true,
      enforcementMode: "observed-event",
      receiptId: OBSERVED_RECEIPT.receiptId,
    });
  });

  it("allows consequential actions with a passing policy and governed receipt", () => {
    expect(
      assertWorkCaseReceiptCoverage({
        action: getWorkCaseAction("complete")!,
        policyDecision: ALLOWED_GOVERNED_POLICY,
        projectedState: ACTIVE_STATE,
        receipt: GOVERNED_RECEIPT,
      }),
    ).toEqual({
      ok: true,
      enforcementMode: "governed-action",
      receiptId: GOVERNED_RECEIPT.receiptId,
    });
  });
});
