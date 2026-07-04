import { describe, it, expect } from "vitest";
import {
  hourlyCostRate,
  computeLaborCost,
  computeWagePay,
  computeBillableRevenue,
  summarizeLaborEconomics,
  DEFAULT_STANDARD_ANNUAL_HOURS,
  type Compensation,
} from "./labor";

const hourly: Compensation = { payType: "hourly", hourlyRate: 25 };
const salary: Compensation = { payType: "salary", annualSalary: 52000, standardAnnualHours: 2080 };

describe("hourlyCostRate", () => {
  it("is the wage rate for hourly staff", () => {
    expect(hourlyCostRate(hourly)).toBe(25);
  });
  it("spreads annual salary over standard annual hours", () => {
    expect(hourlyCostRate(salary)).toBe(25); // 52000 / 2080
  });
  it("defaults standard annual hours when unset", () => {
    expect(hourlyCostRate({ payType: "salary", annualSalary: DEFAULT_STANDARD_ANNUAL_HOURS * 30 })).toBe(30);
  });
});

describe("computeWagePay — pay type matters", () => {
  it("hourly is paid rate × hours (variable)", () => {
    expect(computeWagePay(hourly, 160)).toBe(4000); // 25 × 160
    expect(computeWagePay(hourly, 120)).toBe(3000); // fewer hours → less pay
  });
  it("salary is paid a fixed amount per period, regardless of hours", () => {
    expect(computeWagePay(salary, 160, 12)).toBe(round2(52000 / 12)); // 4333.33
    expect(computeWagePay(salary, 999, 12)).toBe(round2(52000 / 12)); // hours don't change salaried pay
  });
});

describe("computeLaborCost", () => {
  it("costs hours at the cost rate for both pay types", () => {
    expect(computeLaborCost(hourly, 10)).toBe(250);
    expect(computeLaborCost(salary, 10)).toBe(250); // salaried time is still costed
  });
});

describe("computeBillableRevenue", () => {
  it("is bill rate × billable hours", () => {
    expect(computeBillableRevenue(80, 6)).toBe(480);
  });
});

describe("summarizeLaborEconomics — cost, revenue, margin", () => {
  it("bill rate above cost rate yields positive margin", () => {
    // cost rate 25/h; bill rate 80/h; 40 hours, 30 billable.
    const e = summarizeLaborEconomics({ comp: hourly, hours: 40, billableHours: 30, billRate: 80 });
    expect(e.cost).toBe(1000); // 25 × 40 (all hours)
    expect(e.revenue).toBe(2400); // 80 × 30
    expect(e.margin).toBe(2400 - 25 * 30); // revenue − cost of billable hours = 1650
    expect(e.marginPct).toBe(round2((1650 / 2400) * 100)); // 68.75
  });

  it("salaried employee: margin uses the derived cost rate, not the fixed pay", () => {
    const e = summarizeLaborEconomics({ comp: salary, hours: 10, billableHours: 10, billRate: 100 });
    expect(e.revenue).toBe(1000);
    expect(e.margin).toBe(1000 - 25 * 10); // 750 (cost rate 25/h)
  });

  it("caps billable hours at hours actually worked", () => {
    const e = summarizeLaborEconomics({ comp: hourly, hours: 5, billableHours: 100, billRate: 80 });
    expect(e.billableHours).toBe(5);
    expect(e.revenue).toBe(400); // 80 × 5, not 80 × 100
  });

  it("no billable hours → zero revenue and margin", () => {
    const e = summarizeLaborEconomics({ comp: hourly, hours: 8, billableHours: 0, billRate: 80 });
    expect(e.revenue).toBe(0);
    expect(e.margin).toBe(0);
    expect(e.marginPct).toBe(0);
    expect(e.cost).toBe(200); // the 8 hours still cost money (overhead)
  });

  it("bill rate below cost rate yields negative margin (a loss flag)", () => {
    const e = summarizeLaborEconomics({ comp: hourly, hours: 10, billableHours: 10, billRate: 20 });
    expect(e.margin).toBeLessThan(0); // 200 − 250
  });
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
