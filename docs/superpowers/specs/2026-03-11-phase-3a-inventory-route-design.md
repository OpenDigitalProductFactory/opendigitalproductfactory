# Phase 3A — Inventory Route Design

**Date:** 2026-03-11
**Status:** Draft
**Scope:** Add a `/inventory` route — a product catalog listing all digital products with portfolio affiliation, taxonomy classification, and status. Also update `Header.tsx` to add Portfolio and Inventory to the navigation.

---

## Overview

The portfolio route shows the taxonomy structure. The inventory route shows the products themselves — a flat, scannable list of everything in the digital product registry, grouped by portfolio.

**Navigation updates:**
The current header nav shows `My Workspace | Directory | Activity`. Directory and Activity have no routes yet. This phase adds `Portfolio` and `Inventory` as real nav links, replacing the dead `Directory` and `Activity` links with live ones.

Updated nav: `My Workspace | Portfolio | Inventory`

---

## Route Structure

```
app/(shell)/
  inventory/
    page.tsx       — server component; lists all digital products
```

Uses the existing `(shell)` layout (Header + auth gate). No sidebar required — products are listed directly.

---

## Data

One Prisma query with includes:

```ts
const products = await prisma.digitalProduct.findMany({
  orderBy: [{ portfolio: { name: "asc" } }, { name: "asc" }],
  select: {
    id: true,
    name: true,
    status: true,
    portfolio: { select: { slug: true, name: true } },
    taxonomyNode: { select: { nodeId: true } },
  },
});
```

`productId` is not rendered and is omitted. `taxonomyNode.name` is not needed — only `nodeId` is used (to derive the breadcrumb-style path string and to build the link href).

No pagination needed at current scale (4 products). The query is in the page server component directly — no React cache needed (inventory is not shared with layout).

---

## Page Layout

```
/inventory

[heading] Inventory
[subheading] N products

[product cards — grid 1-col sm:2-col]
```

Each product card shows:
- Product name (bold, white)
- Status badge (colour-coded: `active` → green, `planned` → amber, anything else → grey)
- Portfolio name (with portfolio accent colour if portfolio exists)
- Taxonomy node path (if classified, show `nodeId` as breadcrumb-style string e.g. `foundational / compute`)

Card links to `/portfolio/${taxonomyNode.nodeId}` if classified, otherwise links to `/portfolio/${portfolio.slug}` if portfolio exists, otherwise no link.

---

## What Changes

### 1. `Header.tsx` — updated nav items

`apps/web/components/shell/Header.tsx`

Replace the `NAV_ITEMS` array:

```ts
// Before:
const NAV_ITEMS = [
  { label: "My Workspace", href: "/workspace" },
  { label: "Directory", href: "/directory" },
  { label: "Activity", href: "/activity" },
];

// After:
const NAV_ITEMS = [
  { label: "My Workspace", href: "/workspace" },
  { label: "Portfolio", href: "/portfolio" },
  { label: "Inventory", href: "/inventory" },
];
```

Note: The Header uses `activePath.startsWith(item.href)` ... actually it uses `activePath === item.href`. For Portfolio, this will only highlight when exactly at `/portfolio`. We need prefix-matching for Portfolio to highlight when deep in the taxonomy (e.g. `/portfolio/foundational/compute`).

Update the active check to use prefix-matching for Portfolio and Inventory while keeping exact-match for Workspace (more semantically robust as new routes are added):
```tsx
const active = item.href === "/workspace"
  ? activePath === item.href
  : activePath.startsWith(item.href);
```

### 2. `inventory/page.tsx` — new route

`apps/web/app/(shell)/inventory/page.tsx`

```tsx
// apps/web/app/(shell)/inventory/page.tsx
import Link from "next/link";
import { prisma } from "@dpf/db";
import { PORTFOLIO_COLOURS } from "@/lib/portfolio";

const STATUS_COLOURS: Record<string, string> = {
  active: "#4ade80",   // green-400
  planned: "#fbbf24",  // amber-400
};

export default async function InventoryPage() {
  const products = await prisma.digitalProduct.findMany({
    orderBy: [{ portfolio: { name: "asc" } }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      status: true,
      portfolio: { select: { slug: true, name: true } },
      taxonomyNode: { select: { nodeId: true } },
    },
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Inventory</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          {products.length} product{products.length !== 1 ? "s" : ""}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {products.map((p) => {
          const colour = p.portfolio ? (PORTFOLIO_COLOURS[p.portfolio.slug] ?? "#7c8cf8") : "#555566";
          const statusColour = STATUS_COLOURS[p.status] ?? "#555566";
          const href = p.taxonomyNode
            ? `/portfolio/${p.taxonomyNode.nodeId}`
            : p.portfolio
            ? `/portfolio/${p.portfolio.slug}`
            : null;
          const taxonomyPath = p.taxonomyNode
            ? p.taxonomyNode.nodeId.replace(/\//g, " / ")
            : null;

          const card = (
            <div
              className="p-4 rounded-lg bg-[var(--dpf-surface-1)] border-l-4"
              style={{ borderLeftColor: colour }}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <p className="text-sm font-semibold text-white leading-tight">{p.name}</p>
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0"
                  style={{ background: `${statusColour}20`, color: statusColour }}
                >
                  {p.status}
                </span>
              </div>
              {p.portfolio && (
                <p className="text-[10px] font-medium mb-0.5" style={{ color: colour }}>
                  {p.portfolio.name}
                </p>
              )}
              {taxonomyPath && (
                <p className="text-[9px] text-[var(--dpf-muted)] font-mono">{taxonomyPath}</p>
              )}
            </div>
          );

          return href ? (
            <Link
              key={p.id}
              href={href}
              className="block hover:opacity-80 transition-opacity"
            >
              {card}
            </Link>
          ) : (
            <div key={p.id}>{card}</div>
          );
        })}
      </div>

      {products.length === 0 && (
        <p className="text-sm text-[var(--dpf-muted)]">No products registered yet.</p>
      )}
    </div>
  );
}
```

---

## Auth

The `(shell)` layout already handles auth (redirects to `/login` if unauthenticated). No additional auth check needed on the inventory page — all authenticated users can see the product list.

---

## Files to Create / Modify

| File | Action |
|---|---|
| `apps/web/components/shell/Header.tsx` | Update `NAV_ITEMS` and active link logic |
| `apps/web/app/(shell)/inventory/page.tsx` | Create new page |

---

## Testing

No new unit tests. The page is a simple data fetch + render. TypeScript check validates the Prisma query shape and prop types.

---

## What This Does Not Include

- Filtering/sorting UI (future)
- Pagination (not needed at current scale)
- Product detail page (future)
- `/ea` route (separate spec)
- Product create/edit (out of scope for read-only views)
