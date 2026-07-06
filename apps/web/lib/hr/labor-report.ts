// lib/hr/labor-report.ts — read-side aggregation for the labour margin view.
//
// Answers one question for a customer account: what did the billable hours we
// worked for them COST us, what do they EARN, and what margin is left — split
// into what is already on an invoice and what is still waiting to be billed.
// The pure aggregation is separated from the Prisma read so the maths is
// unit-testable; per-row economics reuse lib/hr/labor.ts so cost/revenue rules
// live in exactly one place.

import { prisma } from "@dpf/db";
import { hourlyCostRate, computeBillableRevenue, type Compensation } from "./labor";
import { compensationFromEmployee } from "./labor-service";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Pure aggregation ────────────────────────────────────────────────────────

export type BillableEconRow = {
  /** Approved billable hours on the entry. */
  billableHours: number;
  /** Already stamped onto an invoice? */
  invoiced: boolean;
  /** The employee's compensation, when set — null means cost is unknown. */
  comp: Compensation | null;
  /** The resolved rate-card bill rate — null means the entry cannot be priced. */
  billRate: number | null;
  /** Whether the entry would be invoiceable today (active rate resolved). */
  hasActiveRate: boolean;
};

export type AccountLaborEconomics = {
  /** All approved billable hours for the account (invoiced + unbilled). */
  billableHours: number;
  /** Approved billable hours not yet on an invoice. */
  unbilledHours: number;
  /** Approved, un-invoiced entries ready to price. */
  unbilledEntryCount: number;
  /** Un-invoiced entries that would be SKIPPED for lack of an active rate. */
  unbilledEntriesMissingRate: number;
  /** Billable hours whose employee has no pay set — excluded from cost. */
  hoursMissingCompensation: number;
  /** Cost of the billable hours where the employee's pay is known. */
  cost: number;
  /** Revenue of the billable hours at their rate-card rates (where priced). */
  revenue: number;
  /** revenue − cost (like-for-like on the billable hours). */
  margin: number;
  /** Margin as a % of revenue (0 when no revenue). */
  marginPct: number;
};

/** Fold per-entry billable rows into the account-level economics summary. */
export function aggregateAccountLaborEconomics(rows: BillableEconRow[]): AccountLaborEconomics {
  let billableHours = 0;
  let unbilledHours = 0;
  let unbilledEntryCount = 0;
  let unbilledEntriesMissingRate = 0;
  let hoursMissingCompensation = 0;
  let cost = 0;
  let revenue = 0;

  for (const row of rows) {
    const hours = Math.max(row.billableHours, 0);
    if (hours === 0) continue;

    billableHours = round2(billableHours + hours);
    if (!row.invoiced) {
      unbilledHours = round2(unbilledHours + hours);
      unbilledEntryCount += 1;
      if (!row.hasActiveRate) unbilledEntriesMissingRate += 1;
    }

    if (row.comp) {
      cost = round2(cost + round2(hourlyCostRate(row.comp) * hours));
    } else {
      hoursMissingCompensation = round2(hoursMissingCompensation + hours);
    }
    if (row.billRate != null) {
      revenue = round2(revenue + computeBillableRevenue(row.billRate, hours));
    }
  }

  const margin = round2(revenue - cost);
  const marginPct = revenue > 0 ? round2((margin / revenue) * 100) : 0;

  return {
    billableHours,
    unbilledHours,
    unbilledEntryCount,
    unbilledEntriesMissingRate,
    hoursMissingCompensation,
    cost,
    revenue,
    margin,
    marginPct,
  };
}

// ─── Prisma read ─────────────────────────────────────────────────────────────

/**
 * The labour economics of one customer account, from APPROVED billable
 * timesheet entries. Rates resolve by id against the org rate card (inactive
 * rates still price already-worked time for reporting; only ACTIVE rates make
 * an entry invoiceable, mirroring generateInvoiceFromBillableTime).
 */
export async function getAccountLaborEconomics(
  customerAccountId: string,
): Promise<AccountLaborEconomics> {
  const [entries, org] = await Promise.all([
    prisma.timesheetEntry.findMany({
      where: {
        customerAccountId,
        billable: true,
        billableHours: { gt: 0 },
        timesheetPeriod: { status: "approved" },
      },
      select: {
        billableHours: true,
        billableRateId: true,
        invoiceId: true,
        timesheetPeriod: {
          select: {
            employeeProfile: {
              select: {
                payType: true,
                hourlyRate: true,
                annualSalary: true,
                standardAnnualHours: true,
              },
            },
          },
        },
      },
    }),
    prisma.organization.findFirst({ select: { id: true } }),
  ]);

  const rates = org
    ? await prisma.billableRate.findMany({
        where: { organizationId: org.id },
        select: { id: true, billRate: true, isActive: true },
      })
    : [];
  const rateById = new Map(rates.map((r) => [r.id, { billRate: Number(r.billRate), isActive: r.isActive }]));

  return aggregateAccountLaborEconomics(
    entries.map((e) => {
      const rate = e.billableRateId ? rateById.get(e.billableRateId) : undefined;
      return {
        billableHours: e.billableHours,
        invoiced: e.invoiceId != null,
        comp: compensationFromEmployee(e.timesheetPeriod.employeeProfile),
        billRate: rate ? rate.billRate : null,
        hasActiveRate: Boolean(rate?.isActive),
      };
    }),
  );
}
