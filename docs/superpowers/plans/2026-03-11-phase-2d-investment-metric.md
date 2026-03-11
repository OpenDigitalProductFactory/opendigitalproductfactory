# Phase 2D — Investment Metric Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up the Budget stat box in portfolio views using `Portfolio.budgetKUsd` seeded with placeholder values.

**Architecture:** Add a nullable `Int?` column to the `Portfolio` model, seed placeholder values for the four roots, then expose them via a new `formatBudget` pure function + `getPortfolioBudgets` React cache function, and display in both `PortfolioOverview` and `PortfolioNodeDetail`.

**Tech Stack:** Prisma 5 migration, Vitest (node env), Next.js 14 App Router React `cache()`, TypeScript strict mode (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).

---

## Codebase Context

Working directory: `d:/OpenDigitalProductFactory`

### Repo structure (relevant parts)
```
packages/db/
  prisma/schema.prisma       ← Portfolio model lives here
  prisma/migrations/         ← migration files go here
  src/seed.ts                ← seedPortfolios() function
apps/web/
  lib/portfolio.ts           ← pure utils (computeHealth, etc.)
  lib/portfolio.test.ts      ← Vitest tests, environment: "node"
  lib/portfolio-data.ts      ← React cache() server functions
  app/(shell)/portfolio/[[...slug]]/page.tsx  ← catch-all page
  components/portfolio/PortfolioOverview.tsx
  components/portfolio/PortfolioNodeDetail.tsx
```

### TypeScript rules
- `moduleResolution: "bundler"` — **NO `.js` extensions** on local imports in `apps/web`
- `noUncheckedIndexedAccess: true` — indexing `Record<string, V>` returns `V | undefined`; always use `?? fallback`
- `exactOptionalPropertyTypes: true` — omit optional props rather than passing `false`

### Test command
```bash
pnpm test
```
Runs both `pnpm --filter web test` and `pnpm --filter @dpf/db test`. The db package has no unit tests (only TypeScript check). Expect ~36 web tests passing (20 portfolio + 9 permissions + 7 new ones from this feature).

### Existing patterns to follow
- `getAgentCounts` in `portfolio-data.ts` — model for new `getPortfolioBudgets` cache function
- `computeHealth` in `portfolio.ts` — model for new `formatBudget` pure function
- `agentCounts[root.nodeId] ?? 0` in `PortfolioOverview` — pattern for `budgets[root.nodeId] ?? "—"`

---

## Files to Create / Modify

| File | Action |
|---|---|
| `packages/db/prisma/schema.prisma` | Add `budgetKUsd Int?` to `Portfolio` model |
| `packages/db/prisma/migrations/…` | New migration (auto-generated) |
| `packages/db/src/seed.ts` | Add `PORTFOLIO_BUDGETS` map; pass `budgetKUsd` in upsert |
| `apps/web/lib/portfolio.ts` | Add `formatBudget` pure function |
| `apps/web/lib/portfolio.test.ts` | Add `describe("formatBudget()")` with 7 tests |
| `apps/web/lib/portfolio-data.ts` | Add `getPortfolioBudgets` cache function |
| `apps/web/app/(shell)/portfolio/[[...slug]]/page.tsx` | Add `getPortfolioBudgets` fetch; pass `budgets` / `investment` |
| `apps/web/components/portfolio/PortfolioOverview.tsx` | Add `budgets` prop + Budget stat div |
| `apps/web/components/portfolio/PortfolioNodeDetail.tsx` | Replace dashed Investment with live `investment` prop |

---

## Task 1: Schema — add `budgetKUsd` to `Portfolio`

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1.1: Add `budgetKUsd Int?` to the `Portfolio` model**

  In `schema.prisma`, find the `Portfolio` model (currently ends before the `products` relation). Add the new field after `updatedAt`:

  ```prisma
  model Portfolio {
    id          String           @id @default(cuid())
    slug        String           @unique
    name        String
    description String?
    rootNodeId  String?
    budgetKUsd  Int?             // annual budget in $k — null means unset/unknown
    createdAt   DateTime         @default(now())
    updatedAt   DateTime         @updatedAt
    products    DigitalProduct[]
    agents      Agent[]
  }
  ```

- [ ] **Step 1.2: Run migration**

  ```bash
  cd d:/OpenDigitalProductFactory
  pnpm --filter @dpf/db migrate dev --name add_budget_to_portfolio
  ```

  Expected: A new migration file is created under `packages/db/prisma/migrations/`. The generated SQL will be:
  ```sql
  ALTER TABLE "Portfolio" ADD COLUMN "budgetKUsd" INTEGER;
  ```

- [ ] **Step 1.3: Regenerate Prisma client**

  ```bash
  pnpm --filter @dpf/db generate
  ```

  Expected: `Generated Prisma Client` with no errors.

- [ ] **Step 1.4: TypeScript check**

  ```bash
  cd apps/web && pnpm tsc --noEmit 2>&1 | head -20
  ```

  Expected: No errors about `budgetKUsd`.

- [ ] **Step 1.5: Commit**

  ```bash
  cd d:/OpenDigitalProductFactory
  git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
  git commit -m "feat(db): add budgetKUsd field to Portfolio model"
  ```

---

## Task 2: Seed — populate `budgetKUsd` placeholders

**Files:**
- Modify: `packages/db/src/seed.ts`

- [ ] **Step 2.1: Add the `PORTFOLIO_BUDGETS` constant and update `seedPortfolios`**

  In `seed.ts`, add the budget map above `seedPortfolios()` (or inside it — either works), then pass `budgetKUsd` in the upsert. The key is the registry `id` string (e.g. `"foundational"`), which equals `Portfolio.slug` — **not** the Prisma-generated cuid.

  ```ts
  const PORTFOLIO_BUDGETS: Record<string, number> = {
    foundational: 2500,
    manufacturing_and_delivery: 1800,
    for_employees: 1200,
    products_and_services_sold: 3500,
  };

  async function seedPortfolios(): Promise<void> {
    const registry = readJson<{
      portfolios: Array<{
        id: string;
        name: string;
        description?: string;
      }>;
    }>("MODEL/portfolio_registry.json");

    for (const p of registry.portfolios) {
      await prisma.portfolio.upsert({
        where: { slug: p.id },
        update: { name: p.name, description: p.description ?? null, budgetKUsd: PORTFOLIO_BUDGETS[p.id] ?? null },
        create: { slug: p.id, name: p.name, description: p.description ?? null, budgetKUsd: PORTFOLIO_BUDGETS[p.id] ?? null },
      });
    }
    console.log(`Seeded ${registry.portfolios.length} portfolios`);
  }
  ```

  Note: `PORTFOLIO_BUDGETS[p.id]` with `noUncheckedIndexedAccess` returns `number | undefined`, so `?? null` is required to satisfy `Int?` (Prisma accepts `null` to clear the field; `undefined` means "don't change").

- [ ] **Step 2.2: TypeScript check for seed file**

  ```bash
  cd d:/OpenDigitalProductFactory/packages/db
  npx tsc --noEmit 2>&1 | head -20
  ```

  Expected: No errors.

- [ ] **Step 2.3: Commit**

  ```bash
  cd d:/OpenDigitalProductFactory
  git add packages/db/src/seed.ts
  git commit -m "feat(db): seed portfolio budgetKUsd placeholder values"
  ```

---

## Task 3: `formatBudget` — pure function + tests

**Files:**
- Modify: `apps/web/lib/portfolio.ts`
- Modify: `apps/web/lib/portfolio.test.ts`

This is a TDD task: write tests first, verify they fail, implement, verify they pass.

- [ ] **Step 3.1: Write failing tests**

  In `apps/web/lib/portfolio.test.ts`, add a new `describe` block after the existing `computeHealth` tests:

  ```ts
  describe("formatBudget()", () => {
    it("returns — for null", () => {
      expect(formatBudget(null)).toBe("—");
    });
    it("returns — for undefined", () => {
      expect(formatBudget(undefined)).toBe("—");
    });
    it("returns — for 0", () => {
      expect(formatBudget(0)).toBe("—");
    });
    it("returns — for negative values", () => {
      expect(formatBudget(-1)).toBe("—");
    });
    it("returns $800k for sub-million values", () => {
      expect(formatBudget(800)).toBe("$800k");
    });
    it("returns $1.0M at the boundary (1000)", () => {
      expect(formatBudget(1000)).toBe("$1.0M");
    });
    it("returns $2.5M for 2500", () => {
      expect(formatBudget(2500)).toBe("$2.5M");
    });
  });
  ```

  Add `formatBudget` to the import at the top of the test file:
  ```ts
  import { ..., formatBudget } from "./portfolio";
  ```

- [ ] **Step 3.2: Run tests — verify they fail**

  ```bash
  cd d:/OpenDigitalProductFactory
  pnpm --filter web test -- --reporter=verbose 2>&1 | tail -20
  ```

  Expected: 7 new tests fail with `formatBudget is not a function` or similar.

- [ ] **Step 3.3: Implement `formatBudget` in `portfolio.ts`**

  Add after `computeHealth`:

  ```ts
  /** Format a portfolio budget (thousands USD) as a display string.
   *  Returns "—" when null, zero, or negative. */
  export function formatBudget(kUsd: number | null | undefined): string {
    if (kUsd == null || kUsd <= 0) return "—";
    if (kUsd >= 1000) return `$${(kUsd / 1000).toFixed(1)}M`;
    return `$${kUsd}k`;
  }
  ```

- [ ] **Step 3.4: Run tests — verify they pass**

  ```bash
  cd d:/OpenDigitalProductFactory
  pnpm --filter web test -- --reporter=verbose 2>&1 | tail -30
  ```

  Expected: All 7 new tests pass. Total web tests: ~27 (20 existing + 7 new).

- [ ] **Step 3.5: Commit**

  ```bash
  cd d:/OpenDigitalProductFactory
  git add apps/web/lib/portfolio.ts apps/web/lib/portfolio.test.ts
  git commit -m "feat(web): add formatBudget pure function with tests"
  ```

---

## Task 4: `getPortfolioBudgets` — server cache function

**Files:**
- Modify: `apps/web/lib/portfolio-data.ts`

- [ ] **Step 4.1: Add `getPortfolioBudgets` to `portfolio-data.ts`**

  Add after `getAgentCounts`:

  ```ts
  import { formatBudget } from "./portfolio";

  /**
   * Returns annual budget per portfolio slug, e.g. { foundational: "$2.5M", ... }.
   * Returns "—" for portfolios with null budget.
   * React cache() deduplicates across layout + page within one request.
   */
  export const getPortfolioBudgets = cache(async (): Promise<Record<string, string>> => {
    const portfolios = await prisma.portfolio.findMany({
      select: { slug: true, budgetKUsd: true },
    });
    return Object.fromEntries(
      portfolios.map((p) => [p.slug, formatBudget(p.budgetKUsd)])
    );
  });
  ```

  Note: Add `formatBudget` to the existing import from `"./portfolio"` at the top of the file. Do not add a `.js` extension — `moduleResolution: "bundler"` resolves without it.

- [ ] **Step 4.2: TypeScript check**

  ```bash
  cd d:/OpenDigitalProductFactory/apps/web
  pnpm tsc --noEmit 2>&1 | head -20
  ```

  Expected: No errors.

- [ ] **Step 4.3: Commit**

  ```bash
  cd d:/OpenDigitalProductFactory
  git add apps/web/lib/portfolio-data.ts
  git commit -m "feat(web): add getPortfolioBudgets cache function"
  ```

---

## Task 5: `page.tsx` — fetch budgets and thread through

**Files:**
- Modify: `apps/web/app/(shell)/portfolio/[[...slug]]/page.tsx`

- [ ] **Step 5.1: Add `getPortfolioBudgets` import and fetch**

  1. Add `getPortfolioBudgets` to the `portfolio-data` import:
     ```ts
     import { getPortfolioTree, getAgentCounts, getPortfolioBudgets } from "@/lib/portfolio-data";
     ```

  2. Expand `Promise.all` to three entries:
     ```ts
     const [roots, agentCounts, budgets] = await Promise.all([
       getPortfolioTree(),
       getAgentCounts(),
       getPortfolioBudgets(),
     ]);
     ```

  3. For the overview branch (after `slugs.length === 0`), pass `budgets`:
     ```tsx
     return <PortfolioOverview roots={roots} agentCounts={agentCounts} budgets={budgets} />;
     ```

  4. For the node detail branch, derive `investment` from the portfolio root slug:
     ```ts
     const investment = budgets[rootSlug] ?? "—";
     ```
     Then pass it to `PortfolioNodeDetail`:
     ```tsx
     <PortfolioNodeDetail
       node={node}
       subNodes={node.children}
       products={products}
       breadcrumbs={breadcrumbs}
       agentCount={agentCount}
       health={healthStr}
       investment={investment}
     />
     ```

     `rootSlug` is already defined on line 42: `const rootSlug = slugs[0] ?? "";`. Budget is portfolio-level — all nodes within a portfolio show the same root's budget.

- [ ] **Step 5.2: TypeScript check**

  ```bash
  cd d:/OpenDigitalProductFactory/apps/web
  pnpm tsc --noEmit 2>&1 | head -20
  ```

  Expected: TS errors about `budgets` prop missing on `PortfolioOverview` and `investment` prop missing on `PortfolioNodeDetail` — these will be fixed in Task 6.

- [ ] **Step 5.3: Commit**

  ```bash
  cd d:/OpenDigitalProductFactory
  git add "apps/web/app/(shell)/portfolio/[[...slug]]/page.tsx"
  git commit -m "feat(web): fetch portfolio budgets in portfolio page"
  ```

---

## Task 6: UI components — display Budget stat

**Files:**
- Modify: `apps/web/components/portfolio/PortfolioOverview.tsx`
- Modify: `apps/web/components/portfolio/PortfolioNodeDetail.tsx`

- [ ] **Step 6.1: Update `PortfolioOverview` — add `budgets` prop and Budget stat**

  1. Add `budgets: Record<string, string>` to Props type and destructure:
     ```ts
     type Props = { roots: PortfolioTreeNode[]; agentCounts: Record<string, number>; budgets: Record<string, string> };

     export function PortfolioOverview({ roots, agentCounts, budgets }: Props) {
     ```

  2. Add Budget stat div after the existing Health stat div (inside the `<div className="flex items-center gap-4">` block):
     ```tsx
     <div>
       <p className="text-sm font-bold" style={{ color: colour }}>
         {budgets[root.nodeId] ?? "—"}
       </p>
       <p className="text-[9px] text-[var(--dpf-muted)] uppercase tracking-wider">
         Budget
       </p>
     </div>
     ```

     Card stat order becomes: Products · Owner · Agents · Health · Budget.

     Note: `budgets[root.nodeId]` is safe because for root portfolio cards, `root.nodeId` equals the portfolio slug (e.g. `"foundational"`), which is the key used by `getPortfolioBudgets`. This matches the existing `agentCounts[root.nodeId] ?? 0` pattern in this file.

- [ ] **Step 6.2: Update `PortfolioNodeDetail` — replace dashed Investment placeholder**

  1. Add `investment: string` to Props type and destructure:
     ```ts
     type Props = {
       node: PortfolioTreeNode;
       subNodes: PortfolioTreeNode[];
       products: Product[];
       breadcrumbs: Array<{ nodeId: string; name: string }>;
       agentCount: number;
       health: string;
       investment: string;  // ← new
     };

     export function PortfolioNodeDetail({
       node,
       subNodes,
       products,
       breadcrumbs,
       agentCount,
       health,
       investment,  // ← new
     }: Props) {
     ```

  2. Replace the dashed Investment StatBox with a live Budget StatBox:
     ```tsx
     // Before:
     <StatBox label="Investment" value="—" colour="#555566" dashed />

     // After:
     <StatBox label="Budget" value={investment} colour={colour} />
     ```

     Note: Omit `dashed` entirely — with `exactOptionalPropertyTypes: true`, omitting an optional boolean prop is preferred over passing `false`. The solid border will render automatically.

- [ ] **Step 6.3: TypeScript check — must be clean**

  ```bash
  cd d:/OpenDigitalProductFactory/apps/web
  pnpm tsc --noEmit 2>&1 | head -20
  ```

  Expected: **No errors**.

- [ ] **Step 6.4: Run full test suite**

  ```bash
  cd d:/OpenDigitalProductFactory
  pnpm test 2>&1 | tail -30
  ```

  Expected: All tests pass. Web test count: ~27 (20 previous + 7 new `formatBudget` tests).

- [ ] **Step 6.5: Commit**

  ```bash
  cd d:/OpenDigitalProductFactory
  git add apps/web/components/portfolio/PortfolioOverview.tsx apps/web/components/portfolio/PortfolioNodeDetail.tsx
  git commit -m "feat(web): display Budget stat in portfolio overview and node detail"
  ```

---

## Final Verification

After all 6 tasks:

```bash
cd d:/OpenDigitalProductFactory
pnpm test 2>&1 | tail -10
```

Expected: All tests passing. ~27 web tests, 0 failures.

```bash
cd d:/OpenDigitalProductFactory/apps/web
pnpm tsc --noEmit 2>&1
```

Expected: No output (zero errors).
