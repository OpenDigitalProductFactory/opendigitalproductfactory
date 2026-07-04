// lib/hr/labor.ts — labor economics: the cost, revenue and margin of employee time.
//
// An hour of an employee's time has two prices that must never be conflated:
//   • COST  — what the company pays for it (the wage, hourly or salaried).
//   • BILL  — what the company charges a client for it (a rate-card rate).
// The difference is margin. This module makes both explicit and pure, so the rules
// are unit-testable; the compensation/rate-card persistence, the timesheet → payroll
// feed and the billable-hours → invoice generation are separate (schema-bearing) phases.
//
// The two axes the design turns on:
//   1. Pay type — hourly is paid rate × hours (variable); salary is paid a fixed amount
//      per period (independent of hours). But a salaried hour is still COSTED at a
//      derived hourly rate, so job margin is real: pay ≠ cost-of-time for salary.
//   2. Selling labor — billable hours are charged at a bill rate drawn from the services
//      / resources the company sells (a rate card), distinct from the wage.

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Standard paid hours in a year (40h × 52w) — the default salary→hourly cost divisor. */
export const DEFAULT_STANDARD_ANNUAL_HOURS = 2080;

export type Compensation =
  | { payType: "hourly"; hourlyRate: number }
  | { payType: "salary"; annualSalary: number; standardAnnualHours?: number };

/**
 * The effective per-hour COST of an employee's time — the basis for job costing and
 * margin. Hourly: the wage rate. Salary: annual salary spread over standard annual hours.
 */
export function hourlyCostRate(comp: Compensation): number {
  if (comp.payType === "hourly") return round2(Math.max(comp.hourlyRate, 0));
  const hours =
    comp.standardAnnualHours && comp.standardAnnualHours > 0
      ? comp.standardAnnualHours
      : DEFAULT_STANDARD_ANNUAL_HOURS;
  return round2(Math.max(comp.annualSalary, 0) / hours);
}

/** The cost of a number of hours of this employee's time (cost rate × hours). */
export function computeLaborCost(comp: Compensation, hours: number): number {
  return round2(hourlyCostRate(comp) * Math.max(hours, 0));
}

/**
 * What the employee is PAID for a period:
 *   hourly → wage rate × hours worked (variable);
 *   salary → annual salary / periods per year (fixed — hours logged do not change it).
 * Feeds the payroll gross-to-net engine (lib/hr/payroll.ts) as gross for the period.
 */
export function computeWagePay(
  comp: Compensation,
  hoursInPeriod: number,
  periodsPerYear = 12,
): number {
  if (comp.payType === "hourly") {
    return round2(Math.max(comp.hourlyRate, 0) * Math.max(hoursInPeriod, 0));
  }
  const periods = periodsPerYear > 0 ? periodsPerYear : 12;
  return round2(Math.max(comp.annualSalary, 0) / periods);
}

/** Revenue from billing labor: bill rate × billable hours. */
export function computeBillableRevenue(billRate: number, billableHours: number): number {
  return round2(Math.max(billRate, 0) * Math.max(billableHours, 0));
}

export type LaborEconomics = {
  /** Total hours worked. */
  hours: number;
  /** Of which billable to a customer (capped at total hours). */
  billableHours: number;
  /** Cost of ALL hours worked (cost rate × hours). */
  cost: number;
  /** Revenue from the billable hours (bill rate × billable hours). */
  revenue: number;
  /** Margin on the billed work = revenue − cost of the billable hours. */
  margin: number;
  /** Margin as a % of revenue (0 when no revenue). */
  marginPct: number;
};

/**
 * Summarise the economics of an employee's hours: what they cost, what the billable
 * portion earns, and the margin on that billed work. Margin compares revenue against
 * the cost of the *billable* hours (like for like); the cost of any non-billable hours
 * is overhead, visible as `cost − (cost rate × billableHours)`. Billable hours are
 * capped at total hours so you can never bill more time than was worked.
 */
export function summarizeLaborEconomics(input: {
  comp: Compensation;
  hours: number;
  billableHours: number;
  billRate: number;
}): LaborEconomics {
  const costRate = hourlyCostRate(input.comp);
  const hours = Math.max(input.hours, 0);
  const billableHours = Math.min(Math.max(input.billableHours, 0), hours);

  const cost = round2(costRate * hours);
  const billableCost = round2(costRate * billableHours);
  const revenue = computeBillableRevenue(input.billRate, billableHours);
  const margin = round2(revenue - billableCost);
  const marginPct = revenue > 0 ? round2((margin / revenue) * 100) : 0;

  return { hours, billableHours, cost, revenue, margin, marginPct };
}
