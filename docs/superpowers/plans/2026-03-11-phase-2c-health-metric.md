# Phase 2C — Portfolio Health Metric Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up the Health stat box in portfolio views using a computed percentage of active-vs-total digital products per taxonomy subtree.

**Architecture:** Add `activeCount` to `PortfolioTreeNode` (alongside existing `totalCount`), roll it up via DFS in `buildPortfolioTree`, and add a `computeHealth(active, total)` pure function. `getPortfolioTree()` fetches both a total-products count (all statuses) and an active-products count in parallel. The right panel components read the computed values directly off the tree node — no extra Prisma calls.

**Tech Stack:** TypeScript 5, Next.js 14 App Router, Prisma 5, Vitest, pnpm monorepo.

---

## File Map

| File | What changes |
|---|---|
| `apps/web/lib/portfolio.ts` | Add `activeCount` field to `PortfolioTreeNode`; update `buildPortfolioTree` signature + DFS; add `computeHealth` |
| `apps/web/lib/portfolio.test.ts` | Add `describe("computeHealth()")` and `describe("buildPortfolioTree() — activeCount")` |
| `apps/web/lib/portfolio-data.ts` | Add second `groupBy` for active products; pass both to `buildPortfolioTree` |
| `apps/web/app/(shell)/portfolio/[[...slug]]/page.tsx` | Import `computeHealth`; derive `healthStr`; pass `health` to `PortfolioNodeDetail` |
| `apps/web/components/portfolio/PortfolioOverview.tsx` | Import `computeHealth`; add Health stat to each portfolio card |
| `apps/web/components/portfolio/PortfolioNodeDetail.tsx` | Add `health: string` to Props; remove dashed placeholder; show live value |

**Spec:** `docs/superpowers/specs/2026-03-11-phase-2c-health-metric-design.md`

---

## Chunk 1: Core library changes + tests

### Task 1: `computeHealth` — tests first, then implementation

**Files:**
- Modify: `apps/web/lib/portfolio.test.ts`
- Modify: `apps/web/lib/portfolio.ts`

- [ ] **Step 1.1: Add failing `computeHealth` tests**

Append this `describe` block to `apps/web/lib/portfolio.test.ts`. Add `computeHealth` to the import on line 2:

```ts
import { buildPortfolioTree, resolveNodeFromSlug, computeHealth } from "./portfolio";
```

Then at the end of the file, add:

```ts
describe("computeHealth()", () => {
  it("returns '—' when total is 0", () => {
    expect(computeHealth(0, 0)).toBe("—");
  });

  it("returns '100%' when all products are active", () => {
    expect(computeHealth(10, 10)).toBe("100%");
  });

  it("returns '0%' when no products are active", () => {
    expect(computeHealth(0, 5)).toBe("0%");
  });

  it("rounds down to nearest integer", () => {
    expect(computeHealth(1, 3)).toBe("33%");
  });
});
```

- [ ] **Step 1.2: Run tests — expect failure**

```bash
cd d:/OpenDigitalProductFactory && pnpm --filter web test
```

Expected: test suite errors with `computeHealth is not a function` (or a TypeScript import error). **If tests pass, stop — something is wrong.**

- [ ] **Step 1.3: Implement `computeHealth` in `portfolio.ts`**

Add this function at the end of `apps/web/lib/portfolio.ts` (after `buildBreadcrumbs`):

```ts
/** Compute health percentage string from active vs total product counts.
 *  Returns "—" if no products exist in the subtree. */
export function computeHealth(active: number, total: number): string {
  if (total === 0) return "—";
  return Math.round((active / total) * 100) + "%";
}
```

- [ ] **Step 1.4: Run tests — expect pass**

```bash
cd d:/OpenDigitalProductFactory && pnpm --filter web test
```

Expected: all tests pass (existing 11 + new 4 = 15 web tests passing).

- [ ] **Step 1.5: Commit**

```bash
cd d:/OpenDigitalProductFactory
git add apps/web/lib/portfolio.ts apps/web/lib/portfolio.test.ts
git commit -m "feat(portfolio): add computeHealth pure function with tests"
```

---

### Task 2: Add `activeCount` to `buildPortfolioTree` — tests first

**Files:**
- Modify: `apps/web/lib/portfolio.test.ts`
- Modify: `apps/web/lib/portfolio.ts`

- [ ] **Step 2.1: Add failing `activeCount` tests**

Add this `ACTIVE_COUNTS` fixture immediately after the existing `COUNTS` constant (around line 18 of `portfolio.test.ts`):

```ts
// Active-products fixture: root1 has 1 direct active, l1a has 1 direct active, l2a and l1b have none.
// Expected activeCount roll-up: root1 = 1+1+0 = 2, l1a = 1+0 = 1, l2a = 0, l1b = 0, root2 = 0
const ACTIVE_COUNTS = [
  { taxonomyNodeId: "root1", _count: { id: 1 } },
  { taxonomyNodeId: "l1a",   _count: { id: 1 } },
];
```

Then append this `describe` block at the end of the file (after the `computeHealth` tests):

```ts
describe("buildPortfolioTree() — activeCount", () => {
  it("rolls activeCount up from children to root (root1 = 1 direct + 1 from l1a)", () => {
    const roots = buildPortfolioTree(NODES, COUNTS, ACTIVE_COUNTS);
    const foundational = roots.find((r) => r.nodeId === "foundational")!;
    expect(foundational.activeCount).toBe(2);
  });

  it("sets activeCount on intermediate nodes (l1a = 1 direct, l2a has none)", () => {
    const roots = buildPortfolioTree(NODES, COUNTS, ACTIVE_COUNTS);
    const foundational = roots.find((r) => r.nodeId === "foundational")!;
    const compute = foundational.children.find((c) => c.nodeId === "foundational/compute")!;
    expect(compute.activeCount).toBe(1);
  });

  it("defaults activeCount to 0 for every node when third arg is omitted", () => {
    // Existing call signature without activeCounts — must still compile and run
    const roots = buildPortfolioTree(NODES, COUNTS);
    const foundational = roots.find((r) => r.nodeId === "foundational")!;
    expect(foundational.activeCount).toBe(0);
  });

  it("totalCount is driven by totalCounts arg, not activeCounts (counts all products regardless of status)", () => {
    // root1: 2 direct + l1a: 1 direct + l2a: 1 direct = 4 total (same as COUNTS fixture)
    // Even though only 2 of those are in ACTIVE_COUNTS, totalCount = 4
    const roots = buildPortfolioTree(NODES, COUNTS, ACTIVE_COUNTS);
    const foundational = roots.find((r) => r.nodeId === "foundational")!;
    expect(foundational.totalCount).toBe(4);
  });
});
```

- [ ] **Step 2.2: Run tests — expect failure**

```bash
cd d:/OpenDigitalProductFactory && pnpm --filter web test
```

Expected: TypeScript error — `Property 'activeCount' does not exist on type 'PortfolioTreeNode'`. **If tests pass, the type already has the field — stop and investigate.**

- [ ] **Step 2.3: Update `PortfolioTreeNode` type**

In `apps/web/lib/portfolio.ts`, add `activeCount: number` to the type (after `totalCount`):

```ts
export type PortfolioTreeNode = {
  id: string;
  nodeId: string;
  name: string;
  parentId: string | null;
  portfolioId: string | null;
  directCount: number;
  totalCount: number;
  activeCount: number;   // ← new: active products in subtree, rolled up
  children: PortfolioTreeNode[];
};
```

- [ ] **Step 2.4: Update `buildPortfolioTree` signature and implementation**

Replace the entire `buildPortfolioTree` function in `apps/web/lib/portfolio.ts` with:

```ts
/** Build a tree from flat node rows + product count rows. */
export function buildPortfolioTree(
  nodes: RawNode[],
  totalCounts: CountRow[],        // all products regardless of status
  activeCounts: CountRow[] = []   // active products only; defaults to [] so existing call sites compile
): PortfolioTreeNode[] {
  // Build lookup keyed by node.id (cuid PK)
  const countById = new Map<string, number>();
  for (const c of totalCounts) {
    if (c.taxonomyNodeId) countById.set(c.taxonomyNodeId, c._count.id);
  }

  const activeCountById = new Map<string, number>();
  for (const c of activeCounts) {
    if (c.taxonomyNodeId) activeCountById.set(c.taxonomyNodeId, c._count.id);
  }

  // Build a map of id → node (with empty children array)
  const nodeMap = new Map<string, PortfolioTreeNode>();
  for (const n of nodes) {
    nodeMap.set(n.id, {
      id: n.id,
      nodeId: n.nodeId,
      name: n.name,
      parentId: n.parentId,
      portfolioId: n.portfolioId ?? null,
      directCount: countById.get(n.id) ?? 0,
      totalCount: 0,
      activeCount: 0,   // populated during DFS below
      children: [],
    });
  }

  // Wire up parent → children
  const roots: PortfolioTreeNode[] = [];
  for (const node of nodeMap.values()) {
    if (node.parentId === null) {
      roots.push(node);
    } else {
      const parent = nodeMap.get(node.parentId);
      if (parent) parent.children.push(node);
    }
  }

  // Compute totalCount and activeCount bottom-up via DFS
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

  return roots;
}
```

- [ ] **Step 2.5: Run tests — expect pass**

```bash
cd d:/OpenDigitalProductFactory && pnpm --filter web test
```

Expected: ~28 web tests passing (19 in `portfolio.test.ts`, 9 in `permissions.test.ts`). Verify the new `activeCount` tests (4 tests) are green.

- [ ] **Step 2.6: TypeScript check**

```bash
cd d:/OpenDigitalProductFactory && pnpm --filter web typecheck
```

Expected: no errors from `portfolio.ts` or `portfolio.test.ts`. You may see one error in `PortfolioNodeDetail.tsx` about `health` being a required prop that `page.tsx` has not passed yet — that is expected and will be fixed in Task 4. Anything else is a real error that must be resolved before continuing.

- [ ] **Step 2.7: Commit**

```bash
cd d:/OpenDigitalProductFactory
git add apps/web/lib/portfolio.ts apps/web/lib/portfolio.test.ts
git commit -m "feat(portfolio): add activeCount rollup to buildPortfolioTree"
```

---

### Task 3: Update `getPortfolioTree` to fetch active-product counts

**Files:**
- Modify: `apps/web/lib/portfolio-data.ts`

There are no unit tests for this server function (it requires a live Prisma/DB connection). Correctness is validated by TypeScript + manual verification in later tasks.

- [ ] **Step 3.1: Update `getPortfolioTree` to fetch both count sets**

Replace the entire `getPortfolioTree` export in `apps/web/lib/portfolio-data.ts` with:

```ts
export const getPortfolioTree = cache(async () => {
  const [nodes, totalCounts, activeCounts] = await Promise.all([
    prisma.taxonomyNode.findMany({
      where: { status: "active" },
      select: { id: true, nodeId: true, name: true, parentId: true, portfolioId: true },
    }),
    prisma.digitalProduct.groupBy({
      by: ["taxonomyNodeId"],
      _count: { id: true },
      // no status filter — counts all products in the taxonomy regardless of lifecycle stage
    }),
    prisma.digitalProduct.groupBy({
      by: ["taxonomyNodeId"],
      _count: { id: true },
      where: { status: "active" },
    }),
  ]);
  return buildPortfolioTree(nodes, totalCounts, activeCounts);
});
```

The file top-of-file comment and the `getAgentCounts` export are **unchanged**.

- [ ] **Step 3.2: TypeScript check**

```bash
cd d:/OpenDigitalProductFactory && pnpm --filter web typecheck
```

Expected: no errors on `portfolio-data.ts`. (Component prop errors for `health` are expected at this stage — fixed next.)

- [ ] **Step 3.3: Commit**

```bash
cd d:/OpenDigitalProductFactory
git add apps/web/lib/portfolio-data.ts
git commit -m "feat(portfolio): fetch active-product counts for health metric"
```

---

## Chunk 2: UI wiring

### Task 4: Wire health into `page.tsx` and `PortfolioNodeDetail`

These two files must be updated together — `page.tsx` adds the `health` prop and `PortfolioNodeDetail` consumes it. Doing them in the same task avoids a broken intermediate TypeScript state.

**Files:**
- Modify: `apps/web/app/(shell)/portfolio/[[...slug]]/page.tsx`
- Modify: `apps/web/components/portfolio/PortfolioNodeDetail.tsx`

- [ ] **Step 4.1: Update `PortfolioNodeDetail` Props and Health stat box**

In `apps/web/components/portfolio/PortfolioNodeDetail.tsx`:

1. Add `health: string` to the `Props` type (after `agentCount`):

```ts
type Props = {
  node: PortfolioTreeNode;
  subNodes: PortfolioTreeNode[];
  products: Product[];
  breadcrumbs: Array<{ nodeId: string; name: string }>;
  agentCount: number;
  health: string;
};
```

2. Add `health` to the destructure:

```ts
export function PortfolioNodeDetail({
  node,
  subNodes,
  products,
  breadcrumbs,
  agentCount,
  health,
}: Props) {
```

3. In the stats strip, replace the dashed Health `StatBox`:

```tsx
{/* Before — remove this: */}
<StatBox label="Health" value="—" colour="#555566" dashed />

{/* After — add this: */}
<StatBox label="Health" value={health} colour={colour} />
```

No other changes to this file.

- [ ] **Step 4.2: Update `page.tsx` to derive and pass health**

In `apps/web/app/(shell)/portfolio/[[...slug]]/page.tsx`:

1. Add `computeHealth` to the import from `@/lib/portfolio`:

```ts
import { resolveNodeFromSlug, getSubtreeIds, buildBreadcrumbs, computeHealth } from "@/lib/portfolio";
```

2. After the `agentCount` derivation line (currently line 43), add:

```ts
const healthStr = computeHealth(node.activeCount, node.totalCount);
```

3. Pass `health` to `PortfolioNodeDetail`:

```tsx
return (
  <PortfolioNodeDetail
    node={node}
    subNodes={node.children}
    products={products}
    breadcrumbs={breadcrumbs}
    agentCount={agentCount}
    health={healthStr}
  />
);
```

- [ ] **Step 4.3: TypeScript check**

```bash
cd d:/OpenDigitalProductFactory && pnpm --filter web typecheck
```

Expected: no errors. The `health` prop is now provided by `page.tsx` and consumed by `PortfolioNodeDetail`.

- [ ] **Step 4.4: Run tests**

```bash
cd d:/OpenDigitalProductFactory && pnpm test
```

Expected: all tests pass (~39 total, 28 web + ~11 db). No regressions.

- [ ] **Step 4.5: Commit**

```bash
cd d:/OpenDigitalProductFactory
git add apps/web/app/"(shell)"/portfolio/"[[...slug]]"/page.tsx \
        apps/web/components/portfolio/PortfolioNodeDetail.tsx
git commit -m "feat(portfolio): wire health metric into node detail panel"
```

---

### Task 5: Add health to `PortfolioOverview`

**Files:**
- Modify: `apps/web/components/portfolio/PortfolioOverview.tsx`

- [ ] **Step 5.1: Update `PortfolioOverview` to show health per card**

In `apps/web/components/portfolio/PortfolioOverview.tsx`:

1. Add `computeHealth` to the import:

```ts
import { PORTFOLIO_COLOURS, PORTFOLIO_OWNER_ROLES, computeHealth } from "@/lib/portfolio";
```

2. In the card body, add a Health stat `<div>` after the Agents `<div>` (inside the `<div className="flex items-center gap-4">`):

```tsx
<div>
  <p
    className="text-sm font-bold"
    style={{ color: colour }}
  >
    {computeHealth(root.activeCount, root.totalCount)}
  </p>
  <p className="text-[9px] text-[var(--dpf-muted)] uppercase tracking-wider">
    Health
  </p>
</div>
```

The final card inner layout order will be: Products · Owner · Agents · Health.

- [ ] **Step 5.2: TypeScript check**

```bash
cd d:/OpenDigitalProductFactory && pnpm --filter web typecheck
```

Expected: no errors.

- [ ] **Step 5.3: Run all tests**

```bash
cd d:/OpenDigitalProductFactory && pnpm test
```

Expected: all tests pass (~39 total, 28 web + ~11 db). No regressions.

- [ ] **Step 5.4: Commit**

```bash
cd d:/OpenDigitalProductFactory
git add apps/web/components/portfolio/PortfolioOverview.tsx
git commit -m "feat(portfolio): add health metric to portfolio overview cards"
```

---

### Task 6: Final verification

- [ ] **Step 6.1: Full typecheck**

```bash
cd d:/OpenDigitalProductFactory && pnpm --filter web typecheck && pnpm --filter @dpf/db typecheck 2>/dev/null; echo "typecheck done"
```

Expected: no errors in `apps/web`. The `@dpf/db` package may not have a `typecheck` script — that's fine, ignore the error.

- [ ] **Step 6.2: Full test run**

```bash
cd d:/OpenDigitalProductFactory && pnpm test
```

Expected: all tests pass. Breakdown:
- `apps/web/lib/portfolio.test.ts` — 19 tests:
  - `buildPortfolioTree()` describe: 6 tests
  - `resolveNodeFromSlug()` describe: 5 tests
  - `computeHealth()` describe: 4 tests (added in Task 1)
  - `buildPortfolioTree() — activeCount` describe: 4 tests (added in Task 2)
- `apps/web/lib/permissions.test.ts` — 9 tests (unchanged)
- `packages/db/src/seed-helpers.test.ts` — up to 11 tests (unchanged)

Web total: 28 tests. If the count differs slightly (db test files vary), the key check is **no regressions** — every test that was passing before must still pass.
