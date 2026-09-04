import { describe, expect, it } from "vitest";
import {
  planReimbursements,
  reimbursementCode,
  reimbursementCodesInTaxBase,
  settledClaimIds,
  toPayComponents,
  type SettleableClaim,
} from "./reimbursement-in-payroll";
import { buildPayrollPosting, type PayrollAccountMap } from "./payroll-gl";

function claim(over: Partial<SettleableClaim> = {}): SettleableClaim {
  return {
    claimId: "CLM-0001",
    employeeProfileId: "emp_1",
    title: "August mileage",
    status: "approved",
    totalAmount: 152.25,
    currency: "USD",
    paidAt: null,
    ...over,
  };
}

describe("planReimbursements", () => {
  it("settles an approved, unpaid claim as a non-taxable reimbursement line", () => {
    const plan = planReimbursements({
      employeeProfileId: "emp_1",
      claims: [claim()],
      currency: "USD",
    });

    expect(plan.lines).toHaveLength(1);
    const line = plan.lines[0]!;
    expect(line.componentKind).toBe("reimbursement");
    // Repayment of an expense is not income — this must never be true.
    expect(line.taxable).toBe(false);
    expect(line.amount).toBe(152.25);
    expect(plan.totalReimbursement).toBe(152.25);
    expect(plan.excluded).toHaveLength(0);
  });

  it("refuses a claim that was already paid, rather than paying it twice", () => {
    const plan = planReimbursements({
      employeeProfileId: "emp_1",
      claims: [claim({ paidAt: new Date("2026-08-01T00:00:00.000Z") })],
      currency: "USD",
    });

    expect(plan.lines).toHaveLength(0);
    expect(plan.excluded[0]?.reason).toBe("already_paid");
    expect(plan.totalReimbursement).toBe(0);
  });

  it.each(["draft", "submitted", "rejected", "paid"])(
    "refuses a claim in status %s",
    (status) => {
      const plan = planReimbursements({
        employeeProfileId: "emp_1",
        claims: [claim({ status })],
        currency: "USD",
      });
      expect(plan.lines).toHaveLength(0);
      expect(plan.excluded[0]?.reason).toBe("not_approved");
    },
  );

  it("refuses a foreign-currency claim rather than inventing a rate", () => {
    const plan = planReimbursements({
      employeeProfileId: "emp_1",
      claims: [claim({ currency: "GBP" })],
      currency: "USD",
    });

    // There is no governed FX substrate, so converting here would attach an
    // uncited number to someone's pay.
    expect(plan.lines).toHaveLength(0);
    expect(plan.excluded[0]?.reason).toBe("currency_mismatch");
    expect(plan.excluded[0]?.detail).toContain("no governed FX rate");
  });

  it("does not open a zero-value line", () => {
    const plan = planReimbursements({
      employeeProfileId: "emp_1",
      claims: [claim({ totalAmount: 0 })],
      currency: "USD",
    });
    expect(plan.lines).toHaveLength(0);
    expect(plan.excluded[0]?.reason).toBe("zero_amount");
  });

  it("accounts for every claim as either settled or excluded", () => {
    const claims = [
      claim({ claimId: "CLM-A" }),
      claim({ claimId: "CLM-B", status: "submitted" }),
      claim({ claimId: "CLM-C", paidAt: new Date() }),
      claim({ claimId: "CLM-D", currency: "EUR" }),
      claim({ claimId: "CLM-E", totalAmount: 0 }),
    ];
    const plan = planReimbursements({ employeeProfileId: "emp_1", claims, currency: "USD" });

    // A claim that silently vanishes is an employee who is not paid and cannot
    // see why, so the two buckets must cover the input exactly.
    const accounted = [...plan.lines.map((l) => l.claimId), ...plan.excluded.map((e) => e.claimId)];
    expect(accounted.sort()).toEqual(["CLM-A", "CLM-B", "CLM-C", "CLM-D", "CLM-E"]);
  });

  it("ignores another employee's claims", () => {
    const plan = planReimbursements({
      employeeProfileId: "emp_1",
      claims: [claim({ claimId: "CLM-X", employeeProfileId: "emp_2" })],
      currency: "USD",
    });
    expect(plan.lines).toHaveLength(0);
    expect(plan.excluded).toHaveLength(0);
  });

  it("sums several claims into one total", () => {
    const plan = planReimbursements({
      employeeProfileId: "emp_1",
      claims: [
        claim({ claimId: "CLM-A", totalAmount: 100.1 }),
        claim({ claimId: "CLM-B", totalAmount: 50.2 }),
      ],
      currency: "USD",
    });
    expect(plan.totalReimbursement).toBe(150.3);
  });
});

describe("idempotency", () => {
  it("derives a stable code per claim so a re-run collides rather than duplicates", () => {
    expect(reimbursementCode("CLM-0001")).toBe("REIMB-CLM-0001");

    const once = planReimbursements({ employeeProfileId: "emp_1", claims: [claim()], currency: "USD" });
    const twice = planReimbursements({ employeeProfileId: "emp_1", claims: [claim()], currency: "USD" });

    // PayComponentLine is @@unique([payslipId, code]) — a stable code makes a
    // recomputed run update in place instead of paying twice.
    expect(twice.lines[0]?.code).toBe(once.lines[0]?.code);
  });

  it("names exactly the claims to mark paid in the same transaction", () => {
    const plan = planReimbursements({
      employeeProfileId: "emp_1",
      claims: [claim({ claimId: "CLM-A" }), claim({ claimId: "CLM-B", status: "draft" })],
      currency: "USD",
    });
    expect(settledClaimIds(plan)).toEqual(["CLM-A"]);
  });
});

describe("tax-base guard", () => {
  it("is silent when reimbursement stays out of taxable earnings", () => {
    const plan = planReimbursements({ employeeProfileId: "emp_1", claims: [claim()], currency: "USD" });
    expect(reimbursementCodesInTaxBase(plan, [{ code: "BASE" }, { code: "OT" }])).toEqual([]);
  });

  it("names a reimbursement code that wrongly reached the tax base", () => {
    const plan = planReimbursements({ employeeProfileId: "emp_1", claims: [claim()], currency: "USD" });
    const leaked = reimbursementCodesInTaxBase(plan, [{ code: "BASE" }, { code: "REIMB-CLM-0001" }]);
    // Taxing repayment of an employee's own money is the defect this catches.
    expect(leaked).toEqual(["REIMB-CLM-0001"]);
  });
});

describe("posting a run that reimburses", () => {
  const accounts: PayrollAccountMap = {
    wagesExpense: "6000",
    employerCostExpense: "6100",
    reimbursementExpense: "6200",
    netPayPayable: "2100",
    taxPayable: "2200",
    pensionPayable: "2300",
    otherDeductionsPayable: "2400",
  };

  it("pays wages and the month's mileage in one balanced posting", () => {
    const plan = planReimbursements({ employeeProfileId: "emp_1", claims: [claim()], currency: "USD" });

    const posting = buildPayrollPosting({
      accounts,
      payslips: [
        {
          grossPay: 5000,
          netPay: 4366.67,
          earnings: [{ code: "BASE", label: "Salary", amount: 5000 }],
          employeeDeductions: [{ code: "TAX", label: "Federal withholding", amount: 633.33 }],
          employerCosts: [{ code: "NI", label: "Employer FICA", amount: 382.5 }],
          statutoryCodes: ["TAX"],
          reimbursements: toPayComponents(plan),
        },
      ],
    });

    expect(posting.balanced).toBe(true);

    const reimbLine = posting.lines.find((l) => l.accountCode === "6200");
    // The reimbursement is an expense in its own right, never wages.
    expect(reimbLine?.debit).toBe(152.25);
    const wages = posting.lines.find((l) => l.accountCode === "6000");
    expect(wages?.debit).toBe(5000);

    // Net pay payable carries wages plus the reimbursement — the employee is
    // owed both, but only one of them was earned.
    const netPayable = posting.lines.find((l) => l.accountCode === "2100");
    expect(netPayable?.credit).toBe(4366.67 + 152.25);
  });
});
