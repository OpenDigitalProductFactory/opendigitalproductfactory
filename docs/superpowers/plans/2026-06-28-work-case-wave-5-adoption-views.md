# Work Case Wave 5 Adoption Views Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Wave 5 adoption by projecting customer-domain Work Cases, adding a constrained customer portal case view, and adding a mobile-first attention surface.

**Architecture:** Stay projection-first over `WorkItem` and customer source records. Internal Workspace keeps the full evidence/source model; Portal receives a constrained view that filters by the authenticated customer account and hides internal source references. Mobile attention is a compact projection of the same Workspace lens, not a second queue.

**Tech Stack:** Next.js 16 App Router, Prisma 7 types, React server/static markup tests, Vitest, report-kit, DPF theme tokens, lucide-react icons.

---

## Chunk 1: Customer-Domain Projection Contracts

### Task 1: Domain Workflow Adoption Helper

**Files:**
- Create: `apps/web/lib/work-management/customer-domain-adoption.test.ts`
- Create: `apps/web/lib/work-management/customer-domain-adoption.ts`
- Modify: `apps/web/lib/work-management/index.ts`

- [x] **Step 1: Write failing tests**

Tests must prove that customer source types (`booking`, `storefront-booking`, `opportunity`, `engagement`, `activity`) map into stable domain workflow lanes, expose WWWD decision scope, and do not include platform-development sources.

- [x] **Step 2: Run tests and verify RED**

Run: `pnpm --filter web exec vitest run lib/work-management/customer-domain-adoption.test.ts`
Expected: fail because `customer-domain-adoption.ts` does not exist.

- [x] **Step 3: Implement the helper**

Create a pure helper that accepts Work Case summaries/list items and returns lane summaries:
- `customer-service`: booking/storefront-booking/activity
- `revenue-work`: opportunity/engagement
- `general-customer-work`: any other source with `domainCategory` starting with customer-facing categories

Each lane must include `decisionScope: "wwwd"`, case count, attention count, and the case refs needed by surfaces.

- [x] **Step 4: Run focused tests and export**

Run: `pnpm --filter web exec vitest run lib/work-management/customer-domain-adoption.test.ts`
Expected: pass.

## Chunk 2: Constrained Portal Case View

### Task 2: Portal Case Loader

**Files:**
- Create: `apps/web/lib/work-management/portal-case-loader.test.ts`
- Create: `apps/web/lib/work-management/portal-case-loader.ts`
- Modify: `apps/web/lib/work-management/index.ts`

- [x] **Step 1: Write failing tests**

Tests must prove:
- portal cases are filtered to the authenticated customer's `accountId`
- non-account-resolvable source types are excluded
- returned records omit internal source refs and WorkItem ids
- attention/due status survives in customer-safe language

- [x] **Step 2: Run tests and verify RED**

Run: `pnpm --filter web exec vitest run lib/work-management/portal-case-loader.test.ts`
Expected: fail because loader does not exist.

- [x] **Step 3: Implement loader**

Create `loadPortalWorkCaseList({ prismaClient, customerAccountId, now, limit })`.
Use the Work Case source registry and account resolver keys. Resolve sources by querying the relevant account relation for engagement/opportunity/activity and by booking contact for booking/storefront-booking.

- [x] **Step 4: Run focused tests**

Run: `pnpm --filter web exec vitest run lib/work-management/portal-case-loader.test.ts`
Expected: pass.

### Task 3: Portal Cases Route And Components

**Files:**
- Create: `apps/web/components/portal/PortalWorkCases.tsx`
- Create: `apps/web/components/portal/PortalWorkCases.test.tsx`
- Create: `apps/web/app/(portal)/portal/cases/page.tsx`
- Modify: `apps/web/app/(portal)/layout.tsx`
- Modify: `apps/web/app/(portal)/portal/page.tsx`

- [x] **Step 1: Write failing component tests**

Tests must prove the component renders case count, constrained status cards, no internal refs, and no hardcoded hex colors.

- [x] **Step 2: Run tests and verify RED**

Run: `pnpm --filter web exec vitest run components/portal/PortalWorkCases.test.tsx`
Expected: fail because component does not exist.

- [x] **Step 3: Implement component and route**

Add `/portal/cases` as a section-level portal destination, not a global Workspace route. The page loads the authenticated customer's cases and renders `PortalWorkCases`.

- [x] **Step 4: Refactor portal dashboard card styling**

Replace hardcoded card colors in `/portal` with DPF theme-token intent accents and link the new Cases destination from the dashboard. Keep the copy customer-facing and avoid internal implementation terms.

- [x] **Step 5: Run component tests**

Run: `pnpm --filter web exec vitest run components/portal/PortalWorkCases.test.tsx`
Expected: pass.

## Chunk 3: Mobile Attention Surface

### Task 4: Workspace Mobile Attention Strip

**Files:**
- Modify: `apps/web/components/workspace/WorkCaseAttentionLens.tsx`
- Modify: `apps/web/components/workspace/WorkCaseAttentionLens.test.tsx`

- [x] **Step 1: Add failing test**

Test that the Workspace Work Case lens renders a mobile-first "Today" attention strip with the top three attention cases, stable links, and DPF token styling.

- [x] **Step 2: Run tests and verify RED**

Run: `pnpm --filter web exec vitest run components/workspace/WorkCaseAttentionLens.test.tsx`
Expected: fail because the strip does not exist.

- [x] **Step 3: Implement strip**

Add a compact `md:hidden` section before the desktop lists. Use fixed minimum touch target heights, lucide icons, report-kit badges, and no visible instructional text.

- [x] **Step 4: Run focused tests**

Run: `pnpm --filter web exec vitest run components/workspace/WorkCaseAttentionLens.test.tsx`
Expected: pass.

## Chunk 4: Architecture Grounding And Spec Update

### Task 5: Traceability And Docs

**Files:**
- Modify: `apps/web/lib/work-management/architecture-grounding.ts`
- Modify: `apps/web/lib/work-management/architecture-grounding.test.ts`
- Modify: `docs/superpowers/specs/2026-06-27-work-management-architecture-design.md`

- [x] **Step 1: Add failing grounding test**

Test that Wave 5 requirements and allocations exist for domain adoption, portal constrained view, and mobile attention.

- [x] **Step 2: Run grounding test and verify RED**

Run: `pnpm --filter web exec vitest run lib/work-management/architecture-grounding.test.ts`
Expected: fail until requirements/allocations are added.

- [x] **Step 3: Update grounding and spec**

Add Wave 5 `REQ`, `PART`, `VC`, and allocations. Update the spec status, wave table, and Next Step so Wave 6+ is the remaining long-tail calibration program.

- [x] **Step 4: Run focused tests**

Run: `pnpm --filter web exec vitest run lib/work-management/architecture-grounding.test.ts`
Expected: pass.

## Chunk 5: Verification And PR

## UX Fit Review

**UX fit review - Work Case Wave 5 adoption views**

- Decision: fits-with-guardrails
- UX-Fit-Decision: progressive-disclosure (principle_decide, margin 0.387)
- Owning area: Portal for external/customer visibility; Workspace for internal mobile attention; Customer domain read model for first workflow adoption.
- Route family: `/portal/cases`, `/portal`, `/workspace/my-queue`.
- Primary persona: external customer checking request/service status, and founder/operator scanning work on mobile.
- Navigation layer touched: Portal section navigation and Workspace local page surface.
- Reuse/convergence: reuses Work Case projection helpers, source registry, report-kit badges/stat cards, and existing Portal/Workspace route families.
- Source truth: `WorkItem` plus account-resolvable source records through the Work Case source registry; no parallel case table.
- Empty/failure behavior: Portal shows a quiet "No open cases" state; unauthenticated or unlinked portal users redirect to the existing auth/account paths.
- AI boundary: no prompt send; surfaces only navigate or link to support.
- Required plan/spec edits:
  - Keep Portal DTO constrained to customer-safe fields.
  - Keep mobile attention backed by the same Workspace projection.
- Evidence before merge:
  - Focused Vitest suite for loader, components, mobile strip, and EA grounding.
  - Typecheck, module-size, production build, route-manifest check.
- Captured in: `docs/superpowers/plans/2026-06-28-work-case-wave-5-adoption-views.md`

### Task 6: Full Source-Local Verification

**Files:**
- Verify all touched files.

- [x] **Step 1: Run focused test suite**

Run:
`pnpm --filter web exec vitest run lib/work-management/customer-domain-adoption.test.ts lib/work-management/portal-case-loader.test.ts components/portal/PortalWorkCases.test.tsx components/workspace/WorkCaseAttentionLens.test.tsx lib/work-management/architecture-grounding.test.ts`

- [x] **Step 2: Run typecheck**

Run: `pnpm --filter web typecheck`

- [x] **Step 3: Run module-size guard**

Run: `pnpm check:module-size`

- [x] **Step 4: Run production build**

Run: `pnpm --filter web build`

- [x] **Step 5: Refresh route manifest if needed**

Run: `node node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/cli.mjs apps/web/scripts/build-route-manifest.ts --check`.
If stale, regenerate with the same command without `--check`, then rerun with `--check`.

- [ ] **Step 6: Commit, push, PR, CI**

Commit with DCO sign-off, push `feat/work-case-wave-5-adoption-views`, open ready PR, watch CI, fix failures, merge only after PR health is green.
