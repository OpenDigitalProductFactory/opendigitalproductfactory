# Work Case Wave 6 Portal Drill-Down Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a customer-safe Portal Work Case detail route under the existing `/portal/cases` section.

**Architecture:** Stay projection-first over `WorkItem` and account-resolvable source records. Refactor the Portal loader so list and detail share the same account filter, case-key parsing, status language, and customer-safe DTO rules. The detail route is a child page, not a new dashboard, tab, or write path.

**Tech Stack:** Next.js 16 App Router, Prisma 7 types, React server/static markup tests, Vitest, report-kit, DPF theme tokens, lucide-react icons.

---

## UX Fit Review

**UX fit review - Work Case Wave 6 portal drill-down**

- Decision: fits-with-guardrails
- UX-Fit-Decision: detail-route-under-cases (manual dpf-ux-fit review; principle_decide returned a zeroed low-confidence tie)
- Owning area: Portal
- Route family: `/portal/cases`, `/portal/cases/[caseKey]`
- Primary persona: external customer checking the status and next step for a visible service/request case
- Navigation layer touched: Portal section route only; no global nav, no new dashboard
- Reuse/convergence: reuse `PortalWorkCases`, `portal-case-loader`, report-kit `StatusBadge`/`StatCard`, DPF tokens, and the existing Portal support destination
- Source truth: `WorkItem` plus account-resolvable source records through the Work Case source registry
- Empty/failure behavior: missing, unauthorized, or non-account-resolvable case keys return `notFound()` after auth/account checks
- AI boundary: no prompt send and no consequential mutation; support links navigate only
- Required plan/spec edits:
  - Keep the detail DTO free of `WorkItem` ids, source refs, internal refs, and raw activity/evidence ids.
  - Make `/portal/cases/[caseKey]` a drill-down child route, not a new Portal tab or dashboard.
  - Keep customer copy plain and business-facing.
- Evidence before merge:
  - Focused loader/component/route-grounding tests.
  - Typecheck, module-size, production build, route-manifest freshness.
  - Theme scan in component tests proving no hardcoded token-role colors.
- Captured in: `docs/superpowers/plans/2026-06-28-work-case-wave-6-portal-drilldown.md`

## Chunk 1: Portal Loader Detail Contract

### Task 1: Customer-Safe Case Key And Detail Loader

**Files:**
- Modify: `apps/web/lib/work-management/portal-case-loader.test.ts`
- Modify: `apps/web/lib/work-management/portal-case-loader.ts`

- [x] **Step 1: Add failing loader tests**

Tests must prove:
- list items link to `/portal/cases/<encoded case key>` instead of hash anchors
- `loadPortalWorkCaseDetail()` returns a customer-safe DTO for an account-owned case
- another customer's case returns `null`
- invalid/non-account-resolvable case keys return `null`
- serialized detail does not include `WI-`, `sourceRefs`, `work-item`, raw source refs, or internal ids

- [x] **Step 2: Run tests and verify RED**

Run: `pnpm --filter web exec vitest run lib/work-management/portal-case-loader.test.ts`

Expected: fail because `loadPortalWorkCaseDetail()` does not exist and list hrefs still use anchors.

- [x] **Step 3: Refactor and implement loader**

Add shared helpers:
- `encodePortalCaseKey(caseId: string): string`
- `decodePortalCaseKey(caseKey: string): { sourceType: string; sourceId: string } | null`
- a shared `toPortalCase()` projection used by both list and detail
- `loadPortalWorkCaseDetail({ prismaClient, customerAccountId, caseKey, now })`

The detail DTO should include only customer-safe fields: title, source label, status label, next action, description, due date, created date, support href, and a short customer-safe timeline.

- [x] **Step 4: Run focused loader tests**

Run: `pnpm --filter web exec vitest run lib/work-management/portal-case-loader.test.ts`

Expected: pass.

## Chunk 2: Portal Detail Surface

### Task 2: Detail Component And Route

**Files:**
- Create: `apps/web/components/portal/PortalWorkCaseDetail.tsx`
- Create: `apps/web/components/portal/PortalWorkCaseDetail.test.tsx`
- Create: `apps/web/app/(portal)/portal/cases/[caseKey]/page.tsx`
- Modify: `apps/web/components/portal/PortalWorkCases.tsx`
- Modify: `apps/web/components/portal/PortalWorkCases.test.tsx`

- [x] **Step 1: Add failing component tests**

Tests must prove:
- detail renders a digest, status, next step, due/received dates, back link, and support link
- detail omits internal refs and raw identifiers
- list cards link to the detail route
- component markup uses DPF tokens and no hardcoded hex/status color classes

- [x] **Step 2: Run tests and verify RED**

Run: `pnpm --filter web exec vitest run components/portal/PortalWorkCaseDetail.test.tsx components/portal/PortalWorkCases.test.tsx`

Expected: fail because the detail component does not exist and list links still target anchors.

- [x] **Step 3: Implement component and route**

Create `PortalWorkCaseDetail` using report-kit `StatusBadge`, lucide icons, DPF theme tokens, and restrained page composition. Add `/portal/cases/[caseKey]` with the same customer auth/account guard as `/portal/cases`; call `notFound()` for unavailable cases.

- [x] **Step 4: Run focused component tests**

Run: `pnpm --filter web exec vitest run components/portal/PortalWorkCaseDetail.test.tsx components/portal/PortalWorkCases.test.tsx`

Expected: pass.

## Chunk 3: Architecture Grounding And Docs

### Task 3: Traceability And Spec Update

**Files:**
- Modify: `apps/web/lib/work-management/architecture-grounding.test.ts`
- Modify: `apps/web/lib/work-management/architecture-grounding.ts`
- Modify: `docs/superpowers/specs/2026-06-27-work-management-architecture-design.md`

- [x] **Step 1: Add failing grounding test**

Test that Wave 6 has a requirement, part, verification case, and allocation for the Portal customer-safe drill-down route/component/loader.

- [x] **Step 2: Run grounding test and verify RED**

Run: `pnpm --filter web exec vitest run lib/work-management/architecture-grounding.test.ts`

Expected: fail until Wave 6 grounding is added.

- [x] **Step 3: Update grounding and spec**

Add `REQ-WC-13`, `PART-WC-portal-case-detail`, `VC-WC-13`, allocations to the loader/component/route, and a spec implementation note that Wave 6 is the first long-tail calibration slice.

- [x] **Step 4: Run focused grounding test**

Run: `pnpm --filter web exec vitest run lib/work-management/architecture-grounding.test.ts`

Expected: pass.

## Chunk 4: Verification And PR

### Task 4: Source-Local Verification

**Files:**
- Verify all touched files.

- [x] **Step 1: Run focused suite**

Run:
`pnpm --filter web exec vitest run lib/work-management/portal-case-loader.test.ts components/portal/PortalWorkCases.test.tsx components/portal/PortalWorkCaseDetail.test.tsx lib/work-management/architecture-grounding.test.ts`

- [x] **Step 2: Run typecheck**

Run: `pnpm --filter web typecheck`

- [x] **Step 3: Run module-size guard**

Run: `pnpm check:module-size`

- [x] **Step 4: Run production build**

Run: `pnpm --filter web build`

- [x] **Step 5: Refresh route manifest if needed**

Run: `node node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/cli.mjs apps/web/scripts/build-route-manifest.ts --check`.

If stale, regenerate with the same command without `--check`, then rerun with `--check`.

- [x] **Step 6: Run UX-fit gate**

Run: `$env:BASE_SHA='origin/main'; node scripts/check-ux-fit-decision.mjs`

- [x] **Step 7: Commit, push, PR, CI**

Commit with DCO sign-off, push `feat/work-case-wave-6-portal-drilldown`, open a ready PR, watch CI, fix failures, and merge only after PR health is green.

Closeout evidence:
- PR: `https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/2497`
- Merged: `2026-06-28T20:43:01Z` through the main merge queue.
- Merge commit: `156d81e4fae5a835f55987ccf285445c7bddc114`
- PR head: `a2e5531b66278146ae4bdb5f5097c83029944be7`
- PR health before merge: 47 checks, 0 failing, 0 pending, 0 unresolved review threads.
- Backlog closeout: `BI-WC-WAVE6-DRILLDOWN` done; `WC-305BC2A2` complete with no remaining scope claims.
