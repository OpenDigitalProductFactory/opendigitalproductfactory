# Phase 4A — Employee Route Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/employee` route showing all platform roles with authority domains, HITL tiers, SLA targets, and human assignment counts.

**Architecture:** Two-file change: create `employee/layout.tsx` (auth gate using `view_employee`) and `employee/page.tsx` (server component querying `prisma.platformRole.findMany` with `_count.users`, rendering a 2-col card grid). No Header changes needed — the workspace tile already links to `/employee`.

**Tech Stack:** Next.js 14 App Router server components, Prisma 5, Tailwind CSS, TypeScript strict mode (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `moduleResolution: "bundler"`).

---

## Codebase Context

Working directory: `d:/OpenDigitalProductFactory`

TypeScript rules:
- `moduleResolution: "bundler"` — NO `.js` extensions on local imports in `apps/web`
- `noUncheckedIndexedAccess: true` — indexing `Record<string, V>` or `Record<number, V>` returns `V | undefined`; always use `?? fallback`
- `exactOptionalPropertyTypes: true` — use `!= null` (not `!== undefined`) for optional DB fields typed as `string | null`

Test command: `pnpm test` (run from `d:/OpenDigitalProductFactory`)
Expected baseline: 53 tests passing (42 web + 11 db). No new unit tests in this phase.

TypeScript check: `cd d:/OpenDigitalProductFactory/apps/web && pnpm tsc --noEmit 2>&1 | head -20`

**Note on test exit code:** `pnpm test` may exit with code 1 due to Windows bash profile noise. Verify success by reading the `Tests N passed` line, not exit code.

**Note on TS check:** There may be one pre-existing error in `app/(shell)/layout.tsx` unrelated to this phase. Confirm no **new** errors appear.

---

## Reference

- Spec: `d:/OpenDigitalProductFactory/docs/superpowers/specs/2026-03-11-phase-4a-employee-route-design.md`
- Pattern: `d:/OpenDigitalProductFactory/apps/web/app/(shell)/inventory/layout.tsx` — follow same auth gate pattern
- Pattern: `d:/OpenDigitalProductFactory/apps/web/app/(shell)/ea/page.tsx` — follow same async server component structure
- Permissions: `d:/OpenDigitalProductFactory/apps/web/lib/permissions.ts` — `view_employee` allows HR-000 through HR-500 plus superusers

---

## Task 1: Create `employee/layout.tsx` — auth gate

**File to create:** `apps/web/app/(shell)/employee/layout.tsx`

### Exact file contents

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

### Steps

- [ ] **Step 1.1: Create the file** with the exact contents above.
- [ ] **Step 1.2: TypeScript check**
  ```bash
  cd d:/OpenDigitalProductFactory/apps/web && pnpm tsc --noEmit 2>&1 | head -20
  ```
  Expected: no new errors (one pre-existing error in `app/(shell)/layout.tsx` is acceptable).
- [ ] **Step 1.3: Run tests**
  ```bash
  cd d:/OpenDigitalProductFactory && pnpm test 2>&1 | tail -10
  ```
  Expected: `Tests 53 passed (53)` in output.
- [ ] **Step 1.4: Commit**
  ```bash
  cd d:/OpenDigitalProductFactory
  git add "apps/web/app/(shell)/employee/layout.tsx"
  git commit -m "feat(web): add /employee auth gate (view_employee)"
  ```

---

## Task 2: Create `employee/page.tsx` — role registry

**File to create:** `apps/web/app/(shell)/employee/page.tsx`

### Exact file contents

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

### TypeScript notes

- `r.description != null` — correct guard for `String?` Prisma field typed as `string | null`
- `r.slaDurationH != null && r.slaDurationH > 0` — guards both null (`Int?`) and zero/negative values
- `r._count.users` — standard Prisma count relation, typed as `number` (no undefined)
- No `Record<>` indexing in this file, so no `?? fallback` needed beyond the explicit checks above
- No `.js` extension on `@dpf/db` import
- `key={r.id}` — cuid PK, stable and unique

### Steps

- [ ] **Step 2.1: Create the file** with the exact contents above.
- [ ] **Step 2.2: TypeScript check**
  ```bash
  cd d:/OpenDigitalProductFactory/apps/web && pnpm tsc --noEmit 2>&1 | head -20
  ```
  Expected: no new errors.
- [ ] **Step 2.3: Run tests**
  ```bash
  cd d:/OpenDigitalProductFactory && pnpm test 2>&1 | tail -10
  ```
  Expected: `Tests 53 passed (53)` in output.
- [ ] **Step 2.4: Commit**
  ```bash
  cd d:/OpenDigitalProductFactory
  git add "apps/web/app/(shell)/employee/page.tsx"
  git commit -m "feat(web): add /employee route (platform role registry)"
  ```

---

## Architecture Notes

### No Header change needed

`/employee` is not a global nav item. It is a workspace tile — existing workspace tile logic already links to it. The global nav (`My Workspace | Portfolio | Inventory | EA`) remains unchanged.

### No Prisma migration needed

`PlatformRole` model with `hitlTierMin`, `slaDurationH`, and the `users` relation is already in the schema and seeded. `_count: { select: { users: true } }` is standard Prisma syntax for counting related records — no migration required.

### No new tests needed

Pure data-fetch + render with no business logic. TypeScript strict-mode check is the validation gate.

### Auth gate scope

`view_employee` allows all six HR roles (`HR-000` through `HR-500`) plus superusers. This is the broadest capability in the system — all platform HR staff can view the role registry.
