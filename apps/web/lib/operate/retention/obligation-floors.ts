// EP-A33A5C61 slice 6 (BI-69C29492) — retention floors DERIVED from the
// obligations that actually apply to this install.
//
// THE GAP THIS CLOSES
// industry-floors.ts encodes four hardcoded rows keyed by `Organization.industry`
// through a hand-maintained alias map. Jurisdiction never participates, and a
// missed alias silently drops the floor to the base window. Meanwhile the
// compliance plane already answers the harder question — which regulations bind
// THIS install, by archetype AND jurisdiction (compliance-library.ts:
// classifyRegulationForInstall / resolveApplicableRegulationDbIds) — but no
// Obligation could state a retention duration as a number, only as prose in its
// description ("wage records ... for at least three years"). Obligation
// .retentionMinimumDays is that missing datum; this module joins the two.
//
// SAFETY
// Floors only ever LENGTHEN: effective = max(base, every applicable floor). A
// missing, unparsed or unreachable obligation therefore leaves the conservative
// base window in place and can never cause an early delete. Every failure path
// here returns "no floors" rather than throwing, for the same reason the
// industry resolver does: a retention sweep must never abort because the
// compliance plane is unreadable.

import { getErrorMessage } from "@/lib/shared/get-error-message";

import type { RetentionFloorBucket } from "./policies";
import { RETENTION_FLOOR_BUCKETS } from "./policies";

/** One applicable obligation's contribution, kept for the report and the audit trail. */
export type ObligationFloorSource = {
  obligationId: string;
  title: string;
  regulationId: string;
  regulationName: string;
  jurisdiction: string | null;
  days: number;
  buckets: readonly RetentionFloorBucket[];
};

export type ObligationFloors = {
  /** Longest applicable minimum per bucket, in days. Absent bucket = no floor. */
  byBucket: Partial<Record<RetentionFloorBucket, number>>;
  /** What produced each floor, so a sweep summary can cite the regulator. */
  sources: ObligationFloorSource[];
};

export const NO_OBLIGATION_FLOORS: ObligationFloors = { byBucket: {}, sources: [] };

type ObligationRow = {
  obligationId: string;
  title: string;
  retentionMinimumDays: number | null;
  retentionFloorBuckets: string[];
  regulation: { regulationId: string; name: string; jurisdiction: string | null };
};

/**
 * PURE. Fold obligation rows into the longest floor per bucket.
 *
 * An obligation that names no bucket but states a minimum binds EVERY bucket —
 * a records-retention rule that does not distinguish audit trails from chat is
 * making a claim about all of them, and reading it narrowly would understate a
 * regulator. An unknown bucket name is ignored rather than trusted.
 */
export function foldObligationFloors(rows: readonly ObligationRow[]): ObligationFloors {
  const byBucket: Partial<Record<RetentionFloorBucket, number>> = {};
  const sources: ObligationFloorSource[] = [];

  for (const row of rows) {
    const days = row.retentionMinimumDays;
    if (typeof days !== "number" || !Number.isFinite(days) || days <= 0) continue;

    const named = row.retentionFloorBuckets.filter((b): b is RetentionFloorBucket =>
      (RETENTION_FLOOR_BUCKETS as readonly string[]).includes(b),
    );
    const buckets = named.length > 0 ? named : [...RETENTION_FLOOR_BUCKETS];

    for (const bucket of buckets) {
      byBucket[bucket] = Math.max(byBucket[bucket] ?? 0, days);
    }
    sources.push({
      obligationId: row.obligationId,
      title: row.title,
      regulationId: row.regulation.regulationId,
      regulationName: row.regulation.name,
      jurisdiction: row.regulation.jurisdiction,
      days,
      buckets,
    });
  }

  sources.sort((a, b) => b.days - a.days || a.obligationId.localeCompare(b.obligationId));
  return { byBucket, sources };
}

/**
 * Structural view of the one delegate this module needs. Widened to accept the
 * real PrismaClient's overloaded findMany (whose return type is driven by the
 * caller's `select`) while a test can still hand in a plain fake.
 */
type ObligationFloorDb = {
  obligation: {
    findMany(args: never): Promise<unknown>;
  };
};

/**
 * Read the retention minimums of the obligations that apply to this install.
 *
 * `applicableRegulationDbIds` comes from the existing compliance classifier
 * (compliance-library.ts), which already scopes by archetype and jurisdiction —
 * this module deliberately does not re-derive applicability, so there is one
 * answer to "what binds us" rather than two.
 *
 * Passing `null` means "applicability could not be resolved": every obligation
 * with a stated minimum is then considered, which can only lengthen windows.
 * That is the safe direction, and it keeps a sweep honest on an install whose
 * business context is not yet filled in.
 */
export async function loadObligationFloors(
  db: ObligationFloorDb,
  applicableRegulationDbIds: readonly string[] | null,
  log: (message: string) => void = () => {},
): Promise<ObligationFloors> {
  try {
    const rows = (await db.obligation.findMany({
      where: {
        status: "active",
        retentionMinimumDays: { not: null },
        ...(applicableRegulationDbIds ? { regulationId: { in: [...applicableRegulationDbIds] } } : {}),
      },
      select: {
        obligationId: true,
        title: true,
        retentionMinimumDays: true,
        retentionFloorBuckets: true,
        regulation: { select: { regulationId: true, name: true, jurisdiction: true } },
      },
    } as never)) as ObligationRow[];
    if (applicableRegulationDbIds === null && rows.length > 0) {
      log(
        `applicability unresolved — applying every stated retention minimum (${rows.length}); floors can only lengthen, so this is the safe direction`,
      );
    }
    return foldObligationFloors(rows);
  } catch (err) {
    // Never block a sweep on the compliance plane: no floors means the base
    // windows apply unchanged, which is the conservative outcome.
    log(`obligation floors unreadable (${getErrorMessage(err)}) — base windows apply`);
    return NO_OBLIGATION_FLOORS;
  }
}
