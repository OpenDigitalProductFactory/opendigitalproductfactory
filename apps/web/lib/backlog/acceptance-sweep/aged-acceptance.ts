// The aged share of awaiting-acceptance work, as the delivery surfaces show it
// (design 2026-09-24 acceptance accountability §3.2 and §3.5, BI-CEC60185).
//
// Client-safe: no database access. The loader that measures each item's age is
// ./aged-acceptance-loader.ts.

import { ACCEPTANCE_AGED_DAYS } from "@dpf/db/acceptance-sweep-config";

import type { AcceptanceEntry } from "./acceptance-age";

/**
 * Days in awaiting-acceptance after which an item is aged. Defined once in the
 * acceptance-sweep config (the sweep reads the same constant); re-exported here
 * through the client-safe subpath so client surfaces need not import the db barrel.
 */
export { ACCEPTANCE_AGED_DAYS };

const AWAITING_ACCEPTANCE = "awaiting-acceptance";

export type AgeBasis = AcceptanceEntry["ageBasis"];

/** One aged item. `created` means its age is an upper bound (no entry row). */
export type AgedAcceptanceItem = { id: string; ageBasis: AgeBasis };

export type AgedAcceptanceShare = {
  awaiting: number;
  aged: number;
  /** Of `aged`, how many are measured from creation, so may not really be aged. */
  agedByCreation: number;
};

/** Counts awaiting items and the aged share among `items`. */
export function agedAcceptanceShare(
  items: readonly { id: string; status: string }[],
  agedById: ReadonlyMap<string, AgeBasis>,
): AgedAcceptanceShare {
  const share: AgedAcceptanceShare = { awaiting: 0, aged: 0, agedByCreation: 0 };
  for (const item of items) {
    if (item.status !== AWAITING_ACCEPTANCE) continue;
    share.awaiting += 1;
    const basis = agedById.get(item.id);
    if (basis === undefined) continue;
    share.aged += 1;
    if (basis === "created") share.agedByCreation += 1;
  }
  return share;
}

/**
 * The aged count as shown. When some ages are measured from creation the true
 * count may be lower, so the number is marked as a ceiling rather than
 * presented as time in the state.
 */
export function formatAgedCount(share: Pick<AgedAcceptanceShare, "aged" | "agedByCreation">): string {
  return share.agedByCreation > 0 ? `up to ${share.aged}` : String(share.aged);
}

/** Plain-language explanation for a tooltip or accessible description. */
export function describeAgedShare(share: Pick<AgedAcceptanceShare, "aged" | "agedByCreation">): string {
  const base = `${share.aged} waiting ${ACCEPTANCE_AGED_DAYS}+ days since entering awaiting acceptance`;
  if (share.agedByCreation === 0) return `${base}.`;
  return `${base}. ${share.agedByCreation} of them have no recorded entry, so their age is counted from creation and may be lower.`;
}
