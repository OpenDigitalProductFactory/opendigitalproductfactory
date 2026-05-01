# Tax Remittance Execution Automation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the shipped tax remittance readiness foundation into reconcilable liability tracking and controlled execution automation for indirect-tax filings and payments.

**Architecture:** Add a liability/event layer between finance transactions and `TaxObligationPeriod` so period totals have durable provenance. Reuse the existing tax workspace, notification system, scheduler, and encrypted credential patterns to add filing workpapers, execution runs, and failure escalation without collapsing coworker dialog into the page UI.

**Tech Stack:** Next.js App Router, Prisma/PostgreSQL, existing finance server actions, existing scheduled-agent-task infrastructure, credential crypto, Vitest, Next production build.

---

## File Structure

### New files expected

- `packages/db/src/tax-remittance-execution.test.ts`
- `apps/web/components/finance/TaxLiabilityLedgerCard.tsx`
- `apps/web/components/finance/TaxExecutionPanel.tsx`
- `apps/web/components/finance/TaxAuthorityCredentialPanel.tsx`
- `docs/superpowers/specs/2026-04-30-tax-remittance-execution-automation-design.md`

### Existing files likely modified

- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/<timestamp>_add_tax_execution_automation/migration.sql`
- `packages/db/src/index.ts`
- `apps/web/lib/actions/tax-remittance.ts`
- `apps/web/lib/actions/tax-remittance.test.ts`
- `apps/web/lib/finance/tax-remittance-validation.ts`
- `apps/web/components/finance/TaxObligationPeriodsTable.tsx`
- `apps/web/components/finance/TaxRegistrationEditor.tsx`
- `apps/web/components/finance/TaxRemittanceSettingsPanel.tsx`
- `apps/web/app/(shell)/finance/settings/tax/page.tsx`
- `apps/web/lib/tak/route-context.ts`
- `apps/web/lib/tak/agent-routing.ts`
- `tests/e2e/platform-qa-plan.md`

## Chunk 1: Liability Lineage Foundation

### Task 1: Add failing tests for liability lineage and reconciliation records

**Files:**
- Create: `packages/db/src/tax-remittance-execution.test.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/tax-remittance-execution.test.ts`

- [ ] **Step 1: Write failing DB-shape tests**

Cover:

- `TaxDecisionSnapshot` stores the source transaction type, source row id, tax basis, tax code, and captured amount
- `TaxLiabilityEntry` links a registration and optional obligation period to one captured tax movement
- `TaxLiabilityEntry` supports `invoice_tax`, `bill_tax`, `credit_note`, and `manual_adjustment` source kinds
- `TaxRemittanceRun` stores execution status, confirmation references, and failure details
- `TaxAuthorityCredential` stores provider/authority metadata without leaking plaintext secrets

- [ ] **Step 2: Run the new DB test file to verify it fails**

Run: `pnpm --filter @dpf/db test -- tax-remittance-execution`

Expected: FAIL because the new models do not exist yet.

- [ ] **Step 3: Add schema models**

Modify `packages/db/prisma/schema.prisma` to add:

- `TaxDecisionSnapshot`
- `TaxLiabilityEntry`
- `TaxAuthorityCredential`
- `TaxRemittanceRun`

Keep the models focused:

- `TaxDecisionSnapshot` captures what was determined at transaction time
- `TaxLiabilityEntry` captures how tax moves into or out of remittance liability
- `TaxAuthorityCredential` captures authority-specific credential custody metadata
- `TaxRemittanceRun` captures execution and payment outcomes per period

- [ ] **Step 4: Add backfill SQL in the migration**

Generate:

- `pnpm --filter @dpf/db exec prisma migrate dev --name add_tax_execution_automation`

Backfill existing periods conservatively:

- set existing `TaxObligationPeriod.salesTaxAmount` / `inputTaxAmount` / `netTaxAmount` untouched
- do not fabricate historical liability entries for old rows that cannot be traced reliably
- make the new lineage layer start cleanly for newly generated or refreshed periods

- [ ] **Step 5: Run DB verification**

Run:

- `pnpm --filter @dpf/db test -- tax-remittance-execution`
- `pnpm --filter @dpf/db test`
- `pnpm --filter @dpf/db exec prisma generate`

Expected: PASS.

- [ ] **Step 6: Commit**

Suggested commit:

`feat(db): add tax liability lineage and execution models`

## Chunk 2: Reconciled Period Computation

### Task 2: Replace aggregate-only period math with liability entry generation

**Files:**
- Modify: `apps/web/lib/actions/tax-remittance.ts`
- Modify: `apps/web/lib/actions/tax-remittance.test.ts`
- Modify: `apps/web/lib/finance/tax-remittance-validation.ts`
- Test: `apps/web/lib/actions/tax-remittance.test.ts`

- [ ] **Step 1: Write failing action tests for lineage-aware period generation**

Cover:

- generating periods creates liability entries from invoices and bills in the target date window
- credit-note invoices reduce output tax liability instead of increasing it
- manual adjustments are preserved separately from transaction-derived liability
- regenerated periods do not duplicate liability rows for the same source document line / period
- period totals are recomputed from liability entries rather than raw invoice aggregate sums

- [ ] **Step 2: Run the targeted action tests to verify they fail**

Run: `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/lib/actions/tax-remittance.test.ts`

Expected: FAIL because the action code still relies on invoice and bill aggregates.

- [ ] **Step 3: Add liability builders**

Inside `apps/web/lib/actions/tax-remittance.ts`:

- extract small helpers that map invoices, bills, and manual adjustments into `TaxLiabilityEntry` records
- preserve document provenance (`sourceType`, `sourceId`, optional line-item id when available)
- capture enough metadata to rebuild a filing workpaper without re-querying every source table manually

- [ ] **Step 4: Rework period generation**

Update `generateTaxObligationPeriods()` so it:

- computes the period window
- upserts the obligation period
- creates or refreshes liability entries for that period
- recomputes `salesTaxAmount`, `inputTaxAmount`, `manualAdjustmentAmount`, and `netTaxAmount` from the liability layer

- [ ] **Step 5: Run targeted tests**

Run:

- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/lib/actions/tax-remittance.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

Suggested commit:

`feat(finance): compute tax periods from liability lineage`

## Chunk 3: Reconciliation And Execution Workspace

### Task 3: Add period-level workpapers, credential custody, and execution controls

**Files:**
- Create: `apps/web/components/finance/TaxLiabilityLedgerCard.tsx`
- Create: `apps/web/components/finance/TaxAuthorityCredentialPanel.tsx`
- Create: `apps/web/components/finance/TaxExecutionPanel.tsx`
- Modify: `apps/web/components/finance/TaxObligationPeriodsTable.tsx`
- Modify: `apps/web/components/finance/TaxRemittanceSettingsPanel.tsx`
- Modify: `apps/web/app/(shell)/finance/settings/tax/page.tsx`
- Modify: `apps/web/lib/actions/tax-remittance.ts`
- Modify: `apps/web/lib/actions/tax-remittance.test.ts`

- [ ] **Step 1: Write failing UI/action tests**

Cover:

- obligation-period detail shows liability ledger totals and adjustments
- authority credential panel stores metadata and masks secret custody
- execution panel can prepare a run, mark a run blocked, and mark a run submitted without exposing conversation UI on the page

- [ ] **Step 2: Run targeted tests to verify they fail**

Run:

- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/lib/actions/tax-remittance.test.ts`

- [ ] **Step 3: Add server actions for credentials and runs**

Add actions for:

- saving/updating `TaxAuthorityCredential` metadata
- preparing a `TaxRemittanceRun`
- marking a run `submitted`, `paid`, `blocked`, or `failed`
- attaching confirmation references and issue details

Use existing encrypted credential patterns rather than bespoke plaintext fields.

- [ ] **Step 4: Add operational UI panels**

Update the finance tax page to show:

- a factual liability ledger summary per period
- credential status per authority
- execution-run status, last attempt, next step, and confirmation data

Keep all dialog/guidance in the coworker surface. The page stays operational-only.

- [ ] **Step 5: Run targeted tests**

Run:

- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/lib/actions/tax-remittance.test.ts`
- `pnpm --filter web typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

Suggested commit:

`feat(finance): add tax reconciliation and execution workspace`

## Chunk 4: Automation, Failures, And Coworker Boundaries

### Task 4: Add scheduled execution, notifications, and blocked-state handling

**Files:**
- Modify: `apps/web/lib/actions/tax-remittance.ts`
- Modify: `apps/web/lib/tak/route-context.ts`
- Modify: `apps/web/lib/tak/agent-routing.ts`
- Modify: `tests/e2e/platform-qa-plan.md`
- Test: `apps/web/lib/actions/tax-remittance.test.ts`
- Test: `apps/web/lib/tak/agent-routing.test.ts`

- [ ] **Step 1: Write failing tests for execution scheduling and failures**

Cover:

- a verified authority with active coworker ownership can schedule a remittance run
- missing credentials or MFA-required authorities create blocked runs and open issues
- successful submissions produce FYI notifications
- failures create actionable notifications and period issues

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run:

- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/lib/actions/tax-remittance.test.ts apps/web/lib/tak/agent-routing.test.ts`

- [ ] **Step 3: Add execution orchestration helpers**

Inside `apps/web/lib/actions/tax-remittance.ts`:

- build or refresh scheduled agent tasks for execution-ready periods
- create blocked `TaxRemittanceRun` rows when prerequisites are missing
- write `Notification` rows for FYI and issue cases
- keep `TaxIssue` resolution aligned with the current run state

- [ ] **Step 4: Update finance coworker context**

Update route context and route persona so the finance coworker can:

- explain execution readiness
- point users to missing credentials or blocked authorities
- respect filing-owner and handoff boundaries
- avoid implying unsupported statutory automation when the authority remains portal-only or MFA-blocked

- [ ] **Step 5: Add release QA coverage**

Extend `tests/e2e/platform-qa-plan.md` with a finance execution case covering:

- reconciled period review
- credential status visibility
- scheduled execution or blocked-state creation
- FYI notification on success path
- actionable alert on failure path

- [ ] **Step 6: Run verification**

Run:

- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/lib/actions/tax-remittance.test.ts apps/web/lib/tak/agent-routing.test.ts`
- `pnpm --filter web typecheck`
- `cd apps/web && npx next build`

Expected: PASS.

- [ ] **Step 7: Commit**

Suggested commit:

`feat(finance): automate tax remittance execution and failure escalation`

## Final Verification

- [ ] **Step 1: Run DB and web verification**

Run:

- `pnpm --filter @dpf/db test`
- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/lib/actions/tax-remittance.test.ts apps/web/lib/tak/agent-routing.test.ts`
- `pnpm --filter web typecheck`
- `cd apps/web && npx next build`

- [ ] **Step 2: Apply migration on the live app DB**

Run:

- `pnpm --filter @dpf/db exec prisma migrate deploy --schema prisma/schema.prisma`

- [ ] **Step 3: Run UX verification in the Docker-served app**

Exercise:

- `/finance/settings/tax`
- add or verify an authority credential
- regenerate a period
- review liability ledger totals
- create or refresh a scheduled remittance run
- confirm the page remains operational-only and the coworker surface holds the dialog

- [ ] **Step 4: Update backlog**

Set complete when shipped:

- `BI-TAX-7F1C3A`
- `BI-TAX-8D4B2E`
- `BI-TAX-9A6E1C`
- `BI-TAX-A2F4D8`
- `BI-TAX-B5C7E1`

- [ ] **Step 5: Commit and publish**

Suggested final commit:

`feat(finance): ship tax remittance execution automation`

