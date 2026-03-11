# Phase 2B Design: Agent Portfolio Association + Live Counts

**Date:** 2026-03-11
**Status:** Approved (autonomous — user authorized overnight execution)
**Scope:** Wire live agent counts into the `/portfolio` route stats strip and overview cards

---

## Overview

Phase 2A left three dashed placeholder stats in `PortfolioNodeDetail` and `PortfolioOverview`: **Agents**, **Health**, and **Investment**. Phase 2B wires up the **Agents** count using real data from the existing `Agent` model, adds a `portfolioId` FK so agents are associated with their primary portfolio, and seeds agents from `AGENTS/agent_registry.json`.

Health and Investment remain deferred (Phase 2C+).

---

## Domain Model

The `Agent` model exists in the schema but has no portfolio association. The `agent_registry.json` (43 agents) records a `human_supervisor_id` that maps cleanly to portfolio ownership:

| HR Role | Portfolio Slug |
|---|---|
| HR-100 | `products_and_services_sold` |
| HR-200 | `for_employees` |
| HR-300 | `foundational` |
| HR-500 | `manufacturing_and_delivery` |
| HR-000 | null (cross-cutting) |
| HR-400 | null (cross-cutting) |

Cross-cutting agents (HR-000, HR-400) have no single portfolio — they are excluded from per-portfolio counts.

**Note:** All 43 agents in `agent_registry.json` carry `status: "defined"`. The `seedAgents()` function currently passes `status: a.status ?? "active"` — meaning seeded agents get status `"defined"`. The `getAgentCounts()` filter must use `status: "active"` OR the seed must normalise `"defined"` → `"active"`. The correct resolution is to normalise in the seed: treat `"defined"` as operationally active for the purposes of this platform (agents are defined and ready). Update `seedAgents()` to always write `status: "active"` regardless of the JSON value.

Agent counts in the stats strip are **portfolio-level** — all nodes within a portfolio report the same agent count (the total for that portfolio). Granular per-node agent assignment is a future phase.

---

## Schema Change

Add `portfolioId` FK to `Agent`, matching the pattern established by `DigitalProduct.portfolioId`:

```prisma
model Agent {
  // existing fields …
  portfolioId  String?
  portfolio    Portfolio?  @relation(fields: [portfolioId], references: [id])
}

model Portfolio {
  // existing fields …
  agents  Agent[]
}
```

---

## Data Layer

### `seedAgents()` update

Add `human_supervisor_id` to the type read from JSON. Add `parseAgentPortfolioSlug()` helper in `seed-helpers.ts`:

```ts
const SUPERVISOR_TO_PORTFOLIO: Record<string, string> = {
  "HR-100": "products_and_services_sold",
  "HR-200": "for_employees",
  "HR-300": "foundational",
  "HR-500": "manufacturing_and_delivery",
  // HR-000, HR-400 omitted → returns null (cross-cutting)
};
export function parseAgentPortfolioSlug(supervisorId: string): string | null {
  return SUPERVISOR_TO_PORTFOLIO[supervisorId] ?? null;
}
```

The full updated type read from JSON in `seedAgents()`:

```ts
{
  agent_id: string;
  agent_name: string;
  capability_domain?: string;
  status?: string;
  human_supervisor_id?: string;  // ← added
}
```

`seedAgents()` looks up `Portfolio.id` from the slug and sets `portfolioId` on each agent. Status is always written as `"active"` regardless of the JSON `status` value (the registry uses `"defined"` which means the same thing in this platform).

**Seed call order:** `main()` in `seed.ts` must call `seedPortfolios()` **before** `seedAgents()` so the portfolio rows exist when the agent upserts run their FK lookups. The current order in `main()` has `seedAgents()` on line 240 before `seedPortfolios()` on line 241 — swap these.

### `getAgentCounts()` in `portfolio-data.ts`

New React-cached function returning `Record<string, number>` keyed by portfolio slug:

```ts
export const getAgentCounts = cache(async () => {
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
  // e.g. { foundational: 14, manufacturing_and_delivery: 9, ... }
});
```

---

## Component Changes

### `page.tsx`

Call `getAgentCounts()` alongside `getPortfolioTree()` (both are React-cached):

```ts
const [roots, agentCounts] = await Promise.all([
  getPortfolioTree(),
  getAgentCounts(),
]);
```

Pass `agentCounts` to both `PortfolioOverview` and `PortfolioNodeDetail`. For node detail, the existing `slugs.length === 0` guard at the top of the function ensures `slugs[0]` is always present in the else branch:

```ts
// (slugs.length === 0 already handled above as PortfolioOverview)
const rootSlug = slugs[0] ?? ""; // ?? "" satisfies noUncheckedIndexedAccess; guard above means this is always non-empty
const agentCount = agentCounts[rootSlug] ?? 0;
```

### `PortfolioNodeDetail`

Add `agentCount: number` prop. Replace the dashed Agents `StatBox` with a live one:

```tsx
// Before:
<StatBox label="Agents" value="—" colour="#555566" dashed />
// After:
<StatBox label="Agents" value={String(agentCount)} colour={colour} />
```

### `PortfolioOverview`

Add `agentCounts: Record<string, number>` prop. Add an Agents figure to each portfolio root card alongside the existing Products count.

---

## Implementation Order

Tasks must be done in this order:
1. Schema change + `prisma migrate dev`
2. Run `prisma generate` (or it runs automatically via migrate) — **required before web-layer TypeScript will compile**
3. `seed-helpers.ts` + `seed.ts` changes
4. `portfolio-data.ts` + `page.tsx` + component changes (will not compile until step 2 is done)
5. `seed-helpers.test.ts`

---

## Files Changed

| File | Change |
|---|---|
| `packages/db/prisma/schema.prisma` | Add `portfolioId` + back-relation to `Agent`/`Portfolio` |
| `packages/db/prisma/migrations/…` | New migration |
| `packages/db/src/seed-helpers.ts` | Add `parseAgentPortfolioSlug()` |
| `packages/db/src/seed.ts` | Update `seedAgents()` to set `portfolioId` |
| `apps/web/lib/portfolio-data.ts` | Add `getAgentCounts()` |
| `apps/web/app/(shell)/portfolio/[[...slug]]/page.tsx` | Call `getAgentCounts()`, pass to components |
| `apps/web/components/portfolio/PortfolioNodeDetail.tsx` | Add `agentCount` prop, replace dashed StatBox |
| `apps/web/components/portfolio/PortfolioOverview.tsx` | Add `agentCounts` prop, show agent count on cards |

---

## What This Does Not Include

- Health metrics — deferred Phase 2C
- Investment data — deferred Phase 2C
- Per-node agent assignment (granular) — future phase
- People panel live data — future phase
- Cross-cutting agent counts at overview level — kept as is (Overview header shows total products only; cross-cutting agents not counted per portfolio)

---

## Testing

No new pure functions are added in this phase — all new logic is Prisma-dependent server code or straightforward prop threading. Existing 26 unit tests continue to pass unchanged. No new test file needed.

The `parseAgentPortfolioSlug()` helper is a pure function; a unit test should be added to `packages/db/src/seed-helpers.test.ts` (new file, same package as the helper). This keeps the test co-located with its source and avoids any cross-package import issue. A brief test verifying the known mappings and the null fallback is sufficient.
