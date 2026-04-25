# Customer Marketing Workspace Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first internal `/customer/marketing` workspace slice: strategy-first UI, relocated marketing specialist routing, dedicated marketing capabilities, and Phase 1 marketing data models.

**Architecture:** This plan intentionally covers only Phase 1 from `docs/superpowers/specs/2026-04-24-customer-marketing-workspace-design.md`. The implementation splits into four layers that must land together: access control, coworker routing, Phase 1 Prisma models, and the new `/customer/marketing` UI. The critical design constraint is that marketing moves under `/customer` without accidentally granting access to non-marketing customer routes.

**Tech Stack:** Next.js 16 app router, Prisma 7, TypeScript, Vitest, PostgreSQL, existing DPF coworker routing and skill seeding

**Spec:** `docs/superpowers/specs/2026-04-24-customer-marketing-workspace-design.md`

---

## Scope Check

The spec now spans four phases. Do **not** implement Phases 2-4 in this plan.

- Phase 1 only:
  - dedicated marketing capabilities
  - `/customer/marketing` route family
  - marketing-specialist relocation
  - storefront replacement persona
  - `MarketingStrategy` + `MarketingReview`
  - strategy-first landing page
  - missing `review-inbox` skill file
- Defer to follow-on plans:
  - `MarketingCampaign`
  - `MarketingAutomation`
  - proactive review loop persistence beyond basic `MarketingReview`
  - published customer-facing marketing snapshot / GAID-trusted external coworker

## File Map

### Access control and grants

- Modify: `apps/web/lib/govern/permissions.ts`
- Modify: `apps/web/lib/govern/permissions.test.ts`
- Modify: `apps/web/lib/mcp-tools.ts`
- Modify: `apps/web/lib/tak/agent-grants.ts`
- Modify: `apps/web/lib/tak/agent-grants.test.ts`
- Modify: `packages/db/src/seed.ts`

### Route ownership and coworker behavior

- Modify: `apps/web/lib/tak/agent-routing.ts`
- Modify: `apps/web/lib/tak/agent-routing.test.ts`
- Modify: `apps/web/lib/tak/route-context-map.ts`
- Modify: `apps/web/lib/tak/route-context-map.test.ts`
- Create: `skills/storefront/review-inbox.skill.md`

### Marketing data model

- Modify: `packages/db/prisma/schema.prisma`
- **Generated** (do not author by hand): `packages/db/prisma/migrations/<timestamp>_customer_marketing_phase1/migration.sql` — produced by `prisma migrate dev --name customer_marketing_phase1`. The `<timestamp>` prefix is generated; the implementer does not pick it.
- Create: `apps/web/lib/marketing.ts`

### Customer marketing UI

- Modify: `apps/web/app/(shell)/customer/layout.tsx`
- Modify: `apps/web/components/customer/CustomerTabNav.tsx`
- Create: `apps/web/components/customer/CustomerTabNav.test.tsx`
- Create: `apps/web/app/(shell)/customer/marketing/layout.tsx` (Task 8 owns gate, Task 9 owns nav)
- Create: `apps/web/app/(shell)/customer/marketing/page.tsx`
- Create: `apps/web/app/(shell)/customer/marketing/strategy/page.tsx`
- **Deferred to Phase 2:** `marketing/campaigns/`, `marketing/funnel/`, `marketing/automation/` pages — the IA tabs for these surfaces appear in Phase 1 as "Coming soon" via `MarketingTabNav`, no page files are created.
- Create: `apps/web/components/customer-marketing/MarketingTabNav.tsx`
- Create: `apps/web/components/customer-marketing/MarketingStrategyOverview.tsx`
- Move (route-group restructure for Task 8): `apps/web/app/(shell)/customer/{page,[id],engagements,funnel,opportunities,quotes,sales-orders}` → `apps/web/app/(shell)/customer/(crm)/...`

### Verification

- Run: targeted Vitest for permissions, routing, nav, and coworker skills
- Run: `pnpm --filter web typecheck`
- Run: `cd apps/web && npx next build`
- Run: browser QA on `/customer/marketing`, `/customer`, `/storefront`, and legacy redirects

## Chunk 1: Capability Split and Safe Access Boundaries

### Task 1: Add the Phase 1 marketing capability family

**Files:**

- Modify: `apps/web/lib/govern/permissions.ts`
- Test: `apps/web/lib/govern/permissions.test.ts`

- [ ] **Step 1: Add the new capability keys**

  Extend `CapabilityKey` with:

  ```ts
  | "view_marketing"
  | "operate_marketing"
  | "publish_marketing"
  ```

- [ ] **Step 2: Add role mappings that preserve current marketing reach**

  In `PERMISSIONS`, add:

  ```ts
  view_marketing:    { roles: ["HR-000", "HR-200", "HR-300"] },
  operate_marketing: { roles: ["HR-000", "HR-200", "HR-300"] },
  publish_marketing: { roles: ["HR-000", "HR-200"] },
  ```

  Rationale:
  - `view_marketing` / `operate_marketing` inherit the current internal marketing audience from `view_storefront`
  - `publish_marketing` stays narrower because it is the future externally visible approval boundary

- [ ] **Step 3: Add failing permission tests first**

  Add tests that prove:
  - `HR-300` can `view_marketing`
  - `HR-300` can `operate_marketing`
  - `HR-300` cannot `publish_marketing`
  - `HR-500` cannot access any marketing capability

- [ ] **Step 4: Run the permission test file**

  Run:

  ```bash
  pnpm --filter web exec vitest run apps/web/lib/govern/permissions.test.ts
  ```

- [ ] **Step 5: Commit**

  ```text
  feat(marketing): add dedicated marketing capabilities
  ```

### Task 2: Re-key platform marketing tools to the new capability

**Files:**

- Modify: `apps/web/lib/mcp-tools.ts`

- [ ] **Step 1: Change the three existing marketing tools**

  In `PLATFORM_TOOLS`, update:
  - `get_marketing_summary.requiredCapability`
  - `suggest_campaign_ideas.requiredCapability`
  - `analyze_seo_opportunity.requiredCapability`

  from:

  ```ts
  "view_storefront"
  ```

  to:

  ```ts
  "view_marketing"
  ```

- [ ] **Step 2: Preserve storefront-only tools**

  Do **not** change storefront presentation tools or route them through `view_marketing`. `view_storefront` must remain the capability for sections, items, public presentation, inbox, team, and settings.

- [ ] **Step 3: Verify tool schema still compiles**

  Run:

  ```bash
  pnpm --filter web typecheck
  ```

- [ ] **Step 4: Commit**

  ```text
  feat(marketing): re-key marketing MCP tools to view_marketing
  ```

### Task 3: Add the agent rows, sync grants, and add the invariant guard

**Context — verified before authoring this task:**

- `marketing-specialist` is currently a skill-only persona — it appears in `apps/web/lib/tak/agent-routing.ts` and `packages/db/src/seed-skills.ts`'s `ALL_AGENT_IDS`, but it is **not** in `packages/db/src/seed.ts` `HARDCODED_COWORKER_GRANTS` (verified line 928–943) and **not** in `packages/db/data/agent_registry.json`.
- `storefront-advisor` does not exist anywhere in the codebase yet.
- The agent-grant slugs `marketing_read` and `marketing_write` **already exist** in `apps/web/lib/tak/agent-grants.ts` and the tool→grant mapping (lines 131–135) already wires the three marketing tools to `marketing_read`. **Do not redefine these slugs** — this task is a seed/grants sync, not a taxonomy change.

Without the agent rows, granting tools to them is the silent-grant-failure pattern (project_agent_grant_seeding_gap) — the seed succeeds, and every tool call still denies.

**Files:**

- Modify: `apps/web/lib/tak/agent-grants.ts`
- Modify: `apps/web/lib/tak/agent-grants.test.ts`
- Modify: `packages/db/src/seed.ts`
- Modify: `packages/db/data/agent_registry.json` (if registry-driven seeding is the source of truth for the new `storefront-advisor` agent)

- [ ] **Step 1: Add the two new agent rows to the registry/seed**

  Before granting anything, the agent rows must exist. Inspect `packages/db/data/agent_registry.json` and `packages/db/src/seed.ts` to determine which is authoritative for new coworker creation.

  Add agent definitions for:

  ```text
  agentId: marketing-specialist
  agentName: Marketing Strategist
  tier / type / valueStream: match adjacent acquisition-domain personas

  agentId: storefront-advisor
  agentName: Storefront Operations Manager
  tier / type / valueStream: match adjacent ops-domain personas
  ```

  Verify both appear in any registry-derived enums or `ALL_AGENT_IDS` lists. `marketing-specialist` is already in `ALL_AGENT_IDS` (`packages/db/src/seed-skills.ts:39`); `storefront-advisor` must be added.

- [ ] **Step 2: Confirm tool-to-grant mapping unchanged**

  In `apps/web/lib/tak/agent-grants.ts`, confirm (do NOT re-add) the existing mapping:

  ```ts
  get_marketing_summary:   ["marketing_read"],
  suggest_campaign_ideas:  ["marketing_read"],
  analyze_seo_opportunity: ["marketing_read"],
  ```

  The Phase 1 change is at the user capability layer (Task 1–2). The agent grant slugs already exist and are correctly wired.

- [ ] **Step 3: Add coworker grants in `HARDCODED_COWORKER_GRANTS`**

  In `packages/db/src/seed.ts` `HARDCODED_COWORKER_GRANTS` (line ~928):

  - Add `marketing-specialist` → `["marketing_read", "marketing_write", "consumer_read", "registry_read"]` (mirror adjacent specialist scope; do NOT include `consumer_write` unless required by an existing skill).
  - Update `customer-advisor` to add `"marketing_read"` (read-only marketing context for the customer-success view per spec §9.2).
  - Add `storefront-advisor` with the operational grant set previously implied by `view_storefront` on storefront ops (sections, items, inbox, team, settings) — match the grant slugs the storefront skills already require, do not invent new ones.

- [ ] **Step 4: Add the spec §9.2 step-5 invariant guard**

  Spec §9.2 step 5 mandates a guard verifying every persona that previously held storefront-marketing-grants now holds marketing grants. Add to `agent-grants.test.ts` (or a new `marketing-grants.invariant.test.ts`):

  - **Migration invariant:** the union of personas with `marketing_read` ⊇ the union of personas that historically held `view_storefront` for marketing-tool access. (Concretely: `marketing-specialist` and `customer-advisor` must hold `marketing_read`.)
  - **Tool→grant integrity:** the three marketing tools still require `marketing_read`.
  - **Negative guard:** `storefront-advisor` does NOT hold `marketing_read` or `marketing_write` (the relocation must not double-route marketing through the storefront persona).
  - **Negative guard:** the fallback "planner" grant set cannot use marketing tools.

- [ ] **Step 5: Re-seed the database locally and verify rows landed**

  Run:

  ```bash
  pnpm --filter @dpf/db exec prisma db seed
  ```

  Then verify (do NOT rely on seed exit code alone — silent-skip is the documented failure mode):

  ```bash
  docker compose exec -T postgres psql -U dpf -d dpf -c "SELECT \"agentId\" FROM \"Agent\" WHERE \"agentId\" IN ('marketing-specialist', 'storefront-advisor');"
  docker compose exec -T postgres psql -U dpf -d dpf -c "SELECT \"agentId\", grant FROM \"AgentToolGrant\" WHERE \"agentId\" IN ('marketing-specialist', 'customer-advisor', 'storefront-advisor') ORDER BY \"agentId\", grant;"
  ```

  Expected:
  - both agent rows present
  - `marketing-specialist` has `marketing_read` + `marketing_write`
  - `customer-advisor` has `marketing_read` (in addition to its existing grants)
  - `storefront-advisor` has its operational storefront grants but no marketing grants

- [ ] **Step 6: Commit**

  ```text
  feat(marketing): add marketing-specialist + storefront-advisor agents and sync grants
  ```

## Chunk 2: Route Ownership, Persona Relocation, and Skill Surface

### Task 4: Move the marketing specialist from `/storefront` to `/customer/marketing`

**Files:**

- Modify: `apps/web/lib/tak/agent-routing.ts`
- Modify: `apps/web/lib/tak/agent-routing.test.ts`
- Modify: `apps/web/lib/tak/route-context-map.ts`
- Modify: `apps/web/lib/tak/route-context-map.test.ts`

- [ ] **Step 1: Add explicit `/customer/marketing` route entries before `/customer`**

  In both routing maps, add entries for the routes that ship in Phase 1:

  ```text
  /customer/marketing
  /customer/marketing/strategy
  ```

  `/customer/marketing/campaigns`, `/funnel`, and `/automation` routing entries are deferred to the Phase 2 plan (when their pages land). The longest-prefix matcher in `agent-routing.ts` handles `/customer/marketing/*` resolution generically — adding a single `/customer/marketing` prefix entry is sufficient if the resolver matches by prefix; verify against `agent-routing.ts:515` matching logic before deciding whether to enumerate sub-paths.

- [ ] **Step 2: Point those routes at `marketing-specialist` and refresh welcome copy**

  The `/customer/marketing*` entry should:
  - use `agentId: "marketing-specialist"`
  - require `view_marketing`
  - expose the existing marketing skill bundle (campaign-ideas, content-brief, review-inbox, marketing-health, seo-content-optimizer, email-campaign-builder, competitive-analysis)
  - replace the existing welcome line for `marketing-specialist` (currently in `agent-routing.ts` near line 733, framed as "engagement specialist") with strategy-first copy describing strategy review, campaigns, funnel analysis, and automation readiness — per spec §6.1
  - greet message should match the strategy-first landing experience the UI will render in Task 10

- [ ] **Step 3: Replace the `/storefront` coworker**

  Remove the marketing-specialist mapping from `/storefront` and replace it with:
  - `agentId: "storefront-advisor"`
  - `agentName: "Storefront Operations Manager"`
  - skills focused on sections, items/services, inbox, team, and settings

  Do not leave `/storefront` without a coworker.

- [ ] **Step 4: Update route-context copy and domain tools**

  In `route-context-map.ts`:
  - rewrite `/storefront` domain context to focus on portal operations
  - add a dedicated `/customer/marketing` domain context for acquisition strategy
  - keep `get_marketing_summary` in marketing routes, not generic storefront ops

- [ ] **Step 5: Add routing tests before implementation**

  Add tests proving:
  - `/customer/marketing` resolves to `marketing-specialist`
  - `/customer/marketing/strategy` resolves to `marketing-specialist`
  - `/customer` still resolves to `customer-advisor`
  - `/customer/engagements` (and other CRM routes) still resolve to `customer-advisor`
  - `/storefront` resolves to `storefront-advisor` (NOT `marketing-specialist`, NOT undefined)

- [ ] **Step 6: Run the routing test suite**

  Run:

  ```bash
  pnpm --filter web exec vitest run apps/web/lib/tak/agent-routing.test.ts apps/web/lib/tak/route-context-map.test.ts
  ```

- [ ] **Step 7: Commit**

  ```text
  feat(marketing): relocate marketing specialist to customer marketing routes
  ```

### Task 5: Materialize the missing `review-inbox` skill file

**Files:**

- Create: `skills/storefront/review-inbox.skill.md`
- Modify: `packages/db/src/seed-skills.ts` only if a new agent ID requires inclusion

- [ ] **Step 1: Create the skill file with frontmatter**

  Use:

  ```md
  ---
  name: review-inbox
  description: "Spot marketing opportunities in recent interactions"
  category: storefront
  assignTo: ["marketing-specialist"]
  capability: "view_marketing"
  taskType: "analysis"
  triggerPattern: "inbox|messages|questions|faq|marketing opportunities"
  userInvocable: true
  agentInvocable: true
  allowedTools: [get_marketing_summary]
  composesFrom: []
  contextRequirements: []
  riskBand: low
  ---
  ```

- [ ] **Step 2: Mirror the current inline prompt behavior**

  Body should instruct the specialist to:
  - summarize recent inbox or inquiry activity
  - identify FAQ candidates
  - detect quiet periods or recurrent demand
  - suggest concrete follow-up campaigns or proof assets

- [ ] **Step 3: Re-run skill seed**

  Run:

  ```bash
  pnpm --filter @dpf/db exec prisma db seed
  ```

- [ ] **Step 4: Commit**

  ```text
  feat(marketing): add review-inbox skill file for marketing specialist
  ```

## Chunk 3: Phase 1 Data Model and Strategy Seeding

### Task 6: Add `MarketingStrategy` and `MarketingReview` to Prisma

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Generated by `prisma migrate dev`: `packages/db/prisma/migrations/<timestamp>_customer_marketing_phase1/migration.sql`
- Create: `apps/web/lib/marketing.ts`

- [ ] **Step 1: Add the enum source-of-truth file first**

  Create `apps/web/lib/marketing.ts` with `as const` arrays and union types for:
  - `MARKETING_STRATEGY_STATUS`
  - `MARKETING_ROUTE_TO_MARKET`
  - `MARKETING_LOCALITY_MODEL`
  - `MARKETING_REVIEW_CADENCE`
  - `MARKETING_PROOF_ASSET_TYPE`
  - `MARKETING_REVIEW_TYPE`
  - `MARKETING_CHANNELS`

  Example pattern:

  ```ts
  export const MARKETING_STRATEGY_STATUS = ["draft", "active", "archived"] as const;
  export type MarketingStrategyStatus = typeof MARKETING_STRATEGY_STATUS[number];
  ```

- [ ] **Step 2: Add the Prisma models**

  In `schema.prisma`, add:
  - `MarketingStrategy`
  - `MarketingReview`

  Key constraints:
  - `MarketingStrategy.organizationId` is unique
  - `MarketingReview.strategyId` is required
  - `MarketingStrategy.storefrontId` is nullable
  - JSON fields match the spec instead of premature normalization

- [ ] **Step 3: Generate the migration**

  Run:

  ```bash
  pnpm --filter @dpf/db exec prisma migrate dev --name customer_marketing_phase1
  ```

  This migration should be pure additive DDL. Do not hand-edit prior migration files.

- [ ] **Step 4: Inspect the generated SQL**

  Confirm the migration only:
  - creates the two new tables
  - adds indexes / unique constraint
  - does not attempt a risky backfill

  Phase 1 initial strategy creation will happen via app logic on first load, not by migration ETL.

- [ ] **Step 5: Run Prisma generate and typecheck**

  Run:

  ```bash
  pnpm --filter @dpf/db exec prisma generate
  pnpm --filter web typecheck
  ```

- [ ] **Step 6: Commit**

  ```text
  feat(marketing): add phase1 marketing strategy and review models
  ```

### Task 7: Build a first-load strategy initializer

**Files:**

- Create or extend: `apps/web/lib/marketing.ts`
- Modify: `apps/web/app/(shell)/customer/marketing/page.tsx`

- [ ] **Step 1: Add a server-safe initializer helper**

  Implement helper(s) that:
  - find the canonical `Organization` (single-org-per-install)
  - read `BusinessContext`
  - read `StorefrontConfig` and its `archetypeId`
  - return an existing or newly-created draft `MarketingStrategy`

  Seed values should come from:
  - `BusinessContext.targetMarket`
  - `BusinessContext.customerSegments`
  - `BusinessContext.geographicScope`
  - `StorefrontConfig.archetypeId`
  - organization website/address if available

- [ ] **Step 2: Use Prisma `upsert`, not read-then-create**

  The helper must be safe to call on every page load AND safe under concurrent first-hits (e.g., two tabs opening the page simultaneously). Use:

  ```ts
  await prisma.marketingStrategy.upsert({
    where: { organizationId },         // unique per spec §8.2
    update: {},                        // never overwrite an existing draft
    create: { organizationId, /* seed fields */ },
  });
  ```

  Read-then-create races would attempt two inserts and one would throw on the unique constraint. `upsert` collapses the race. Pattern matches `bootstrap-first-run.ts` in this codebase.

- [ ] **Step 3: Add a low-level verification step**

  After hitting the page once, run:

  ```bash
  docker compose exec -T postgres psql -U dpf -d dpf -c "SELECT \"strategyId\", \"organizationId\", status, \"routeToMarket\" FROM \"MarketingStrategy\";"
  ```

- [ ] **Step 4: Commit**

  ```text
  feat(marketing): auto-seed a draft marketing strategy from existing business context
  ```

## Chunk 4: Customer Marketing UI and Navigation

### Task 8: Use route groups so the security boundary fails closed

**Why this is restructured from per-page gating:** the original per-page-gate approach (widen the shared layout, then re-tighten every leaf page) is fail-open by default — any new customer page added later that forgets the per-page guard would leak to marketing-only roles. Route grouping inverts this: each capability group has its own layout that gates on the right capability, and any new page added inside a group inherits the correct gate automatically. Aligns with the "architecture over shortcuts" preference.

**Target shape:**

```text
apps/web/app/(shell)/customer/
  layout.tsx                 # gates on view_customer || view_marketing (thin shell only)
  (crm)/                     # NEW route group — all existing CRM pages move here
    layout.tsx               # gates on view_customer (fail-closed for new CRM pages)
    page.tsx                 # was customer/page.tsx (Accounts)
    [id]/page.tsx
    engagements/page.tsx
    opportunities/page.tsx
    opportunities/[id]/page.tsx
    quotes/page.tsx
    sales-orders/page.tsx
    funnel/page.tsx
  marketing/                 # NEW
    layout.tsx               # gates on view_marketing (fail-closed for new marketing pages)
    page.tsx                 # strategy-first landing (Task 10)
    strategy/page.tsx        # (Task 10)
```

Route groups (`(crm)`) do not affect URLs — `app/(shell)/customer/(crm)/page.tsx` still serves `/customer`, `app/(shell)/customer/(crm)/engagements/page.tsx` still serves `/customer/engagements`, etc.

**Files:**

- Modify: `apps/web/app/(shell)/customer/layout.tsx` — thin shell, gate on `view_customer || view_marketing`
- Create: `apps/web/app/(shell)/customer/(crm)/layout.tsx` — gate on `view_customer`
- Move: `apps/web/app/(shell)/customer/page.tsx` → `apps/web/app/(shell)/customer/(crm)/page.tsx`
- Move: `apps/web/app/(shell)/customer/[id]/page.tsx` → `apps/web/app/(shell)/customer/(crm)/[id]/page.tsx`
- Move: `apps/web/app/(shell)/customer/engagements/page.tsx` → `apps/web/app/(shell)/customer/(crm)/engagements/page.tsx`
- Move: `apps/web/app/(shell)/customer/funnel/page.tsx` → `apps/web/app/(shell)/customer/(crm)/funnel/page.tsx`
- Move: `apps/web/app/(shell)/customer/opportunities/page.tsx` → `apps/web/app/(shell)/customer/(crm)/opportunities/page.tsx`
- Move: `apps/web/app/(shell)/customer/opportunities/[id]/page.tsx` → `apps/web/app/(shell)/customer/(crm)/opportunities/[id]/page.tsx`
- Move: `apps/web/app/(shell)/customer/quotes/page.tsx` → `apps/web/app/(shell)/customer/(crm)/quotes/page.tsx`
- Move: `apps/web/app/(shell)/customer/sales-orders/page.tsx` → `apps/web/app/(shell)/customer/(crm)/sales-orders/page.tsx`
- Create: `apps/web/app/(shell)/customer/marketing/layout.tsx` — gate on `view_marketing` (already in Task 9 file map; note ownership here)

- [ ] **Step 1: Move existing CRM pages into the `(crm)` route group**

  Use `git mv` so move history is preserved. Confirm URLs are unchanged after the move (route groups are URL-transparent).

- [ ] **Step 2: Create `(crm)/layout.tsx` that gates on `view_customer`**

  This layout runs `notFound()` (or the project's standard 404/403 path) when the user lacks `view_customer`. It is the only place CRM access is gated.

- [ ] **Step 3: Thin the parent `customer/layout.tsx`**

  Reduce to a shell that gates on `view_customer || view_marketing`. Move any chrome that is CRM-specific (sub-nav, headers) into the `(crm)/layout.tsx`. The Marketing tab visibility is handled by `CustomerTabNav` in Task 9.

- [ ] **Step 4: Create `marketing/layout.tsx` that gates on `view_marketing`**

  Mirror `(crm)/layout.tsx`'s gating pattern. (This file is also listed in Task 9 — that's fine; this task owns the gating logic, Task 9 owns the nested nav rendering.)

- [ ] **Step 5: Verify the security boundary manually**

  - `HR-200`: `/customer`, `/customer/engagements`, `/customer/marketing` all work
  - `HR-300`: `/customer/marketing` works; `/customer` returns 404; `/customer/engagements` returns 404
  - `HR-500`: all customer routes return 404

- [ ] **Step 6: Commit**

  ```text
  feat(marketing): split /customer into (crm) and marketing route groups for fail-closed gating
  ```

### Task 9: Add the top-level Marketing tab and nested marketing nav

**Files:**

- Modify: `apps/web/components/customer/CustomerTabNav.tsx`
- Create: `apps/web/components/customer/CustomerTabNav.test.tsx`
- Create: `apps/web/components/customer-marketing/MarketingTabNav.tsx`
- Create: `apps/web/app/(shell)/customer/marketing/layout.tsx`

- [ ] **Step 1: Make `CustomerTabNav` capability-aware**

  Replace the current static tab list with entries that include capability keys:

  ```ts
  [
    { label: "Accounts", href: "/customer", capability: "view_customer" },
    { label: "Engagements", href: "/customer/engagements", capability: "view_customer" },
    { label: "Pipeline", href: "/customer/opportunities", capability: "view_customer" },
    { label: "Quotes", href: "/customer/quotes", capability: "view_customer" },
    { label: "Orders", href: "/customer/sales-orders", capability: "view_customer" },
    { label: "Funnel", href: "/customer/funnel", capability: "view_customer" },
    { label: "Marketing", href: "/customer/marketing", capability: "view_marketing" },
  ]
  ```

- [ ] **Step 2: Pass the current user context into the tab nav**

  Update `customer/layout.tsx` so `CustomerTabNav` can filter visible tabs. Do not show inaccessible customer tabs to a marketing-only user.

- [ ] **Step 3: Create the nested Marketing tab strip**

  Add `MarketingTabNav.tsx`. In Phase 1, only Overview and Strategy are clickable; Campaigns / Funnel / Automation render as visibly disabled "Coming soon" entries to anchor the IA without producing 404s:

  ```ts
  [
    { label: "Overview",   href: "/customer/marketing",          enabled: true },
    { label: "Strategy",   href: "/customer/marketing/strategy", enabled: true },
    { label: "Campaigns",  href: "/customer/marketing/campaigns",  enabled: false, reason: "Phase 2" },
    { label: "Funnel",     href: "/customer/marketing/funnel",     enabled: false, reason: "Phase 3" },
    { label: "Automation", href: "/customer/marketing/automation", enabled: false, reason: "Phase 2" },
  ]
  ```

  The Phase 2 plan re-enables Campaigns / Automation; Phase 3 re-enables Funnel. Disabled-tab styling uses DPF theme tokens (no hardcoded colors).

- [ ] **Step 4: Add nav tests before wiring UI**

  Add tests proving:
  - `HR-200` sees both customer tabs and Marketing
  - `HR-300` sees only Marketing inside the customer shell
  - active-state matching works for `/customer/marketing/*`

- [ ] **Step 5: Run the nav tests**

  Run:

  ```bash
  pnpm --filter web exec vitest run apps/web/components/customer/CustomerTabNav.test.tsx
  ```

- [ ] **Step 6: Commit**

  ```text
  feat(marketing): add customer marketing navigation
  ```

### Task 10: Build the strategy-first landing experience

**Scope (Phase 1 only):** spec §14 Phase 1 calls for the strategy-first landing page backed by `MarketingStrategy`. The campaigns / funnel / automation sub-routes belong to Phase 2/3 — do not stub them in Phase 1. The nested Marketing tab strip from Task 9 should disable or omit those entries until their phases land.

**Files:**

- Create: `apps/web/app/(shell)/customer/marketing/page.tsx` — landing page (also serves `/customer/marketing/strategy` redirect or shared component)
- Create: `apps/web/app/(shell)/customer/marketing/strategy/page.tsx`
- Create: `apps/web/components/customer-marketing/MarketingStrategyOverview.tsx`

(`apps/web/app/(shell)/customer/marketing/layout.tsx` is created in Task 8 with the `view_marketing` gate.)

- [ ] **Step 1: Create a shared strategy summary component**

  `MarketingStrategyOverview.tsx` should render:
  - business / archetype summary
  - route to market
  - geographic scope / territories
  - target segments / ICPs
  - primary channels
  - proof assets snapshot
  - review cadence + next review date

  Use DPF theme variables only. No hardcoded text, border, or background colors.

- [ ] **Step 2: Implement `/customer/marketing` as the real landing page**

  The landing page should answer the eight questions from spec §6.1 and surface:
  - "what we know" (read from `MarketingStrategy`)
  - "what needs review" (stale fields, `nextReviewAt` past due)
  - "what the specialist suggests next" (latest `MarketingReview.suggestedActions`)

  Back this page with the Task 7 initializer + `MarketingStrategy`, not static placeholder copy.

- [ ] **Step 3: Implement `/customer/marketing/strategy`**

  Reuse the landing summary with slightly fuller detail (full proof asset list, full segment list, constraints). No write affordances in Phase 1 — strategy edits land in Phase 2 alongside the review loop.

- [ ] **Step 4: Update `MarketingTabNav` to reflect Phase 1 reality**

  The nested Marketing tab strip from Task 9 lists Overview / Strategy / Campaigns / Funnel / Automation. In Phase 1, mark Campaigns / Funnel / Automation as disabled or visibly "Coming soon" in the nav so users see the IA without hitting 404s. Do NOT create page files for them.

- [ ] **Step 5: Keep `/storefront` focused on storefront operations**

  Verify no marketing strategy copy remains on the `/storefront` root page or in its coworker default framing (this should be covered by Task 4, but double-check after the relocation).

- [ ] **Step 6: Commit**

  ```text
  feat(marketing): add strategy-first customer marketing workspace
  ```

## Chunk 5: Verification, QA, and Handoff

### Task 11: Run automated verification

**Files:**

- Test: `apps/web/lib/govern/permissions.test.ts`
- Test: `apps/web/lib/tak/agent-grants.test.ts`
- Test: `apps/web/lib/tak/agent-routing.test.ts`
- Test: `apps/web/lib/tak/route-context-map.test.ts`
- Test: `apps/web/components/customer/CustomerTabNav.test.tsx`

- [ ] **Step 1: Run targeted Vitest**

  Run:

  ```bash
  pnpm --filter web exec vitest run apps/web/lib/govern/permissions.test.ts apps/web/lib/tak/agent-grants.test.ts apps/web/lib/tak/agent-routing.test.ts apps/web/lib/tak/route-context-map.test.ts apps/web/components/customer/CustomerTabNav.test.tsx
  ```

- [ ] **Step 2: Run app typecheck**

  Run:

  ```bash
  pnpm --filter web typecheck
  ```

- [ ] **Step 3: Run production build**

  Run:

  ```bash
  cd apps/web && npx next build
  ```

- [ ] **Step 4: If build fails, fix before moving on**

  Do not defer build failures to a follow-up session.

### Task 12: Run UX verification against the real app

- [ ] **Step 1: Rebuild the production runtime if this work is being verified for final signoff**

  Run:

  ```bash
  docker compose build --no-cache portal portal-init sandbox
  docker compose up -d portal-init sandbox
  docker compose up -d portal
  ```

- [ ] **Step 2: Verify marketing entry and route ownership**

  Check:
  - `/customer` shows the new `Marketing` top-level tab for `HR-200`
  - `/customer/marketing` opens with the marketing specialist
  - `/customer/marketing/strategy` keeps the same specialist
  - `/storefront` opens with the storefront operations specialist, not the marketing specialist

- [ ] **Step 3: Verify permission segmentation**

  Check:
  - `HR-200`: customer routes + marketing routes available
  - `HR-300`: marketing routes available, non-marketing customer routes blocked
  - `HR-500`: marketing routes blocked

- [ ] **Step 4: Verify portal routing rules still hold**

  Check:
  - `/storefront`
  - legacy `/admin/storefront` redirect
  - `/storefront/settings`
  - `/storefront/settings/business`
  - `/storefront/settings/operations`

  The marketing relocation must not regress the internal portal-management routing contract.

- [ ] **Step 5: Verify coworker skill surface**

  Check:
  - marketing specialist exposes campaign / content / inbox review skills under `/customer/marketing`
  - storefront operations specialist does not expose acquisition-marketing strategy skills on `/storefront`
  - `review-inbox` appears from the seeded skill file

## Follow-On Plans After Phase 1

- Phase 2 plan: `MarketingCampaign` and `MarketingAutomation` models plus campaigns/automation pages
- Phase 3 plan: richer marketing funnel analytics and real automation integrations
- Phase 4 plan: approved public snapshot and customer-facing trusted coworker

## Notes for the Implementer

- Do not widen `/customer` access without adding page-level guards. That is the easiest way to leak customer data to marketing-only roles.
- Do not modify old migration files after commit.
- Do not rename `skills/storefront/` in Phase 1.
- Do not implement customer-facing GAID badge work in this plan.
