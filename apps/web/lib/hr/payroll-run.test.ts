import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    employeeProfile: { findUnique: vi.fn() },
    timesheetPeriod: { findMany: vi.fn() },
  },
}));

import { prisma } from "@dpf/db";
import { runPayroll, markPayslipDisbursed } from "./payroll-run";
import type { StatutoryDeductionFn } from "./payroll";

const findUnique = prisma.employeeProfile.findUnique as unknown as ReturnType<typeof vi.fn>;
const findMany = prisma.timesheetPeriod.findMany as unknown as ReturnType<typeof vi.fn>;

const flat20: StatutoryDeductionFn = ({ taxable }) => ({
  incomeTax: Math.round(taxable * 0.2 * 100) / 100,
  employeeNI: 0,
  employerNI: 0,
});

// Comp rows as a hire's landing would have written them (unset comp columns null).
const EMPLOYEES: Record<string, unknown> = {
  "emp-salary": { payType: "salary", annualSalary: 120000, hourlyRate: null, standardAnnualHours: null },
  "emp-nocomp": { payType: null, annualSalary: null, hourlyRate: null, standardAnnualHours: null },
};

function writeDb() {
  const payRunUpsert = vi.fn().mockResolvedValue({
    id: "run-1",
    periodStart: START,
    periodEnd: END,
    payDate: null,
    status: "draft",
  });
  let seq = 0;
  const payslipUpsert = vi.fn().mockImplementation(() => Promise.resolve({ id: `slip-${++seq}` }));
  return {
    db: { payRun: { upsert: payRunUpsert }, payslip: { upsert: payslipUpsert } },
    payRunUpsert,
    payslipUpsert,
  };
}

const START = new Date("2026-09-01");
const END = new Date("2026-10-01");

describe("runPayroll — persist a hire's computed pay as a durable, disbursable record", () => {
  beforeEach(() => {
    findUnique.mockReset();
    findUnique.mockImplementation((args: { where: { id: string } }) =>
      Promise.resolve(EMPLOYEES[args.where.id] ?? null),
    );
    findMany.mockReset();
    findMany.mockResolvedValue([]); // salaried in this suite: hours don't change base pay
  });

  it("creates a PayRun and persists one Payslip per payable employee", async () => {
    const { db, payRunUpsert, payslipUpsert } = writeDb();

    const result = await runPayroll(db, {
      payRunRef: "PR-2026-09",
      periodStart: START,
      periodEnd: END,
      employeeProfileIds: ["emp-salary"],
      statutory: flat20,
      opts: { periodsPerYear: 12 },
    });

    expect(payRunUpsert).toHaveBeenCalledTimes(1);
    expect(payRunUpsert.mock.calls[0][0]).toMatchObject({
      where: { payRunRef: "PR-2026-09" },
      create: { payRunRef: "PR-2026-09", status: "draft" },
      update: {},
    });

    expect(payslipUpsert).toHaveBeenCalledTimes(1);
    const upsertArg = payslipUpsert.mock.calls[0][0];
    // Idempotent per (payRunId, employee).
    expect(upsertArg.where).toEqual({ payRunId_employeeProfileId: { payRunId: "run-1", employeeProfileId: "emp-salary" } });
    expect(upsertArg.create).toMatchObject({ grossPay: 10000, netPay: 8000, taxablePay: 10000 });

    expect(result.payRunId).toBe("run-1");
    expect(result.paid).toEqual([
      { employeeProfileId: "emp-salary", payslipId: "slip-1", grossPay: 10000, netPay: 8000 },
    ]);
    expect(result.skipped).toEqual([]);
  });

  it("skips an employee with no compensation instead of persisting a broken payslip", async () => {
    const { db, payslipUpsert } = writeDb();

    const result = await runPayroll(db, {
      payRunRef: "PR-x",
      periodStart: START,
      periodEnd: END,
      employeeProfileIds: ["emp-salary", "emp-nocomp"],
      statutory: flat20,
      opts: { periodsPerYear: 12 },
    });

    expect(result.paid).toHaveLength(1);
    expect(result.paid[0].employeeProfileId).toBe("emp-salary");
    expect(result.skipped).toEqual([{ employeeProfileId: "emp-nocomp", reason: "no-compensation" }]);
    // Only the payable employee got a payslip.
    expect(payslipUpsert).toHaveBeenCalledTimes(1);
  });

  it("reuses the same PayRun when the caller retries a stable payRunRef", async () => {
    const payRunUpsert = vi.fn().mockResolvedValue({
      id: "run-stable",
      periodStart: START,
      periodEnd: END,
      payDate: null,
      status: "draft",
    });
    const payslipUpsert = vi.fn().mockResolvedValue({ id: "slip-1" });
    const db = {
      payRun: { upsert: payRunUpsert },
      payslip: { upsert: payslipUpsert },
    };
    const input = {
      payRunRef: "PR-2026-09-retry",
      periodStart: START,
      periodEnd: END,
      employeeProfileIds: ["emp-salary"],
      statutory: flat20,
      opts: { periodsPerYear: 12 },
    };

    const first = await runPayroll(db, input);
    const retried = await runPayroll(db, input);

    expect(retried.payRunId).toBe(first.payRunId);
    expect(payRunUpsert).toHaveBeenCalledTimes(2);
  });

  it("refuses to reuse a payRunRef for a different period", async () => {
    const { db, payRunUpsert, payslipUpsert } = writeDb();
    payRunUpsert.mockResolvedValueOnce({
      id: "run-existing",
      periodStart: new Date("2026-08-01"),
      periodEnd: new Date("2026-09-01"),
      payDate: null,
      status: "draft",
    });

    await expect(
      runPayroll(db, {
        payRunRef: "PR-reused-wrongly",
        periodStart: START,
        periodEnd: END,
        employeeProfileIds: ["emp-salary"],
        statutory: flat20,
      }),
    ).rejects.toThrow(/different pay period/);
    expect(payslipUpsert).not.toHaveBeenCalled();
  });

  it("refuses to recompute a run after it leaves draft", async () => {
    const { db, payRunUpsert, payslipUpsert } = writeDb();
    payRunUpsert.mockResolvedValueOnce({
      id: "run-approved",
      periodStart: START,
      periodEnd: END,
      payDate: null,
      status: "approved",
    });

    await expect(
      runPayroll(db, {
        payRunRef: "PR-approved",
        periodStart: START,
        periodEnd: END,
        employeeProfileIds: ["emp-salary"],
        statutory: flat20,
      }),
    ).rejects.toThrow(/cannot be recomputed from status approved/);
    expect(payslipUpsert).not.toHaveBeenCalled();
  });
});

describe("markPayslipDisbursed — record the money-movement outcome (never moves money)", () => {
  it("marks a payslip paid with a paidAt timestamp", async () => {
    const update = vi.fn().mockResolvedValue({});
    const at = new Date("2026-09-30");
    await markPayslipDisbursed({ payslip: { update } }, "slip-1", "paid", at);
    expect(update).toHaveBeenCalledWith({
      where: { id: "slip-1", disbursementStatus: "pending" },
      data: { disbursementStatus: "paid", paidAt: at },
    });
  });

  it("marks a failed disbursement without a paidAt", async () => {
    const update = vi.fn().mockResolvedValue({});
    await markPayslipDisbursed({ payslip: { update } }, "slip-2", "failed", new Date());
    expect(update).toHaveBeenCalledWith({
      where: { id: "slip-2", disbursementStatus: "pending" },
      data: { disbursementStatus: "failed" },
    });
  });
});
