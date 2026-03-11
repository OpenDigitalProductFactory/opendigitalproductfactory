# Phase 4E — Admin Route Design

**Date:** 2026-03-11
**Status:** Draft
**Scope:** Add an `/admin` route — a user registry showing all platform users with their role assignments and active status.

---

## Overview

The Admin route shows the user layer of the platform — a registry of all `User` accounts with their platform role assignments and active status. This gives the CDIO visibility into who has access to the platform and in what capacity.

This is a read-only view of the `User` table joined to `UserGroup` (which provides role assignments).

**Navigation:** The workspace tile already links to `/admin`. No header nav change.

---

## Route Structure

```
app/(shell)/
  admin/
    layout.tsx     — auth gate: view_admin (HR-000 only)
    page.tsx       — server component; lists all users
```

Uses the existing `(shell)` layout. No sidebar.

---

## Data

One Prisma query:

```ts
const users = await prisma.user.findMany({
  orderBy: { email: "asc" },
  select: {
    id: true,
    email: true,
    isActive: true,
    isSuperuser: true,
    createdAt: true,
    groups: {
      select: {
        platformRole: { select: { roleId: true, name: true } },
      },
    },
  },
});
```

`groups` provides the list of role assignments for each user. A user may have zero or multiple roles.

---

## Page Layout

```
/admin

[heading] Admin
[subheading] N users

[grid of user cards — 1-col sm:2-col]
```

Users ordered by `email` ascending.

### User card fields

| Field | Rendering |
|---|---|
| `email` | Bold (`font-semibold`), white, `text-sm`, `truncate` |
| Status | `text-[9px] px-1.5 py-0.5 rounded-full`: `"active"` green / `"inactive"` muted |
| Superuser badge | If `isSuperuser`: `"superuser"` badge in amber |
| Roles | Each `roleId` in monospace `text-[9px]` muted; if no roles: `"No roles assigned"` in muted |

Status badge colours:
- `isActive === true` → `#4ade80` (green-400), label `"active"`
- `isActive === false` → `#555566`, label `"inactive"`

Superuser badge (only shown when `isSuperuser === true`):
- Colour: `#fbbf24` (amber-400)
- Label: `"superuser"`

Card left-border colour: fixed `"#555566"` (the `admin` workspace tile accent colour) for all user cards.

Cards are not links — no user detail page in Phase 4E.

---

## What Changes

### 1. `admin/layout.tsx` — auth gate

`apps/web/app/(shell)/admin/layout.tsx`

```tsx
// apps/web/app/(shell)/admin/layout.tsx
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (
    !session?.user ||
    !can(
      { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
      "view_admin"
    )
  ) {
    notFound();
  }

  return <>{children}</>;
}
```

### 2. `admin/page.tsx` — new route

`apps/web/app/(shell)/admin/page.tsx`

```tsx
// apps/web/app/(shell)/admin/page.tsx
import { prisma } from "@dpf/db";

export default async function AdminPage() {
  const users = await prisma.user.findMany({
    orderBy: { email: "asc" },
    select: {
      id: true,
      email: true,
      isActive: true,
      isSuperuser: true,
      createdAt: true,
      groups: {
        select: {
          platformRole: { select: { roleId: true, name: true } },
        },
      },
    },
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Admin</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          {users.length} user{users.length !== 1 ? "s" : ""}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {users.map((u) => {
          const statusColour = u.isActive ? "#4ade80" : "#555566";
          const statusLabel = u.isActive ? "active" : "inactive";

          return (
            <div
              key={u.id}
              className="p-4 rounded-lg bg-[var(--dpf-surface-1)] border-l-4"
              style={{ borderLeftColor: "#555566" }}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <p className="text-sm font-semibold text-white leading-tight truncate">
                  {u.email}
                </p>
                <div className="flex gap-1 shrink-0">
                  {u.isSuperuser && (
                    <span
                      className="text-[9px] px-1.5 py-0.5 rounded-full"
                      style={{ background: "#fbbf2420", color: "#fbbf24" }}
                    >
                      superuser
                    </span>
                  )}
                  <span
                    className="text-[9px] px-1.5 py-0.5 rounded-full"
                    style={{ background: `${statusColour}20`, color: statusColour }}
                  >
                    {statusLabel}
                  </span>
                </div>
              </div>
              {u.groups.length === 0 ? (
                <p className="text-[9px] text-[var(--dpf-muted)]">No roles assigned</p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {u.groups.map((g) => (
                    <span
                      key={g.platformRole.roleId}
                      className="text-[9px] font-mono text-[var(--dpf-muted)]"
                    >
                      {g.platformRole.roleId}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {users.length === 0 && (
        <p className="text-sm text-[var(--dpf-muted)]">No users registered yet.</p>
      )}
    </div>
  );
}
```

---

## Auth

`admin/layout.tsx` uses `view_admin` which allows only `HR-000` (CDIO) plus superusers. This is the most restricted capability in the system.

---

## Files to Create

| File | Action |
|---|---|
| `apps/web/app/(shell)/admin/layout.tsx` | Create auth gate |
| `apps/web/app/(shell)/admin/page.tsx` | Create new page |

No existing files need modification.

---

## Testing

No new unit tests. TypeScript check validates the Prisma query shape and the nested relation select.

---

## What This Does Not Include

- User detail page (future)
- Role assignment UI (out of scope for read-only views)
- User create/edit/deactivate (future admin actions)
- Password reset (future)
- Filtering by role or active status (future)
