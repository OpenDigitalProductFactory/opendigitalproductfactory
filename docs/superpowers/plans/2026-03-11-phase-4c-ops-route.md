# Phase 4C — Ops Route Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/ops` route showing all backlog items grouped by type (product | portfolio).

**Architecture:** Two-file change: create `ops/layout.tsx` (auth gate using `view_operations`) and `ops/page.tsx` (server component querying `prisma.backlogItem.findMany`, grouping by type, rendering tier-style sections with a card grid per type).

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

- Spec: `d:/OpenDigitalProductFactory/docs/superpowers/specs/2026-03-11-phase-4c-ops-route-design.md`
- Pattern for grouped sections: `d:/OpenDigitalProductFactory/apps/web/app/(shell)/ea/page.tsx`
- Pattern for layout: `d:/OpenDigitalProductFactory/apps/web/app/(shell)/employee/layout.tsx`

---

## Task 1: Create `ops/layout.tsx` — auth gate

**File to create:** `apps/web/app/(shell)/ops/layout.tsx`

### Exact file contents

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
  git add "apps/web/app/(shell)/ops/layout.tsx"
  git commit -m "feat(web): add /ops auth gate (view_operations)"
  ```

---

## Task 2: Create `ops/page.tsx` — backlog registry

**File to create:** `apps/web/app/(shell)/ops/page.tsx`

### Exact file contents

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

### TypeScript notes

- `TYPE_LABELS[t]` — `Record<string, string>` returns `string | undefined` under `noUncheckedIndexedAccess`; `?? t` fallback required.
- `byType.get(t)` — `Map.get` returns `T | undefined`; `?? []` required.
- `types` is `readonly ["product", "portfolio"]` — both strings are known keys of `TYPE_LABELS`, but the compiler still sees it as `Record<string, string>` access, so the `??` is needed.
- All selected Prisma fields (`id`, `itemId`, `title`, `status`, `type`) are non-nullable `String` — no null guards needed.
- `key={t}` on `<section>` (outer element in `types.map`), `key={item.id}` on `<div>` (outer element in `typeItems.map`) — both correct.
- No `.js` extension on `@dpf/db` import.

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
  git add "apps/web/app/(shell)/ops/page.tsx"
  git commit -m "feat(web): add /ops route (operations backlog registry)"
  ```

---

## Architecture Notes

### No Header change needed

`/ops` is a workspace tile route, not a global nav item.

### No Prisma migration needed

`BacklogItem` model is already in the schema. No migration required.

### Empty state

The `BacklogItem` table is empty in the seeded database. Both type sections will be skipped (length === 0), leaving only the empty-state paragraph.
