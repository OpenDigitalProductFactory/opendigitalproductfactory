# Phase 4B — Customer Route Design

**Date:** 2026-03-11
**Status:** Draft
**Scope:** Add a `/customer` route — a CRM account registry showing all customer accounts with their status and contact counts.

---

## Overview

The Customer route shows the external-facing layer of the platform — a registry of all `CustomerAccount` records created through the CRM. Each account shows its business status and how many contacts are associated.

This is a read-only view of the `CustomerAccount` table (seeded empty; new accounts are created through future intake flows).

**Navigation:** The workspace tile already links to `/customer`. No header nav change.

---

## Route Structure

```
app/(shell)/
  customer/
    layout.tsx     — auth gate: view_customer (HR-000, HR-200)
    page.tsx       — server component; lists all customer accounts
```

Uses the existing `(shell)` layout. No sidebar.

---

## Data

One Prisma query with `_count`:

```ts
const accounts = await prisma.customerAccount.findMany({
  orderBy: { name: "asc" },
  select: {
    id: true,
    accountId: true,
    name: true,
    status: true,
    _count: { select: { contacts: true } },
  },
});
```

`status` values expected: `"prospect"` (default), `"active"`, `"inactive"`.

---

## Page Layout

```
/customer

[heading] Customer
[subheading] N accounts

[grid of account cards — 1-col sm:2-col]
```

Accounts ordered by `name` ascending.

### Account card fields

| Field | Rendering |
|---|---|
| `accountId` | Top; monospace (`font-mono`), `text-[9px]`, muted |
| `name` | Bold (`font-semibold`), white, `text-sm` |
| `status` | Status badge: `text-[9px] px-1.5 py-0.5 rounded-full`, colour-coded (see below) |
| Contact count | `text-[9px]`, muted: `"N contacts"` or `"No contacts"` if zero |

Status colours:
```ts
const STATUS_COLOURS: Record<string, string> = {
  prospect: "#fbbf24",  // amber-400
  active:   "#4ade80",  // green-400
};
// fallback: "#555566"
```

Card left-border colour: fixed `"#f472b6"` (the `customer` workspace tile accent colour) for all account cards.

Cards are not links — no account detail page in Phase 4B.

---

## What Changes

### 1. `customer/layout.tsx` — auth gate

`apps/web/app/(shell)/customer/layout.tsx`

```tsx
// apps/web/app/(shell)/customer/layout.tsx
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";

export default async function CustomerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (
    !session?.user ||
    !can(
      { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
      "view_customer"
    )
  ) {
    notFound();
  }

  return <>{children}</>;
}
```

### 2. `customer/page.tsx` — new route

`apps/web/app/(shell)/customer/page.tsx`

```tsx
// apps/web/app/(shell)/customer/page.tsx
import { prisma } from "@dpf/db";

const STATUS_COLOURS: Record<string, string> = {
  prospect: "#fbbf24",
  active:   "#4ade80",
};

export default async function CustomerPage() {
  const accounts = await prisma.customerAccount.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      accountId: true,
      name: true,
      status: true,
      _count: { select: { contacts: true } },
    },
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Customer</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          {accounts.length} account{accounts.length !== 1 ? "s" : ""}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {accounts.map((a) => {
          const contactCount = a._count.contacts;
          const statusColour = STATUS_COLOURS[a.status] ?? "#555566";

          return (
            <div
              key={a.id}
              className="p-4 rounded-lg bg-[var(--dpf-surface-1)] border-l-4"
              style={{ borderLeftColor: "#f472b6" }}
            >
              <p className="text-[9px] font-mono text-[var(--dpf-muted)] mb-1">
                {a.accountId}
              </p>
              <div className="flex items-start justify-between gap-2 mb-2">
                <p className="text-sm font-semibold text-white leading-tight">
                  {a.name}
                </p>
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0"
                  style={{ background: `${statusColour}20`, color: statusColour }}
                >
                  {a.status}
                </span>
              </div>
              <p className="text-[9px] text-[var(--dpf-muted)]">
                {contactCount === 0 ? "No contacts" : `${contactCount} ${contactCount === 1 ? "contact" : "contacts"}`}
              </p>
            </div>
          );
        })}
      </div>

      {accounts.length === 0 && (
        <p className="text-sm text-[var(--dpf-muted)]">No accounts registered yet.</p>
      )}
    </div>
  );
}
```

---

## Auth

`customer/layout.tsx` uses `view_customer` which allows `HR-000` (CDIO) and `HR-200` (Digital Product Managers) plus superusers.

---

## Files to Create

| File | Action |
|---|---|
| `apps/web/app/(shell)/customer/layout.tsx` | Create auth gate |
| `apps/web/app/(shell)/customer/page.tsx` | Create new page |

No existing files need modification.

---

## Testing

No new unit tests. TypeScript check validates the Prisma query shape.

---

## What This Does Not Include

- Account detail page (future)
- Contact list per account (future)
- Account create/edit (out of scope for read-only views)
- Filtering by status (future)
