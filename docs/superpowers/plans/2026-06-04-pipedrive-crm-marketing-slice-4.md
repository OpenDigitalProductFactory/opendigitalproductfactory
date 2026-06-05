# Pipedrive CRM Marketing Slice 4 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unlock real read-only marketing subroutes for campaign work, marketing funnel evidence, and automation candidates under `/customer/marketing`.

**Architecture:** Reuse the existing marketing strategy/work-product substrate and CRM engagement/opportunity evidence. Add a small marketing route read-model module so page files stay mostly presentation and route navigation only exposes implemented routes.

**Tech Stack:** Next.js app router server pages, React server/client components, Prisma via `@dpf/db`, Vitest, DPF theme tokens, report-kit status/data primitives where useful.

---

## Scope

This plan implements `BI-F40F447C` in `EP-CRM-MKT-OPS`.

Deliver:
- `/customer/marketing/campaigns`
- `/customer/marketing/funnel`
- `/customer/marketing/automation`
- marketing tab nav with only real routes
- useful empty states backed by actual substrate checks

Out of scope:
- new database tables
- external publish/send behavior
- AI agent autonomous writes
- Build Studio promotion

## File Map

- Modify `apps/web/components/customer-marketing/MarketingTabNav.tsx` to expose the three newly implemented routes.
- Modify `apps/web/components/customer-marketing/MarketingTabNav.test.tsx` to assert all visible tabs are real routes and nested routes activate correctly.
- Create `apps/web/lib/marketing/subroutes.ts` for pure route view models: campaigns, funnel, automation, labels, counts, and status intent mapping.
- Create `apps/web/lib/marketing/subroutes.test.ts` with red/green coverage for campaign task grouping, funnel evidence, and automation approval posture.
- Create `apps/web/components/customer-marketing/MarketingRoutePrimitives.tsx` for shared section shell, empty state, metric tiles, and compact status treatment.
- Create `apps/web/app/(shell)/customer/marketing/campaigns/page.tsx`.
- Create `apps/web/app/(shell)/customer/marketing/funnel/page.tsx`.
- Create `apps/web/app/(shell)/customer/marketing/automation/page.tsx`.
- Extend `apps/web/components/ui/report-kit/statusColors.ts` with marketing lifecycle intents if `StatusBadge` is used for marketing status.

## Implementation Tasks

### Task 1: Route Nav Contract

- [ ] Write a failing `MarketingTabNav` test that expects Campaigns, Funnel, and Automation links.
- [ ] Run `pnpm --filter web exec vitest run components/customer-marketing/MarketingTabNav.test.tsx` and confirm the new expectation fails.
- [ ] Update `MarketingTabNav.tsx` to expose only implemented routes.
- [ ] Re-run the nav test and confirm it passes.

### Task 2: Route View Models

- [ ] Write failing tests in `apps/web/lib/marketing/subroutes.test.ts` for:
  - campaign briefs with asset-task progress
  - funnel source rows combining engagement source and opportunity stage evidence
  - automation candidate approval posture
- [ ] Run `pnpm --filter web exec vitest run lib/marketing/subroutes.test.ts` and confirm the tests fail because the module is absent.
- [ ] Implement `apps/web/lib/marketing/subroutes.ts` with pure helpers and no database calls.
- [ ] Re-run the subroute tests and confirm they pass.

### Task 3: Shared Presentation Refactor

- [ ] Create `MarketingRoutePrimitives.tsx` for the repeated section, metric, empty-state, and status elements used by the new routes.
- [ ] Use DPF theme variables only. Avoid hardcoded colors and one-off badge maps.
- [ ] Keep page files as data assembly plus composition, not status/formatting logic.

### Task 4: Campaigns Route

- [ ] Create `/customer/marketing/campaigns`.
- [ ] Read `getMarketingWorkspaceSnapshot()`.
- [ ] Render campaign briefs, related asset tasks, approval/draft posture, channels, KPIs, and useful empty state.
- [ ] Link back to `/customer/marketing/strategy` when strategy context is missing.

### Task 5: Funnel Route

- [ ] Create `/customer/marketing/funnel`.
- [ ] Read `getMarketingWorkspaceSnapshot()` plus CRM engagement/opportunity grouped evidence from existing models.
- [ ] Render source/channel rows, stage counts, conversion hints, and KPI checkpoints.
- [ ] Avoid implying attribution when only source evidence exists.

### Task 6: Automation Route

- [ ] Create `/customer/marketing/automation`.
- [ ] Read `getMarketingWorkspaceSnapshot()`.
- [ ] Render automation candidates with approval posture, trigger, action, rationale, and safety copy.
- [ ] Keep all write/policy controls out of scope for Slice 4.

### Task 7: Verification

- [ ] Run focused Vitest for new/changed tests.
- [ ] Run `pnpm --filter web typecheck` in the worktree.
- [ ] Run production build on the canonical runtime surface or CI path required by AGENTS.md.
- [ ] Exercise `/customer/marketing`, `/customer/marketing/campaigns`, `/customer/marketing/funnel`, and `/customer/marketing/automation` with UX evidence.
- [ ] Push, open a ready PR, wait for CI, merge, and mark `BI-F40F447C` done only after evidence is recorded.
