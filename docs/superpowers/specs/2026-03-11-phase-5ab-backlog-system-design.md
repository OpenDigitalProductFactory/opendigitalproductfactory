# Phase 5A+B — Backlog System Design

## Overview

Implement a two-context backlog system aligned with IT4IT/DPPM, and register the DPF Portal as its own managed digital product within the Manufacture and Delivery portfolio — making the platform recursive: it manages its own development through the same system it provides to all other digital products.

---

## Architectural Principle: Taxonomy as Ownership Map

The taxonomy tree (`TaxonomyNode`) is not a classification hierarchy — it is the **ownership and provider map** for all entities in the system. Digital Products, AI Agents, and People are all citizens of taxonomy nodes. A taxonomy node answers: *who owns this domain?* Backlog items, products, and agents are anchored to taxonomy nodes to establish their organizational context, not merely their category.

This principle underpins the design of `BacklogItem.taxonomyNodeId`: it records the ownership domain of the work, not a tag.

---

## Domain Model: Two Backlog Contexts

Per IT4IT/DPPM, backlog items exist in two distinct contexts:

**Portfolio context** (`type: "portfolio"`)
Strategic work that affects the portfolio as a whole. Anchored to a taxonomy node (the ownership domain). No digital product FK. Belongs to the IT4IT *Evaluate* value stream — decisions about whether and where to invest.

**Product context** (`type: "product"`)
Implementation work for a specific digital product. Requires a `digitalProductId` FK. Also anchored to a taxonomy node (the owning domain). Belongs to the IT4IT *Explore* value stream — decisions about what to build and how.

---

## Schema Changes

### `DigitalProduct` — CSDM two-attribute lifecycle

Replace the single `status: String` field with:

```prisma
lifecycleStage  String  @default("plan")   // plan | design | build | production | retirement
lifecycleStatus String  @default("draft")  // draft | active | inactive
```

The pair answers two distinct questions:
- `lifecycleStage`: *where in the product lifecycle is this?*
- `lifecycleStatus`: *what is its current operational state?*

This allows future/current/retired products to coexist in the same portfolio graph. Examples:
- `production / active` — live and running
- `retirement / active` — still live but being wound down
- `plan / draft` — not yet committed

**Migration:** existing `status` records are migrated to `lifecycleStage: "production"`, `lifecycleStatus: "active"`, then `status` is dropped. No production data at risk.

### `BacklogItem` — ownership and product links

Add three optional fields:

```prisma
priority         Int?              // lower number = higher priority; null = unset
digitalProductId String?           // FK → DigitalProduct; required when type = "product"
digitalProduct   DigitalProduct?   @relation(...)
taxonomyNodeId   String?           // FK → TaxonomyNode; the ownership domain
taxonomyNode     TaxonomyNode?     @relation(...)
```

`BacklogItem.status` (work state) remains distinct from `DigitalProduct.lifecycleStatus` (product operational state):
- BacklogItem status values: `open | in-progress | done | deferred`
- DigitalProduct lifecycleStatus values: `draft | active | inactive`

### `TaxonomyNode` — back-relations only

No new fields. Prisma back-relations added:
- `backlogItems BacklogItem[]`
- `DigitalProduct[]` already exists

---

## Phase 5A: Backlog CRUD in `/ops`

### Data Layer

**`apps/web/lib/backlog-data.ts`** (new file):
- `getBacklogItems()` — all items joined with `digitalProduct` and `taxonomyNode`, ordered by priority ASC then `createdAt` ASC; wrapped in React `cache()`
- `getDigitalProductsForSelect()` — slim list `{ id, productId, name, lifecycleStage }` for form selector
- Taxonomy node flat list reuses `getPortfolioTree()` (already cached); flattened at call site

### Server Actions

**`apps/web/lib/actions/backlog.ts`** (new file), three `"use server"` actions:

```ts
type BacklogItemInput = {
  title: string
  type: "product" | "portfolio"
  status: "open" | "in-progress" | "done" | "deferred"
  priority?: number
  body?: string
  taxonomyNodeId?: string
  digitalProductId?: string  // required when type === "product"
}

createBacklogItem(data: BacklogItemInput): Promise<BacklogItem>
updateBacklogItem(id: string, data: BacklogItemInput): Promise<BacklogItem>
deleteBacklogItem(id: string): Promise<void>
```

`itemId` generated as `BI-<Date.now()>` on create.

**Auth gate:** session required; action rejected if no session. Role check: `isSuperuser` or `platformRole` HR-100 and above. (Consistent with existing admin patterns.)

**Validation:** `type === "product"` requires `digitalProductId` — enforced in the action, not only the form. `type === "portfolio"` does not hard-require `taxonomyNodeId`, but the form should preselect it when context is available (e.g., when creating from within a taxonomy node view). Grounding portfolio-type items in the ownership map is the correct behaviour per the architectural principle; the soft treatment allows data entry flexibility.

### UI

**`apps/web/app/(shell)/ops/page.tsx`** — extended (not replaced):

Two sections: **Portfolio Backlog** and **Product Backlog**, matching existing grouping. Each section has an "Add item" button.

**Item row:** priority badge (number, muted if unset) | title | taxonomy node name (small, muted) | digital product name (product-type only) | status badge (open=blue, in-progress=amber, done=green, deferred=gray) | edit icon | delete icon with inline confirm.

**Right-side slide panel** (controlled by `useState`, no URL change):
- Single `BacklogPanel` client component; `item?: BacklogItemWithRelations` prop — undefined = create mode
- Keeping the full list visible behind the panel provides context while editing

**Form fields in panel:**
1. Title (text, required)
2. Type (segmented toggle: Portfolio / Product)
3. Status (select: open / in-progress / done / deferred)
4. Priority (number input, optional)
5. Taxonomy node (searchable select — flat list of all 481 nodes, label shows `nodeId` path)
6. Digital product (select, shown only when type = Product)
7. Body (textarea, optional — markdown supported in future)

No new routes introduced.

---

## Phase 5B: DPF Self-Registration

### New seed function: `seedDpfSelfRegistration()`

Added to `packages/db/src/seed.ts`, called from `main()` after `seedTaxonomyNodes()`.

**DPF Portal as a DigitalProduct:**

```
productId:       dpf-portal
name:            Digital Product Factory Portal
lifecycleStage:  production
lifecycleStatus: active
portfolioId:     → Portfolio { slug: "manufacturing_and_delivery" }
taxonomyNodeId:  → TaxonomyNode { nodeId: "manufacturing_and_delivery" }
```

All records upserted on natural keys — seed is fully idempotent.

**Portfolio-type backlog items** (domain-wide, no digitalProductId):

| itemId | title | status | priority |
|--------|-------|--------|----------|
| BI-PORT-001 | Establish Digital Product Factory in Manufacture and Delivery Portfolio | done | 1 |
| BI-PORT-002 | Implement DPPM taxonomy — 481-node portfolio ownership graph | done | 2 |
| BI-PORT-003 | Portfolio route — browsable portfolio tree with node detail | done | 3 |
| BI-PORT-004 | Backlog system — portfolio and product context per IT4IT | in-progress | 4 |

`taxonomyNodeId` → `manufacturing_and_delivery` TaxonomyNode for all.

**Product-type backlog items** (linked to dpf-portal):

| itemId | title | status | priority |
|--------|-------|--------|----------|
| BI-PROD-001 | Phase 5A — Backlog CRUD in /ops | in-progress | 1 |
| BI-PROD-002 | Phase 5B — DPF self-registration as managed digital product | in-progress | 2 |
| BI-PROD-003 | Phase 2B — Live Agent counts and Health metrics in portfolio panels | open | 3 |

`digitalProductId` → `dpf-portal`. `taxonomyNodeId` → `manufacturing_and_delivery` TaxonomyNode.

### Recursive loop

The DPF Portal tracks its own development backlog through the same backlog system it provides to all other digital products. Portfolio-type items (`BI-PORT-*`) represent strategic investment decisions at the Manufacture and Delivery portfolio level. Product-type items (`BI-PROD-*`) represent implementation work on the DPF product itself. This is the IT4IT-described recursive self-management of a platform as a digital product.

---

## Out of Scope (Future)

- IT4IT value stream stage on BacklogItem (`valueStreamStage: Evaluate | Explore | ...`) — correct long-term but no UI consumes it yet
- Backlog items linked to `User` or `Agent` entities (ownership is via taxonomy node for now)
- Multi-tenancy / business-type taxonomy variations
- Work packages and product releases (the IT4IT layer above backlog items)
- Soft-delete on BacklogItem
