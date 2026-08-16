import { beforeEach, describe, expect, it, vi } from "vitest";

// Payroll reads the spine via prisma; stub it so we can drive the seam end to end.
vi.mock("@dpf/db", () => ({
  prisma: {
    employeeProfile: { findUnique: vi.fn() },
    timesheetPeriod: { findMany: vi.fn() },
  },
}));

import { prisma } from "@dpf/db";
import { computeEmployeePayslip } from "./labor-service";
import type { StatutoryDeductionFn } from "./payroll";
import { offerCompensationToEmployeeColumns } from "@/lib/recruiting/offer-compensation";

const findUnique = prisma.employeeProfile.findUnique as unknown as ReturnType<typeof vi.fn>;
const findMany = prisma.timesheetPeriod.findMany as unknown as ReturnType<typeof vi.fn>;

// The EmployeeProfile row a hire produces: the columns slice 1 writes, with unset
// comp columns null (exactly what the DB returns after a partial create).
function employeeRowFromOffer(offerComp: Parameters<typeof offerCompensationToEmployeeColumns>[0]) {
  const cols = offerCompensationToEmployeeColumns(offerComp);
  return {
    payType: cols.payType,
    hourlyRate: cols.hourlyRate ?? null,
    annualSalary: cols.annualSalary ?? null,
    standardAnnualHours: cols.standardAnnualHours ?? null,
  };
}

// Simple deterministic jurisdiction: 20% income tax on taxable, no NI.
const flat20: StatutoryDeductionFn = ({ taxable }) => ({
  incomeTax: Math.round(taxable * 0.2 * 100) / 100,
  employeeNI: 0,
  employerNI: 0,
});

const START = new Date("2026-09-01");
const END = new Date("2026-10-01");

describe("computeEmployeePayslip — the hiring→paying seam, end to end", () => {
  beforeEach(() => {
    findUnique.mockReset();
    findMany.mockReset();
  });

  it("pays a salaried hire from the comp the offer carried through", async () => {
    // Offer → hire landed these comp columns (slice 1) → payroll reads them here.
    findUnique.mockResolvedValue(employeeRowFromOffer({ payType: "salary", annualSalary: 120000 }));
    findMany.mockResolvedValue([]); // salaried: logged hours don't change base pay

    const result = await computeEmployeePayslip("emp-1", START, END, flat20, { periodsPerYear: 12 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payslip.grossPay).toBe(10000); // 120000 / 12
    expect(result.payslip.netPay).toBe(8000); // gross − 20% income tax
  });

  it("pays an hourly hire from approved timesheet hours at the offer rate", async () => {
    findUnique.mockResolvedValue(employeeRowFromOffer({ payType: "hourly", hourlyRate: 25 }));
    findMany.mockResolvedValue([{ totalHours: 80, overtimeHours: 0 }]);

    const result = await computeEmployeePayslip("emp-2", START, END, flat20);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payslip.grossPay).toBe(2000); // 80h × $25
    expect(result.payslip.netPay).toBe(1600); // gross − 20%
  });

  it("a hire with NO compensation is not payable — the seam gap made explicit", async () => {
    // An EmployeeProfile that never got comp (offer didn't carry it / hand-entry pending).
    findUnique.mockResolvedValue({
      payType: null,
      hourlyRate: null,
      annualSalary: null,
      standardAnnualHours: null,
    });

    const result = await computeEmployeePayslip("emp-3", START, END, flat20);
    expect(result).toEqual({ ok: false, reason: "no-compensation" });
  });

  it("returns no-employee when the profile is missing", async () => {
    findUnique.mockResolvedValue(null);
    const result = await computeEmployeePayslip("nope", START, END, flat20);
    expect(result).toEqual({ ok: false, reason: "no-employee" });
  });
});
