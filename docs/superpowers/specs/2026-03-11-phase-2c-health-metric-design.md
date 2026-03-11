# Phase 2C — Portfolio Health Metric Design

**Date:** 2026-03-11
**Status:** Approved
**Scope:** Wire up the Health stat box in portfolio views using a computed product-status metric.

---

## Overview

Phase 2A introduced dashed placeholder stat boxes for Health and Investment in both `PortfolioNodeDetail` and (conceptually) `PortfolioOverview`. Phase 2B wired up live Agent counts. Phase 2C wires up the **Health** stat box using a computed metric derived from existing `DigitalProduct.status` data.

**Health definition:**

> `Math.round(activeProducts / totalProducts * 100)%`
>
> Where `activeProducts` = products with `status === "active"` in this node's subtree, and `totalProducts` = all products in this node's subtree regardless of status. Returns `"—"` when `totalProducts === 0`.

**Investment** remains a dashed placeholder. No schema or seed changes are required for this phase.

---

## What Changes

### 1. `PortfolioTreeNode` type — add `activeCount`

`apps/web/lib/portfolio.ts`

Add `activeCount: number` field alongside the existing `totalCount`:

```ts
export type PortfolioTreeNode = {
  id: string;
  nodeId: string;
  name: string;
  parentId: string | null;
  portfolioId: string | null;
  directCount: number;     // total products directly on this node (all statuses)
  totalCount: number;      // total products in subtree (all statuses, rolled up)
  activeCount: number;     // active products in subtree (rolled up)
  children: PortfolioTreeNode[];
};
```

**Note on `totalCount` semantics change:** The existing query in `getPortfolioTree()` uses `where: { status: "active" }`, meaning `totalCount` currently equals the count of *active* products only. In Phase 2C this is corrected: `totalCount` is changed to count all products regardless of status, and `activeCount` counts active-only. This is a breaking change to existing behaviour, but it is the semantically correct model. In practice, all current seed data has `status: "active"` so displayed counts are unchanged.

### 2. `buildPortfolioTree` — accept `activeCounts` third parameter (optional, default `[]`)

```ts
export function buildPortfolioTree(
  nodes: RawNode[],
  totalCounts: CountRow[],        // all products (any status) — replaces existing `counts`
  activeCounts: CountRow[] = []   // active products only; defaults to [] so existing call sites compile
): PortfolioTreeNode[]
```

- `directCount` = from `totalCounts`
- `activeDirectCount` (local variable, not exposed on the type) = from `activeCounts`
- Both are rolled up via the DFS `sumSubtree` function

**Node initialisation** — the object literal inside `buildPortfolioTree` must initialise `activeCount: 0` (required by `exactOptionalPropertyTypes`):

```ts
nodeMap.set(n.id, {
  id: n.id,
  nodeId: n.nodeId,
  name: n.name,
  parentId: n.parentId,
  portfolioId: n.portfolioId ?? null,
  directCount: countById.get(n.id) ?? 0,
  totalCount: 0,
  activeCount: 0,   // ← new; set during DFS below
  children: [],
});
```

**DFS rollup** — build an `activeCountById` map (same pattern as `countById`), then update `sumSubtree` to set both fields in one pass:

```ts
const activeCountById = new Map<string, number>();
for (const c of activeCounts) {
  if (c.taxonomyNodeId) activeCountById.set(c.taxonomyNodeId, c._count.id);
}

function sumSubtree(node: PortfolioTreeNode): { total: number; active: number } {
  const childTotals = node.children.reduce(
    (acc, c) => {
      const sub = sumSubtree(c);
      return { total: acc.total + sub.total, active: acc.active + sub.active };
    },
    { total: 0, active: 0 }
  );
  node.totalCount  = node.directCount + childTotals.total;
  node.activeCount = (activeCountById.get(node.id) ?? 0) + childTotals.active;
  return { total: node.totalCount, active: node.activeCount };
}
for (const root of roots) sumSubtree(root);
```

**Existing call sites** — because `activeCounts` defaults to `[]`, the 11 existing test call sites `buildPortfolioTree(NODES, COUNTS)` continue to compile without modification. `activeCount` will be `0` for all nodes when the third argument is omitted, which does not affect any existing test assertion.

### 3. `computeHealth` — new pure function

```ts
export function computeHealth(active: number, total: number): string {
  if (total === 0) return "—";
  return Math.round((active / total) * 100) + "%";
}
```

Exported from `portfolio.ts`. No DB calls.

### 4. `getPortfolioTree()` — fetch both count sets

`apps/web/lib/portfolio-data.ts`

Two parallel `groupBy` queries:

```ts
const [nodes, totalCounts, activeCounts] = await Promise.all([
  prisma.taxonomyNode.findMany({ ... }),
  prisma.digitalProduct.groupBy({
    by: ["taxonomyNodeId"],
    _count: { id: true },
    // no status filter — counts all products
  }),
  prisma.digitalProduct.groupBy({
    by: ["taxonomyNodeId"],
    _count: { id: true },
    where: { status: "active" },
  }),
]);
return buildPortfolioTree(nodes, totalCounts, activeCounts);
```

React `cache()` wrapping unchanged — still deduplicates across layout + page within one request.

### 5. `page.tsx` — derive health for selected node

```ts
const healthStr = computeHealth(node.activeCount, node.totalCount);
// Pass to PortfolioNodeDetail
```

For the overview (`/portfolio`), health is read directly from each root's `activeCount` and `totalCount` in `PortfolioOverview` — no additional fetch needed.

The existing `prisma.digitalProduct.findMany` query (which fetches only `status: "active"` products for the `ProductList` display) is **unchanged**. It is independent of the health computation.

### 6. `PortfolioOverview.tsx` — show health per portfolio card

Add a Health stat alongside Products, Owner, Agents:

```tsx
<div>
  <p className="text-sm font-bold" style={{ color: colour }}>
    {computeHealth(root.activeCount, root.totalCount)}
  </p>
  <p className="text-[9px] text-[var(--dpf-muted)] uppercase tracking-wider">
    Health
  </p>
</div>
```

Import `computeHealth` from `@/lib/portfolio`.

### 7. `PortfolioNodeDetail.tsx` — wire Health stat box

Replace the dashed Health `StatBox`:

```tsx
// Before:
<StatBox label="Health" value="—" colour="#555566" dashed />

// After:
<StatBox label="Health" value={health} colour={colour} />
```

Add `health: string` to Props. The `dashed` prop defaults to `false` so no change needed to `StatBox`.

---

## Component / Data Flow

```
portfolio-data.ts: getPortfolioTree()
  ├─ prisma: all-products groupBy  → totalCounts[]
  ├─ prisma: active-products groupBy → activeCounts[]
  └─ buildPortfolioTree(nodes, totalCounts, activeCounts)
       → PortfolioTreeNode[] with .totalCount + .activeCount

page.tsx (overview):
  PortfolioOverview  ← roots[]  (reads .activeCount, .totalCount directly)

page.tsx (node detail):
  healthStr = computeHealth(node.activeCount, node.totalCount)
  PortfolioNodeDetail ← health={healthStr}
```

No schema migration. No seed changes. No new packages.

---

## Files to Create / Modify

| File | Action |
|---|---|
| `apps/web/lib/portfolio.ts` | Add `activeCount` to type; update `buildPortfolioTree` signature + implementation; add `computeHealth` |
| `apps/web/lib/portfolio.test.ts` | Update existing fixture (3rd arg); add tests for `activeCount` roll-up + `computeHealth` |
| `apps/web/lib/portfolio-data.ts` | Add second `groupBy` for active products; pass both to `buildPortfolioTree` |
| `apps/web/app/(shell)/portfolio/[[...slug]]/page.tsx` | Import `computeHealth`; derive `healthStr`; pass to `PortfolioNodeDetail` |
| `apps/web/components/portfolio/PortfolioOverview.tsx` | Import `computeHealth`; add Health div to each portfolio card |
| `apps/web/components/portfolio/PortfolioNodeDetail.tsx` | Add `health: string` to Props; replace dashed placeholder with live `StatBox` |

---

## Testing

All tests are unit tests in `apps/web/lib/portfolio.test.ts` (existing Vitest config, `environment: "node"`).

| Test | What it checks |
|---|---|
| `buildPortfolioTree()` — activeCount rolls up from children | NODES with activeCounts fixture |
| `buildPortfolioTree()` — node with no active products gets activeCount=0 | activeCounts=[] |
| `buildPortfolioTree()` — totalCount now counts all products (any status) | Separate totalCounts/activeCounts fixture |
| `computeHealth(10, 10)` | `"100%"` |
| `computeHealth(0, 5)` | `"0%"` |
| `computeHealth(0, 0)` | `"—"` |
| `computeHealth(1, 3)` | `"33%"` |

Existing 11 tests are **left unchanged** — the third argument is omitted, which is valid because `activeCounts` defaults to `[]`. The existing assertions (`directCount`, `totalCount`) do not touch `activeCount`, so they remain correct.

---

## What This Does Not Include

- Investment metric — no data source exists; remains dashed placeholder
- People panel live data — future phase
- Health thresholding (e.g., red/amber/green) — future phase
- Tests for `PortfolioOverview` or `PortfolioNodeDetail` rendering — deferred (no jsdom setup)
