# Coworker Service Offer Catalog Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first governed slice of the DPF Coworker Service Catalog, Offer Catalog, and engagement interface.

**Architecture:** Add a small catalog layer over the existing coworker substrate: provider capabilities (`CoworkerService`), consumable packages (`CoworkerOffer`), and actual demand (`CoworkerEngagement`). Keep projection, MCP handlers, and UI as thin layers over shared service functions.

**Surface doctrine:** This first slice ships human portal discovery plus bounded MCP discovery/request tools. A2A direct engagement, GAID/AIDoc projection, catalog broker ranking, and aggregate/process-refinement offers are intentionally designed here but queued as follow-on slices so the first PR does not overload every agent with a universal catalog payload.

**Tech Stack:** Next.js 16 app router, Prisma 7, pnpm workspaces, Vitest, React Testing Library, DPF MCP tool surface.

---

## Chunk 1: Schema and Types

### Task 1: Add catalog type guards

**Files:**
- Create: `apps/web/lib/coworker-service-catalog/types.ts`
- Test: `apps/web/lib/coworker-service-catalog/types.test.ts`

- [ ] **Step 1: Write failing tests** for status, risk, authority, availability, and engagement status guards.
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run apps/web/lib/coworker-service-catalog/types.test.ts`
- [ ] **Step 3: Implement type arrays, unions, and guards.**
- [ ] **Step 4: Re-run the targeted test.**

### Task 2: Add Prisma schema models

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create migration: `packages/db/prisma/migrations/<timestamp>_coworker_service_offer_catalog/migration.sql`

- [ ] **Step 1: Add model-boundary tests that reference expected Prisma delegates in service tests.**
- [ ] **Step 2: Add `CoworkerService`, `CoworkerOffer`, and `CoworkerEngagement` schema models with stable business IDs.**
- [ ] **Step 3: Generate migration with `pnpm --filter @dpf/db exec prisma migrate dev --name coworker_service_offer_catalog` if local DB is available; otherwise hand-author SQL and report migration apply as unrun until canonical runtime.**

## Chunk 2: Projection and Engagement Service

### Task 3: Implement catalog projection

**Files:**
- Create: `apps/web/lib/coworker-service-catalog/catalog.ts`
- Test: `apps/web/lib/coworker-service-catalog/catalog.test.ts`

- [ ] **Step 1: Write failing tests** for service/offer boundary projection, skill/tool/grant enrichment, legal coworker visibility, and filtering.
- [ ] **Step 2: Run the test and verify RED.**
- [ ] **Step 3: Implement projection and filters.**
- [ ] **Step 4: Re-run and verify GREEN.**

### Task 4: Implement engagement creation

**Files:**
- Create: `apps/web/lib/coworker-service-catalog/engagements.ts`
- Test: `apps/web/lib/coworker-service-catalog/engagements.test.ts`

- [ ] **Step 1: Write failing tests** for normal request, high-risk approval status, external-provider terms requirement, and Work Capsule non-creation by default.
- [ ] **Step 2: Run RED.**
- [ ] **Step 3: Implement engagement creation.**
- [ ] **Step 4: Run GREEN.**

## Chunk 3: MCP Surface

### Task 5: Add tool definitions and grant mappings

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts`
- Modify: `apps/web/lib/tak/agent-grants.ts`
- Test: `apps/web/lib/mcp-tools-coworker-service-catalog.test.ts`

- [ ] **Step 1: Write failing tests** proving the four tools exist and have grant mappings.
- [ ] **Step 2: Run RED.**
- [ ] **Step 3: Add tool definitions and execute handlers as thin wrappers.**
- [ ] **Step 4: Add `coworker_catalog_read` and `coworker_engagement_write` mappings.**
- [ ] **Step 5: Run GREEN.**

## Chunk 4: UI Route

### Task 6: Add AI Workforce catalog UI

**Files:**
- Modify: `apps/web/lib/navigation/portal-navigation-model.ts`
- Create: `apps/web/app/(shell)/platform/ai/catalog/page.tsx`
- Create: `apps/web/components/platform/coworker-service-catalog/CoworkerCatalogView.tsx`
- Test: `apps/web/app/(shell)/platform/ai/catalog/page.test.tsx`
- Test: `apps/web/components/platform/coworker-service-catalog/CoworkerCatalogView.test.tsx`

- [ ] **Step 1: Write failing page/component tests** for Legal Operations Counsel visibility and dense service/offer/engagement separation.
- [ ] **Step 2: Run RED.**
- [ ] **Step 3: Implement route and components with theme-aware styling.**
- [ ] **Step 4: Run GREEN.**

## Chunk 5: Verification

### Task 7: Run gates

**Files:**
- All touched files.

- [ ] **Step 1: Run targeted Vitest suite for catalog files.**
- [ ] **Step 2: Run `pnpm --filter web build`.**
- [ ] **Step 3: Claim `local-integration-ci` lease before runtime/UX verification.**
- [ ] **Step 4: Exercise `/platform/ai/catalog` on the running portal and capture evidence.**
- [ ] **Step 5: Record any blocked gate honestly; do not treat unrun gates as passed.**

## Follow-On Chunk: A2A, GAID, and Catalog Broker

### Task 8: Add access-profile projection

**Files:**
- Modify/create catalog projection modules under `apps/web/lib/coworker-service-catalog/`
- Add tests near catalog projection tests.

- [ ] **Step 1: Define projection profiles for human portal, MCP summary, MCP detail, internal A2A, partner A2A, and external/public discovery.**
- [ ] **Step 2: Ensure internal-only specialists such as Legal Operations Counsel do not leak into partner/external projections unless a specific offer is marked for that availability scope.**
- [ ] **Step 3: Add tests that list responses stay summary-sized and detail is retrieved by offer id.**

### Task 9: Add A2A/GAID resolution

**Files:**
- Modify/create A2A/GAID adapter modules after the existing GAID architecture profile is wired into runtime identity.

- [ ] **Step 1: Resolve selected offers to internal/private Agent Card metadata for trusted A2A callers.**
- [ ] **Step 2: Resolve partner/external offers to GAID/AIDoc references and authenticated/public Agent Card variants.**
- [ ] **Step 3: Preserve acting, delegating, and delegated identity in engagement/audit receipts.**
- [ ] **Step 4: Reject cross-organization access when GAID, terms, data boundary, revocation, or authority metadata is missing.**

### Task 10: Add aggregate offers and process refinement

**Files:**
- Extend the catalog schema/service in a separate PR after first-slice usage evidence exists.

- [ ] **Step 1: Capture engagement routing rationale and mark requests as emergent, repeatable, or codified.**
- [ ] **Step 2: Identify repeated multi-coworker patterns and promote them into aggregate offers/playbooks with owner, inputs, outputs, routing rules, and approval rails.**
- [ ] **Step 3: Track DMAIC-style metrics: cycle time, handoffs, rework, approvals, cost variance, defect/escape rate, and requester satisfaction.**
- [ ] **Step 4: Feed process metrics into catalog ranking without making ranking opaque or mandatory.**

## Follow-On Chunk: Build Studio Requirements Broker

### Task 11: Add trigger taxonomy and requirements packet schema

**Files:**
- Create: `apps/web/lib/coworker-service-catalog/build-requirements.ts`
- Test: `apps/web/lib/coworker-service-catalog/build-requirements.test.ts`

- [ ] **Step 1: Define trigger families** for payment/cardholder data, payroll/workforce compensation, company identity/data authority, paid providers/data feeds/token acquisition, identity/auth/security monitoring, tax, employment, healthcare, financial reporting, external customer/supplier communication, and supplier onboarding.
- [ ] **Step 2: Define a requirements packet schema** with obligations, non-goals, controls, acceptance criteria, required evidence, prohibited patterns, approved provider/provider-selection requirements, cost and renewal tracking, approvals, data-boundary constraints, retention constraints, and citations/policy links.
- [ ] **Step 3: Add tests** proving PCI-style payment features, ADP-style payroll integrations, D&B-style company data authority, and paid model/provider dependencies select bounded aggregate offers instead of injecting the full coworker catalog into coding-agent context.

### Task 12: Integrate broker into Build Studio planning and review

**Files:**
- Modify: `apps/web/lib/integrate/build-agent-prompts.ts`
- Modify: `apps/web/lib/integrate/build-orchestrator.ts`
- Modify related Build Studio review/verification modules after identifying the smallest existing integration point.

- [ ] **Step 1: Scan feature briefs, designs, decomposition output, dependencies, data-model changes, route exposure, and implementation review notes for trigger signals.**
- [ ] **Step 2: Request coworker engagements for matching offers and attach the requirements packet plus engagement evidence to the feature plan or Work Capsule.**
- [ ] **Step 3: Feed only the bounded packet into coding-agent and review-agent prompts, not the full catalog.**
- [ ] **Step 4: Block build-to-implementation or mark the build as needing human review when a high-risk required packet is missing, unresolved, or rejected.**
- [ ] **Step 5: Treat late review-time trigger discovery as process debt by recording the missed trigger family and source phase.**

### Task 13: Add paid-provider cost and approval workflow

**Files:**
- Extend catalog, engagement, procurement, and finance modules in a separate PR after selecting the canonical cost-tracking model.

- [ ] **Step 1: Route paid dependency requests through procurement, finance, legal, security, and data governance according to provider type and data boundary.**
- [ ] **Step 2: Track provider organization, contract/terms status, cost model, budget owner, cost center, renewal or usage cadence, token acquisition, revocation/termination rights, and evidence links.**
- [ ] **Step 3: Require approved cost and contract context before Build Studio marks the provider dependency as available to implement.**
- [ ] **Step 4: Emit catalog metrics for provider cost variance, approval latency, renewal exposure, and provider-specific implementation defects.**
