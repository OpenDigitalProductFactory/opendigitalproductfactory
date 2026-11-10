/**
 * Where the acceptance route reads an item's objective baseline from (BI-2515F779).
 *
 * The readiness PROJECTION already lets a plan child inherit its parent's
 * initiative scope through the parent's plan-coverage receipt
 * (parent-scope-inheritance.ts), which is why OBJECTIVE_BASELINE_REQUIRED
 * passes on a child that never had its own spec approval. The terminal
 * ROUTER did not: it read `initiative_scope_baseline` rows on the child only,
 * found none, and escalated "baseline-not-found — complete independent spec
 * approval", which a decomposed child by design never does. The one receipt
 * the shape owes was therefore unreachable and no child could close.
 *
 * This resolver answers the same question for both router ports — the
 * baseline chain, and the evidence window that chain opens — from one place:
 * the item's own baseline rows when it has any, otherwise the baselines of the
 * parent whose coverage maps it. Evidence is always the child's own; the
 * inherited part is the scope, never the proof.
 */

import {
  loadInheritedInitiativeScope,
  type InheritanceDb,
} from "./parent-scope-inheritance";

export type BaselineRow = { id: string; kind: string; recordedAt: Date; payload: unknown; backlogItemId?: string };

export type BaselineSource = {
  /** Row id of the item whose evidence is being judged (always the subject). */
  itemRowId: string;
  itemId: string;
  /** Baseline rows in recorded order; own rows when present, else inherited. */
  baselineRows: BaselineRow[];
  /** "own" when the subject minted its baseline; "inherited" when the parent did. */
  origin: "own" | "inherited" | "none";
  /** The parent whose scope was inherited, when it was. */
  inheritedFromItemId: string | null;
};

export type BaselineSourceDb = InheritanceDb & {
  backlogItem: {
    findFirst(args: unknown): Promise<{ id?: string; itemId: string } | null>;
  };
};

export async function loadBaselineSource(
  db: BaselineSourceDb,
  itemId: string,
): Promise<BaselineSource | null> {
  const item = await db.backlogItem.findFirst({
    where: { OR: [{ itemId }, { id: itemId }] },
    select: { id: true, itemId: true },
  }) as { id: string; itemId: string } | null;
  if (!item) return null;
  return loadBaselineSourceForItem(db, item);
}

/** Same resolution for a caller that already holds the item row (no extra lookup). */
export async function loadBaselineSourceForItem(
  db: BaselineSourceDb,
  item: { id: string; itemId: string },
): Promise<BaselineSource> {
  const own = await db.backlogItemActivity.findMany({
    where: { backlogItemId: item.id, kind: "initiative_scope_baseline" },
    orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
    select: { id: true, backlogItemId: true, kind: true, recordedAt: true, payload: true },
  }) as BaselineRow[];
  if (own.length > 0) {
    return { itemRowId: item.id, itemId: item.itemId, baselineRows: own, origin: "own", inheritedFromItemId: null };
  }

  const inherited = await loadInheritedInitiativeScope(db, { childItemId: item.itemId, childRowId: item.id });
  if (!inherited) {
    return { itemRowId: item.id, itemId: item.itemId, baselineRows: [], origin: "none", inheritedFromItemId: null };
  }
  const rows = inherited.activities
    .filter((activity) => activity.kind === "initiative_scope_baseline")
    .map((activity) => ({ id: activity.id, kind: activity.kind, recordedAt: activity.recordedAt, payload: activity.payload }))
    .sort((left, right) => left.recordedAt.getTime() - right.recordedAt.getTime());
  return {
    itemRowId: item.id,
    itemId: item.itemId,
    baselineRows: rows,
    origin: rows.length > 0 ? "inherited" : "none",
    inheritedFromItemId: inherited.parentItemId,
  };
}
