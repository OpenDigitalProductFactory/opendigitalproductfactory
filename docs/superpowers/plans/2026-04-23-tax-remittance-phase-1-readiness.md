# Tax Remittance Phase 1 Readiness Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first real tax remittance capability in DPF: bootstrap jurisdiction reference data, finance tax setup UX, coworker-led setup storage, and remittance period tracking.

**Architecture:** Add a small tax-remittance domain on top of the existing finance models instead of expanding invoices and bills into a full tax engine. Keep three layers distinct: jurisdiction reference data, organization tax posture, and remittance operations. Integrate with current finance settings, scheduled tasks, notifications, and agent grants rather than creating parallel infrastructure.

**Tech Stack:** Next.js App Router, Prisma/PostgreSQL, existing server actions, existing finance components, DPF agent grant system, Vitest, Next production build.

---

## File Structure

### New files expected

- `packages/db/data/tax_jurisdiction_reference.json`
- `packages/db/src/seed-tax-jurisdictions.ts`
- `apps/web/lib/tax-remittance-validation.ts`
- `apps/web/lib/actions/tax-remittance.ts`
- `apps/web/components/finance/TaxRemittanceSettingsPanel.tsx`
- `apps/web/components/finance/TaxRegistrationEditor.tsx`
- `apps/web/components/finance/TaxObligationPeriodsTable.tsx`
- `apps/web/app/(shell)/finance/settings/tax/page.tsx`
- `apps/web/lib/actions/tax-remittance.test.ts`
- `apps/web/components/finance/TaxRemittanceSettingsPanel.test.tsx`
- `packages/db/prisma/migrations/<timestamp>_add_tax_remittance_foundation/migration.sql`

### Existing files likely modified

- `packages/db/prisma/schema.prisma`
- `packages/db/src/seed.ts`
- `packages/db/src/index.ts`
- `apps/web/components/finance/finance-nav.ts`
- `apps/web/components/finance/FinanceTabNav.tsx` or tests only if route family changes require it
- `apps/web/app/(shell)/finance/settings/page.tsx`
- `apps/web/app/(shell)/finance/configuration/page.tsx`
- `apps/web/lib/tak/agent-grants.ts`
- `packages/db/data/agent_registry.json` only if the existing finance coworker’s grants are seed-managed and phase 1 explicitly wires them

## Chunk 1: Schema and Reference Foundation

### Task 1: Add failing schema-oriented tests or assertions for the new tax-remittance models

**Files:**
- Create: `packages/db/src/tax-remittance-foundation.test.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/tax-remittance-foundation.test.ts`

- [ ] **Step 1: Write failing tests for tax-remittance shape**

Cover:

- `TaxJurisdictionReference` can be created and queried
- `OrganizationTaxProfile` is unique per organization
- `TaxRegistration` belongs to an organization and jurisdiction
- `TaxObligationPeriod` belongs to a registration
- `TaxFilingArtifact` and `TaxIssue` attach cleanly to periods/registrations

- [ ] **Step 2: Run the new DB test file to verify it fails**

Run: `pnpm --filter @dpf/db test -- tax-remittance-foundation`

Expected: Prisma types or runtime lookups fail because the models do not exist yet.

- [ ] **Step 3: Add schema models**

Modify `packages/db/prisma/schema.prisma` to add:

- `TaxJurisdictionReference`
- `OrganizationTaxProfile`
- `TaxRegistration`
- `TaxObligationPeriod`
- `TaxFilingArtifact`
- `TaxIssue`

Keep fields lean and aligned to the spec. Reuse existing organization identity instead of inventing a parallel business identity model.

- [ ] **Step 4: Generate and verify the migration**

Run:

- `pnpm prisma migrate dev --name add_tax_remittance_foundation`
- `pnpm --filter @dpf/db exec prisma migrate deploy --schema prisma/schema.prisma`

Expected: migration applies cleanly with no drift.

- [ ] **Step 5: Create the bootstrap jurisdiction seed**

Create:

- `packages/db/data/tax_jurisdiction_reference.json`
- `packages/db/src/seed-tax-jurisdictions.ts`

Seed minimum viable records for:

- US state-level authorities
- UK
- Denmark
- Norway
- EU country-level VAT authority references

Include only stable metadata:

- authority name
- country/state code
- authority type
- official website
- registration URL when known
- filing/payment URL when known
- locality model hint
- cadence hints
- source URLs

- [ ] **Step 6: Wire the seed into the existing DB seed flow**

Modify `packages/db/src/seed.ts` to call the new seed module without conflating seed with runtime truth.

- [ ] **Step 7: Run DB tests again**

Run: `pnpm --filter @dpf/db test -- tax-remittance-foundation`

Expected: PASS.

- [ ] **Step 8: Run broader DB verification**

Run:

- `pnpm --filter @dpf/db test`
- `pnpm --filter @dpf/db exec prisma generate`

Expected: PASS.

- [ ] **Step 9: Commit**

Suggested commit:

`feat(db): add tax remittance foundation schema and jurisdiction seed`

## Chunk 2: Finance Settings UX and Server Actions

### Task 2: Add the tax-remittance settings surface

**Files:**
- Create: `apps/web/lib/tax-remittance-validation.ts`
- Create: `apps/web/lib/actions/tax-remittance.ts`
- Create: `apps/web/components/finance/TaxRemittanceSettingsPanel.tsx`
- Create: `apps/web/components/finance/TaxRegistrationEditor.tsx`
- Create: `apps/web/components/finance/TaxObligationPeriodsTable.tsx`
- Create: `apps/web/app/(shell)/finance/settings/tax/page.tsx`
- Modify: `apps/web/components/finance/finance-nav.ts`
- Modify: `apps/web/app/(shell)/finance/settings/page.tsx`
- Modify: `apps/web/app/(shell)/finance/configuration/page.tsx`
- Test: `apps/web/lib/actions/tax-remittance.test.ts`
- Test: `apps/web/components/finance/TaxRemittanceSettingsPanel.test.tsx`

- [ ] **Step 1: Write the failing action tests**

Cover:

- fetching the current organization tax profile
- saving draft setup state
- creating or updating tax registrations
- listing obligation periods

- [ ] **Step 2: Run the targeted action tests to verify they fail**

Run: `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/lib/actions/tax-remittance.test.ts`

Expected: FAIL because the action module does not exist yet.

- [ ] **Step 3: Implement validation and server actions**

Create `apps/web/lib/tax-remittance-validation.ts` and `apps/web/lib/actions/tax-remittance.ts`.

Responsibilities:

- auth/permission guard using existing finance permissions pattern
- load organization tax profile, registrations, and periods
- save tax profile draft
- create/update registration records
- generate initial periods for verified registrations

- [ ] **Step 4: Build the settings page**

Create `apps/web/app/(shell)/finance/settings/tax/page.tsx` and supporting components.

The page should show:

- setup mode summary (`unknown`, `existing`, `new_business`)
- top-level tax profile fields
- registrations list/editor
- obligation periods table
- empty states that guide the user toward coworker-assisted setup

- [ ] **Step 5: Wire navigation entry points**

Modify:

- `apps/web/components/finance/finance-nav.ts`
- `apps/web/app/(shell)/finance/settings/page.tsx`
- `apps/web/app/(shell)/finance/configuration/page.tsx`

Add a visible `Tax Remittance` entry so the feature is discoverable in the Finance UX.

- [ ] **Step 6: Add component tests**

Verify:

- nav shows tax entry
- settings page renders existing and empty states correctly
- registration editor handles add/edit flows

- [ ] **Step 7: Run targeted web tests**

Run:

- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/lib/actions/tax-remittance.test.ts`
- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/components/finance/TaxRemittanceSettingsPanel.test.tsx`

Expected: PASS.

- [ ] **Step 8: Commit**

Suggested commit:

`feat(web): add finance tax remittance settings workspace`

## Chunk 3: Coworker Readiness and Platform Authority

### Task 3: Add phase-1 coworker support and guardrails

**Files:**
- Modify: `apps/web/lib/tak/agent-grants.ts`
- Modify: coworker prompt/registry files that already define the finance coworker once identified in the repo
- Test: grant-related tests if present near the finance coworker or TAK authority surface

- [ ] **Step 1: Identify the current finance coworker definition**

Search the repo for the active finance coworker route context and prompt source before editing. Do not invent a second finance coworker if one already exists.

- [ ] **Step 2: Add tax-remittance-specific grant mappings**

Extend `apps/web/lib/tak/agent-grants.ts` with explicit tool mappings for any new tools/actions introduced for:

- tax profile read/write
- registration read/write
- period generation/update
- filing artifact creation
- tax issue creation/update

If phase 1 reuses normal server actions instead of MCP tools, document the follow-on grant work instead of inventing unused tool names.

- [ ] **Step 3: Add coworker prompt guidance**

Update the finance coworker’s instructions to:

- ask whether the business is already set up or starting fresh
- prefer official tax authority sources
- record uncertainty rather than guessing
- propose likely jurisdictions from footprint
- maintain setup over time

- [ ] **Step 4: Run affected tests**

Run the smallest relevant set around TAK/grants/prompt lookup.

- [ ] **Step 5: Commit**

Suggested commit:

`feat(ai): prepare finance coworker for tax remittance setup`

## Chunk 4: Final Verification and Live Backlog Setup

### Task 4: Verify the feature slice and register the epic

**Files:**
- No new product files required unless QA coverage gaps are found
- Modify: `tests/e2e/platform-qa-plan.md` if a finance setup QA case is missing

- [ ] **Step 1: Add or update QA plan coverage**

If the tax-remittance settings/setup path is user-facing and not represented in `tests/e2e/platform-qa-plan.md`, add a finance QA case for:

- empty-state setup
- existing-setup editing
- incomplete-information coworker path

- [ ] **Step 2: Run targeted tests**

Run:

- `pnpm --filter @dpf/db test`
- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/lib/actions/tax-remittance.test.ts apps/web/components/finance/TaxRemittanceSettingsPanel.test.tsx`

- [ ] **Step 3: Run the production build**

Run: `cd apps/web && npx next build`

Expected: PASS with zero build errors.

- [ ] **Step 4: Run UX verification on the real app**

Use the running platform and verify:

- `http://localhost:3000/finance/settings/tax`
- navigation path from `Finance > Settings`
- empty-state and configured-state behavior

If a Docker rebuild is needed for true production-path verification, use:

`docker compose build --no-cache portal portal-init sandbox && docker compose up -d portal-init sandbox && docker compose up -d portal`

- [ ] **Step 5: Create the live epic and initial backlog items**

After the slice is real enough to track, insert a live epic:

- `Tax Remittance Readiness, Automation, and Jurisdiction Intelligence`

Create initial items:

- jurisdiction registry foundation
- tax settings UX
- coworker-led setup flow
- obligation period engine
- filing packet and evidence flow

- [ ] **Step 6: Final commit**

Suggested commit:

`feat(finance): ship tax remittance readiness foundation`

## Notes For Execution

- Do not edit `packages/db/src/seed.ts` to represent runtime customer changes. Use it only to wire bootstrap reference data.
- Keep seed data and business truth separate.
- Do not give the coworker blanket table access. Extend capability/grant boundaries deliberately.
- If the schema migration reveals existing finance drift, stop and repair the drift before continuing.
- If the route or coworker surfaces differ from the assumptions above, follow the repo’s existing patterns and update this plan as part of execution.

## Suggested Execution Order

1. Chunk 1: schema + seed
2. Chunk 2: settings UX + actions
3. Chunk 3: coworker and grants
4. Chunk 4: QA, build, backlog, final verification

Plan complete and saved to `docs/superpowers/plans/2026-04-23-tax-remittance-phase-1-readiness.md`. Ready to execute?
