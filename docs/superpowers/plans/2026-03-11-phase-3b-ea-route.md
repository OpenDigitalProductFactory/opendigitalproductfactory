# Phase 3B — EA Route Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/ea` route showing all agents grouped by tier, and update Header.tsx nav to `My Workspace | Portfolio | Inventory | EA`. Also improve the active-link logic to use the stricter `=== || startsWith("/")` form.

**Architecture:** Two-file change: update `Header.tsx` (NAV_ITEMS + active-link logic); create `apps/web/app/(shell)/ea/page.tsx` as an async server component that queries `prisma.agent.findMany`, groups by tier, and renders a card grid.

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

- Spec: `d:/OpenDigitalProductFactory/docs/superpowers/specs/2026-03-11-phase-3b-ea-route-design.md`
- Pattern: `d:/OpenDigitalProductFactory/apps/web/app/(shell)/inventory/page.tsx` — follow same async server component structure
- `PORTFOLIO_COLOURS`: exported from `apps/web/lib/portfolio.ts` as `Record<string, string>`

---

## Task 1: Update `Header.tsx` — add EA nav item and improve active-link logic

**File to modify:** `apps/web/components/shell/Header.tsx`

### Step 1.1: Replace NAV_ITEMS array

Find:
```ts
const NAV_ITEMS = [
  { label: "My Workspace", href: "/workspace" },
  { label: "Portfolio", href: "/portfolio" },
  { label: "Inventory", href: "/inventory" },
];
```
Replace with:
```ts
const NAV_ITEMS = [
  { label: "My Workspace", href: "/workspace" },
  { label: "Portfolio", href: "/portfolio" },
  { label: "Inventory", href: "/inventory" },
  { label: "EA", href: "/ea" },
];
```

### Step 1.2: Update active-link expression

Find:
```tsx
const active = item.href === "/workspace"
  ? activePath === item.href
  : activePath.startsWith(item.href);
```
Replace with:
```tsx
const active = activePath === item.href || activePath.startsWith(`${item.href}/`);
```

This stricter form prevents false matches (e.g. `/ea` would not match `/early-access`) and is correct for all four nav items. The `/workspace` special-case is no longer needed.

### Steps

- [ ] **Step 1.1: Replace NAV_ITEMS** (as above)
- [ ] **Step 1.2: Update active-link expression** (as above)
- [ ] **Step 1.3: TypeScript check**
  ```bash
  cd d:/OpenDigitalProductFactory/apps/web && pnpm tsc --noEmit 2>&1 | head -20
  ```
  Expected: no new errors.
- [ ] **Step 1.4: Run tests**
  ```bash
  cd d:/OpenDigitalProductFactory && pnpm test 2>&1 | tail -10
  ```
  Expected: `Tests 53 passed (53)` in output.
- [ ] **Step 1.5: Commit**
  ```bash
  cd d:/OpenDigitalProductFactory
  git add apps/web/components/shell/Header.tsx
  git commit -m "feat(web): add EA nav item and tighten active-link logic"
  ```

---

## Task 2: Create `ea/page.tsx`

**File to create:** `apps/web/app/(shell)/ea/page.tsx`

### Exact file contents

```tsx
// apps/web/app/(shell)/ea/page.tsx
import { prisma } from "@dpf/db";
import { PORTFOLIO_COLOURS } from "@/lib/portfolio";

const TIER_LABELS: Record<number, string> = {
  1: "Tier 1 — Orchestrators",
  2: "Tier 2 — Specialists",
  3: "Tier 3 — Cross-cutting",
};

export default async function EaPage() {
  const agents = await prisma.agent.findMany({
    orderBy: [{ tier: "asc" }, { name: "asc" }],
    select: {
      id: true,
      agentId: true,
      name: true,
      tier: true,
      type: true,
      description: true,
      portfolio: { select: { slug: true, name: true } },
    },
  });

  const tiers = [1, 2, 3] as const;
  const byTier = new Map(tiers.map((t) => [t, agents.filter((a) => a.tier === t)]));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Enterprise Architecture</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          {agents.length} agent{agents.length !== 1 ? "s" : ""}
        </p>
      </div>

      {tiers.map((t) => {
        const tierAgents = byTier.get(t) ?? [];
        if (tierAgents.length === 0) return null;

        const tierLabel = TIER_LABELS[t] ?? `Tier ${t}`;

        return (
          <section key={t} className="mb-8">
            <h2 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-widest mb-3">
              {tierLabel}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {tierAgents.map((a) => {
                const colour = a.portfolio
                  ? (PORTFOLIO_COLOURS[a.portfolio.slug] ?? "#555566")
                  : "#555566";

                return (
                  <div
                    key={a.id}
                    className="p-4 rounded-lg bg-[var(--dpf-surface-1)] border-l-4"
                    style={{ borderLeftColor: colour }}
                  >
                    <p className="text-[9px] font-mono text-[var(--dpf-muted)] mb-1">
                      {a.agentId}
                    </p>
                    <p className="text-sm font-semibold text-white leading-tight mb-1">
                      {a.name}
                    </p>
                    {a.description != null && (
                      <p className="text-[10px] text-[var(--dpf-muted)] line-clamp-2 mb-1.5">
                        {a.description}
                      </p>
                    )}
                    {a.portfolio != null ? (
                      <p
                        className="text-[10px] font-medium"
                        style={{ color: colour }}
                      >
                        {a.portfolio.name}
                      </p>
                    ) : (
                      <p className="text-[10px] text-[var(--dpf-muted)]">
                        Cross-cutting
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      {agents.length === 0 && (
        <p className="text-sm text-[var(--dpf-muted)]">No agents registered yet.</p>
      )}
    </div>
  );
}
```

### TypeScript notes

- `PORTFOLIO_COLOURS[a.portfolio.slug]` — `Record<string, string>`, returns `string | undefined` under `noUncheckedIndexedAccess`; `?? "#555566"` fallback required.
- `TIER_LABELS[t]` — `Record<number, string>`, same pattern; `` ?? `Tier ${t}` `` fallback required.
- `a.description != null` — correct guard for `string | null` (Prisma maps `String?` to `string | null`).
- `a.portfolio != null` — correct guard for optional relation.
- `byTier.get(t) ?? []` — `Map.get` returns `T | undefined`; `?? []` required.
- `key={t}` on `<section>` (outer element in `tiers.map`), `key={a.id}` on `<div>` (outer element in `tierAgents.map`) — both correct.
- No `.js` extension on `@/lib/portfolio` or `@dpf/db`.

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
  git add "apps/web/app/(shell)/ea/page.tsx"
  git commit -m "feat(web): add /ea route (agent registry)"
  ```

---

## Architecture Notes

### No layout.tsx for EA

The EA route uses the root `(shell)` layout — same as inventory. No sidebar. Full-width content within the shell.

### No Prisma migration needed

The `Agent` model and `portfolio` relation are already in the schema and seeded (43 agents).

### No new tests needed

Pure data-fetch + render with no business logic. TypeScript strict-mode check is the validation gate.

### Active-link improvement note

The change to `activePath === item.href || activePath.startsWith(\`${item.href}/\`)` is a correctness improvement that affects all four nav items. It is safe and backward-compatible with the existing portfolio sub-route behavior (`/portfolio/foundational/compute` still highlights Portfolio).
