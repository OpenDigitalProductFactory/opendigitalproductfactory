# Phase 4B — Customer Route Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/customer` route showing all customer accounts with status and contact counts.

**Architecture:** Two-file change: create `customer/layout.tsx` (auth gate using `view_customer`) and `customer/page.tsx` (server component querying `prisma.customerAccount.findMany` with `_count.contacts`, rendering a 2-col card grid).

**Tech Stack:** Next.js 14 App Router server components, Prisma 5, Tailwind CSS, TypeScript strict mode (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `moduleResolution: "bundler"`).

---

## Codebase Context

Working directory: `d:/OpenDigitalProductFactory`

TypeScript rules:
- `moduleResolution: "bundler"` — NO `.js` extensions on local imports in `apps/web`
- `noUncheckedIndexedAccess: true` — indexing `Record<string, V>` returns `V | undefined`; always use `?? fallback`
- `exactOptionalPropertyTypes: true` — use `!= null` for optional DB fields typed as `string | null`

Test command: `pnpm test` (run from `d:/OpenDigitalProductFactory`)
Expected baseline: 53 tests passing (42 web + 11 db). No new unit tests in this phase.

TypeScript check: `cd d:/OpenDigitalProductFactory/apps/web && pnpm tsc --noEmit 2>&1 | head -20`

**Note on test exit code:** `pnpm test` may exit with code 1 due to Windows bash profile noise. Verify success by reading the `Tests N passed` line, not exit code.

**Note on TS check:** There may be one pre-existing error in `app/(shell)/layout.tsx` unrelated to this phase. Confirm no **new** errors appear.

---

## Reference

- Spec: `d:/OpenDigitalProductFactory/docs/superpowers/specs/2026-03-11-phase-4b-customer-route-design.md`
- Pattern: `d:/OpenDigitalProductFactory/apps/web/app/(shell)/employee/layout.tsx` — follow same auth gate pattern
- Pattern: `d:/OpenDigitalProductFactory/apps/web/app/(shell)/employee/page.tsx` — follow same async server component structure

---

## Task 1: Create `customer/layout.tsx` — auth gate

**File to create:** `apps/web/app/(shell)/customer/layout.tsx`

### Exact file contents

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
  git add "apps/web/app/(shell)/customer/layout.tsx"
  git commit -m "feat(web): add /customer auth gate (view_customer)"
  ```

---

## Task 2: Create `customer/page.tsx` — account registry

**File to create:** `apps/web/app/(shell)/customer/page.tsx`

### Exact file contents

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

### TypeScript notes

- `STATUS_COLOURS[a.status]` — `Record<string, string>` returns `string | undefined` under `noUncheckedIndexedAccess`; `?? "#555566"` fallback required.
- `a._count.contacts` — Prisma `_count` relation, typed as `number`; no fallback needed.
- No nullable Prisma fields in the selected shape — `name`, `accountId`, `status` are all `String` (non-nullable).
- No `.js` extension on `@dpf/db` import.
- `key={a.id}` — cuid PK, stable and unique.

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
  git add "apps/web/app/(shell)/customer/page.tsx"
  git commit -m "feat(web): add /customer route (customer account registry)"
  ```

---

## Architecture Notes

### No Header change needed

`/customer` is a workspace tile route, not a global nav item. The global nav remains unchanged.

### No Prisma migration needed

`CustomerAccount` and `CustomerContact` models are already in the schema. `_count: { select: { contacts: true } }` is standard Prisma syntax — no migration required.

### No new tests needed

Pure data-fetch + render with no business logic. TypeScript strict-mode check is the validation gate.

### Empty state

The `CustomerAccount` table is empty in the seeded database. The page gracefully handles this with the "No accounts registered yet." empty-state paragraph.
