# Phase 4A — Employee Route Design

**Date:** 2026-03-11
**Status:** Draft
**Scope:** Add a `/employee` route — an organisational role registry showing all platform roles with authority domains, HITL tiers, SLA targets, and human assignment counts.

---

## Overview

The EA route shows the AI agent layer. The Employee route shows the human layer — the six platform roles that govern and supervise the Digital Product Factory, alongside how many people are assigned to each role.

This is a read-only view of the `PlatformRole` table, which is already seeded.

**Navigation:** The nav already shows `/employee` as a workspace tile. No header nav change needed — the global nav (`My Workspace | Portfolio | Inventory | EA`) is fixed; the workspace tiles cover additional routes.

---

## Route Structure

```
app/(shell)/
  employee/
    layout.tsx     — auth gate: view_employee (all HR roles)
    page.tsx       — server component; lists all platform roles
```

Uses the existing `(shell)` layout. No sidebar. Auth gate uses `view_employee` which grants access to all 6 HR roles (`HR-000` through `HR-500`).

---

## Data

One Prisma query with `_count`:

```ts
const roles = await prisma.platformRole.findMany({
  orderBy: { roleId: "asc" },
  select: {
    id: true,
    roleId: true,
    name: true,
    description: true,
    hitlTierMin: true,
    slaDurationH: true,
    _count: { select: { users: true } },
  },
});
```

`hitlTierMin` — 0 means highest authority (no HITL escalation threshold). `slaDurationH` — `-1` or null means no fixed SLA.

No React cache needed — role data is not shared with any layout.

---

## Page Layout

```
/employee

[heading] Employee
[subheading] N roles

[grid of role cards — 1-col sm:2-col]
```

Roles are ordered by `roleId` ascending (HR-000 first = most senior).

### Role card fields

| Field | Rendering |
|---|---|
| `roleId` | Top; monospace (`font-mono`), `text-[9px]`, muted |
| `name` | Bold (`font-semibold`), white, `text-sm` |
| `description` | If not null: `text-[10px]`, muted, clamped to 2 lines (`line-clamp-2`) |
| HITL tier | `text-[9px]`, muted: `"HITL T${hitlTierMin}"` |
| SLA | If `slaDurationH` is not null and > 0: `"${slaDurationH}h SLA"` in muted; otherwise `"No SLA"` |
| User count | `text-[9px]`, muted: `"${userCount} people"` or `"Unassigned"` if zero |

Card left-border colour: fixed `"#7c8cf8"` (the platform accent colour `--dpf-accent`) for all role cards — roles are platform-level, not portfolio-affiliated.

Cards are not links — no role detail page in Phase 4A.

---

## What Changes

### 1. `employee/layout.tsx` — auth gate

`apps/web/app/(shell)/employee/layout.tsx`

```tsx
// apps/web/app/(shell)/employee/layout.tsx
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";

export default async function EmployeeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (
    !session?.user ||
    !can(
      { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
      "view_employee"
    )
  ) {
    notFound();
  }

  return <>{children}</>;
}
```

### 2. `employee/page.tsx` — new route

`apps/web/app/(shell)/employee/page.tsx`

```tsx
// apps/web/app/(shell)/employee/page.tsx
import { prisma } from "@dpf/db";

export default async function EmployeePage() {
  const roles = await prisma.platformRole.findMany({
    orderBy: { roleId: "asc" },
    select: {
      id: true,
      roleId: true,
      name: true,
      description: true,
      hitlTierMin: true,
      slaDurationH: true,
      _count: { select: { users: true } },
    },
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Employee</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          {roles.length} role{roles.length !== 1 ? "s" : ""}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {roles.map((r) => {
          const userCount = r._count.users;
          const sla =
            r.slaDurationH != null && r.slaDurationH > 0
              ? `${r.slaDurationH}h SLA`
              : "No SLA";

          return (
            <div
              key={r.id}
              className="p-4 rounded-lg bg-[var(--dpf-surface-1)] border-l-4"
              style={{ borderLeftColor: "#7c8cf8" }}
            >
              <p className="text-[9px] font-mono text-[var(--dpf-muted)] mb-1">
                {r.roleId}
              </p>
              <p className="text-sm font-semibold text-white leading-tight mb-1">
                {r.name}
              </p>
              {r.description != null && (
                <p className="text-[10px] text-[var(--dpf-muted)] line-clamp-2 mb-2">
                  {r.description}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <span className="text-[9px] text-[var(--dpf-muted)]">
                  HITL T{r.hitlTierMin}
                </span>
                <span className="text-[9px] text-[var(--dpf-muted)]">{sla}</span>
                <span className="text-[9px] text-[var(--dpf-muted)]">
                  {userCount === 0 ? "Unassigned" : `${userCount} ${userCount === 1 ? "person" : "people"}`}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {roles.length === 0 && (
        <p className="text-sm text-[var(--dpf-muted)]">No roles registered yet.</p>
      )}
    </div>
  );
}
```

---

## Auth

`employee/layout.tsx` uses `view_employee` which allows all six HR roles (`HR-000`, `HR-100`, `HR-200`, `HR-300`, `HR-400`, `HR-500`) plus superusers. This is the most broadly accessible capability in the system.

---

## Files to Create

| File | Action |
|---|---|
| `apps/web/app/(shell)/employee/layout.tsx` | Create auth gate |
| `apps/web/app/(shell)/employee/page.tsx` | Create new page |

No existing files need modification.

---

## Testing

No new unit tests. The page is a simple data fetch and render. TypeScript check validates the Prisma query shape (`_count.users`, all selected fields).

---

## What This Does Not Include

- User list (individual user names/emails — out of scope, potentially sensitive)
- Role detail page (future)
- Role assignment UI (out of scope for read-only views)
- Filtering by HITL tier or SLA (future)
- Edit/create role forms (out of scope)
