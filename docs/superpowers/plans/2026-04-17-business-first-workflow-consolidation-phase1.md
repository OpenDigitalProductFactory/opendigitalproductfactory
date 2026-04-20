# Business-First Workflow Consolidation Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the shell feel lighter and refactor Finance into the first workflow-oriented hub so users can operate the business without navigating a broad launchpad.

**Architecture:** Keep the new shell hierarchy, but shrink the persistent left rail and remove most descriptive density so the page canvas wins visually. In Finance, add a grouped route-backed navigation model plus four new workflow hub pages (`Revenue`, `Spend`, `Close`, `Configuration`) while preserving legacy detail routes during transition.

**Tech Stack:** Next.js App Router, React server/client components, TypeScript, Tailwind utility classes with DPF CSS variables, Vitest, Docker Compose, Playwright CLI for live smoke checks.

---

## Scope

This plan intentionally covers only the first shippable slice from `docs/superpowers/specs/2026-04-17-business-first-portal-workflow-consolidation-design.md`:

- compact left rail
- finance workflow-hub consolidation

Do **not** include Platform or Admin relocation work in this plan. Those should follow once the finance pattern is proven in production.

## File Structure

### Existing files to modify

- `apps/web/app/(shell)/layout.tsx`
  - shrink the shell rail width and keep the main canvas/coworker balance intact
- `apps/web/components/shell/AppRail.tsx`
  - convert the persistent rail from card-heavy descriptive blocks to a lighter, more compact nav treatment
- `apps/web/app/(shell)/finance/page.tsx`
  - turn the current Finance launchpad into the new `Overview` hub
- `apps/web/app/(shell)/finance/reports/page.tsx`
  - align the reports index with the new finance navigation family
- `apps/web/app/(shell)/finance/settings/page.tsx`
  - align financial settings with the new finance navigation family
- `apps/web/lib/govern/permissions.test.ts`
  - keep shell nav assumptions covered if layout/section labeling changes affect expected behavior

### New files to create

- `apps/web/components/shell/AppRail.test.tsx`
  - render-level regression coverage for the compact rail behavior
- `apps/web/components/finance/finance-nav.ts`
  - canonical finance family definitions and route membership
- `apps/web/components/finance/finance-nav.test.ts`
  - tests for family membership and labels
- `apps/web/components/finance/FinanceTabNav.tsx`
  - grouped finance navigation component
- `apps/web/components/finance/FinanceTabNav.test.tsx`
  - render-level regression coverage for grouped finance navigation
- `apps/web/components/finance/FinanceSummaryCard.tsx`
  - small reusable finance hub card component for overview and family hubs
- `apps/web/app/(shell)/finance/revenue/page.tsx`
  - revenue workflow hub
- `apps/web/app/(shell)/finance/spend/page.tsx`
  - spend workflow hub
- `apps/web/app/(shell)/finance/close/page.tsx`
  - close workflow hub
- `apps/web/app/(shell)/finance/configuration/page.tsx`
  - finance configuration hub

### Existing files that are likely to need follow-up in the same slice

- `apps/web/app/(shell)/finance/banking/page.tsx`
- `apps/web/app/(shell)/finance/bills/page.tsx`
- `apps/web/app/(shell)/finance/invoices/page.tsx`
- `apps/web/app/(shell)/finance/expense-claims/page.tsx`
- `apps/web/app/(shell)/finance/my-expenses/page.tsx`
- `apps/web/app/(shell)/finance/payment-runs/page.tsx`
- `apps/web/app/(shell)/finance/payments/page.tsx`
- `apps/web/app/(shell)/finance/purchase-orders/page.tsx`
- `apps/web/app/(shell)/finance/recurring/page.tsx`
- `apps/web/app/(shell)/finance/assets/page.tsx`
- `apps/web/app/(shell)/finance/suppliers/page.tsx`

These should be updated only as needed to keep the navigation family coherent in the first slice. Do not redesign every detail page beyond what is required for route continuity and orientation.

---

## Chunk 1: Compact Shell Rail

### Task 1: Add regression coverage for the compact rail

**Files:**
- Create: `apps/web/components/shell/AppRail.test.tsx`

- [ ] **Step 1: Write the failing test**

Create a render test that proves:

- the rail still renders all grouped section labels
- the active item still shows the active marker
- the compact rail does **not** render long descriptive body copy for every destination item

Use the same testing style as `apps/web/components/compliance/ComplianceTabNav.test.tsx`.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter web exec vitest run components/shell/AppRail.test.tsx
```

Expected:
- FAIL because the test file is new and/or the current `AppRail.tsx` still renders the heavier descriptive treatment

- [ ] **Step 3: Implement the minimal test harness**

Mock:

- `next/navigation`
- `next/link`

Render:

- a small `sections` payload with one active item and one inactive item

- [ ] **Step 4: Re-run the test and confirm the intended failure**

Run:

```bash
pnpm --filter web exec vitest run components/shell/AppRail.test.tsx
```

Expected:
- FAIL with an assertion that captures the current heavy rail output

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/shell/AppRail.test.tsx
git commit -m "test(nav): add compact rail regression coverage"
```

### Task 2: Compact the shell rail

**Files:**
- Modify: `apps/web/app/(shell)/layout.tsx`
- Modify: `apps/web/components/shell/AppRail.tsx`
- Test: `apps/web/components/shell/AppRail.test.tsx`

- [ ] **Step 1: Shrink the rail width in the shell layout**

Update the `aside` width in `layout.tsx` from the current `lg:w-80` to a compact target in the `248px-256px` range.

Use a deterministic Tailwind/arbitrary width class such as:

```tsx
className="shrink-0 border-b border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] lg:w-[248px] lg:border-b-0 lg:border-r"
```

- [ ] **Step 2: Simplify the persistent rail styling**

Refactor `AppRail.tsx` so the rail is a lightweight nav, not a stack of content cards:

- keep section labels
- keep active state clarity
- reduce padding
- remove destination-level paragraph descriptions from persistent chrome
- keep theme-variable styling only

Aim for a structure closer to:

```tsx
<nav aria-label="Primary" className="grid gap-3 p-3 lg:p-4">
  <section>
    <p className="px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--dpf-muted)]">
      {section.label}
    </p>
    <div className="mt-1 space-y-1">
      ...
    </div>
  </section>
</nav>
```

- [ ] **Step 3: Make the AppRail test pass**

Run:

```bash
pnpm --filter web exec vitest run components/shell/AppRail.test.tsx
```

Expected:
- PASS

- [ ] **Step 4: Run shell-related regression tests**

Run:

```bash
pnpm --filter web exec vitest run components/shell/AppRail.test.tsx lib/govern/permissions.test.ts
```

Expected:
- PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/(shell)/layout.tsx apps/web/components/shell/AppRail.tsx apps/web/components/shell/AppRail.test.tsx apps/web/lib/govern/permissions.test.ts
git commit -m "feat(nav): compact the app rail for docked coworker layouts"
```

---

## Chunk 2: Finance Family Model

### Task 3: Define the finance families in one canonical module

**Files:**
- Create: `apps/web/components/finance/finance-nav.ts`
- Create: `apps/web/components/finance/finance-nav.test.ts`

- [ ] **Step 1: Write the failing tests for finance family mapping**

Cover:

- top-level family labels: `Overview`, `Revenue`, `Spend`, `Close`, `Configuration`
- representative route membership
- legacy detail routes mapping to the right family

Minimum route expectations:

- `/finance` → `Overview`
- `/finance/invoices` → `Revenue`
- `/finance/bills` → `Spend`
- `/finance/reports` → `Close`
- `/finance/settings` → `Configuration`
- `/finance/banking` → `Configuration`
- `/finance/expense-claims` and `/finance/my-expenses` → `Spend`

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter web exec vitest run components/finance/finance-nav.test.ts
```

Expected:
- FAIL because the module does not exist yet

- [ ] **Step 3: Implement `finance-nav.ts`**

Create:

```ts
export type FinanceFamilyKey = "overview" | "revenue" | "spend" | "close" | "configuration";

export type FinanceFamily = {
  key: FinanceFamilyKey;
  label: string;
  href: string;
  description: string;
  matchPrefixes: string[];
  subItems: Array<{ label: string; href: string }>;
};

export const FINANCE_FAMILIES: FinanceFamily[] = [...];

export function getFinanceFamily(pathname: string): FinanceFamily { ... }
```

- [ ] **Step 4: Re-run the tests**

Run:

```bash
pnpm --filter web exec vitest run components/finance/finance-nav.test.ts
```

Expected:
- PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/finance/finance-nav.ts apps/web/components/finance/finance-nav.test.ts
git commit -m "feat(finance): define workflow family route mapping"
```

### Task 4: Build grouped finance navigation

**Files:**
- Create: `apps/web/components/finance/FinanceTabNav.tsx`
- Create: `apps/web/components/finance/FinanceTabNav.test.tsx`
- Modify: `apps/web/components/finance/finance-nav.ts`
- Test: `apps/web/components/finance/finance-nav.test.ts`

- [ ] **Step 1: Write the failing render test**

Model it after the grouped `ComplianceTabNav` and `ProductTabNav` tests.

Prove:

- top-level finance families render
- only the active family's sub-navigation is shown
- legacy silo labels are not rendered as the top-level strip

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter web exec vitest run components/finance/FinanceTabNav.test.tsx
```

Expected:
- FAIL because the component does not exist yet

- [ ] **Step 3: Implement the component**

Follow the grouped pattern already used in:

- `apps/web/components/compliance/ComplianceTabNav.tsx`
- `apps/web/components/product/ProductTabNav.tsx`

Use:

- top-level tabs for families
- sub-item pills for family-local destinations
- only CSS variables for text/background/border styling

- [ ] **Step 4: Re-run finance navigation tests**

Run:

```bash
pnpm --filter web exec vitest run components/finance/finance-nav.test.ts components/finance/FinanceTabNav.test.tsx
```

Expected:
- PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/finance/FinanceTabNav.tsx apps/web/components/finance/FinanceTabNav.test.tsx apps/web/components/finance/finance-nav.ts apps/web/components/finance/finance-nav.test.ts
git commit -m "feat(finance): add grouped workflow tab navigation"
```

---

## Chunk 3: Finance Workflow Hubs

### Task 5: Create a small reusable summary card for finance hubs

**Files:**
- Create: `apps/web/components/finance/FinanceSummaryCard.tsx`

- [ ] **Step 1: Implement the reusable card component**

Create a small presentational component that accepts:

- `title`
- `description`
- `href`
- optional `metrics`
- optional `accentTone`

Use only theme-aware styling.

- [ ] **Step 2: Sanity-check the component in place**

No dedicated test required if this remains a trivial presentational unit and is exercised by page-level render tests later in the slice.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/finance/FinanceSummaryCard.tsx
git commit -m "feat(finance): add reusable workflow summary card"
```

### Task 6: Convert `/finance` into the new Overview hub

**Files:**
- Modify: `apps/web/app/(shell)/finance/page.tsx`
- Modify: `apps/web/components/finance/FinanceTabNav.tsx`
- Modify: `apps/web/components/finance/finance-nav.ts`
- Create or Modify: `apps/web/app/(shell)/finance/page.test.tsx` (only if a practical isolated render test can be added)

- [ ] **Step 1: Add the finance tab nav to the overview page**

Render `FinanceTabNav` near the top of the page so Finance now has a clear local structure.

- [ ] **Step 2: Restructure the page from launchpad to overview**

Preserve the strongest existing metrics from the current page, but reorganize them into:

- overview status
- next-step workflow cards linking to:
  - `/finance/revenue`
  - `/finance/spend`
  - `/finance/close`
  - `/finance/configuration`

Avoid reintroducing a broad flat card grid of unrelated submodules.

- [ ] **Step 3: Add a page-level regression test if practical**

If the page can be tested without excessive mocking, add a narrow render test that checks for:

- `Overview`
- `Revenue`
- `Spend`
- `Close`
- `Configuration`

If not practical, skip the page test and rely on the family/nav tests plus live smoke checks.

- [ ] **Step 4: Run affected finance tests**

Run:

```bash
pnpm --filter web exec vitest run components/finance/finance-nav.test.ts components/finance/FinanceTabNav.test.tsx
```

Expected:
- PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/(shell)/finance/page.tsx apps/web/components/finance/FinanceTabNav.tsx apps/web/components/finance/finance-nav.ts apps/web/app/(shell)/finance/page.test.tsx
git commit -m "feat(finance): turn finance home into workflow overview"
```

### Task 7: Add the Revenue, Spend, Close, and Configuration hub routes

**Files:**
- Create: `apps/web/app/(shell)/finance/revenue/page.tsx`
- Create: `apps/web/app/(shell)/finance/spend/page.tsx`
- Create: `apps/web/app/(shell)/finance/close/page.tsx`
- Create: `apps/web/app/(shell)/finance/configuration/page.tsx`
- Modify: `apps/web/components/finance/FinanceSummaryCard.tsx`
- Modify: `apps/web/components/finance/FinanceTabNav.tsx`

- [ ] **Step 1: Create the Revenue hub**

Show grouped links/summaries for:

- invoices
- outstanding receivables
- aged debtors
- revenue-by-customer

- [ ] **Step 2: Create the Spend hub**

Show grouped links/summaries for:

- bills
- suppliers
- purchase orders
- expense claims
- my expenses
- payments

- [ ] **Step 3: Create the Close hub**

Show grouped links/summaries for:

- reports
- recurring
- payment runs
- assets
- cash-flow-oriented close work

- [ ] **Step 4: Create the Configuration hub**

Show grouped links/summaries for:

- settings
- banking
- currency
- dunning

- [ ] **Step 5: Run affected tests**

Run:

```bash
pnpm --filter web exec vitest run components/finance/finance-nav.test.ts components/finance/FinanceTabNav.test.tsx
```

Expected:
- PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/(shell)/finance/revenue/page.tsx apps/web/app/(shell)/finance/spend/page.tsx apps/web/app/(shell)/finance/close/page.tsx apps/web/app/(shell)/finance/configuration/page.tsx apps/web/components/finance/FinanceSummaryCard.tsx apps/web/components/finance/FinanceTabNav.tsx
git commit -m "feat(finance): add workflow hub landing pages"
```

### Task 8: Integrate existing finance detail pages with the new family model

**Files:**
- Modify: `apps/web/app/(shell)/finance/reports/page.tsx`
- Modify: `apps/web/app/(shell)/finance/settings/page.tsx`
- Modify as needed:
  - `apps/web/app/(shell)/finance/banking/page.tsx`
  - `apps/web/app/(shell)/finance/invoices/page.tsx`
  - `apps/web/app/(shell)/finance/bills/page.tsx`
  - `apps/web/app/(shell)/finance/expense-claims/page.tsx`
  - `apps/web/app/(shell)/finance/my-expenses/page.tsx`
  - `apps/web/app/(shell)/finance/payment-runs/page.tsx`
  - `apps/web/app/(shell)/finance/purchase-orders/page.tsx`
  - `apps/web/app/(shell)/finance/recurring/page.tsx`
  - `apps/web/app/(shell)/finance/assets/page.tsx`
  - `apps/web/app/(shell)/finance/suppliers/page.tsx`

- [ ] **Step 1: Add `FinanceTabNav` to the reports and settings indexes**

Those two are the strongest current examples of isolated launchpads and should immediately feel part of the new family structure.

- [ ] **Step 2: Add `FinanceTabNav` to the highest-traffic detail indexes**

Prioritize:

- `invoices/page.tsx`
- `bills/page.tsx`
- `banking/page.tsx`

Only extend further if needed to keep the experience coherent within the first slice.

- [ ] **Step 3: Keep breadcrumbs secondary**

Do not remove useful breadcrumbs on deeper pages if they help orientation, but ensure the grouped finance nav is now the primary sibling-switching mechanism.

- [ ] **Step 4: Run finance navigation regressions**

Run:

```bash
pnpm --filter web exec vitest run components/finance/finance-nav.test.ts components/finance/FinanceTabNav.test.tsx
```

Expected:
- PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/(shell)/finance/reports/page.tsx apps/web/app/(shell)/finance/settings/page.tsx apps/web/app/(shell)/finance/banking/page.tsx apps/web/app/(shell)/finance/invoices/page.tsx apps/web/app/(shell)/finance/bills/page.tsx
git commit -m "feat(finance): align detail indexes with workflow navigation"
```

---

## Chunk 4: Verification And Live Smoke Check

### Task 9: Run the full verification gate

**Files:**
- No code changes

- [ ] **Step 1: Run the focused unit tests**

Run:

```bash
pnpm --filter web exec vitest run components/shell/AppRail.test.tsx components/finance/finance-nav.test.ts components/finance/FinanceTabNav.test.tsx lib/govern/permissions.test.ts
```

Expected:
- PASS

- [ ] **Step 2: Run any page tests added during the slice**

Run:

```bash
pnpm --filter web exec vitest run "app/(shell)/finance/page.test.tsx"
```

Expected:
- PASS, if the page test exists

- [ ] **Step 3: Run the production build**

Run:

```bash
pnpm --filter web build
```

Expected:
- PASS with exit code `0`

- [ ] **Step 4: Rebuild the live portal image**

Run:

```bash
docker compose up -d --build portal
```

Expected:
- portal container rebuilt and healthy

- [ ] **Step 5: Perform live browser smoke checks**

Use Playwright CLI against the running portal and verify:

- `/workspace`
  - left rail is visually lighter and narrower
- `/finance`
  - overview hub is visible
- `/finance/revenue`
  - grouped finance nav is present and `Revenue` is active
- `/finance/configuration`
  - grouped finance nav is present and `Configuration` is active

- [ ] **Step 6: Commit final implementation if verification passes**

```bash
git add apps/web/app/(shell)/layout.tsx apps/web/components/shell/AppRail.tsx apps/web/components/shell/AppRail.test.tsx apps/web/components/finance/finance-nav.ts apps/web/components/finance/finance-nav.test.ts apps/web/components/finance/FinanceTabNav.tsx apps/web/components/finance/FinanceTabNav.test.tsx apps/web/components/finance/FinanceSummaryCard.tsx apps/web/app/(shell)/finance/page.tsx apps/web/app/(shell)/finance/revenue/page.tsx apps/web/app/(shell)/finance/spend/page.tsx apps/web/app/(shell)/finance/close/page.tsx apps/web/app/(shell)/finance/configuration/page.tsx apps/web/app/(shell)/finance/reports/page.tsx apps/web/app/(shell)/finance/settings/page.tsx
git commit -m "feat(finance): introduce workflow hubs and compact shell rail"
```

---

## Notes For The Implementer

- Use the PR workflow in this repository. Create one short-lived intent-named branch (`feat/*`, `fix/*`, `chore/*`, `doc/*`, or `clean/*`) for this slice, and do not push directly to `main`.
- The workspace is already dirty with unrelated local files and in-progress coworker layout work. Do not stage or revert:
  - `.admin-credentials`
  - `.host-profile.json`
  - `.codex`
  - any unrelated agent-panel files unless they are intentionally part of the current change
- Keep all styling theme-aware. No hardcoded text/background/border colors except the existing allowed `text-white` on accent buttons.
- Prefer reusing the grouped nav patterns already established in Compliance and Product detail instead of inventing a new finance navigation idiom.
- Keep this slice additive and reversible. Do not try to physically relocate every finance detail route yet.

## Completion Criteria

Phase 1 is complete when:

- the shell rail is noticeably lighter and narrower on desktop
- Finance has a clear grouped local navigation model
- Finance now has workflow hub pages for `Revenue`, `Spend`, `Close`, and `Configuration`
- the Finance overview page feels like an operating summary, not a broad launchpad
- focused tests pass
- `pnpm --filter web build` passes
- the rebuilt live portal passes the smoke checks above

---

Plan complete and saved to `docs/superpowers/plans/2026-04-17-business-first-workflow-consolidation-phase1.md`. Ready to execute?
