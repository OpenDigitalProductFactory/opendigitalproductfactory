import { describe, expect, it } from "vitest";
import { aggregateAccountLaborEconomics, type BillableEconRow } from "./labor-report";

const hourly = (rate: number) => ({ payType: "hourly" as const, hourlyRate: rate });
const salary = (annual: number, hours?: number) => ({
  payType: "salary" as const,
  annualSalary: annual,
  ...(hours ? { standardAnnualHours: hours } : {}),
});

describe("aggregateAccountLaborEconomics", () => {
  it("returns zeros for no rows", () => {
    const r = aggregateAccountLaborEconomics([]);
    expect(r.billableHours).toBe(0);
    expect(r.unbilledHours).toBe(0);
    expect(r.cost).toBe(0);
    expect(r.revenue).toBe(0);
    expect(r.margin).toBe(0);
    expect(r.marginPct).toBe(0);
  });

  it("computes cost, revenue and margin across hourly and salaried employees", () => {
    const rows: BillableEconRow[] = [
      // 10h by an hourly £20 employee at £85 bill rate, already invoiced
      { billableHours: 10, invoiced: true, comp: hourly(20), billRate: 85, hasActiveRate: true },
      // 4h by a salaried £41,600/2080 (=£20/h) employee at £85, unbilled
      { billableHours: 4, invoiced: false, comp: salary(41600, 2080), billRate: 85, hasActiveRate: true },
    ];
    const r = aggregateAccountLaborEconomics(rows);
    expect(r.billableHours).toBe(14);
    expect(r.unbilledHours).toBe(4);
    expect(r.unbilledEntryCount).toBe(1);
    expect(r.cost).toBe(280); // 14h × £20
    expect(r.revenue).toBe(1190); // 14h × £85
    expect(r.margin).toBe(910);
    expect(r.marginPct).toBe(76.47);
  });

  it("counts unbilled entries with no active rate as missing-rate, excluded from revenue", () => {
    const rows: BillableEconRow[] = [
      { billableHours: 3, invoiced: false, comp: hourly(20), billRate: null, hasActiveRate: false },
      { billableHours: 2, invoiced: false, comp: hourly(20), billRate: 90, hasActiveRate: true },
    ];
    const r = aggregateAccountLaborEconomics(rows);
    expect(r.unbilledEntriesMissingRate).toBe(1);
    expect(r.revenue).toBe(180); // only the priced 2h
    expect(r.cost).toBe(100); // all 5h still cost money
  });

  it("tracks hours whose employee has no pay set instead of costing them at zero silently", () => {
    const rows: BillableEconRow[] = [
      { billableHours: 6, invoiced: false, comp: null, billRate: 70, hasActiveRate: true },
    ];
    const r = aggregateAccountLaborEconomics(rows);
    expect(r.hoursMissingCompensation).toBe(6);
    expect(r.cost).toBe(0);
    expect(r.revenue).toBe(420);
  });

  it("ignores zero-hour rows and never counts invoiced entries as unbilled", () => {
    const rows: BillableEconRow[] = [
      { billableHours: 0, invoiced: false, comp: hourly(20), billRate: 85, hasActiveRate: true },
      { billableHours: 5, invoiced: true, comp: hourly(20), billRate: 85, hasActiveRate: true },
    ];
    const r = aggregateAccountLaborEconomics(rows);
    expect(r.billableHours).toBe(5);
    expect(r.unbilledHours).toBe(0);
    expect(r.unbilledEntryCount).toBe(0);
  });

  it("prices already-invoiced hours with an inactive rate for reporting", () => {
    const rows: BillableEconRow[] = [
      { billableHours: 8, invoiced: true, comp: hourly(25), billRate: 60, hasActiveRate: false },
    ];
    const r = aggregateAccountLaborEconomics(rows);
    expect(r.revenue).toBe(480);
    expect(r.unbilledEntriesMissingRate).toBe(0);
  });
});
