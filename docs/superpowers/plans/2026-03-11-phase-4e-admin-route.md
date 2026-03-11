# Phase 4E — Admin Route Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/admin` route showing all platform users with their role assignments and active status.

**Architecture:** Two-file change: create `admin/layout.tsx` (auth gate using `view_admin`) and `admin/page.tsx` (server component querying `prisma.user.findMany` with nested `groups.platformRole` select, rendering a 2-col card grid with status and superuser badges and role pill list).

**Tech Stack:** Next.js 14 App Router server components, Prisma 5, Tailwind CSS, TypeScript strict mode (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `moduleResolution: "bundler"`).

---

## Codebase Context

Working directory: `d:/OpenDigitalProductFactory`

TypeScript rules:
- `moduleResolution: "bundler"` — NO `.js` extensions on local imports in `apps/web`
- `noUncheckedIndexedAccess: true` — `Record<string, V>` indexing returns `V | undefined`; always use `?? fallback`
- `exactOptionalPropertyTypes: true` — use `!= null` for optional DB fields typed as `string | null`

Test command: `pnpm test` (run from `d:/OpenDigitalProductFactory`)
Expected baseline: 53 tests passing (42 web + 11 db). No new unit tests in this phase.

TypeScript check: `cd d:/OpenDigitalProductFactory/apps/web && pnpm tsc --noEmit 2>&1 | head -20`

**Note on test exit code:** `pnpm test` may exit with code 1 due to Windows bash profile noise. Verify success by reading the `Tests N passed` line, not exit code.

**Note on TS check:** There may be one pre-existing error in `app/(shell)/layout.tsx` unrelated to this phase. Confirm no **new** errors appear.

---

## Reference

- Spec: `d:/OpenDigitalProductFactory/docs/superpowers/specs/2026-03-11-phase-4e-admin-route-design.md`
- Pattern: `d:/OpenDigitalProductFactory/apps/web/app/(shell)/employee/layout.tsx` — auth gate
- Schema: `packages/db/prisma/schema.prisma` — `User`, `UserGroup`, `PlatformRole` models

---

## Task 1: Create `admin/layout.tsx` — auth gate

**File to create:** `apps/web/app/(shell)/admin/layout.tsx`

### Exact file contents

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

### Steps

- [ ] **Step 1.1: Create the file** with the exact contents above.
- [ ] **Step 1.2: TypeScript check**
  ```bash
  cd d:/OpenDigitalProductFactory/apps/web && pnpm tsc --noEmit 2>&1 | head -20
  ```
  Expected: no new errors.
- [ ] **Step 1.3: Run tests**
  ```bash
  cd d:/OpenDigitalProductFactory && pnpm test 2>&1 | grep -E "Tests|passed|failed"
  ```
  Expected: `Tests 53 passed`.
- [ ] **Step 1.4: Commit**
  ```bash
  cd d:/OpenDigitalProductFactory
  git add "apps/web/app/(shell)/admin/layout.tsx"
  git commit -m "feat(web): add /admin auth gate (view_admin)"
  ```

---

## Task 2: Create `admin/page.tsx` — user registry

**File to create:** `apps/web/app/(shell)/admin/page.tsx`

### Exact file contents

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

### TypeScript notes

- `isActive` and `isSuperuser` are `Boolean` (non-nullable) — ternary directly, no `!= null` guard needed.
- `u.groups` is a relation array — always defined (Prisma never returns `null` for array relations); `u.groups.length === 0` is safe.
- `g.platformRole.roleId` used as `key` — `roleId` is `String @unique` on `PlatformRole`; safe as React key.
- `email` is `String @unique` (non-nullable) — no guard needed.
- `createdAt` is selected but not rendered — acceptable as it may be useful for future sorting without requiring a migration.
- No `Record<>` indexing — no `?? fallback` needed.
- Nested select syntax `groups: { select: { platformRole: { select: { roleId, name } } } }` is valid Prisma v5 for `UserGroup[]` → `PlatformRole`.

### Steps

- [ ] **Step 2.1: Create the file** with the exact contents above.
- [ ] **Step 2.2: TypeScript check**
  ```bash
  cd d:/OpenDigitalProductFactory/apps/web && pnpm tsc --noEmit 2>&1 | head -20
  ```
  Expected: no new errors.
- [ ] **Step 2.3: Run tests**
  ```bash
  cd d:/OpenDigitalProductFactory && pnpm test 2>&1 | grep -E "Tests|passed|failed"
  ```
  Expected: `Tests 53 passed`.
- [ ] **Step 2.4: Commit**
  ```bash
  cd d:/OpenDigitalProductFactory
  git add "apps/web/app/(shell)/admin/page.tsx"
  git commit -m "feat(web): add /admin route (user registry)"
  ```

---

## Architecture Notes

### Highest-restriction route

`view_admin` is granted only to `HR-000` (CDIO) and superusers. This is the most restricted capability in the system.

### No Prisma migration needed

`User`, `UserGroup`, and `PlatformRole` models with all selected fields are already in the schema. No migration required.

### At least one user exists

The seed creates a default admin user (`seedDefaultAdminUser`), so the user table has at least one record. The empty state is a safety net for edge cases.

### `createdAt` selected but not rendered

`createdAt` is in the select for potential future use (e.g., sorting by join date) without needing a schema change. It does not cause TypeScript errors.
