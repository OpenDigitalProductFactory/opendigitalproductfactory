// apps/web/lib/business-activity-sim/field-service-flow.test.ts
import { describe, expect, it } from "vitest";
import { runFieldServiceFlow, type FieldServiceFlowResult } from "./field-service-flow";
import {
  FIELD_SERVICE_ORACLES,
  FIN1_ledgerBalanced,
  FIN2_revenueRecognized,
  FIN3_receivableReconciles,
  FIN5_noPhantomBilling,
  LC1_terminalPaid,
} from "./oracles";
import {
  DEFAULT_FIELD_SERVICE_SCENARIOS,
  coverageViolations,
  runFieldServiceCoverage,
} from "./coverage";

const allGreen = (r: FieldServiceFlowResult) => FIELD_SERVICE_ORACLES.every((o) => o(r).ok);

describe("runFieldServiceFlow — end-to-end operational spine", () => {
  it("drives a taxed job to paid, posts a balanced GL, and settles AR to zero", () => {
    const r = runFieldServiceFlow({ id: "t", customerAccountId: "c1", subtotal: 300, taxAmount: 30 });
    expect(r.finalStatus).toBe("paid");
    expect(r.lifecycle).toContain("complete");
    expect(r.trialBalance.balanced).toBe(true);
    expect(r.revenueRecognized).toBe(300); // tax is NOT revenue
    expect(r.cashReceived).toBe(330); // gross
    expect(r.receivableBalance).toBe(0); // fully settled
    expect(allGreen(r)).toBe(true);
  });

  it("handles a job with no tax", () => {
    const r = runFieldServiceFlow({ id: "u", customerAccountId: "c2", subtotal: 450 });
    expect(r.revenueRecognized).toBe(450);
    expect(r.cashReceived).toBe(450);
    expect(r.receivableBalance).toBe(0);
    expect(allGreen(r)).toBe(true);
  });

  it("leaves a correct outstanding receivable on a legitimate partial payment", () => {
    const r = runFieldServiceFlow({ id: "p", customerAccountId: "c3", subtotal: 200, taxAmount: 20, paymentAmount: 150 });
    expect(r.gross).toBe(220);
    expect(r.receivableBalance).toBe(70); // 220 gross − 150 paid
    expect(r.trialBalance.balanced).toBe(true); // each posting balances regardless
    expect(allGreen(r)).toBe(true); // a partial payment is a valid business state
  });
});

describe("runFieldServiceCoverage", () => {
  it("passes every oracle across the default scenario set", () => {
    const report = runFieldServiceCoverage(DEFAULT_FIELD_SERVICE_SCENARIOS);
    expect(report.passed).toBe(true);
    expect(report.passRate).toBe(1);
    expect(coverageViolations(report)).toEqual([]);
    expect(report.scenarios).toHaveLength(3);
  });
});

// The oracles are only worth running if they can catch a broken flow. These prove
// each one has teeth by handing it a deliberately corrupted result.
describe("oracles catch broken flows (teeth)", () => {
  const good = () => runFieldServiceFlow({ id: "g", customerAccountId: "c", subtotal: 300, taxAmount: 30 });

  it("FIN1 catches an unbalanced ledger", () => {
    const r = good();
    r.trialBalance = { ...r.trialBalance, balanced: false, totalDebit: 330, totalCredit: 300 };
    expect(FIN1_ledgerBalanced(r).ok).toBe(false);
  });

  it("FIN2 catches tax booked as revenue", () => {
    const r = good();
    r.revenueRecognized = r.gross; // 330 instead of 300 — tax wrongly recognised as income
    const res = FIN2_revenueRecognized(r);
    expect(res.ok).toBe(false);
    expect(res.violations[0]).toContain("revenue recognised");
  });

  it("FIN3 catches a mis-stated receivable", () => {
    const r = good();
    r.receivableBalance = 100; // should be 0 after full settlement
    expect(FIN3_receivableReconciles(r).ok).toBe(false);
  });

  it("FIN5 catches phantom billing (invoice without a completed visit)", () => {
    const r = good();
    r.workCompletedBeforeInvoice = false; // revenue posted but job never completed
    expect(FIN5_noPhantomBilling(r).ok).toBe(false);
  });

  it("LC1 catches a job that did not reach paid", () => {
    const r = good();
    r.finalStatus = "complete";
    expect(LC1_terminalPaid(r).ok).toBe(false);
  });
});
