import { describe, it, expect } from "vitest";
import { payrollEarningsFromTimesheet, buildBillableInvoiceLines } from "./labor-billing";
import type { Compensation } from "./labor";

const hourly: Compensation = { payType: "hourly", hourlyRate: 20 };
const salary: Compensation = { payType: "salary", annualSalary: 60000, standardAnnualHours: 2000 };

describe("payrollEarningsFromTimesheet", () => {
  it("hourly: regular hours at rate, overtime at 1.5× — overtime never double-paid", () => {
    // 45 approved hours of which 5 overtime → 40 regular + 5 OT.
    const e = payrollEarningsFromTimesheet(hourly, { totalHours: 45, overtimeHours: 5 });
    expect(e).toEqual({ hoursWorked: 40, hourlyRate: 20, overtimeHours: 5, overtimeRate: 30 });
  });

  it("salary: fixed period pay, hours ignored", () => {
    const e = payrollEarningsFromTimesheet(salary, { totalHours: 200, overtimeHours: 60 }, { periodsPerYear: 12 });
    expect(e).toEqual({ baseSalary: 5000 });
  });

  it("caps overtime at total hours and respects a custom multiplier", () => {
    const e = payrollEarningsFromTimesheet(hourly, { totalHours: 10, overtimeHours: 99 }, { overtimeMultiplier: 2 });
    expect(e.hoursWorked).toBe(0);
    expect(e.overtimeHours).toBe(10);
    expect(e.overtimeRate).toBe(40);
  });
});

describe("buildBillableInvoiceLines", () => {
  const rateCard = [
    { id: "r-consult", name: "Consulting", unit: "hour", billRate: 120 },
    { id: "r-site", name: "Site Labour", unit: "hour", billRate: 65 },
  ];

  it("aggregates hours per rate into one line with a date range", () => {
    const r = buildBillableInvoiceLines(
      [
        { id: "e1", date: new Date("2026-07-01"), billableHours: 3, billableRateId: "r-consult" },
        { id: "e2", date: new Date("2026-07-03"), billableHours: 2.5, billableRateId: "r-consult" },
        { id: "e3", date: new Date("2026-07-02"), billableHours: 8, billableRateId: "r-site" },
      ],
      rateCard,
    );
    expect(r.lines).toHaveLength(2);
    const consult = r.lines.find((l) => l.description.startsWith("Consulting"))!;
    expect(consult.quantity).toBe(5.5);
    expect(consult.unitPrice).toBe(120);
    expect(consult.description).toContain("2026-07-01 – 2026-07-03");
    expect(r.billedEntryIds.sort()).toEqual(["e1", "e2", "e3"]);
    expect(r.totalHours).toBe(13.5);
    expect(r.skipped).toHaveLength(0);
  });

  it("skips entries with no resolvable rate — never bills at zero", () => {
    const r = buildBillableInvoiceLines(
      [
        { id: "e1", date: new Date("2026-07-01"), billableHours: 4, billableRateId: null },
        { id: "e2", date: new Date("2026-07-01"), billableHours: 4, billableRateId: "r-unknown" },
        { id: "e3", date: new Date("2026-07-01"), billableHours: 0, billableRateId: "r-consult" },
      ],
      rateCard,
    );
    expect(r.lines).toHaveLength(0);
    expect(r.billedEntryIds).toHaveLength(0);
    expect(r.skipped).toEqual(
      expect.arrayContaining([
        { entryId: "e1", reason: "no-rate" },
        { entryId: "e2", reason: "no-rate" },
        { entryId: "e3", reason: "zero-hours" },
      ]),
    );
  });

  it("single-day work shows one date, singular unit", () => {
    const r = buildBillableInvoiceLines(
      [{ id: "e1", date: new Date("2026-07-04"), billableHours: 1, billableRateId: "r-site" }],
      rateCard,
    );
    expect(r.lines[0].description).toBe("Site Labour (1 hour, 2026-07-04)");
  });
});
