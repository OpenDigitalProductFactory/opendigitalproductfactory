# Phase 2E — People Panel Design

**Date:** 2026-03-11
**Status:** Draft
**Scope:** Replace the dashed People placeholder in `PortfolioNodeDetail` with a live panel showing the portfolio's primary owner role data from `PlatformRole`.

---

## Overview

Phases 2B–2D wired up Agents, Health, and Budget. The last dashed placeholder in `PortfolioNodeDetail` is the People panel at the bottom. Phase 2E makes it live.

**What the People panel shows:**

The portfolio's primary owner role — the HR role code responsible for this portfolio type — rendered as a role card:
- Role name (e.g. "Enterprise Architect")
- Role code (e.g. "HR-300")
- Description / authority domain (e.g. "Foundational portfolio governance")
- User count — number of platform users currently assigned to that role

People is a **portfolio-level panel** — the same owner role is shown at all depths within a portfolio (consistent with Budget and Agent count patterns).

---

## Data Model

No schema changes. The existing `PlatformRole` model has everything needed:

```prisma
model PlatformRole {
  id            String      @id @default(cuid())
  roleId        String      @unique // HR-000 … HR-500
  name          String
  description   String?
  users         UserGroup[]
}
```

The four portfolio owner role codes (already static in `PORTFOLIO_OWNER_ROLES`):

| Portfolio slug | Owner roleId |
|---|---|
| `foundational` | `HR-300` |
| `manufacturing_and_delivery` | `HR-500` |
| `for_employees` | `HR-200` |
| `products_and_services_sold` | `HR-100` |

---

## What Changes

### 1. `OwnerRoleInfo` type — new, in `portfolio.ts`

```ts
export type OwnerRoleInfo = {
  roleId: string;
  name: string;
  description: string | null;
  userCount: number;
};
```

Pure type, no server imports — safe to co-locate with other portfolio types in `portfolio.ts`.

### 2. `getPortfolioOwnerRoles` — new server cache function

`apps/web/lib/portfolio-data.ts`

```ts
/**
 * Returns owner role detail per portfolio slug.
 * React cache() deduplicates within one request.
 */
export const getPortfolioOwnerRoles = cache(async (): Promise<Record<string, OwnerRoleInfo>> => {
  const ownerRoleIds = Object.values(PORTFOLIO_OWNER_ROLES); // ["HR-300", "HR-500", "HR-200", "HR-100"]
  const roles = await prisma.platformRole.findMany({
    where: { roleId: { in: ownerRoleIds } },
    select: {
      roleId: true,
      name: true,
      description: true,
      _count: { select: { users: true } },
    },
  });

  // Build roleId → OwnerRoleInfo lookup
  const roleById = new Map(
    roles.map((r) => [
      r.roleId,
      { roleId: r.roleId, name: r.name, description: r.description, userCount: r._count.users },
    ])
  );

  // Return keyed by portfolio slug
  return Object.fromEntries(
    Object.entries(PORTFOLIO_OWNER_ROLES).map(([slug, roleId]) => [
      slug,
      roleById.get(roleId) ?? { roleId, name: roleId, description: null, userCount: 0 },
    ])
  );
});
```

Import `PORTFOLIO_OWNER_ROLES` from `"./portfolio"` and `OwnerRoleInfo` from `"./portfolio"`.

Fallback when role not seeded: `{ roleId, name: roleId, description: null, userCount: 0 }` — graceful degradation.

### 3. `page.tsx` — fetch owner roles

`apps/web/app/(shell)/portfolio/[[...slug]]/page.tsx`

Add `getPortfolioOwnerRoles` to imports. Fetch in `Promise.all`:

```ts
const [roots, agentCounts, budgets, ownerRoles] = await Promise.all([
  getPortfolioTree(),
  getAgentCounts(),
  getPortfolioBudgets(),
  getPortfolioOwnerRoles(),
]);
```

Derive for node detail (portfolio-level, use `rootSlug`):

```ts
const ownerRole = ownerRoles[rootSlug] ?? null;
```

Pass to `PortfolioNodeDetail`:
```tsx
<PortfolioNodeDetail ... ownerRole={ownerRole} />
```

### 4. `PortfolioNodeDetail` — replace People placeholder

`apps/web/components/portfolio/PortfolioNodeDetail.tsx`

Add `ownerRole: OwnerRoleInfo | null` to Props. Import `OwnerRoleInfo` from `@/lib/portfolio`.

**Import line change:** Remove `PORTFOLIO_OWNER_ROLES` from the import (it will be unused after this change — `ownerRole` prop replaces the local derivation). Change:
```ts
// Before:
import { PORTFOLIO_COLOURS, PORTFOLIO_OWNER_ROLES } from "@/lib/portfolio";

// After:
import { PORTFOLIO_COLOURS, type OwnerRoleInfo } from "@/lib/portfolio";
```

**Remove the local derivation** at the top of the function body:
```ts
// Remove this line:
const ownerRole = PORTFOLIO_OWNER_ROLES[rootSlug] ?? "—";
```

**Owner StatBox — retain as-is** (no change). The stats strip continues to show the HR code (`ownerRole` from `PORTFOLIO_OWNER_ROLES` was showing the code string). However, since we are removing the local `const ownerRole` derivation, the existing `StatBox label="Owner"` now needs the code from another source. Use `ownerRoleProp?.roleId ?? "—"` (rename the prop to `ownerRole` and access `.roleId`):

```tsx
// Stats strip Owner StatBox — update value source:
<StatBox label="Owner" value={ownerRole?.roleId ?? "—"} colour={colour} />
```

The prop is named `ownerRole` (same as the removed local const), so no rename is needed — just delete the `const` line and use the prop directly. This keeps the HR code visible in the compact stats strip while the People panel below shows the full detail.

Replace the People placeholder div:

```tsx
// Before:
<div className="mt-8">
  <PlaceholderPanel label="People" description="Human role assignments — coming soon" />
</div>

// After:
<div className="mt-8">
  <PeoplePanel ownerRole={ownerRole} colour={colour} />
</div>
```

Add `PeoplePanel` component (in the same file, alongside `StatBox` and `PlaceholderPanel`):

```tsx
function PeoplePanel({
  ownerRole,
  colour,
}: {
  ownerRole: OwnerRoleInfo | null;
  colour: string;
}) {
  return (
    <div>
      <p className="text-[10px] text-[var(--dpf-muted)] uppercase tracking-widest mb-2">
        People
      </p>
      {ownerRole === null ? (
        <p className="text-xs text-[var(--dpf-muted)]">No owner role assigned.</p>
      ) : (
        <div className="bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] rounded-lg px-4 py-3">
          <div className="flex items-baseline gap-2 mb-1">
            <p className="text-sm font-semibold text-white">{ownerRole.name}</p>
            <p className="text-[10px] font-mono" style={{ color: colour }}>
              {ownerRole.roleId}
            </p>
          </div>
          {ownerRole.description !== null && (
            <p className="text-xs text-[var(--dpf-muted)] mb-2">{ownerRole.description}</p>
          )}
          <p className="text-[10px] text-[var(--dpf-muted)]">
            {ownerRole.userCount === 0
              ? "No users assigned"
              : ownerRole.userCount === 1
              ? "1 person"
              : `${ownerRole.userCount} people`}
          </p>
        </div>
      )}
    </div>
  );
}
```

The `PlaceholderPanel` function is removed since it is no longer used by any call site after this change.

---

## Component / Data Flow

```
portfolio-data.ts: getPortfolioOwnerRoles()
  ├─ prisma.platformRole.findMany({ where: { roleId: { in: [...4 owner roleIds] } } })
  ├─ _count: { users: true }
  └─ → Record<portfolioSlug, OwnerRoleInfo>

page.tsx (node detail):
  ownerRole = ownerRoles[rootSlug] ?? null   // portfolio-level, same at all depths
  PortfolioNodeDetail ← ownerRole: OwnerRoleInfo | null
```

---

## Files to Create / Modify

| File | Action |
|---|---|
| `apps/web/lib/portfolio.ts` | Add `OwnerRoleInfo` type |
| `apps/web/lib/portfolio-data.ts` | Add `getPortfolioOwnerRoles` cache function |
| `apps/web/app/(shell)/portfolio/[[...slug]]/page.tsx` | Add `getPortfolioOwnerRoles` fetch; pass `ownerRole` |
| `apps/web/components/portfolio/PortfolioNodeDetail.tsx` | Add `ownerRole` prop; replace placeholder with `PeoplePanel`; add `PeoplePanel` function; remove `PlaceholderPanel` |

---

## Testing

`getPortfolioOwnerRoles` is a server/DB function — not unit-testable without live DB. Validated via TypeScript check.

`OwnerRoleInfo` type is purely structural — no logic to test.

`PeoplePanel` component logic is trivial (null check, pluralisation) — rendered via server component, verified by TypeScript.

No new unit tests required.

---

## What This Does Not Include

- Owner role assignment UI — read-only display only
- L1/L2/L3 per-node role assignments — future phase
- Secondary or associated roles beyond the primary owner — future phase
- `/inventory` and `/ea` routes — separate specs
