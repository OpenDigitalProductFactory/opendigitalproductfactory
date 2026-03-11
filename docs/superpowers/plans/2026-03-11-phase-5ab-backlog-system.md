# Phase 5A+B — Backlog System Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add CSDM-aligned lifecycle to DigitalProduct, link BacklogItem to DigitalProduct and TaxonomyNode, build CRUD in /ops, and register DPF Portal as its own managed digital product with seed backlog items.

**Architecture:** Schema-first — Prisma migration before any app code. Pure utils in `backlog.ts` (testable, no server imports). Data fetching in `backlog-data.ts` (React cache). Server actions in `lib/actions/backlog.ts` (`"use server"`). UI: server component page passes data to `OpsClient` (client wrapper holding panel state), `BacklogItemRow` and `BacklogPanel` are client components that call server actions then `router.refresh()`.

**Tech Stack:** Next.js 16 App Router, Prisma 5, TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Tailwind CSS, Auth.js v5, Vitest. `moduleResolution: "bundler"` — no `.js` extensions on local imports.

---

## Chunk 1: Schema Migration and Data Layer Fixes

### Task 1: Prisma Schema — CSDM Lifecycle and BacklogItem Links

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1.1: Replace `DigitalProduct.status` with CSDM two-attribute lifecycle**

In `packages/db/prisma/schema.prisma`, replace the `DigitalProduct` model entirely with:

```prisma
model DigitalProduct {
  id              String        @id @default(cuid())
  productId       String        @unique
  name            String
  lifecycleStage  String        @default("plan")   // plan | design | build | production | retirement
  lifecycleStatus String        @default("draft")  // draft | active | inactive
  portfolioId     String?
  portfolio       Portfolio?    @relation(fields: [portfolioId], references: [id])
  taxonomyNodeId  String?
  taxonomyNode    TaxonomyNode? @relation(fields: [taxonomyNodeId], references: [id])
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
  backlogItems    BacklogItem[]
}
```

- [ ] **Step 1.2: Add links and priority to BacklogItem**

Replace the `BacklogItem` model with:

```prisma
model BacklogItem {
  id               String          @id @default(cuid())
  itemId           String          @unique
  title            String
  status           String          // open | in-progress | done | deferred
  type             String          // product | portfolio
  body             String?
  priority         Int?
  digitalProductId String?
  digitalProduct   DigitalProduct? @relation(fields: [digitalProductId], references: [id])
  taxonomyNodeId   String?
  taxonomyNode     TaxonomyNode?   @relation(fields: [taxonomyNodeId], references: [id])
  createdAt        DateTime        @default(now())
  updatedAt        DateTime        @updatedAt
}
```

- [ ] **Step 1.3: Add back-relations to TaxonomyNode**

In the `TaxonomyNode` model, add after `products DigitalProduct[]`:

```prisma
  backlogItems BacklogItem[]
```

- [ ] **Step 1.4: Run the migration**

```bash
pnpm --filter @dpf/db exec prisma migrate dev --name csdm_lifecycle_backlog_links
```

When prompted "We need to reset the PostgreSQL database…" — type `y` to accept (dev database only; existing taxonomy/role data is re-seeded). Using `exec prisma` directly because pnpm's npm script argument forwarding with `--` does not reliably pass `--name` to Prisma's CLI.

Expected: `Your database is now in sync with your schema.` followed by Prisma client regeneration.

- [ ] **Step 1.5: Regenerate Prisma client**

```bash
pnpm --filter @dpf/db generate
```

Expected: `Generated Prisma Client`.

- [ ] **Step 1.6: TypeCheck the db package**

```bash
pnpm --filter @dpf/db typecheck
```

Expected: no errors.

- [ ] **Step 1.7: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(db): CSDM lifecycle on DigitalProduct; taxonomy + product FK on BacklogItem"
```

---

### Task 2: Fix `seedDigitalProducts()` for CSDM Fields

**Files:**
- Modify: `packages/db/src/seed.ts` (lines 198–229)

The `seedDigitalProducts()` function currently reads `p.lifecycle?.stage_status` into a `status` field. That field no longer exists. Update it to write `lifecycleStage` and `lifecycleStatus`.

- [ ] **Step 2.1: Update `seedDigitalProducts()` to write lifecycle fields**

Find the `seedDigitalProducts` function in `packages/db/src/seed.ts`. Replace it entirely with:

```ts
async function seedDigitalProducts(): Promise<void> {
  const registry = readJson<{
    digital_products: Array<{
      product_id: string;
      name: string;
      portfolio_id?: string;
      lifecycle?: { stage_status?: string };
    }>;
  }>("MODEL/digital_product_registry.json");

  const products = registry.digital_products;
  for (const p of products) {
    let portfolioDbId: string | undefined;
    if (p.portfolio_id) {
      const portfolio = await prisma.portfolio.findUnique({ where: { slug: p.portfolio_id } });
      portfolioDbId = portfolio?.id;
    }
    // Treat registry stage_status as the operational lifecycleStatus.
    // All registry products are assumed to be in production.
    const lifecycleStatus = p.lifecycle?.stage_status ?? "active";

    await prisma.digitalProduct.upsert({
      where: { productId: p.product_id },
      update: { name: p.name, lifecycleStage: "production", lifecycleStatus, portfolioId: portfolioDbId ?? null },
      create: {
        productId: p.product_id,
        name: p.name,
        lifecycleStage: "production",
        lifecycleStatus,
        portfolioId: portfolioDbId ?? null,
      },
    });
  }
  console.log(`Seeded ${products.length} digital products`);
}
```

- [ ] **Step 2.2: TypeCheck seed.ts**

```bash
pnpm --filter @dpf/db typecheck
```

Expected: no errors.

- [ ] **Step 2.3: Commit**

```bash
git add packages/db/src/seed.ts
git commit -m "fix(seed): write lifecycleStage + lifecycleStatus on DigitalProduct (removes status)"
```

---

### Task 3: Fix `portfolio-data.ts` Active-Count Query

**Files:**
- Modify: `apps/web/lib/portfolio-data.ts` (line 22)

The `getPortfolioTree` function has a `groupBy` query that filters `where: { status: "active" }`. The `status` field is gone; active products are now those with `lifecycleStatus: "active"`.

- [ ] **Step 3.1: Update the active-count filter**

In `apps/web/lib/portfolio-data.ts`, find the third argument of `Promise.all` (around line 19):

```ts
    prisma.digitalProduct.groupBy({
      by: ["taxonomyNodeId"],
      _count: { id: true },
      where: { status: "active" },
    }),
```

Change `status: "active"` to `lifecycleStatus: "active"`:

```ts
    prisma.digitalProduct.groupBy({
      by: ["taxonomyNodeId"],
      _count: { id: true },
      where: { lifecycleStatus: "active" },
    }),
```

- [ ] **Step 3.2: TypeCheck apps/web**

```bash
pnpm --filter web typecheck
```

Expected: 0 errors.

- [ ] **Step 3.3: Run tests**

```bash
pnpm --filter web test
```

Expected: all tests pass (portfolio.test.ts tests pure utils — this change doesn't affect them, but confirm nothing regressed).

- [ ] **Step 3.4: Commit**

```bash
git add apps/web/lib/portfolio-data.ts
git commit -m "fix(web): update active-product filter to lifecycleStatus after CSDM migration"
```

---

## Chunk 2: Pure Utils and Data Layer

### Task 4: Pure Backlog Utils — `backlog.ts` and `backlog.test.ts`

**Files:**
- Create: `apps/web/lib/backlog.ts`
- Create: `apps/web/lib/backlog.test.ts`

This file has no server imports — it's safe to use in tests and client components.

- [ ] **Step 4.1: Write the failing tests first**

Create `apps/web/lib/backlog.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  validateBacklogInput,
  BACKLOG_STATUS_COLOURS,
  LIFECYCLE_STAGE_LABELS,
  type BacklogItemInput,
} from "./backlog";

describe("validateBacklogInput()", () => {
  it("returns null for a valid portfolio-type item", () => {
    const input: BacklogItemInput = { title: "My item", type: "portfolio", status: "open" };
    expect(validateBacklogInput(input)).toBeNull();
  });

  it("returns an error string for a product-type item missing digitalProductId", () => {
    const input: BacklogItemInput = { title: "My item", type: "product", status: "open" };
    expect(validateBacklogInput(input)).toMatch(/digital product/i);
  });

  it("returns null for a valid product-type item with digitalProductId", () => {
    const input: BacklogItemInput = {
      title: "My item",
      type: "product",
      status: "open",
      digitalProductId: "clxabc123",
    };
    expect(validateBacklogInput(input)).toBeNull();
  });

  it("returns an error for a blank title", () => {
    const input: BacklogItemInput = { title: "   ", type: "portfolio", status: "open" };
    expect(validateBacklogInput(input)).toMatch(/title/i);
  });
});

describe("BACKLOG_STATUS_COLOURS", () => {
  it("has a colour for every expected status", () => {
    expect(BACKLOG_STATUS_COLOURS["open"]).toBeDefined();
    expect(BACKLOG_STATUS_COLOURS["in-progress"]).toBeDefined();
    expect(BACKLOG_STATUS_COLOURS["done"]).toBeDefined();
    expect(BACKLOG_STATUS_COLOURS["deferred"]).toBeDefined();
  });
});

describe("LIFECYCLE_STAGE_LABELS", () => {
  it("has a label for every stage", () => {
    for (const stage of ["plan", "design", "build", "production", "retirement"]) {
      expect(LIFECYCLE_STAGE_LABELS[stage]).toBeDefined();
    }
  });
});
```

- [ ] **Step 4.2: Run tests to confirm they fail**

```bash
pnpm --filter web test backlog
```

Expected: FAIL — cannot find module `./backlog`.

- [ ] **Step 4.3: Implement `backlog.ts`**

Create `apps/web/lib/backlog.ts`:

```ts
// Pure utility library — no server imports. Safe in tests and client components.

export type BacklogItemInput = {
  title: string;
  type: "product" | "portfolio";
  status: "open" | "in-progress" | "done" | "deferred";
  priority?: number;
  body?: string;
  taxonomyNodeId?: string;
  digitalProductId?: string;
};

export type BacklogItemWithRelations = {
  id: string;
  itemId: string;
  title: string;
  status: string;
  type: string;
  body: string | null;
  priority: number | null;
  digitalProduct: { id: string; productId: string; name: string } | null;
  taxonomyNode: { id: string; nodeId: string; name: string } | null;
  createdAt: Date;
  updatedAt: Date;
};

export type DigitalProductSelect = {
  id: string;
  productId: string;
  name: string;
  lifecycleStage: string;
};

export type TaxonomyNodeSelect = {
  id: string;
  nodeId: string;
  name: string;
};

/** Returns null if valid, or an error message if invalid. */
export function validateBacklogInput(input: BacklogItemInput): string | null {
  if (!input.title.trim()) return "Title is required";
  if (input.type === "product" && !input.digitalProductId) {
    return "A digital product is required for product-type items";
  }
  return null;
}

/** Status badge colours (Tailwind inline styles). */
export const BACKLOG_STATUS_COLOURS: Record<string, string> = {
  "open":        "#38bdf8",
  "in-progress": "#fb923c",
  "done":        "#4ade80",
  "deferred":    "#555566",
};

/** Human-readable labels for CSDM lifecycle stages. */
export const LIFECYCLE_STAGE_LABELS: Record<string, string> = {
  plan:       "Plan",
  design:     "Design",
  build:      "Build",
  production: "Production",
  retirement: "Retirement",
};

/** Human-readable labels for CSDM lifecycle statuses. */
export const LIFECYCLE_STATUS_LABELS: Record<string, string> = {
  draft:    "Draft",
  active:   "Active",
  inactive: "Inactive",
};
```

- [ ] **Step 4.4: Run tests to confirm they pass**

```bash
pnpm --filter web test backlog
```

Expected: 6 tests passing.

- [ ] **Step 4.5: TypeCheck**

```bash
pnpm --filter web typecheck
```

Expected: 0 errors.

- [ ] **Step 4.6: Commit**

```bash
git add apps/web/lib/backlog.ts apps/web/lib/backlog.test.ts
git commit -m "feat(web): backlog pure utils — types, validation, status colours, lifecycle labels"
```

---

### Task 5: Backlog Data Layer — `backlog-data.ts`

**Files:**
- Create: `apps/web/lib/backlog-data.ts`

Server-only. Uses React `cache()` to deduplicate Prisma calls within one request.

- [ ] **Step 5.1: Create `apps/web/lib/backlog-data.ts`**

```ts
// apps/web/lib/backlog-data.ts
// Server-only: uses React cache() to deduplicate Prisma calls within one request.
import { cache } from "react";
import { prisma } from "@dpf/db";
import type { BacklogItemWithRelations, DigitalProductSelect, TaxonomyNodeSelect } from "./backlog";

export const getBacklogItems = cache(async (): Promise<BacklogItemWithRelations[]> => {
  return prisma.backlogItem.findMany({
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      itemId: true,
      title: true,
      status: true,
      type: true,
      body: true,
      priority: true,
      createdAt: true,
      updatedAt: true,
      digitalProduct: { select: { id: true, productId: true, name: true } },
      taxonomyNode: { select: { id: true, nodeId: true, name: true } },
    },
  });
});

export const getDigitalProductsForSelect = cache(async (): Promise<DigitalProductSelect[]> => {
  return prisma.digitalProduct.findMany({
    orderBy: { name: "asc" },
    select: { id: true, productId: true, name: true, lifecycleStage: true },
  });
});

// Note: The spec originally proposed reusing getPortfolioTree() and flattening at call site.
// A direct query is used here instead: getPortfolioTree() returns nodes with product-count
// metadata that is irrelevant for the form selector, and coupling the form to the portfolio
// tree shape creates an unnecessary dependency. A dedicated active-node query is cleaner.
export const getTaxonomyNodesFlat = cache(async (): Promise<TaxonomyNodeSelect[]> => {
  return prisma.taxonomyNode.findMany({
    where: { status: "active" },
    select: { id: true, nodeId: true, name: true },
    orderBy: { nodeId: "asc" },
  });
});
```

- [ ] **Step 5.2: TypeCheck**

```bash
pnpm --filter web typecheck
```

Expected: 0 errors.

- [ ] **Step 5.3: Commit**

```bash
git add apps/web/lib/backlog-data.ts
git commit -m "feat(web): backlog data layer — getBacklogItems, getDigitalProductsForSelect, getTaxonomyNodesFlat"
```

---

## Chunk 3: Permissions and Server Actions

### Task 6: Add `manage_backlog` Permission

**Files:**
- Modify: `apps/web/lib/permissions.ts`

No isolated tests are needed for this task. `CapabilityKey` is a TypeScript union type — adding a member is verified entirely by typecheck. The `can()` function is already correct; adding a new entry to `PERMISSIONS` follows the exact same pattern as every existing entry. Proceed directly to Step 6.2.

- [ ] **Step 6.2: Add `manage_backlog` to `CapabilityKey` and `PERMISSIONS`**

In `apps/web/lib/permissions.ts`:

1. Add `"manage_backlog"` to the `CapabilityKey` union type (after `"manage_provider_connections"`):

```ts
export type CapabilityKey =
  | "view_ea_modeler"
  | "view_portfolio"
  | "view_inventory"
  | "view_employee"
  | "view_customer"
  | "view_operations"
  | "view_platform"
  | "view_admin"
  | "manage_branding"
  | "manage_taxonomy"
  | "manage_agents"
  | "manage_capabilities"
  | "manage_users"
  | "manage_provider_connections"
  | "manage_backlog";
```

2. Add `manage_backlog` to `PERMISSIONS` (after `manage_provider_connections`):

```ts
  manage_backlog:              { roles: ["HR-000", "HR-500"] },
```

(HR-000 = superuser admin, HR-500 = operations role — matches `view_operations` scope.)

- [ ] **Step 6.3: TypeCheck**

```bash
pnpm --filter web typecheck
```

Expected: 0 errors.

- [ ] **Step 6.4: Run all tests**

```bash
pnpm --filter web test
```

Expected: all pass.

- [ ] **Step 6.5: Commit**

```bash
git add apps/web/lib/permissions.ts
git commit -m "feat(web): add manage_backlog permission (HR-000, HR-500)"
```

---

### Task 7: Server Actions — `lib/actions/backlog.ts`

**Files:**
- Create: `apps/web/lib/actions/backlog.ts`

- [ ] **Step 7.1: Create the actions file**

Create directory `apps/web/lib/actions/` (it does not exist yet), then create `apps/web/lib/actions/backlog.ts`:

```ts
"use server";

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { validateBacklogInput, type BacklogItemInput } from "@/lib/backlog";

async function requireManageBacklog(): Promise<void> {
  const session = await auth();
  const user = session?.user;
  if (
    !user ||
    !can(
      { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
      "manage_backlog"
    )
  ) {
    throw new Error("Unauthorized");
  }
}

export async function createBacklogItem(input: BacklogItemInput): Promise<void> {
  await requireManageBacklog();
  const error = validateBacklogInput(input);
  if (error) throw new Error(error);

  await prisma.backlogItem.create({
    data: {
      itemId:          `BI-${Date.now()}`,
      title:           input.title.trim(),
      type:            input.type,
      status:          input.status,
      body:            input.body?.trim() || null,
      priority:        input.priority ?? null,
      taxonomyNodeId:  input.taxonomyNodeId ?? null,
      digitalProductId: input.digitalProductId ?? null,
    },
  });
}

export async function updateBacklogItem(id: string, input: BacklogItemInput): Promise<void> {
  await requireManageBacklog();
  const error = validateBacklogInput(input);
  if (error) throw new Error(error);

  await prisma.backlogItem.update({
    where: { id },
    data: {
      title:           input.title.trim(),
      type:            input.type,
      status:          input.status,
      body:            input.body?.trim() || null,
      priority:        input.priority ?? null,
      taxonomyNodeId:  input.taxonomyNodeId ?? null,
      digitalProductId: input.digitalProductId ?? null,
    },
  });
}

export async function deleteBacklogItem(id: string): Promise<void> {
  await requireManageBacklog();
  await prisma.backlogItem.delete({ where: { id } });
}
```

- [ ] **Step 7.2: TypeCheck**

```bash
pnpm --filter web typecheck
```

Expected: 0 errors.

- [ ] **Step 7.3: Commit**

```bash
git add apps/web/lib/actions/backlog.ts
git commit -m "feat(web): server actions — createBacklogItem, updateBacklogItem, deleteBacklogItem"
```

---

## Chunk 4: UI Components and Page

### Task 8: `BacklogItemRow` Client Component

**Files:**
- Create: `apps/web/components/ops/BacklogItemRow.tsx`

Single row in the backlog list. Handles inline delete confirm and fires edit callback.

- [ ] **Step 8.1: Create `apps/web/components/ops/BacklogItemRow.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteBacklogItem } from "@/lib/actions/backlog";
import { BACKLOG_STATUS_COLOURS, type BacklogItemWithRelations } from "@/lib/backlog";

type Props = {
  item: BacklogItemWithRelations;
  onEdit: (item: BacklogItemWithRelations) => void;
};

export function BacklogItemRow({ item, onEdit }: Props) {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      await deleteBacklogItem(item.id);
      router.refresh();
    });
  }

  const statusColour = BACKLOG_STATUS_COLOURS[item.status] ?? "#555566";

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]">
      {/* Priority badge */}
      <span className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-[10px] font-mono bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">
        {item.priority ?? "—"}
      </span>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white leading-tight truncate">{item.title}</p>
        <p className="text-[10px] text-[var(--dpf-muted)] mt-0.5 truncate">
          {item.taxonomyNode?.nodeId ?? "—"}
          {item.digitalProduct ? ` · ${item.digitalProduct.name}` : ""}
        </p>
      </div>

      {/* Status badge */}
      <span
        className="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded"
        style={{ backgroundColor: `${statusColour}22`, color: statusColour }}
      >
        {item.status}
      </span>

      {/* Actions */}
      <div className="shrink-0 flex items-center gap-1">
        {confirmDelete ? (
          <>
            <button
              onClick={handleDelete}
              disabled={isPending}
              className="text-[10px] text-red-400 hover:text-red-300 px-1"
            >
              {isPending ? "…" : "confirm"}
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="text-[10px] text-[var(--dpf-muted)] hover:text-white px-1"
            >
              cancel
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => onEdit(item)}
              className="text-[10px] text-[var(--dpf-muted)] hover:text-white px-1"
              aria-label="Edit"
            >
              edit
            </button>
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-[10px] text-[var(--dpf-muted)] hover:text-red-400 px-1"
              aria-label="Delete"
            >
              del
            </button>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 8.2: TypeCheck**

```bash
pnpm --filter web typecheck
```

Expected: 0 errors.

- [ ] **Step 8.3: Commit**

```bash
git add apps/web/components/ops/BacklogItemRow.tsx
git commit -m "feat(web): BacklogItemRow client component with inline delete confirm"
```

---

### Task 9: `BacklogPanel` Client Component

**Files:**
- Create: `apps/web/components/ops/BacklogPanel.tsx`

Right-side slide panel. Create mode (no `item` prop) and edit mode (with `item`).

- [ ] **Step 9.1: Create `apps/web/components/ops/BacklogPanel.tsx`**

```tsx
"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createBacklogItem, updateBacklogItem } from "@/lib/actions/backlog";
import { validateBacklogInput, type BacklogItemInput, type BacklogItemWithRelations, type DigitalProductSelect, type TaxonomyNodeSelect } from "@/lib/backlog";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  item?: BacklogItemWithRelations;
  defaultType?: "portfolio" | "product";
  digitalProducts: DigitalProductSelect[];
  taxonomyNodes: TaxonomyNodeSelect[];
};

function emptyForm(type: "portfolio" | "product" = "portfolio"): BacklogItemInput {
  return { title: "", type, status: "open", priority: undefined, body: "", taxonomyNodeId: undefined, digitalProductId: undefined };
}

export function BacklogPanel({ isOpen, onClose, item, defaultType, digitalProducts, taxonomyNodes }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<BacklogItemInput>(() => emptyForm(defaultType));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Populate form when switching between create/edit
  useEffect(() => {
    if (item) {
      setForm({
        title:           item.title,
        type:            item.type as "product" | "portfolio",
        status:          item.status as BacklogItemInput["status"],
        priority:        item.priority ?? undefined,
        body:            item.body ?? "",
        taxonomyNodeId:  item.taxonomyNode?.id ?? undefined,
        digitalProductId: item.digitalProduct?.id ?? undefined,
      });
    } else {
      setForm(emptyForm(defaultType));
    }
    setError(null);
  }, [item, isOpen, defaultType]);

  function set<K extends keyof BacklogItemInput>(key: K, value: BacklogItemInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validationError = validateBacklogInput(form);
    if (validationError) { setError(validationError); return; }
    setError(null);

    startTransition(async () => {
      try {
        if (item) {
          await updateBacklogItem(item.id, form);
        } else {
          await createBacklogItem(form);
        }
        router.refresh();
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    });
  }

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-96 bg-[var(--dpf-surface-1)] border-l border-[var(--dpf-border)] z-50 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--dpf-border)]">
          <h2 className="text-sm font-semibold text-white">
            {item ? "Edit Backlog Item" : "New Backlog Item"}
          </h2>
          <button onClick={onClose} className="text-[var(--dpf-muted)] hover:text-white text-lg leading-none">×</button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          {/* Title */}
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Title *</span>
            <input
              type="text"
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              className="bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded px-3 py-2 text-sm text-white placeholder:text-[var(--dpf-muted)] focus:outline-none focus:border-[var(--dpf-accent)]"
              placeholder="What needs to be done?"
              required
            />
          </label>

          {/* Type */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Type</span>
            <div className="flex rounded overflow-hidden border border-[var(--dpf-border)]">
              {(["portfolio", "product"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    set("type", t);
                    if (t === "portfolio") set("digitalProductId", undefined);
                  }}
                  className={`flex-1 py-1.5 text-xs font-semibold transition-colors ${
                    form.type === t
                      ? "bg-[var(--dpf-accent)] text-white"
                      : "bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)] hover:text-white"
                  }`}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Status */}
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Status</span>
            <select
              value={form.status}
              onChange={(e) => set("status", e.target.value as BacklogItemInput["status"])}
              className="bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[var(--dpf-accent)]"
            >
              <option value="open">Open</option>
              <option value="in-progress">In Progress</option>
              <option value="done">Done</option>
              <option value="deferred">Deferred</option>
            </select>
          </label>

          {/* Priority */}
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Priority (lower = higher)</span>
            <input
              type="number"
              min={1}
              value={form.priority ?? ""}
              onChange={(e) => set("priority", e.target.value ? Number(e.target.value) : undefined)}
              className="bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[var(--dpf-accent)]"
              placeholder="Optional"
            />
          </label>

          {/* Taxonomy Node */}
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Ownership Domain</span>
            <select
              value={form.taxonomyNodeId ?? ""}
              onChange={(e) => set("taxonomyNodeId", e.target.value || undefined)}
              className="bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[var(--dpf-accent)]"
            >
              <option value="">— select node —</option>
              {taxonomyNodes.map((n) => (
                <option key={n.id} value={n.id}>{n.nodeId}</option>
              ))}
            </select>
          </label>

          {/* Digital Product (product-type only) */}
          {form.type === "product" && (
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Digital Product *</span>
              <select
                value={form.digitalProductId ?? ""}
                onChange={(e) => set("digitalProductId", e.target.value || undefined)}
                className="bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[var(--dpf-accent)]"
                required
              >
                <option value="">— select product —</option>
                {digitalProducts.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.lifecycleStage})</option>
                ))}
              </select>
            </label>
          )}

          {/* Body */}
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Notes</span>
            <textarea
              value={form.body ?? ""}
              onChange={(e) => set("body", e.target.value)}
              rows={4}
              className="bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded px-3 py-2 text-sm text-white placeholder:text-[var(--dpf-muted)] focus:outline-none focus:border-[var(--dpf-accent)] resize-none"
              placeholder="Optional notes…"
            />
          </label>

          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}
        </form>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-[var(--dpf-border)] flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2 rounded border border-[var(--dpf-border)] text-xs text-[var(--dpf-muted)] hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isPending}
            className="flex-1 py-2 rounded bg-[var(--dpf-accent)] text-xs text-white font-semibold hover:opacity-90 disabled:opacity-50"
          >
            {isPending ? "Saving…" : item ? "Save Changes" : "Create Item"}
          </button>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 9.2: TypeCheck**

```bash
pnpm --filter web typecheck
```

Expected: 0 errors.

- [ ] **Step 9.3: Commit**

```bash
git add apps/web/components/ops/BacklogPanel.tsx
git commit -m "feat(web): BacklogPanel slide-panel form for create/edit backlog items"
```

---

### Task 10: `OpsClient` — State Wrapper

**Files:**
- Create: `apps/web/components/ops/OpsClient.tsx`

Holds `panelState`, renders sections with "Add item" buttons, `BacklogItemRow` list, and `BacklogPanel`.

- [ ] **Step 10.1: Create `apps/web/components/ops/OpsClient.tsx`**

```tsx
"use client";

import { useState } from "react";
import { BacklogPanel } from "./BacklogPanel";
import { BacklogItemRow } from "./BacklogItemRow";
import type { BacklogItemWithRelations, DigitalProductSelect, TaxonomyNodeSelect } from "@/lib/backlog";

type PanelState = {
  open: boolean;
  item?: BacklogItemWithRelations;
  defaultType?: "portfolio" | "product";
};

type Props = {
  items: BacklogItemWithRelations[];
  digitalProducts: DigitalProductSelect[];
  taxonomyNodes: TaxonomyNodeSelect[];
};

const TYPE_LABELS: Record<string, string> = {
  portfolio: "Portfolio Backlog",
  product:   "Product Backlog",
};

export function OpsClient({ items, digitalProducts, taxonomyNodes }: Props) {
  const [panel, setPanel] = useState<PanelState>({ open: false });

  const types = ["portfolio", "product"] as const;
  const byType = new Map(types.map((t) => [t, items.filter((i) => i.type === t)]));

  // defaultType pre-selects the type toggle so "Add item" under Product Backlog opens
  // the panel already in product mode rather than defaulting to portfolio every time.
  function openCreate(defaultType: "portfolio" | "product") {
    setPanel({ open: true, item: undefined, defaultType });
  }
  function openEdit(item: BacklogItemWithRelations) { setPanel({ open: true, item }); }
  function closePanel() { setPanel({ open: false }); }

  return (
    <>
      {types.map((t) => {
        const typeItems = byType.get(t) ?? [];
        const label = TYPE_LABELS[t] ?? t;

        return (
          <section key={t} className="mb-8">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-widest">
                {label}
                <span className="ml-2 text-[var(--dpf-muted)] normal-case font-normal">
                  {typeItems.length}
                </span>
              </h2>
              <button
                onClick={() => openCreate(t)}
                className="text-[10px] font-semibold text-[var(--dpf-accent)] hover:opacity-80"
              >
                + Add item
              </button>
            </div>
            {typeItems.length === 0 ? (
              <p className="text-xs text-[var(--dpf-muted)]">No {label.toLowerCase()} items.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {typeItems.map((item) => (
                  <BacklogItemRow key={item.id} item={item} onEdit={openEdit} />
                ))}
              </div>
            )}
          </section>
        );
      })}

      {items.length === 0 && (
        <p className="text-sm text-[var(--dpf-muted)]">No backlog items yet.</p>
      )}

      <BacklogPanel
        isOpen={panel.open}
        onClose={closePanel}
        item={panel.item}
        defaultType={panel.defaultType}
        digitalProducts={digitalProducts}
        taxonomyNodes={taxonomyNodes}
      />
    </>
  );
}
```

- [ ] **Step 10.2: TypeCheck**

```bash
pnpm --filter web typecheck
```

Expected: 0 errors.

- [ ] **Step 10.3: Commit**

```bash
git add apps/web/components/ops/OpsClient.tsx
git commit -m "feat(web): OpsClient — panel state wrapper, section headers with Add button"
```

---

### Task 11: Update `/ops` Page

**Files:**
- Modify: `apps/web/app/(shell)/ops/page.tsx`

Replace the current read-only server component with one that fetches via `backlog-data.ts` and delegates rendering to `OpsClient`.

- [ ] **Step 11.1: Replace `apps/web/app/(shell)/ops/page.tsx`**

```tsx
// apps/web/app/(shell)/ops/page.tsx
import { getBacklogItems, getDigitalProductsForSelect, getTaxonomyNodesFlat } from "@/lib/backlog-data";
import { OpsClient } from "@/components/ops/OpsClient";

export default async function OpsPage() {
  const [items, digitalProducts, taxonomyNodes] = await Promise.all([
    getBacklogItems(),
    getDigitalProductsForSelect(),
    getTaxonomyNodesFlat(),
  ]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Operations</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          {items.length} item{items.length !== 1 ? "s" : ""}
        </p>
      </div>

      <OpsClient
        items={items}
        digitalProducts={digitalProducts}
        taxonomyNodes={taxonomyNodes}
      />
    </div>
  );
}
```

- [ ] **Step 11.2: TypeCheck**

```bash
pnpm --filter web typecheck
```

Expected: 0 errors.

- [ ] **Step 11.3: Run all tests**

```bash
pnpm test
```

Expected: all tests pass (26+ tests).

- [ ] **Step 11.4: Commit**

```bash
git add apps/web/app/(shell)/ops/page.tsx
git commit -m "feat(web): /ops page — server data fetch + OpsClient interactive CRUD"
```

---

## Chunk 5: Seed — DPF Self-Registration

### Task 12: `seedDpfSelfRegistration()` in `seed.ts`

**Files:**
- Modify: `packages/db/src/seed.ts`

Add a function that registers the DPF Portal as a managed DigitalProduct and seeds its backlog items. All upserted on natural keys — idempotent.

- [ ] **Step 12.1: Add the seed function**

In `packages/db/src/seed.ts`, add the following function before `main()`:

```ts
async function seedDpfSelfRegistration(): Promise<void> {
  // Resolve the manufacturing_and_delivery portfolio and taxonomy node
  const portfolio = await prisma.portfolio.findUnique({
    where: { slug: "manufacturing_and_delivery" },
  });
  if (!portfolio) throw new Error("manufacturing_and_delivery portfolio not seeded");

  const taxonomyNode = await prisma.taxonomyNode.findUnique({
    where: { nodeId: "manufacturing_and_delivery" },
  });
  if (!taxonomyNode) throw new Error("manufacturing_and_delivery taxonomy node not seeded");

  // Register DPF Portal as a DigitalProduct
  const dpfPortal = await prisma.digitalProduct.upsert({
    where: { productId: "dpf-portal" },
    update: {
      name:           "Digital Product Factory Portal",
      lifecycleStage: "production",
      lifecycleStatus: "active",
      portfolioId:    portfolio.id,
      taxonomyNodeId: taxonomyNode.id,
    },
    create: {
      productId:      "dpf-portal",
      name:           "Digital Product Factory Portal",
      lifecycleStage: "production",
      lifecycleStatus: "active",
      portfolioId:    portfolio.id,
      taxonomyNodeId: taxonomyNode.id,
    },
    select: { id: true },
  });

  // Portfolio-type backlog items — strategic, domain-wide
  const portfolioItems = [
    { itemId: "BI-PORT-001", title: "Establish Digital Product Factory in Manufacture and Delivery Portfolio", status: "done",        priority: 1 },
    { itemId: "BI-PORT-002", title: "Implement DPPM taxonomy — 481-node portfolio ownership graph",          status: "done",        priority: 2 },
    { itemId: "BI-PORT-003", title: "Portfolio route — browsable portfolio tree with node detail",           status: "done",        priority: 3 },
    { itemId: "BI-PORT-004", title: "Backlog system — portfolio and product context per IT4IT",              status: "in-progress", priority: 4 },
  ];

  for (const item of portfolioItems) {
    await prisma.backlogItem.upsert({
      where: { itemId: item.itemId },
      update: { title: item.title, status: item.status, priority: item.priority, type: "portfolio", taxonomyNodeId: taxonomyNode.id },
      create: { itemId: item.itemId, title: item.title, status: item.status, priority: item.priority, type: "portfolio", taxonomyNodeId: taxonomyNode.id },
    });
  }

  // Product-type backlog items — linked to dpf-portal
  const productItems = [
    { itemId: "BI-PROD-001", title: "Phase 5A — Backlog CRUD in /ops",                                    status: "in-progress", priority: 1 },
    { itemId: "BI-PROD-002", title: "Phase 5B — DPF self-registration as managed digital product",        status: "in-progress", priority: 2 },
    { itemId: "BI-PROD-003", title: "Phase 2B — Live Agent counts and Health metrics in portfolio panels", status: "open",        priority: 3 },
  ];

  for (const item of productItems) {
    await prisma.backlogItem.upsert({
      where: { itemId: item.itemId },
      update: { title: item.title, status: item.status, priority: item.priority, type: "product", digitalProductId: dpfPortal.id, taxonomyNodeId: taxonomyNode.id },
      create: { itemId: item.itemId, title: item.title, status: item.status, priority: item.priority, type: "product", digitalProductId: dpfPortal.id, taxonomyNodeId: taxonomyNode.id },
    });
  }

  console.log("Seeded DPF Portal digital product and 7 backlog items");
}
```

- [ ] **Step 12.2: Call `seedDpfSelfRegistration()` from `main()`**

First, verify the current `main()` body in `seed.ts` — confirm `seedRoles`, `seedPortfolios`, `seedAgents`, `seedTaxonomyNodes`, `seedDigitalProducts`, and `seedDefaultAdminUser` are all present. Then add `seedDpfSelfRegistration()` after `seedDigitalProducts()`:

```ts
async function main(): Promise<void> {
  console.log("Starting seed...");
  await seedRoles();
  await seedPortfolios();
  await seedAgents();
  await seedTaxonomyNodes();
  await seedDigitalProducts();
  await seedDpfSelfRegistration();   // ← add this line
  await seedDefaultAdminUser();
  console.log("Seed complete.");
}
```

- [ ] **Step 12.3: TypeCheck**

```bash
pnpm --filter @dpf/db typecheck
```

Expected: 0 errors.

- [ ] **Step 12.4: Run the seed**

```bash
pnpm --filter @dpf/db seed
```

Expected output includes:
```
Seeded DPF Portal digital product and 7 backlog items
Seed complete.
```

- [ ] **Step 12.5: Run all tests**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 12.6: Commit**

```bash
git add packages/db/src/seed.ts
git commit -m "feat(db): seed DPF Portal as managed DigitalProduct + 7 backlog items (self-registration)"
```

---

## Verification

After all chunks complete:

- [ ] Start the dev server: `pnpm --filter web dev`
- [ ] Sign in as `admin@dpf.local`
- [ ] Navigate to `/ops`
- [ ] Confirm: two sections visible (Portfolio Backlog with 4 items, Product Backlog with 3 items)
- [ ] Confirm: "Add item" button opens the slide panel
- [ ] Create a new portfolio-type item — confirm it appears in the list after submit
- [ ] Edit an existing item — confirm changes persist
- [ ] Delete an item — confirm inline confirm → item removed
- [ ] Confirm: 0 TypeScript errors (`pnpm typecheck`)
- [ ] Confirm: all tests pass (`pnpm test`)
