// The scope baseline a plan-coverage receipt binds to (BI-86B638F7).
//
// Readiness lets a plan child inherit its parent's scope baseline through the
// parent's coverage (baseline-source.ts, BI-2515F779), and then issues no
// spec-approval route of its own. Coverage resolves the baseline the same way, so
// the two never disagree about whether an item has one.
//
// Order, unchanged for every item that already had a route: the item's own
// baseline; else the proportional delivery scope (schema v3) where its shape owes
// one; else the baseline it inherits. Invariant: coverage is never recordable
// without some approved baseline. With none of the three, rows are empty and the
// caller refuses exactly as before.

import { loadBaselineSourceForItem, type BaselineSourceDb } from "@/lib/backlog/initiative-readiness/baseline-source";

import { readPlanDeliveryScope, type PlanDeliveryScope } from "./plan-coverage-delivery-scope";

export async function resolveCoverageBaseline(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  item: { id: string; itemId: string },
  options: { deliveryScope: boolean },
): Promise<{ rows: Array<{ payload: unknown }>; deliveryScope: PlanDeliveryScope | null }> {
  const own: Array<{ payload: unknown }> = await db.backlogItemActivity.findMany({
    where: { backlogItemId: item.id, kind: "initiative_scope_baseline" },
    orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
    select: { payload: true },
  });
  if (own.length > 0) return { rows: own, deliveryScope: null };
  const deliveryScope = options.deliveryScope ? await readPlanDeliveryScope(db, item as never) : null;
  if (deliveryScope) return { rows: own, deliveryScope };
  const source = await loadBaselineSourceForItem(db as BaselineSourceDb, { id: item.id, itemId: item.itemId });
  return { rows: source.origin === "inherited" ? source.baselineRows : [], deliveryScope: null };
}
