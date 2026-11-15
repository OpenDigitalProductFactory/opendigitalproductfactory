import { beforeEach, describe, expect, it, vi } from "vitest";

// An in-memory stand-in for the tables recordPayRunPaid and approvePayRun touch,
// so the claim-guarded transactions are exercised end to end.
const state = vi.hoisted(() => ({
  run: { id: "run-1", payRunRef: "PR-1", status: "approved", periodEnd: new Date("2026-03-31T00:00:00Z"), payDate: new Date("2026-03-31T00:00:00Z") },
  payslips: [{ id: "slip-1", netPay: 1690.85, earnings: [{ code: "BASE", label: "Base salary", amount: 2000 }],
    employeeDeductions: [{ code: "US_FWT", label: "Federal income tax", amount: 156.15 }, { code: "US_SS_EE", label: "Social Security", amount: 124 }, { code: "US_MED_EE", label: "Medicare", amount: 29 }],
    employerCosts: [{ code: "US_SS_ER", label: "Social Security (employer)", amount: 124 }],
    disbursementStatus: "pending" }],
  journals: [] as Array<{ entryRef: string; memo: string }>,
  staleRead: null as string | null,
}));

vi.mock("@dpf/db", () => {
  const tx = {
    payRun: {
      updateMany: async ({ where, data }: { where: { status: string }; data: { status: string } }) => {
        if (state.run.status !== where.status) return { count: 0 };
        state.run.status = data.status;
        return { count: 1 };
      },
    },
    payslip: {
      update: async ({ where, data }: { where: { id: string; disbursementStatus: string }; data: { disbursementStatus: string } }) => {
        const slip = state.payslips.find((p) => p.id === where.id && p.disbursementStatus === where.disbursementStatus);
        if (!slip) throw new Error("payslip not pending");
        slip.disbursementStatus = data.disbursementStatus;
        return slip;
      },
    },
    journalEntry: {
      create: async ({ data }: { data: { entryRef: string; memo: string } }) => {
        state.journals.push({ entryRef: data.entryRef, memo: data.memo });
        return { id: `je-${state.journals.length}` };
      },
    },
  };
  return {
    prisma: {
      ...tx,
      payRun: { ...tx.payRun, findUnique: async () => ({ ...state.run, status: state.staleRead ?? state.run.status, payslips: state.payslips }) },
      organization: { findFirst: async () => ({ id: "org-1" }) },
      ledgerAccount: {
        findMany: async () => [
          { id: "acc-bank", code: "1000", name: "Cash at Bank", type: "asset" },
          { id: "acc-net", code: "2300", name: "Net Pay Payable", type: "liability" },
          { id: "acc-taxpay", code: "2310", name: "Payroll Taxes Payable", type: "liability" },
          { id: "acc-ded", code: "2320", name: "Payroll Deductions Payable", type: "liability" },
          { id: "acc-wages", code: "5300", name: "Wages and Salaries", type: "expense" },
          { id: "acc-ertax", code: "5310", name: "Employer Payroll Taxes", type: "expense" },
        ],
      },
      platformConfig: { findUnique: async () => null },
      $transaction: async <T,>(fn: (t: typeof tx) => Promise<T>) => fn(tx),
    },
  };
});
vi.mock("@/lib/finance/ledger-service", () => ({ seedChartOfAccounts: async () => ({ seeded: 0 }) }));
vi.mock("@/lib/org-locale/org-currency.server", () => ({ getOrgBaseCurrency: async () => "USD" }));

import { approvePayRun, recordPayRunPaid } from "./pay-run-books.server";
import { AUTOMATION_PERSONA_EMAIL } from "@/lib/govern/automation-persona-identity";

const person = { userId: "user-1", email: "owner@example.com" };
const paidOn = new Date("2026-04-01T00:00:00Z");

beforeEach(() => {
  state.run.status = "approved";
  state.payslips[0]!.disbursementStatus = "pending";
  state.journals.length = 0;
  state.staleRead = null;
});

describe("recordPayRunPaid", () => {
  it("posts one payment journal and marks the payslips paid", async () => {
    const result = await recordPayRunPaid("run-1", person, { bankReference: "ACH-778", paidOn });
    expect(result.ok).toBe(true);
    expect(state.run.status).toBe("paid");
    expect(state.payslips[0]!.disbursementStatus).toBe("paid");
    expect(state.journals).toHaveLength(1);
    expect(state.journals[0]!.memo).toContain("ACH-778");
    expect(state.journals[0]!.memo).toContain("attested by user-1 at");
  });

  it("a second submission posts nothing, even after passing the status check", async () => {
    await recordPayRunPaid("run-1", person, { bankReference: "ACH-778", paidOn });
    // A retry whose read still saw "approved" gets past the early status check;
    // only the conditional claim inside the transaction can stop it.
    state.staleRead = "approved";
    state.payslips[0]!.disbursementStatus = "pending";
    const again = await recordPayRunPaid("run-1", person, { bankReference: "ACH-778", paidOn });
    expect(again.ok).toBe(false);
    expect(state.journals).toHaveLength(1);
  });

  it("refuses the automation persona and an empty bank reference", async () => {
    expect((await recordPayRunPaid("run-1", { userId: "a", email: AUTOMATION_PERSONA_EMAIL }, { bankReference: "X", paidOn })).ok).toBe(false);
    expect((await recordPayRunPaid("run-1", person, { bankReference: "  ", paidOn })).ok).toBe(false);
    expect(state.journals).toHaveLength(0);
    expect(state.run.status).toBe("approved");
  });
});

describe("approvePayRun", () => {
  it("approves a draft once and posts one balanced journal", async () => {
    state.run.status = "draft";
    const first = await approvePayRun("run-1", person);
    expect(first.ok).toBe(true);
    expect(state.run.status).toBe("approved");
    const second = await approvePayRun("run-1", person);
    expect(second.ok).toBe(false);
    expect(state.journals).toHaveLength(1);
  });
});
