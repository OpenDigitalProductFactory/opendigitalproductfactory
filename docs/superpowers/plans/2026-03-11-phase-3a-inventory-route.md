# Phase 3A — Inventory Route Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/inventory` route listing all digital products, and update Header.tsx nav to `My Workspace | Portfolio | Inventory`.

**Architecture:** Two-file change: update `Header.tsx` NAV_ITEMS and active-link logic; create `apps/web/app/(shell)/inventory/page.tsx` as an async server component that queries `prisma.digitalProduct.findMany` and renders a responsive card grid.

**Tech Stack:** Next.js 14 App Router server components, Prisma 5, Tailwind CSS, TypeScript strict mode (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `moduleResolution: "bundler"`).

---

## Codebase Context

Working directory: `d:/OpenDigitalProductFactory`

TypeScript rules:
- `moduleResolution: "bundler"` — NO `.js` extensions on local imports in `apps/web`
- `noUncheckedIndexedAccess: true` — indexing `Record<string, V>` returns `V | undefined`; always use `?? fallback`
- `exactOptionalPropertyTypes: true` — omit optional props rather than passing `undefined`

Test command: `pnpm test` (run from `d:/OpenDigitalProductFactory`)
Expected baseline: 53 tests passing (42 web + 11 db). No new unit tests in this phase.

TypeScript check: `cd d:/OpenDigitalProductFactory/apps/web && pnpm tsc --noEmit 2>&1 | head -20`

---

## Reference

- Spec: `d:/OpenDigitalProductFactory/docs/superpowers/specs/2026-03-11-phase-3a-inventory-route-design.md`
- Shell layout: `d:/OpenDigitalProductFactory/apps/web/app/(shell)/layout.tsx` — handles auth gate and Header rendering; no changes needed
- Portfolio page reference: `d:/OpenDigitalProductFactory/apps/web/app/(shell)/portfolio/[[...slug]]/page.tsx` — follow same async server component pattern

---

## Task 1: Update `Header.tsx` nav items and active-link logic

**File to modify:** `apps/web/components/shell/Header.tsx`

### Before (exact current state)

```ts
const NAV_ITEMS = [
  { label: "My Workspace", href: "/workspace" },
  { label: "Directory", href: "/directory" },
  { label: "Activity", href: "/activity" },
];
```

```tsx
const active = activePath === item.href;
```

### After

```ts
const NAV_ITEMS = [
  { label: "My Workspace", href: "/workspace" },
  { label: "Portfolio", href: "/portfolio" },
  { label: "Inventory", href: "/inventory" },
];
```

```tsx
const active = item.href === "/workspace"
  ? activePath === item.href
  : activePath.startsWith(item.href);
```

The conditional form keeps exact-match for `/workspace` (robust for future `/workspace/*` routes) and uses prefix-match for `/portfolio` and `/inventory` so the nav item stays highlighted when navigating deep into the taxonomy (e.g. `/portfolio/foundational/compute`).

### Steps

- [ ] **Step 1.1: Replace NAV_ITEMS array**

  In `apps/web/components/shell/Header.tsx`, replace:
  ```ts
  const NAV_ITEMS = [
    { label: "My Workspace", href: "/workspace" },
    { label: "Directory", href: "/directory" },
    { label: "Activity", href: "/activity" },
  ];
  ```
  With:
  ```ts
  const NAV_ITEMS = [
    { label: "My Workspace", href: "/workspace" },
    { label: "Portfolio", href: "/portfolio" },
    { label: "Inventory", href: "/inventory" },
  ];
  ```

- [ ] **Step 1.2: Update active-link expression**

  In the same file, replace:
  ```tsx
  const active = activePath === item.href;
  ```
  With:
  ```tsx
  const active = item.href === "/workspace"
    ? activePath === item.href
    : activePath.startsWith(item.href);
  ```

- [ ] **Step 1.3: TypeScript check — no new errors**

  ```bash
  cd d:/OpenDigitalProductFactory/apps/web && pnpm tsc --noEmit 2>&1 | head -20
  ```

  **Note:** There is one pre-existing error in `app/(shell)/layout.tsx` (Next.js `headers()` API mismatch — unrelated to this phase). This error exists before your changes. Confirm no **new** errors appear beyond that one.

- [ ] **Step 1.4: Run tests — expect 53 passing**

  ```bash
  cd d:/OpenDigitalProductFactory && pnpm test 2>&1 | tail -10
  ```

  Expected: `Tests 53 passed (53)` in the tail output. **Note:** The command may exit with code 1 due to a Windows bash profile noise line — this is expected and not a real failure. Verify success by reading the `Tests N passed` line, not by exit code.

- [ ] **Step 1.5: Commit**

  ```bash
  cd d:/OpenDigitalProductFactory
  git add apps/web/components/shell/Header.tsx
  git commit -m "feat(web): update Header nav to Portfolio and Inventory"
  ```

---

## Task 2: Create `inventory/page.tsx`

**File to create:** `apps/web/app/(shell)/inventory/page.tsx`

The directory `apps/web/app/(shell)/inventory/` does not yet exist — Next.js will pick it up automatically once the file is created.

### Exact file contents

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

### TypeScript notes

- `PORTFOLIO_COLOURS[p.portfolio.slug]` — typed `Record<string, string>`, returns `string | undefined` under `noUncheckedIndexedAccess`; `?? "#7c8cf8"` fallback satisfies the rule.
- `STATUS_COLOURS[p.status]` — same pattern; `?? "#555566"` fallback required.
- `p.taxonomyNode` and `p.portfolio` are nullable Prisma relations; ternary chains handle both `null` cases.
- No `.js` extension on `@/lib/portfolio` import (bundler resolution).
- `import { prisma } from "@dpf/db"` — same import used in the portfolio page.

### Steps

- [ ] **Step 2.1: Create the file**

  Create `apps/web/app/(shell)/inventory/page.tsx` with the exact contents shown above.

- [ ] **Step 2.2: TypeScript check — no new errors**

  ```bash
  cd d:/OpenDigitalProductFactory/apps/web && pnpm tsc --noEmit 2>&1 | head -20
  ```

  **Note:** There is one pre-existing error in `app/(shell)/layout.tsx` (Next.js `headers()` API mismatch — unrelated to this phase). Confirm no **new** errors appear.

- [ ] **Step 2.3: Run tests — expect 53 passing**

  ```bash
  cd d:/OpenDigitalProductFactory && pnpm test 2>&1 | tail -10
  ```

  Expected: `Tests 53 passed (53)` in the tail output. Exit code 1 is expected Windows shell noise — not a real failure.

- [ ] **Step 2.4: Commit**

  ```bash
  cd d:/OpenDigitalProductFactory
  git add "apps/web/app/(shell)/inventory/page.tsx"
  git commit -m "feat(web): add /inventory route"
  ```

---

## Architecture Notes

### No layout.tsx for inventory

The inventory route uses the root `(shell)` layout which provides the Header and auth gate. The sidebar in `portfolio/layout.tsx` is portfolio-specific — inventory renders full-width within the shell, consistent with `workspace/`.

### No Prisma migration needed

`DigitalProduct` already has `portfolio` and `taxonomyNode` nullable relations, `status`, `name`, and `id`. No schema changes required.

### No new tests needed

Pure data-fetch + render with no business logic. TypeScript strict-mode check serves as the validation gate.
