// lib/hr/labor-billing.ts — the pure bridges that wire the timecard to money.
//
// Two one-way flows, both starting from APPROVED timesheet time:
//   1. timesheet → payroll: approved hours + the employee's compensation become the
//      earnings side of a PayrollInput (lib/hr/payroll.ts computes gross-to-net).
//   2. billable time → invoice: approved billable hours priced from the BillableRate
//      rate card become draft invoice line inputs (lib/actions/finance.ts createInvoice
//      turns them into a real Invoice, which auto-posts to the GL on send).
//
// Pure and DB-free; the Prisma reads/writes live in lib/hr/labor-service.ts.

import type { Compensation } from "./labor";
import type { PayrollInput } from "./payroll";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Timesheet → payroll earnings ────────────────────────────────────────────

export type ApprovedTimesheetTotals = {
  /** Total approved hours in the pay period (INCLUDING overtime hours). */
  totalHours: number;
  /** Of which overtime (TimesheetPeriod.overtimeHours). */
  overtimeHours: number;
};

export type PayrollEarnings = Pick<
  PayrollInput,
  "baseSalary" | "hoursWorked" | "hourlyRate" | "overtimeHours" | "overtimeRate"
>;

/**
 * Build the earnings side of a PayrollInput from an employee's compensation and
 * their approved timesheet totals for the pay period:
 *   salary → a fixed baseSalary (annualSalary / periodsPerYear); logged hours never
 *            change salaried pay.
 *   hourly → regular hours (total − overtime) at hourlyRate, plus overtime hours at
 *            hourlyRate × overtimeMultiplier (default 1.5).
 * TimesheetPeriod.totalHours includes its overtimeHours, so regular hours are the
 * difference — overtime is never double-paid.
 */
export function payrollEarningsFromTimesheet(
  comp: Compensation,
  approved: ApprovedTimesheetTotals,
  opts?: { periodsPerYear?: number; overtimeMultiplier?: number },
): PayrollEarnings {
  const periods = opts?.periodsPerYear && opts.periodsPerYear > 0 ? opts.periodsPerYear : 12;

  if (comp.payType === "salary") {
    return { baseSalary: round2(Math.max(comp.annualSalary, 0) / periods) };
  }

  const multiplier = opts?.overtimeMultiplier && opts.overtimeMultiplier > 0 ? opts.overtimeMultiplier : 1.5;
  const total = Math.max(approved.totalHours, 0);
  const overtime = Math.min(Math.max(approved.overtimeHours, 0), total);
  const regular = round2(total - overtime);
  const rate = Math.max(comp.hourlyRate, 0);

  return {
    hoursWorked: regular,
    hourlyRate: rate,
    overtimeHours: overtime,
    overtimeRate: round2(rate * multiplier),
  };
}

// ─── Billable time → invoice lines ───────────────────────────────────────────

export type BillableTimeEntry = {
  id: string;
  /** ISO date of the work, used only for the line description range. */
  date: Date;
  billableHours: number;
  billableRateId: string | null;
};

export type RateCardEntry = {
  id: string;
  name: string;
  unit: string;
  billRate: number;
};

export type BillableInvoiceLine = {
  description: string;
  quantity: number;
  unitPrice: number;
};

export type BillableLinesResult = {
  lines: BillableInvoiceLine[];
  /** Entry ids priced into `lines` — the set the caller should stamp as invoiced. */
  billedEntryIds: string[];
  /** Entries skipped because they carry no resolvable rate — surfaced, never billed at 0. */
  skipped: Array<{ entryId: string; reason: "no-rate" | "zero-hours" }>;
  totalHours: number;
};

/**
 * Price approved billable time entries into draft invoice line inputs, one line per
 * rate-card service (hours aggregated, date range in the description). An entry with
 * no resolvable rate or zero hours is SKIPPED and reported — a missing rate must
 * surface as a decision, not silently bill at £0.
 */
export function buildBillableInvoiceLines(
  entries: BillableTimeEntry[],
  rateCard: RateCardEntry[],
): BillableLinesResult {
  const rates = new Map(rateCard.map((r) => [r.id, r]));
  const byRate = new Map<string, { rate: RateCardEntry; hours: number; from: Date; to: Date; ids: string[] }>();
  const skipped: BillableLinesResult["skipped"] = [];

  for (const e of entries) {
    const hours = Math.max(e.billableHours, 0);
    if (hours === 0) {
      skipped.push({ entryId: e.id, reason: "zero-hours" });
      continue;
    }
    const rate = e.billableRateId ? rates.get(e.billableRateId) : undefined;
    if (!rate) {
      skipped.push({ entryId: e.id, reason: "no-rate" });
      continue;
    }
    const bucket = byRate.get(rate.id);
    if (!bucket) {
      byRate.set(rate.id, { rate, hours, from: e.date, to: e.date, ids: [e.id] });
    } else {
      bucket.hours = round2(bucket.hours + hours);
      if (e.date < bucket.from) bucket.from = e.date;
      if (e.date > bucket.to) bucket.to = e.date;
      bucket.ids.push(e.id);
    }
  }

  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const lines: BillableInvoiceLine[] = [];
  const billedEntryIds: string[] = [];
  let totalHours = 0;

  for (const { rate, hours, from, to, ids } of byRate.values()) {
    const range = fmt(from) === fmt(to) ? fmt(from) : `${fmt(from)} – ${fmt(to)}`;
    lines.push({
      description: `${rate.name} (${hours} ${rate.unit}${hours === 1 ? "" : "s"}, ${range})`,
      quantity: hours,
      unitPrice: rate.billRate,
    });
    billedEntryIds.push(...ids);
    totalHours = round2(totalHours + hours);
  }

  return { lines, billedEntryIds, skipped, totalHours };
}
