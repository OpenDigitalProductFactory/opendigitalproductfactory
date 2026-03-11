# Phase 2E — People Panel Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dashed People placeholder in `PortfolioNodeDetail` with a live panel showing the portfolio's primary owner role data from the `PlatformRole` DB table.

**Architecture:** Add `OwnerRoleInfo` type to `portfolio.ts`, new `getPortfolioOwnerRoles()` React cache function, thread through `page.tsx`, replace `PlaceholderPanel` with new `PeoplePanel` component in `PortfolioNodeDetail`. No schema changes required.

**Tech Stack:** Prisma 5 `findMany` with `_count`, Next.js 14 App Router React `cache()`, TypeScript strict mode.

---

## Codebase Context

Working directory: `d:/OpenDigitalProductFactory`

### TypeScript rules
- `moduleResolution: "bundler"` — **NO `.js` extensions** on local imports in `apps/web`
- `noUncheckedIndexedAccess: true` — indexing `Record<string, V>` returns `V | undefined`; always use `?? fallback`
- `exactOptionalPropertyTypes: true` — omit optional props rather than passing `undefined`

### Test command
```bash
pnpm test
```
Expected: 53 tests passing (42 web + 11 db). No new unit tests in this phase (no pure logic functions).

### Current `PortfolioNodeDetail.tsx` relevant lines
```ts
// Line 4:
import { PORTFOLIO_COLOURS, PORTFOLIO_OWNER_ROLES } from "@/lib/portfolio";

// Line 34 (inside function body, before return):
const ownerRole = PORTFOLIO_OWNER_ROLES[rootSlug] ?? "—";

// Line 68 (in stats strip):
<StatBox label="Owner" value={ownerRole} colour={colour} />

// Line 116 (People placeholder):
<PlaceholderPanel label="People" description="Human role assignments — coming soon" />
```

### Existing patterns to follow
- `getPortfolioBudgets` in `portfolio-data.ts` — model for `getPortfolioOwnerRoles`
- `budgets[rootSlug] ?? null` in `page.tsx` — model for `ownerRoles[rootSlug] ?? null`
- `PlatformRole.users` is `UserGroup[]` — use `_count: { select: { users: true } }` for user count

---

## Files to Create / Modify

| File | Action |
|---|---|
| `apps/web/lib/portfolio.ts` | Add `OwnerRoleInfo` type |
| `apps/web/lib/portfolio-data.ts` | Add `getPortfolioOwnerRoles` cache function |
| `apps/web/app/(shell)/portfolio/[[...slug]]/page.tsx` | Add `getPortfolioOwnerRoles` fetch; pass `ownerRole` |
| `apps/web/components/portfolio/PortfolioNodeDetail.tsx` | Add `ownerRole` prop; update import; remove local const; update Owner StatBox; replace placeholder with `PeoplePanel`; add `PeoplePanel`; remove `PlaceholderPanel` |

---

## Task 1: `OwnerRoleInfo` type

**Files:**
- Modify: `apps/web/lib/portfolio.ts`

- [ ] **Step 1.1: Add `OwnerRoleInfo` type after `PortfolioTreeNode`**

  Add after the `PortfolioTreeNode` type definition:

  ```ts
  export type OwnerRoleInfo = {
    roleId: string;
    name: string;
    description: string | null;
    userCount: number;
  };
  ```

- [ ] **Step 1.2: TypeScript check**

  ```bash
  cd d:/OpenDigitalProductFactory/apps/web
  pnpm tsc --noEmit 2>&1 | head -10
  ```

  Expected: No errors.

- [ ] **Step 1.3: Commit**

  ```bash
  cd d:/OpenDigitalProductFactory
  git add apps/web/lib/portfolio.ts
  git commit -m "feat(web): add OwnerRoleInfo type to portfolio utils"
  ```

---

## Task 2: `getPortfolioOwnerRoles` — server cache function

**Files:**
- Modify: `apps/web/lib/portfolio-data.ts`

- [ ] **Step 2.1: Add `OwnerRoleInfo` and `PORTFOLIO_OWNER_ROLES` to the import**

  The current import from `"./portfolio"` is:
  ```ts
  import { buildPortfolioTree, formatBudget } from "./portfolio";
  ```

  Change to:
  ```ts
  import { buildPortfolioTree, formatBudget, PORTFOLIO_OWNER_ROLES, type OwnerRoleInfo } from "./portfolio";
  ```

  (`type` import prefix is correct TypeScript — no `.js` extension per `moduleResolution: "bundler"`)

- [ ] **Step 2.2: Add `getPortfolioOwnerRoles` after `getPortfolioBudgets`**

  ```ts
  /**
   * Returns owner role detail per portfolio slug.
   * React cache() deduplicates within one request.
   */
  export const getPortfolioOwnerRoles = cache(async (): Promise<Record<string, OwnerRoleInfo>> => {
    const ownerRoleIds = Object.values(PORTFOLIO_OWNER_ROLES);
    const roles = await prisma.platformRole.findMany({
      where: { roleId: { in: ownerRoleIds } },
      select: {
        roleId: true,
        name: true,
        description: true,
        _count: { select: { users: true } },
      },
    });

    const roleById = new Map(
      roles.map((r) => [
        r.roleId,
        { roleId: r.roleId, name: r.name, description: r.description, userCount: r._count.users },
      ])
    );

    return Object.fromEntries(
      Object.entries(PORTFOLIO_OWNER_ROLES).map(([slug, roleId]) => [
        slug,
        roleById.get(roleId) ?? { roleId, name: roleId, description: null, userCount: 0 },
      ])
    );
  });
  ```

  Fallback `{ roleId, name: roleId, description: null, userCount: 0 }` handles the case where roles are not yet seeded.

- [ ] **Step 2.3: TypeScript check**

  ```bash
  cd d:/OpenDigitalProductFactory/apps/web
  pnpm tsc --noEmit 2>&1 | head -10
  ```

  Expected: No errors.

- [ ] **Step 2.4: Commit**

  ```bash
  cd d:/OpenDigitalProductFactory
  git add apps/web/lib/portfolio-data.ts
  git commit -m "feat(web): add getPortfolioOwnerRoles cache function"
  ```

---

## Task 3: `page.tsx` — fetch owner roles

**Files:**
- Modify: `apps/web/app/(shell)/portfolio/[[...slug]]/page.tsx`

- [ ] **Step 3.1: Add `getPortfolioOwnerRoles` to imports and fetch**

  1. Add `getPortfolioOwnerRoles` to the portfolio-data import:
     ```ts
     import { getPortfolioTree, getAgentCounts, getPortfolioBudgets, getPortfolioOwnerRoles } from "@/lib/portfolio-data";
     ```

  2. Expand `Promise.all` to four entries:
     ```ts
     const [roots, agentCounts, budgets, ownerRoles] = await Promise.all([
       getPortfolioTree(),
       getAgentCounts(),
       getPortfolioBudgets(),
       getPortfolioOwnerRoles(),
     ]);
     ```

  3. In the node detail branch, after `const investment = ...`, derive `ownerRole`:
     ```ts
     const ownerRole = ownerRoles[rootSlug] ?? null;
     ```

  4. Pass `ownerRole` to `PortfolioNodeDetail`:
     ```tsx
     <PortfolioNodeDetail
       node={node}
       subNodes={node.children}
       products={products}
       breadcrumbs={breadcrumbs}
       agentCount={agentCount}
       health={healthStr}
       investment={investment}
       ownerRole={ownerRole}
     />
     ```

- [ ] **Step 3.2: TypeScript check**

  ```bash
  cd d:/OpenDigitalProductFactory/apps/web
  pnpm tsc --noEmit 2>&1 | head -20
  ```

  Expected: TypeScript error about `ownerRole` prop not existing on `PortfolioNodeDetail` Props — this will be resolved in Task 4.

- [ ] **Step 3.3: Commit**

  ```bash
  cd d:/OpenDigitalProductFactory
  git add "apps/web/app/(shell)/portfolio/[[...slug]]/page.tsx"
  git commit -m "feat(web): fetch portfolio owner roles in portfolio page"
  ```

---

## Task 4: `PortfolioNodeDetail` — People panel

**Files:**
- Modify: `apps/web/components/portfolio/PortfolioNodeDetail.tsx`

This is the main task — several coordinated changes to one file.

- [ ] **Step 4.1: Update import line**

  Current import line 4:
  ```ts
  import { PORTFOLIO_COLOURS, PORTFOLIO_OWNER_ROLES } from "@/lib/portfolio";
  ```

  Change to:
  ```ts
  import { PORTFOLIO_COLOURS, type OwnerRoleInfo } from "@/lib/portfolio";
  ```

  (`PORTFOLIO_OWNER_ROLES` is removed since `ownerRole` will be a prop; `OwnerRoleInfo` is the new type import)

- [ ] **Step 4.2: Add `ownerRole: OwnerRoleInfo | null` to Props type**

  Current Props:
  ```ts
  type Props = {
    node: PortfolioTreeNode;
    subNodes: PortfolioTreeNode[];
    products: Product[];
    breadcrumbs: Array<{ nodeId: string; name: string }>;
    agentCount: number;
    health: string;
    investment: string;
  };
  ```

  Add `ownerRole: OwnerRoleInfo | null`:
  ```ts
  type Props = {
    node: PortfolioTreeNode;
    subNodes: PortfolioTreeNode[];
    products: Product[];
    breadcrumbs: Array<{ nodeId: string; name: string }>;
    agentCount: number;
    health: string;
    investment: string;
    ownerRole: OwnerRoleInfo | null;
  };
  ```

- [ ] **Step 4.3: Update function destructure**

  Add `ownerRole` to the destructure:
  ```ts
  export function PortfolioNodeDetail({
    node,
    subNodes,
    products,
    breadcrumbs,
    agentCount,
    health,
    investment,
    ownerRole,
  }: Props) {
  ```

- [ ] **Step 4.4: Remove the local const derivation**

  Find and delete this line in the function body:
  ```ts
  const ownerRole = PORTFOLIO_OWNER_ROLES[rootSlug] ?? "—";
  ```

- [ ] **Step 4.5: Update the Owner StatBox**

  The current Owner StatBox uses `ownerRole` (the old string). Now `ownerRole` is `OwnerRoleInfo | null`. Update the value:

  Current:
  ```tsx
  <StatBox label="Owner" value={ownerRole} colour={colour} />
  ```

  Change to:
  ```tsx
  <StatBox label="Owner" value={ownerRole?.roleId ?? "—"} colour={colour} />
  ```

- [ ] **Step 4.6: Replace the People placeholder div**

  Find:
  ```tsx
  {/* People placeholder */}
  <div className="mt-8">
    <PlaceholderPanel label="People" description="Human role assignments — coming soon" />
  </div>
  ```

  Replace with:
  ```tsx
  {/* People */}
  <div className="mt-8">
    <PeoplePanel ownerRole={ownerRole} colour={colour} />
  </div>
  ```

- [ ] **Step 4.7: Add `PeoplePanel` component**

  Add after the `StatBox` function (before or after `PlaceholderPanel` — it will replace it):

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

- [ ] **Step 4.8: Remove `PlaceholderPanel` function**

  Find and delete the entire `PlaceholderPanel` function (it has no remaining call sites):

  ```tsx
  function PlaceholderPanel({
    label,
    description,
  }: {
    label: string;
    description: string;
  }) {
    return (
      <div className="bg-[var(--dpf-surface-1)] border border-dashed border-[var(--dpf-border)] rounded-lg p-4 opacity-50">
        <p className="text-[9px] text-[var(--dpf-muted)] uppercase tracking-widest mb-1">
          {label}
        </p>
        <p className="text-xs text-[var(--dpf-muted)]">{description}</p>
      </div>
    );
  }
  ```

- [ ] **Step 4.9: TypeScript check — must be clean**

  ```bash
  cd d:/OpenDigitalProductFactory/apps/web
  pnpm tsc --noEmit 2>&1 | head -20
  ```

  Expected: **Zero errors**.

- [ ] **Step 4.10: Run full test suite**

  ```bash
  cd d:/OpenDigitalProductFactory
  pnpm test 2>&1 | tail -20
  ```

  Expected: All 53 tests passing (42 web + 11 db).

- [ ] **Step 4.11: Commit**

  ```bash
  cd d:/OpenDigitalProductFactory
  git add apps/web/components/portfolio/PortfolioNodeDetail.tsx
  git commit -m "feat(web): replace People placeholder with live PeoplePanel"
  ```

---

## Final Verification

After all 4 tasks:

```bash
cd d:/OpenDigitalProductFactory
pnpm test 2>&1 | tail -10
```

Expected: 53 tests passing, 0 failures.

```bash
cd d:/OpenDigitalProductFactory/apps/web
pnpm tsc --noEmit 2>&1
```

Expected: No output (zero errors).
