// apps/web/lib/coworker/envelope-expiry.ts
//
// Settling an approval nobody answered (BI-410ACCB8).
//
// envelope-observability.ts already knows which envelopes have lapsed — it
// treats a `proposed` row past its `expiresAt` as `expired` and counts it apart
// from `awaitingDecision`. It refuses to write that down, and says why: "an
// observer that quietly expired rows would be changing the thing it measures,
// and the state machine owns that transition."
//
// Nothing owned it. On the reference install on 2026-09-12 all 139 open
// envelopes had an `expiresAt` in the past and every one still read `proposed`,
// so the projection was right and the stored state was wrong — and each new
// consumer of raw status had to re-derive the correction or repeat the mistake.
//
// This is the transition. It writes only what the projection already concluded,
// so the two can never disagree.

import { canTransition, type EnvelopeStatus } from "./envelope-state-machine";

/** The lapsed envelopes this sweep may settle, and the write it performs. */
export interface EnvelopeExpiryDb {
  coworkerActionEnvelope: {
    findMany(args: unknown): Promise<Array<{ id: string; status: string }>>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
}

/** Statuses a lapse can still settle. Anything terminal is already answered. */
const LAPSABLE: readonly EnvelopeStatus[] = ["proposed", "approved"];

export interface EnvelopeExpirySummary {
  /** How many envelopes moved to `expired`. */
  expired: number;
  /** Rows read but left alone because the transition is not legal from there. */
  skipped: number;
}

/**
 * Settle every envelope whose decision window closed with nobody answering.
 *
 * Bounded per pass (`limit`) so one sweep cannot monopolise a transaction, and
 * every candidate is checked against the state machine rather than trusted —
 * a row that raced to a terminal status between the read and the write must not
 * be dragged back out of it.
 */
export async function expireLapsedEnvelopes(
  db: EnvelopeExpiryDb,
  now: Date,
  limit = 200,
): Promise<EnvelopeExpirySummary> {
  const candidates = await db.coworkerActionEnvelope.findMany({
    where: {
      status: { in: [...LAPSABLE] },
      resolvedAt: null,
      expiresAt: { lte: now, not: null },
    },
    select: { id: true, status: true },
    take: limit,
  });
  if (candidates.length === 0) return { expired: 0, skipped: 0 };

  const settlable = candidates.filter((row) =>
    canTransition(row.status as EnvelopeStatus, "expired"),
  );
  const skipped = candidates.length - settlable.length;
  if (settlable.length === 0) return { expired: 0, skipped };

  const { count } = await db.coworkerActionEnvelope.updateMany({
    where: {
      id: { in: settlable.map((row) => row.id) },
      // Re-assert the precondition at write time: between the read above and
      // this update a person may have answered, and their answer wins.
      status: { in: [...LAPSABLE] },
      resolvedAt: null,
    },
    data: { status: "expired", resolvedAt: now },
  });

  return { expired: count, skipped };
}
