# Phase 4C — Ops Route Design

**Date:** 2026-03-11
**Status:** Draft
**Scope:** Add a `/ops` route — an operations backlog registry showing all `BacklogItem` records grouped by type.

---

## Overview

The Ops route shows the operational backlog — a registry of `BacklogItem` records (product and portfolio backlog items). This gives Operations Managers visibility into what is queued for action.

This is a read-only view of the `BacklogItem` table (seeded empty; backlog items are created through future intake flows).

**Navigation:** The workspace tile already links to `/ops`. No header nav change.

---

## Route Structure

```
app/(shell)/
  ops/
    layout.tsx     — auth gate: view_operations (HR-000, HR-500)
    page.tsx       — server component; lists all backlog items grouped by type
```

Uses the existing `(shell)` layout. No sidebar.

---

## Data

One Prisma query:

```ts
const items = await prisma.backlogItem.findMany({
  orderBy: [{ type: "asc" }, { createdAt: "desc" }],
  select: {
    id: true,
    itemId: true,
    title: true,
    status: true,
    type: true,
  },
});
```

Group by `type` after the query:

```ts
const byType = {
  product:   items.filter((i) => i.type === "product"),
  portfolio: items.filter((i) => i.type === "portfolio"),
};
```

`type` values: `"product"` | `"portfolio"`. `status` values: any string (no enum constraint in schema).

---

## Page Layout

```
/ops

[heading] Operations
[subheading] N items

[section heading] Product Backlog
[grid of item cards]

[section heading] Portfolio Backlog
[grid of item cards]
```

Sections are only rendered if they have at least one item. Grid: `grid-cols-1 sm:grid-cols-2`.

### Item card fields

| Field | Rendering |
|---|---|
| `itemId` | Top; monospace (`font-mono`), `text-[9px]`, muted |
| `title` | Bold (`font-semibold`), white, `text-sm` |
| `status` | `text-[9px]`, muted |

Card left-border colour: fixed `"#38bdf8"` (the `operations` workspace tile accent colour) for all cards.

Cards are not links — no item detail page in Phase 4C.

---

## What Changes

### 1. `ops/layout.tsx` — auth gate

`apps/web/app/(shell)/ops/layout.tsx`

```tsx
// apps/web/app/(shell)/ops/layout.tsx
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";

export default async function OpsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (
    !session?.user ||
    !can(
      { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
      "view_operations"
    )
  ) {
    notFound();
  }

  return <>{children}</>;
}
```

### 2. `ops/page.tsx` — new route

`apps/web/app/(shell)/ops/page.tsx`

```tsx
// apps/web/app/(shell)/ops/page.tsx
import { prisma } from "@dpf/db";

const TYPE_LABELS: Record<string, string> = {
  product:   "Product Backlog",
  portfolio: "Portfolio Backlog",
};

export default async function OpsPage() {
  const items = await prisma.backlogItem.findMany({
    orderBy: [{ type: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      itemId: true,
      title: true,
      status: true,
      type: true,
    },
  });

  const types = ["product", "portfolio"] as const;
  const byType = new Map(types.map((t) => [t, items.filter((i) => i.type === t)]));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Operations</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          {items.length} item{items.length !== 1 ? "s" : ""}
        </p>
      </div>

      {types.map((t) => {
        const typeItems = byType.get(t) ?? [];
        if (typeItems.length === 0) return null;

        const typeLabel = TYPE_LABELS[t] ?? t;

        return (
          <section key={t} className="mb-8">
            <h2 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-widest mb-3">
              {typeLabel}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {typeItems.map((item) => (
                <div
                  key={item.id}
                  className="p-4 rounded-lg bg-[var(--dpf-surface-1)] border-l-4"
                  style={{ borderLeftColor: "#38bdf8" }}
                >
                  <p className="text-[9px] font-mono text-[var(--dpf-muted)] mb-1">
                    {item.itemId}
                  </p>
                  <p className="text-sm font-semibold text-white leading-tight mb-1">
                    {item.title}
                  </p>
                  <p className="text-[9px] text-[var(--dpf-muted)]">{item.status}</p>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {items.length === 0 && (
        <p className="text-sm text-[var(--dpf-muted)]">No backlog items yet.</p>
      )}
    </div>
  );
}
```

---

## Auth

`ops/layout.tsx` uses `view_operations` which allows `HR-000` (CDIO) and `HR-500` (Operations Manager) plus superusers.

---

## Files to Create

| File | Action |
|---|---|
| `apps/web/app/(shell)/ops/layout.tsx` | Create auth gate |
| `apps/web/app/(shell)/ops/page.tsx` | Create new page |

No existing files need modification.

---

## Testing

No new unit tests. TypeScript check validates the Prisma query shape.

---

## What This Does Not Include

- Item detail page (future)
- Status filtering (future)
- Item create/edit (out of scope for read-only views)
- `body` field (omitted — potentially verbose; summary view only)
