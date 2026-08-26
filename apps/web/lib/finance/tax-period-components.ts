// lib/finance/tax-period-components.ts — period component totals, one home.
//
// TaxObligationPeriod used to carry salesTaxAmount and inputTaxAmount directly.
// Payroll needs employee-withheld and employer-contribution totals on the same
// spine, and adding those as columns would have made four, with each family's
// pair dead weight on every other family's rows (DI-31F2D7D10E25).
//
// So a component total lives in exactly one place: a TaxObligationPeriodComponent
// row keyed by (periodId, componentKind). This module is the only reader and
// writer of that shape, so no surface re-derives it differently.

/** Mirrors the TaxPeriodComponentKind Prisma enum. */
export type TaxPeriodComponentKind =
  | "sales_output"
  | "sales_input"
  | "employee_withheld"
  | "employer_contribution";

export interface PeriodComponentAmount {
  componentKind: TaxPeriodComponentKind;
  amount: number;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Sum the components of one period by kind.
 *
 * A kind with no row reads as 0. That is the honest default: a period that
 * never accrued withholding has no withholding, and forcing a zero row for
 * every kind on every period would put three quarters of the table's rows there
 * to say nothing.
 */
export function summariseComponents(
  components: readonly PeriodComponentAmount[],
): Record<TaxPeriodComponentKind, number> {
  const totals: Record<TaxPeriodComponentKind, number> = {
    sales_output: 0,
    sales_input: 0,
    employee_withheld: 0,
    employer_contribution: 0,
  };
  for (const component of components) {
    if (component.componentKind in totals) {
      totals[component.componentKind] = round2(
        totals[component.componentKind] + component.amount,
      );
    }
  }
  return totals;
}

/**
 * Net tax for a period from its components plus any manual adjustment.
 *
 * Sales input tax is RECOVERABLE, so it subtracts. Both payroll components are
 * owed, so they add — including the employee-withheld portion, which the
 * business does not own but must still remit. Netting withheld money off the
 * liability because it "isn't the company's" would understate what is due.
 */
export function netFromComponents(
  totals: Record<TaxPeriodComponentKind, number>,
  manualAdjustmentAmount = 0,
): number {
  return round2(
    totals.sales_output -
      totals.sales_input +
      totals.employee_withheld +
      totals.employer_contribution +
      manualAdjustmentAmount,
  );
}

/** The slice of Prisma this module needs, so tests need no live database. */
export type PeriodComponentClient = {
  taxObligationPeriodComponent: {
    deleteMany(args: unknown): Promise<unknown>;
    createMany(args: unknown): Promise<unknown>;
  };
};

/**
 * Replace a period's components with exactly the non-zero amounts given.
 *
 * Replace rather than merge: a re-run that no longer produces withholding must
 * clear the old withholding row, or the period keeps reporting a liability the
 * current facts no longer support. Zero amounts are dropped for the same reason
 * the emitter drops them — an empty component is not a liability to file.
 *
 * `componentId` is caller-supplied so the write stays deterministic and
 * testable; callers pass their own id generator.
 */
export async function replacePeriodComponents(
  db: PeriodComponentClient,
  periodRecordId: string,
  amounts: readonly PeriodComponentAmount[],
  newComponentId: () => string,
): Promise<PeriodComponentAmount[]> {
  const kept = amounts
    .map((a) => ({ componentKind: a.componentKind, amount: round2(a.amount) }))
    .filter((a) => a.amount !== 0);

  await db.taxObligationPeriodComponent.deleteMany({ where: { periodId: periodRecordId } });
  if (kept.length > 0) {
    await db.taxObligationPeriodComponent.createMany({
      data: kept.map((a) => ({
        taxObligationPeriodComponentId: newComponentId(),
        periodId: periodRecordId,
        componentKind: a.componentKind,
        amount: a.amount,
      })),
    });
  }
  return kept;
}

/** The slice of Prisma the period upsert needs. */
export type PeriodUpsertClient = PeriodComponentClient & {
  taxObligationPeriod: {
    update(args: unknown): Promise<{ id: string }>;
    create(args: unknown): Promise<{ id: string; periodId: string }>;
  };
};

/**
 * Create or refresh one obligation period and its components together.
 *
 * The two writes belong in one place because they must agree: a period whose
 * net says one thing while its components say another is the exact
 * inconsistency normalizing them was meant to remove.
 */
export async function upsertPeriodWithComponents(
  db: PeriodUpsertClient,
  args: {
    existingRecordId?: string;
    registrationId: string;
    newPeriodId: () => string;
    newComponentId: () => string;
    periodStart: Date;
    periodEnd: Date;
    dueDate: Date;
    netTaxAmount: number;
    manualAdjustmentAmount: number;
    components: readonly PeriodComponentAmount[];
  },
): Promise<{ id: string; periodId?: string }> {
  let record: { id: string; periodId?: string };

  if (args.existingRecordId) {
    const updated = await db.taxObligationPeriod.update({
      where: { id: args.existingRecordId },
      data: {
        dueDate: args.dueDate,
        manualAdjustmentAmount: args.manualAdjustmentAmount,
        netTaxAmount: args.netTaxAmount,
      },
    });
    record = { id: updated.id };
  } else {
    const created = await db.taxObligationPeriod.create({
      data: {
        periodId: args.newPeriodId(),
        registrationId: args.registrationId,
        periodStart: args.periodStart,
        periodEnd: args.periodEnd,
        dueDate: args.dueDate,
        status: "draft",
        netTaxAmount: args.netTaxAmount,
        manualAdjustmentAmount: args.manualAdjustmentAmount,
        exportStatus: "not_started",
        dueSoonNotifiedAt: null,
        overdueNotifiedAt: null,
      },
    });
    record = { id: created.id, periodId: created.periodId };
  }

  await replacePeriodComponents(db, record.id, args.components, args.newComponentId);
  return record;
}
