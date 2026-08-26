// lib/hr/payroll-tax-persistence.ts — the write path from a pay run onto the
// tax spine (BI-947F8703 item 4).
//
// emitPayrollTaxSnapshots already proved the MAPPING: a pay run's taxes become
// snapshots with sourceType "payroll_run" and reuse the whole
// accrue -> period -> due -> prepare -> approve -> file -> confirm machinery.
// But it is a pure function, so nothing was ever written. This module is the
// write path, and it is deliberately the only one.
//
// SAFETY. This persists ACCRUALS, nothing more. It records what is owed and
// when. It never files, never remits, and never touches an authority
// credential — those stay agent-prepared and human-approved with MFA step-up,
// because a late or wrong deposit carries real financial penalties.

import {
  emitPayrollTaxSnapshots,
  summarisePeriod,
  type EmittablePayRun,
  type PayrollTaxSnapshot,
  type PayrollTaxType,
} from "./payroll-tax-emission";
import {
  netFromComponents,
  replacePeriodComponents,
  summariseComponents,
  type PeriodComponentAmount,
} from "@/lib/finance/tax-period-components";

/**
 * Which registration remits which payroll tax.
 *
 * Resolved by the CALLER, not guessed here. A tax type with no registration is
 * a finding the operator must see — silently dropping it would lose a real
 * liability, and inventing a registration would fabricate an authority
 * relationship that does not exist.
 */
export type RegistrationsByTaxType = Partial<Record<PayrollTaxType, string>>;

export interface PayrollTaxPersistenceResult {
  /** Snapshot rows written, by their public id. */
  snapshotIds: string[];
  /** Liability entry rows written, by their public id. */
  liabilityEntryIds: string[];
  /** Period components written, keyed by the period record they belong to. */
  componentsByPeriod: Record<string, PeriodComponentAmount[]>;
  /** Net tax recorded per period record. */
  netByPeriod: Record<string, number>;
  /**
   * Tax types the run produced that no registration covers.
   *
   * Surfaced, never swallowed: an uncovered liability is money owed to an
   * authority the business has not registered with, which is exactly the thing
   * an operator needs told.
   */
  unregisteredTaxTypes: PayrollTaxType[];
}

/** The slice of Prisma this module needs, so tests need no live database. */
export type PayrollTaxPersistenceClient = {
  taxDecisionSnapshot: { create(args: unknown): Promise<{ id: string; snapshotId: string }> };
  taxLiabilityEntry: { create(args: unknown): Promise<{ id: string; entryId: string }> };
  taxObligationPeriodComponent: {
    deleteMany(args: unknown): Promise<unknown>;
    createMany(args: unknown): Promise<unknown>;
  };
};

export interface PersistPayrollTaxArgs {
  organizationTaxProfileId: string;
  run: EmittablePayRun;
  registrationsByTaxType: RegistrationsByTaxType;
  /**
   * Which obligation period each registration's accrual belongs to. A missing
   * entry writes the snapshot and liability without a period; period generation
   * picks it up later by sourceType, exactly as sales tax does.
   */
  periodByRegistration?: Record<string, string>;
  newSnapshotId: () => string;
  newEntryId: () => string;
  newComponentId: () => string;
}

/**
 * Write one pay run's tax accruals onto the tax spine.
 *
 * Snapshot AND liability entry, not one or the other: the snapshot is the
 * immutable record of what was decided and why, the entry is the running
 * balance a period totals. Sales tax writes both; payroll writing only one
 * would make payroll periods total differently from sales periods.
 */
export async function persistPayrollTaxAccruals(
  db: PayrollTaxPersistenceClient,
  args: PersistPayrollTaxArgs,
): Promise<PayrollTaxPersistenceResult> {
  const snapshots = emitPayrollTaxSnapshots(args.run);

  const snapshotIds: string[] = [];
  const liabilityEntryIds: string[] = [];
  const unregisteredTaxTypes: PayrollTaxType[] = [];
  const byPeriod = new Map<string, PayrollTaxSnapshot[]>();

  for (const snapshot of snapshots) {
    const registrationId = args.registrationsByTaxType[snapshot.taxType];
    if (!registrationId) {
      if (!unregisteredTaxTypes.includes(snapshot.taxType)) {
        unregisteredTaxTypes.push(snapshot.taxType);
      }
      continue;
    }

    const periodRecordId = args.periodByRegistration?.[registrationId];

    const written = await db.taxDecisionSnapshot.create({
      data: {
        snapshotId: args.newSnapshotId(),
        organizationTaxProfileId: args.organizationTaxProfileId,
        registrationId,
        sourceType: snapshot.sourceType,
        sourceId: snapshot.sourceId,
        taxType: snapshot.taxType,
        // The side rides in taxCode so the withheld/contribution split survives
        // onto the spine without the spine needing a payroll-shaped column.
        taxCode: snapshot.side,
        direction: "output",
        taxableAmount: snapshot.taxableAmount,
        taxAmount: snapshot.taxAmount,
        occurredAt: snapshot.occurredAt,
        evidence: {
          emitter: "payroll-tax-emission",
          side: snapshot.side,
          payRunId: snapshot.sourceId,
          // Pay date, not period end: the deposit obligation is triggered by
          // payment, and this is the field a later audit reads to check timing.
          datedBy: "pay_date",
        },
      },
    });
    snapshotIds.push(written.snapshotId);

    const entry = await db.taxLiabilityEntry.create({
      data: {
        entryId: args.newEntryId(),
        organizationTaxProfileId: args.organizationTaxProfileId,
        registrationId,
        periodId: periodRecordId ?? null,
        decisionSnapshotId: written.id,
        sourceType: snapshot.sourceType,
        sourceId: snapshot.sourceId,
        direction: "output",
        taxableAmount: snapshot.taxableAmount,
        taxAmount: snapshot.taxAmount,
        currency: snapshot.currency,
        occurredAt: snapshot.occurredAt,
        notes: `Payroll ${snapshot.taxType} (${snapshot.side})`,
      },
    });
    liabilityEntryIds.push(entry.entryId);

    if (periodRecordId) {
      byPeriod.set(periodRecordId, [...(byPeriod.get(periodRecordId) ?? []), snapshot]);
    }
  }

  const componentsByPeriod: Record<string, PeriodComponentAmount[]> = {};
  const netByPeriod: Record<string, number> = {};

  for (const [periodRecordId, periodSnapshots] of byPeriod) {
    const split = summarisePeriod(periodSnapshots);
    const written = await replacePeriodComponents(
      db,
      periodRecordId,
      [
        { componentKind: "employee_withheld", amount: split.employeeWithheld },
        { componentKind: "employer_contribution", amount: split.employerContribution },
      ],
      args.newComponentId,
    );
    componentsByPeriod[periodRecordId] = written;
    netByPeriod[periodRecordId] = netFromComponents(summariseComponents(written));
  }

  return {
    snapshotIds,
    liabilityEntryIds,
    componentsByPeriod,
    netByPeriod,
    unregisteredTaxTypes,
  };
}
