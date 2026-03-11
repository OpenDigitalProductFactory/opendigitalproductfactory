# Phase 3B — EA Route Design

**Date:** 2026-03-11
**Status:** Draft
**Scope:** Add a `/ea` route — an Agent Registry view showing all 43 AI agents in the system, organised by tier. Also update `Header.tsx` to add EA to the navigation.

---

## Overview

The portfolio route shows the taxonomy structure. The inventory route shows digital products. The EA route shows the AI agent layer of the platform — a registry of every agent, grouped into their three operational tiers: Orchestrators, Specialists, and Cross-cutting agents.

Each agent card is colour-coded by its portfolio affiliation (using the same accent colours as the portfolio route), making it immediately clear which part of the business each agent serves.

**Navigation update:**
Add "EA" as a fourth nav link after "Inventory".

Updated nav: `My Workspace | Portfolio | Inventory | EA`

---

## Route Structure

```
app/(shell)/
  ea/
    page.tsx       — server component; lists all agents grouped by tier
```

Uses the existing `(shell)` layout (Header + auth gate). No sidebar required — agents are listed directly in the main content area.

---

## Data

One Prisma query, ordered by tier then name:

```ts
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
```

`status` is omitted — the registry is a read view of active agents; status filtering is out of scope for Phase 3B.

Group by tier server-side after the query:

```ts
const TIER_LABELS: Record<number, string> = {
  1: "Tier 1 — Orchestrators",
  2: "Tier 2 — Specialists",
  3: "Tier 3 — Cross-cutting",
};

const tiers = [1, 2, 3] as const;
const byTier = new Map(tiers.map((t) => [t, agents.filter((a) => a.tier === t)]));
```

The `TIER_LABELS` lookup uses `?? fallback` at the call site (`TIER_LABELS[t] ?? \`Tier ${t}\``) to satisfy `noUncheckedIndexedAccess`.

No React cache needed — agent data is not shared with any layout; the query lives in the page server component directly.

---

## Page Layout

```
/ea

[heading] Enterprise Architecture
[subheading] N agents

[section heading] Tier 1 — Orchestrators
[grid of agent cards]

[section heading] Tier 2 — Specialists
[grid of agent cards]

[section heading] Tier 3 — Cross-cutting
[grid of agent cards]
```

If a tier has zero agents, its section is skipped entirely (no heading, no empty grid).

Grid: `grid-cols-1 sm:grid-cols-2`, matching the inventory route.

### Agent card fields

Each card has a left border coloured by portfolio affiliation:

| Field | Rendering |
|---|---|
| `agentId` | Top line; monospace (`font-mono`), `text-[9px]`, muted colour (`var(--dpf-muted)`) |
| `name` | Bold (`font-semibold`), white, `text-sm` |
| `description` | If present: `text-[10px]`, muted, clamped to 2 lines (`line-clamp-2`) |
| Portfolio affiliation | If `portfolio` is non-null: portfolio `name` in portfolio accent colour from `PORTFOLIO_COLOURS[slug]`; if no portfolio: literal string `"Cross-cutting"` in `var(--dpf-muted)` |

Card left-border colour: `PORTFOLIO_COLOURS[agent.portfolio.slug] ?? "#555566"`. For agents with no portfolio, the border is `"#555566"`.

Agent cards are not links — there is no agent detail page in Phase 3B.

---

## What Changes

### 1. `Header.tsx` — add EA nav item

`apps/web/components/shell/Header.tsx`

Replace the `NAV_ITEMS` array:

```ts
// Before:
const NAV_ITEMS = [
  { label: "My Workspace", href: "/workspace" },
  { label: "Portfolio", href: "/portfolio" },
  { label: "Inventory", href: "/inventory" },
];

// After:
const NAV_ITEMS = [
  { label: "My Workspace", href: "/workspace" },
  { label: "Portfolio", href: "/portfolio" },
  { label: "Inventory", href: "/inventory" },
  { label: "EA", href: "/ea" },
];
```

Update the active-link logic to use the stricter prefix form to prevent false matches against paths that merely start with the same characters (e.g. a hypothetical `/early-access` matching `/ea`):

```tsx
// Before:
const active = item.href === "/workspace"
  ? activePath === item.href
  : activePath.startsWith(item.href);

// After:
const active = activePath === item.href || activePath.startsWith(`${item.href}/`);
```

The new form matches the item if the active path is exactly the item's href, or if it starts with the item's href followed by a `/` (i.e. a true sub-route). This is safe for all four nav items:
- `/workspace` — exact match only (no `/workspace/` sub-routes in Phase 3B)
- `/portfolio` — matches `/portfolio`, `/portfolio/foundational`, `/portfolio/foundational/compute`, etc.
- `/inventory` — exact match only in Phase 3B
- `/ea` — exact match only in Phase 3B

The old form's special-case for `/workspace` is no longer needed because the new form is safe for all routes.

### 2. `ea/page.tsx` — new route

`apps/web/app/(shell)/ea/page.tsx`

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

---

## Auth

The `(shell)` layout already handles auth (redirects to `/login` if unauthenticated). No additional auth check is needed on the EA page — all authenticated users can view the agent registry.

---

## Files to Create / Modify

| File | Action |
|---|---|
| `apps/web/components/shell/Header.tsx` | Add EA nav item to `NAV_ITEMS` |
| `apps/web/app/(shell)/ea/page.tsx` | Create new page |

---

## Testing

No new unit tests. The page is a simple data fetch and render. TypeScript check validates the Prisma query shape, the `PORTFOLIO_COLOURS` indexing (null guards), and the `TIER_LABELS` indexing (null guard).

---

## What This Does Not Include

- Agent detail page (future)
- Filtering or search UI (future)
- Agent status badges — all agents in the registry are assumed active; status display is out of scope
- Pagination — not needed at 43 agents
- `/ea/[agentId]` sub-routes (future)
- Edit / create agent forms (out of scope for read-only views)
