# Portfolio Route Design

**Date:** 2026-03-10
**Status:** Approved
**Scope:** `/portfolio` route — Phase 2A of the Open Digital Product Factory monorepo

---

## Overview

The `/portfolio` route gives Portfolio Managers (HR-100), Enterprise Architects (HR-300), ITFM Directors (HR-400), and the CDIO (HR-000) a read-only structural view of the company's digital product landscape.

The page expresses three perspectives simultaneously:
- **Digital Products** — what products exist and where they sit in the taxonomy
- **People** — which human roles own and manage each capability domain
- **AI Agents** — which agents are operating in each domain

The conceptual foundation is the Open Group DPPM guide (G252, 2025): four portfolio types aligned to Conway's Law, investment rolling down from portfolio to product, metrics rolling up from product to portfolio.

---

## The Four Portfolios

| Slug | Name | Colour | Primary Owner |
|---|---|---|---|
| `foundational` | Foundational | `#7c8cf8` | HR-300 (EA) |
| `manufacturing_and_delivery` | Mfr & Delivery | `#fb923c` | HR-500 (Ops) |
| `for_employees` | For Employees | `#a78bfa` | HR-200 (DPM) |
| `products_and_services_sold` | Products Sold | `#f472b6` | HR-100 (Portfolio) |

**Foundational** = technology management services underpinning the platform (infrastructure, platform services, security, data, networking). Not customer-facing. Aligns to the IT4IT Foundational portfolio type.

---

## Route Structure

```
app/(shell)/portfolio/
  layout.tsx                  — server component; loads full taxonomy tree + product counts once
  [[...slug]]/
    page.tsx                  — server component; renders right panel for the selected node
```

**URL → selection mapping:**

| URL | What is selected |
|---|---|
| `/portfolio` | Overview — all 4 portfolio roots |
| `/portfolio/foundational` | Foundational portfolio root |
| `/portfolio/foundational/platform-services` | L1 capability domain |
| `/portfolio/foundational/platform-services/container-platform` | L2 functional group (leaf) |

Up to 4 URL segments deep (portfolio root → L1 → L2 → L3). The `[[...slug]]` catch-all handles all depths with one page file.

---

## Data Model Changes

### Schema migration

Add `taxonomyNodeId` to `DigitalProduct`:

```prisma
model DigitalProduct {
  // existing fields …
  taxonomyNodeId  String?
  taxonomyNode    TaxonomyNode? @relation(fields: [taxonomyNodeId], references: [id])
}
```

Products without a `taxonomyNodeId` remain valid — they appear as "unclassified" at the portfolio root level.

### TaxonomyNode seeding

Seed `TaxonomyNode` from `PORTFOLIOS/taxonomy_v2.csv` in the old project (~379 rows). Tree structure:

```
Portfolio root  (portfolioId set, parentId null, nodeId = portfolio slug)
  └─ L1 capability domain   (parentId → root nodeId)
       └─ L2 functional group  (parentId → L1 nodeId)
            └─ L3 specialisation  (parentId → L2 nodeId, sparse)
```

Node `nodeId` values are URL-safe slugs (e.g. `compute`, `platform-services`, `container-platform`) — stable across seeds.

`TaxonomyNode.id` is the cuid primary key used for all FK references (including `DigitalProduct.taxonomyNodeId` and `TaxonomyNode.parentId`). `TaxonomyNode.nodeId` is the human-readable URL slug — a separate unique field used only for routing. Do not use `nodeId` as a FK target.

---

## Component Architecture

### New files

```
apps/web/
  app/(shell)/portfolio/
    layout.tsx                     server component — tree data loader
    [[...slug]]/
      page.tsx                     server component — right panel renderer

  components/portfolio/
    PortfolioTree.tsx               'use client' — manages expand/collapse state only
    PortfolioTreeNode.tsx           recursive — renders one tree node + children
    PortfolioOverview.tsx           right panel: /portfolio (all 4 roots)
    PortfolioNodeDetail.tsx         right panel: single node at any depth
    ProductList.tsx                 product/service list for leaf nodes
```

### PortfolioTree (client component)

Responsibilities:
- Receive the full annotated tree from layout as a prop (serialised, no Prisma calls)
- Manage expand/collapse state in `useState` — initialised from `?open=` search param
- Sync open state back to URL via `window.history.replaceState` (not `router.replace` — App Router's replace triggers a server re-render; `replaceState` updates the URL client-side only, preserving deep-link behaviour without unnecessary Prisma round-trips)
- Highlight the active node derived from `usePathname()`
- Render `PortfolioTreeNode` recursively

The client component holds **no data-fetching logic** — it only manages interaction state.

### Layout (server component)

Two parallel Prisma queries on every request into `/portfolio/*`:

```ts
const [nodes, counts] = await Promise.all([
  prisma.taxonomyNode.findMany({
    where: { status: 'active' },
    select: { id: true, nodeId: true, name: true, parentId: true, portfolioId: true }
  }),
  prisma.digitalProduct.groupBy({
    by: ['taxonomyNodeId'],
    _count: { id: true },
    where: { status: 'active' }
  })
])
// counts[n].taxonomyNodeId is a cuid matching TaxonomyNode.id
// In-memory join: directCount = counts.find(c => c.taxonomyNodeId === node.id)?._count.id ?? 0
// Roll cumulative counts up to parents bottom-up after building the tree
// Pass annotated tree to PortfolioTree
```

The layout also checks `can(user, 'view_portfolio')` and calls `notFound()` if false, preventing direct URL access by roles without this capability (e.g. HR-500).

~379 nodes, in-memory tree build — negligible overhead.

### Right panel (server component, page.tsx)

Renders differently by depth:

| Depth | Content |
|---|---|
| 0 — `/portfolio` | 4 portfolio root cards with product count, agent count, owner role |
| 1 — portfolio root | Portfolio name + description, stats strip, grid of L1 capability domains |
| 2 — L1 domain | Breadcrumb, stats strip, grid of L2 functional groups |
| 3/4 — L2/L3 leaf | Breadcrumb, stats strip, product/service list |

**Stats strip** (all non-overview levels):
- Products count — filled (Prisma count)
- Agents count — **placeholder (dashed)** in Phase 2A; the `Agent` model has no portfolio association yet; wired up when `Agent.portfolioId` is added in a future phase
- Owner role — mapped from `Portfolio.slug` → static role map (filled; no DB query needed)
- Health slot — dashed placeholder, wired up in a future phase
- Investment slot — dashed placeholder, wired up in a future phase

**People and Agents panels** — dashed placeholders rendered at all levels. Represent the three-perspective model (Products / People / Agents) from day one. Wired up in a later phase.

---

## Tree Sidebar Design

- 4 portfolio roots always visible, colour-coded by portfolio accent colour
- Each root is expandable — click to reveal L1 nodes
- L1 nodes expandable to L2, L2 to L3 (full 4-level depth)
- Product count badge on every node (direct + subtree cumulative)
- Active node: accent-coloured left border + background highlight
- Collapsed portfolios show root name + total count only
- Dividers between the 4 portfolio roots

---

## State & URL Design

| State | Source of truth |
|---|---|
| Selected node | URL path (`params.slug`) |
| Expanded nodes | `?open=node1,node2` search param |
| Active portfolio colour | Derived from selected node's root portfolio |

Deep links work by default. Sharing `/portfolio/foundational/platform-services?open=foundational` opens the tree at the right position.

---

## Error & Empty States

| Condition | Handling |
|---|---|
| User lacks `view_portfolio` capability | `notFound()` in `portfolio/layout.tsx` — checked via `can(user, 'view_portfolio')` |
| Slug not found in taxonomy | `notFound()` in page.tsx via `resolveNodeFromSlug` returning null |
| No taxonomy seeded | Sidebar shows 4 portfolio root names only (graceful degradation) |
| Node has no products | "No products classified here yet" message in right panel |

---

## Testing

Following existing project patterns (Vitest, synchronous, no asyncio):

| Test | Type | File |
|---|---|---|
| `buildPortfolioTree(nodes, counts)` — correct parent-child wiring | Unit | `apps/web/lib/portfolio.test.ts` |
| `buildPortfolioTree()` — count roll-up to parents | Unit | `apps/web/lib/portfolio.test.ts` |
| `can(user, 'view_portfolio')` for all 6 roles | Already covered | `apps/web/lib/permissions.test.ts` |
| `resolveNodeFromSlug(tree, slug)` — valid slug returns node | Unit | `apps/web/lib/portfolio.test.ts` |
| `resolveNodeFromSlug(tree, unknownSlug)` — returns null | Unit | `apps/web/lib/portfolio.test.ts` |

**Note on integration tests:** The existing vitest config (`apps/web/vitest.config.ts`) uses `environment: "node"` with no jsdom/happy-dom setup — React component rendering tests are not supported without additional config. Integration-style coverage for the portfolio route is therefore provided via unit tests of the pure functions (`buildPortfolioTree`, `resolveNodeFromSlug`) that contain all routing and data-shaping logic. Full component render tests are deferred until the project adds a DOM test environment.

---

## What This Does Not Include (Phase 2A scope boundary)

- Editing or creating portfolios/taxonomy nodes — admin task, later phase
- Wiring People and Agents panels with live data — placeholders only
- Health or Investment metrics — placeholder slots only
- `/inventory` and `/ea` routes — separate specs
- Neo4j graph traversal — PostgreSQL only for Phase 2A

---

## Files to Create / Modify

| File | Action |
|---|---|
| `packages/db/prisma/schema.prisma` | Add `taxonomyNodeId` + relation to `DigitalProduct` |
| `packages/db/prisma/migrations/…` | New migration |
| `packages/db/src/seed.ts` | Add taxonomy node seeding from CSV data |
| `apps/web/app/(shell)/portfolio/layout.tsx` | New — tree data loader |
| `apps/web/app/(shell)/portfolio/[[...slug]]/page.tsx` | New — right panel server component |
| `apps/web/lib/portfolio.ts` | New — `buildPortfolioTree()` utility |
| `apps/web/components/portfolio/PortfolioTree.tsx` | New — client tree component |
| `apps/web/components/portfolio/PortfolioTreeNode.tsx` | New — recursive tree node |
| `apps/web/components/portfolio/PortfolioOverview.tsx` | New — all-portfolios overview panel |
| `apps/web/components/portfolio/PortfolioNodeDetail.tsx` | New — single-node detail panel |
| `apps/web/components/portfolio/ProductList.tsx` | New — product/service list |
| `apps/web/lib/portfolio.test.ts` | New — unit tests for `buildPortfolioTree` and `resolveNodeFromSlug` |
| `.gitignore` | Add `.superpowers/` if not present (done) |
