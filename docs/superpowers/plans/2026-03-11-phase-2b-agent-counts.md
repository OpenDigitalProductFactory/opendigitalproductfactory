# Phase 2B — Agent Counts Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire live agent counts into the `/portfolio` route stats strip and overview cards by adding `portfolioId` to the `Agent` model and seeding the association from `agent_registry.json`.

**Architecture:** Add `portfolioId FK` to `Agent` (nullable, null = cross-cutting). Seed maps `human_supervisor_id` → portfolio slug via a new `parseAgentPortfolioSlug()` pure helper. A new React-cached `getAgentCounts()` function in `portfolio-data.ts` returns `Record<portfolioSlug, number>`. `page.tsx` calls it alongside `getPortfolioTree()` and threads `agentCount` / `agentCounts` props into `PortfolioNodeDetail` and `PortfolioOverview`.

**Tech Stack:** Next.js 14 App Router, Prisma 5, TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Vitest, pnpm monorepo.

**Spec:** `docs/superpowers/specs/2026-03-11-phase-2b-agent-counts-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `package.json` (root) | Modify | Add `packages/db` to `test` script so `pnpm test` covers both packages |
| `packages/db/prisma/schema.prisma` | Modify | Add `portfolioId`/`portfolio` to `Agent`; add `agents` back-relation to `Portfolio` |
| `packages/db/prisma/migrations/<ts>_add_portfolio_to_agent/migration.sql` | Create (via migrate) | DB migration |
| `packages/db/src/seed-helpers.ts` | Modify | Add `parseAgentPortfolioSlug()` pure helper |
| `packages/db/src/seed-helpers.test.ts` | Create | Unit tests for `parseAgentPortfolioSlug()` |
| `packages/db/src/seed.ts` | Modify | Update `seedAgents()` type + portfolioId lookup + status normalisation; reorder `main()` |
| `apps/web/lib/portfolio-data.ts` | Modify | Add `getAgentCounts()` React-cached function |
| `apps/web/app/(shell)/portfolio/[[...slug]]/page.tsx` | Modify | Call `getAgentCounts()`, pass counts to components |
| `apps/web/components/portfolio/PortfolioNodeDetail.tsx` | Modify | Add `agentCount: number` prop; replace dashed StatBox; remove Agents PlaceholderPanel |
| `apps/web/components/portfolio/PortfolioOverview.tsx` | Modify | Add `agentCounts: Record<string, number>` prop; show agents on each card |

---

## Chunk 1: Foundation

### Task 1: Extend `pnpm test` to cover both packages

**Files:**
- Modify: `package.json` (root, at repo root)

**Context:** Currently `"test": "pnpm --filter web test"` only runs `apps/web` Vitest tests. The new `packages/db` tests need to run too. `packages/db` already has `"test": "vitest run"` in its own `package.json`.

- [ ] **Step 1.1: Update root test script**

Open repo root `package.json`. Change the `test` line from:

```json
"test": "pnpm --filter web test",
```

To:

```json
"test": "pnpm --filter web test && pnpm --filter @dpf/db test",
```

- [ ] **Step 1.2: Verify both suites run**

```bash
pnpm test
```

Expected: `apps/web` 26 tests pass, `@dpf/db` existing tests pass (0 or more). No failures.

- [ ] **Step 1.3: Commit**

```bash
git add package.json
git commit -m "chore: run packages/db tests in root pnpm test script"
```

---

### Task 2: Schema migration — add `portfolioId` to `Agent`

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create (via tool): migration file

**Context:** `Agent` model is around line 160 in `schema.prisma`. `Portfolio` model is around line 57. `DigitalProduct` already has an identical `portfolioId/portfolio` pattern — follow it exactly.

- [ ] **Step 2.1: Add fields to `Agent` model**

Open `packages/db/prisma/schema.prisma`. In the `Agent` model, add after the `createdAt` line:

```prisma
  portfolioId  String?
  portfolio    Portfolio?  @relation(fields: [portfolioId], references: [id])
```

- [ ] **Step 2.2: Add back-relation to `Portfolio` model**

In the `Portfolio` model, add after the `products DigitalProduct[]` line:

```prisma
  agents       Agent[]
```

- [ ] **Step 2.3: Run migration**

Use `--name` flag to avoid interactive TTY prompt (required in subagent/non-TTY contexts):

```bash
pnpm db:migrate -- --name add_portfolio_to_agent
```

Expected: migration file created at `packages/db/prisma/migrations/<timestamp>_add_portfolio_to_agent/migration.sql`. Prisma client is regenerated automatically by `prisma migrate dev` — no separate `prisma generate` step needed.

- [ ] **Step 2.4: Verify TypeScript compiles in packages/db**

```bash
pnpm --filter @dpf/db typecheck
```

Expected: 0 errors. The regenerated Prisma client now includes `portfolioId` and `portfolio` on `Agent`.

- [ ] **Step 2.5: Run tests**

```bash
pnpm test
```

Expected: all existing tests pass.

- [ ] **Step 2.6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat: add portfolioId FK to Agent model"
```

---

## Chunk 2: Data Layer

### Task 3: `parseAgentPortfolioSlug()` helper + tests

**Files:**
- Modify: `packages/db/src/seed-helpers.ts`
- Create: `packages/db/src/seed-helpers.test.ts`

**Context:**
- `seed-helpers.ts` exports `parseRoleId`, `parseAgentTier`, `parseAgentType` — all pure functions. Adding a fourth.
- **Import convention:** Tests in `packages/db` use bare module paths (no `.js`) — Vitest/Vite resolves them. `seed.ts` uses `.js` extensions because it runs with `tsx` in a Node ESM context. These are different and both are correct.
- `packages/db` has no `vitest.config.ts`; Vitest discovers tests by default glob (`**/*.test.ts`).

- [ ] **Step 3.1: Write the failing test**

Create `packages/db/src/seed-helpers.test.ts`:

```ts
// packages/db/src/seed-helpers.test.ts
import { describe, it, expect } from "vitest";
import { parseAgentPortfolioSlug } from "./seed-helpers"; // no .js — Vitest resolver handles it

describe("parseAgentPortfolioSlug", () => {
  it("maps HR-100 to products_and_services_sold", () => {
    expect(parseAgentPortfolioSlug("HR-100")).toBe("products_and_services_sold");
  });

  it("maps HR-200 to for_employees", () => {
    expect(parseAgentPortfolioSlug("HR-200")).toBe("for_employees");
  });

  it("maps HR-300 to foundational", () => {
    expect(parseAgentPortfolioSlug("HR-300")).toBe("foundational");
  });

  it("maps HR-500 to manufacturing_and_delivery", () => {
    expect(parseAgentPortfolioSlug("HR-500")).toBe("manufacturing_and_delivery");
  });

  it("returns null for HR-000 (cross-cutting)", () => {
    expect(parseAgentPortfolioSlug("HR-000")).toBeNull();
  });

  it("returns null for HR-400 (cross-cutting)", () => {
    expect(parseAgentPortfolioSlug("HR-400")).toBeNull();
  });

  it("returns null for an unknown supervisor", () => {
    expect(parseAgentPortfolioSlug("HR-999")).toBeNull();
  });
});
```

- [ ] **Step 3.2: Run test to confirm it fails**

```bash
pnpm test
```

Expected: `@dpf/db` suite FAIL — `parseAgentPortfolioSlug is not exported`. `apps/web` suite: 26 pass.

- [ ] **Step 3.3: Implement `parseAgentPortfolioSlug` in `seed-helpers.ts`**

Open `packages/db/src/seed-helpers.ts`. Add after the existing exports:

```ts
const SUPERVISOR_TO_PORTFOLIO: Record<string, string> = {
  "HR-100": "products_and_services_sold",
  "HR-200": "for_employees",
  "HR-300": "foundational",
  "HR-500": "manufacturing_and_delivery",
  // HR-000, HR-400 omitted — cross-cutting agents, no single portfolio
};

export function parseAgentPortfolioSlug(supervisorId: string): string | null {
  return SUPERVISOR_TO_PORTFOLIO[supervisorId] ?? null;
}
```

- [ ] **Step 3.4: Run tests to confirm they pass**

```bash
pnpm test
```

Expected: `apps/web` 26 pass, `@dpf/db` 7 pass. Total: 33.

- [ ] **Step 3.5: Commit**

```bash
git add packages/db/src/seed-helpers.ts packages/db/src/seed-helpers.test.ts
git commit -m "feat: add parseAgentPortfolioSlug helper with tests"
```

---

### Task 4: Update `seedAgents()` with `portfolioId` + call-order fix

**Files:**
- Modify: `packages/db/src/seed.ts`

**Context:**
- Current `main()` call order: `seedRoles()` → `seedAgents()` → `seedPortfolios()` → ... Must swap so `seedPortfolios()` runs before `seedAgents()`.
- Import in `seed.ts` uses `.js` extension (ESM/tsx runtime): `from "./seed-helpers.js"` — **keep the `.js`**.
- `status` in `agent_registry.json` is `"defined"` for all agents; normalise to `"active"` in the seed.

- [ ] **Step 4.1: Update the import in `seed.ts`**

Open `packages/db/src/seed.ts`. Find (around line 5):

```ts
import { parseRoleId, parseAgentTier, parseAgentType } from "./seed-helpers.js";
```

Add `parseAgentPortfolioSlug` (keep the `.js` extension — this file runs with tsx in Node ESM):

```ts
import { parseRoleId, parseAgentTier, parseAgentType, parseAgentPortfolioSlug } from "./seed-helpers.js";
```

- [ ] **Step 4.2: Replace the `seedAgents` function**

Replace the entire `seedAgents` function with:

```ts
async function seedAgents(): Promise<void> {
  const registry = readJson<{
    agents: Array<{
      agent_id: string;
      agent_name: string;
      capability_domain?: string;
      status?: string;
      human_supervisor_id?: string;
    }>;
  }>("AGENTS/agent_registry.json");

  // Build portfolio slug → cuid lookup (portfolios must already be seeded)
  const portfolios = await prisma.portfolio.findMany({ select: { id: true, slug: true } });
  const portfolioIdBySlug = new Map(portfolios.map((p) => [p.slug, p.id]));

  for (const a of registry.agents) {
    const portfolioSlug = parseAgentPortfolioSlug(a.human_supervisor_id ?? "");
    const portfolioId = portfolioSlug ? (portfolioIdBySlug.get(portfolioSlug) ?? null) : null;

    await prisma.agent.upsert({
      where: { agentId: a.agent_id },
      update: {
        name: a.agent_name,
        tier: parseAgentTier(a.agent_id),
        type: parseAgentType(a.agent_id),
        description: a.capability_domain ?? null,
        status: "active", // normalise: registry uses "defined" which means the same thing
        portfolioId,
      },
      create: {
        agentId: a.agent_id,
        name: a.agent_name,
        tier: parseAgentTier(a.agent_id),
        type: parseAgentType(a.agent_id),
        description: a.capability_domain ?? null,
        status: "active",
        portfolioId,
      },
    });
  }
  console.log(`Seeded ${registry.agents.length} agents`);
}
```

- [ ] **Step 4.3: Fix call order in `main()`**

Find the `main()` function body. Change:

```ts
// Before:
await seedRoles();
await seedAgents();
await seedPortfolios();
```

To:

```ts
// After:
await seedRoles();
await seedPortfolios();
await seedAgents();
```

Leave the remaining calls (`seedTaxonomyNodes`, `seedDigitalProducts`, `seedDefaultAdminUser`) unchanged.

- [ ] **Step 4.4: Verify TypeScript compiles**

```bash
pnpm --filter @dpf/db typecheck
```

Expected: 0 errors.

- [ ] **Step 4.5: Run tests**

```bash
pnpm test
```

Expected: 33 tests pass.

- [ ] **Step 4.6: Commit**

```bash
git add packages/db/src/seed.ts
git commit -m "feat: seed Agent.portfolioId from human_supervisor_id mapping"
```

---

## Chunk 3: Web Layer

### Task 5: `getAgentCounts()` in `portfolio-data.ts`

**Files:**
- Modify: `apps/web/lib/portfolio-data.ts`

**Context:** The `Agent` model now has `portfolioId` (migrated in Task 2, client regenerated). `getPortfolioTree` uses `cache()` from React — follow the same pattern. No `.js` extensions on local imports in `apps/web` (`moduleResolution: "bundler"`).

- [ ] **Step 5.1: Add `getAgentCounts` to `portfolio-data.ts`**

Open `apps/web/lib/portfolio-data.ts`. Add after `getPortfolioTree`:

```ts
/**
 * Returns agent count per portfolio slug, e.g. { foundational: 14, ... }.
 * Cross-cutting agents (portfolioId = null) are excluded.
 * React cache() deduplicates across layout + page within one request.
 */
export const getAgentCounts = cache(async (): Promise<Record<string, number>> => {
  const portfolios = await prisma.portfolio.findMany({
    select: { id: true, slug: true },
  });
  const counts = await prisma.agent.groupBy({
    by: ["portfolioId"],
    _count: { id: true },
    where: { status: "active", portfolioId: { not: null } },
  });
  // portfolioId! is safe: where clause already excludes null
  const countById = new Map(counts.map((c) => [c.portfolioId!, c._count.id]));
  return Object.fromEntries(portfolios.map((p) => [p.slug, countById.get(p.id) ?? 0]));
});
```

- [ ] **Step 5.2: Verify TypeScript compiles**

```bash
cd apps/web && pnpm tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 5.3: Run tests**

```bash
pnpm test
```

Expected: 33 tests pass.

- [ ] **Step 5.4: Commit**

```bash
git add apps/web/lib/portfolio-data.ts
git commit -m "feat: add getAgentCounts() cached data function"
```

---

### Task 6: Wire agent counts into `page.tsx` and components

**Files:**
- Modify: `apps/web/app/(shell)/portfolio/[[...slug]]/page.tsx`
- Modify: `apps/web/components/portfolio/PortfolioNodeDetail.tsx`
- Modify: `apps/web/components/portfolio/PortfolioOverview.tsx`

**Context:**
- `PortfolioNodeDetail`: stats strip has `<StatBox label="Agents" value="—" colour="#555566" dashed />` — replace with live count. Also has a `<PlaceholderPanel label="Agents" .../>` in the People + Agents section at the bottom — **remove it** (would create a duplicate now that stats strip shows live data; People panel remains).
- `PortfolioOverview`: keyed lookups use `root.nodeId` which equals the portfolio slug for root-level taxonomy nodes (e.g. `"foundational"` is both the nodeId and the Portfolio.slug) — this is a maintained seed invariant.

- [ ] **Step 6.1: Update `page.tsx`**

Open `apps/web/app/(shell)/portfolio/[[...slug]]/page.tsx`.

Add `getAgentCounts` to the import:

```ts
import { getPortfolioTree, getAgentCounts } from "@/lib/portfolio-data";
```

Replace `const roots = await getPortfolioTree()` with a parallel call:

```ts
const [roots, agentCounts] = await Promise.all([
  getPortfolioTree(),
  getAgentCounts(),
]);
```

In the overview branch (where `slugs.length === 0`), update the return:

```tsx
return <PortfolioOverview roots={roots} agentCounts={agentCounts} />;
```

After `const node = resolveNodeFromSlug(...)` in the node detail branch, add:

```ts
const rootSlug = slugs[0] ?? ""; // slugs.length === 0 handled above; ?? "" satisfies noUncheckedIndexedAccess
const agentCount = agentCounts[rootSlug] ?? 0;
```

Update the `PortfolioNodeDetail` return to pass `agentCount`:

```tsx
return (
  <PortfolioNodeDetail
    node={node}
    subNodes={node.children}
    products={products}
    breadcrumbs={breadcrumbs}
    agentCount={agentCount}
  />
);
```

- [ ] **Step 6.2: Update `PortfolioNodeDetail.tsx`**

Open `apps/web/components/portfolio/PortfolioNodeDetail.tsx`.

Add `agentCount: number` to `Props`:

```ts
type Props = {
  node: PortfolioTreeNode;
  subNodes: PortfolioTreeNode[];
  products: Product[];
  breadcrumbs: Array<{ nodeId: string; name: string }>;
  agentCount: number;
};
```

Add `agentCount` to the destructured params:

```ts
export function PortfolioNodeDetail({
  node,
  subNodes,
  products,
  breadcrumbs,
  agentCount,
}: Props) {
```

In the stats strip, replace the dashed Agents StatBox:

```tsx
// was:
<StatBox label="Agents" value="—" colour="#555566" dashed />
// becomes:
<StatBox label="Agents" value={String(agentCount)} colour={colour} />
```

At the bottom, find the People + Agents placeholders section and remove the Agents panel (keep People):

```tsx
// was:
{/* People + Agents placeholders */}
<div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
  <PlaceholderPanel label="People" description="Human role assignments — coming soon" />
  <PlaceholderPanel label="Agents" description="AI agent assignments — coming soon" />
</div>

// becomes:
{/* People placeholder */}
<div className="mt-8">
  <PlaceholderPanel label="People" description="Human role assignments — coming soon" />
</div>
```

- [ ] **Step 6.3: Update `PortfolioOverview.tsx`**

Open `apps/web/components/portfolio/PortfolioOverview.tsx`.

Update `Props`:

```ts
type Props = { roots: PortfolioTreeNode[]; agentCounts: Record<string, number> };
```

Add `agentCounts` to the destructured props:

```ts
export function PortfolioOverview({ roots, agentCounts }: Props) {
```

In the portfolio card's `<div className="flex items-center gap-4">`, add an Agents figure after the Products div:

```tsx
<div>
  <p className="text-xl font-bold" style={{ color: colour }}>
    {agentCounts[root.nodeId] ?? 0}
  </p>
  <p className="text-[9px] text-[var(--dpf-muted)] uppercase tracking-wider">
    Agents
  </p>
</div>
```

> **Note:** `root.nodeId` equals `Portfolio.slug` for root taxonomy nodes (e.g. `"foundational"`) — maintained invariant from the seed, so the lookup is correct.

- [ ] **Step 6.4: Verify TypeScript compiles**

```bash
cd apps/web && pnpm tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 6.5: Run all tests**

```bash
pnpm test
```

Expected: 33 tests pass (26 web + 7 db).

- [ ] **Step 6.6: Commit**

```bash
git add apps/web/app/(shell)/portfolio/[[...slug]]/page.tsx \
        apps/web/components/portfolio/PortfolioNodeDetail.tsx \
        apps/web/components/portfolio/PortfolioOverview.tsx
git commit -m "feat: wire live agent counts into portfolio stats strip and overview cards"
```

---

## After All Tasks Complete

Use `superpowers:finishing-a-development-branch` to verify, decide merge strategy, and push.
