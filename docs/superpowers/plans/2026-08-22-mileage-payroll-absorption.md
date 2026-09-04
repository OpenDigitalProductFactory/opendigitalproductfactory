---
status: active
---

# Mileage, Payroll, and Payroll Tax Absorption Plan

> **For agentic workers:** REQUIRED: Use `dpf-platform:dpf-writing-plans` conventions and execute phase-by-phase. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** planned
**Epics:** EP-MILEAGE-ABSORB (Phases 1–2), EP-PAYROLL-ABSORB (Phases 3–6)
**Kernel decision:** DI-87A27C692B16 (`principle_decide`, profile `mark-dpf-platform`)
**Related:** [finance-workforce-maturity-matrix](../../architecture/finance-workforce-maturity-matrix.md), [edge-adapter-to-native-convergence](../../architecture/edge-adapter-to-native-convergence.md), [tax-remittance-design](../specs/2026-04-23-tax-remittance-design.md), [tax-remittance-execution-automation](2026-04-30-tax-remittance-execution-automation.md)

---

## Goal

Absorb two vendor-shaped jobs into native DPF modules: automatic business-mileage
tracking and reimbursement (MileIQ-class), and payroll processing including US
payroll tax filing and remittance (Gusto-class). The manual disbursement rail is already
native; only the automated provider rail stays gated behind a governed provider decision.
No agent moves real money in any phase.

## Absorption criteria

Absorption is judged by **use cases covered end to end inside DPF**, not by
feature-parity with a vendor tier chart. A use case is absorbed when an operator
completes it in the portal without leaving for the vendor, and the result lands in
our own models with GL truth and an audit trail. Vendor tiers are used only to
enumerate the jobs. Per the convergence doctrine, copying vendor schemas 1:1 into
Prisma is explicitly out of bounds: every model below is ours.

## Substrate findings (verified 2026-08-22 against `origin/main`)

> **Correction.** The first pass of this plan was written against a stale branch that still
> carried the monolithic `schema.prisma`. Re-verified against `origin/main`, payroll is
> materially further along than that pass claimed — see the PayRun/Payslip and NACHA rows
> below. Mileage was re-verified as genuinely absent.

| Finding | Anchor |
| --- | --- |
| Gross-to-net payroll engine already exists, pure and DB-free, with a pluggable `StatutoryDeductionFn` | `apps/web/lib/hr/payroll.ts` |
| **`PayRun` and `Payslip` already exist and are persisted**, with an idempotent run orchestrator | `packages/db/prisma/schema/workforce.prisma`, `apps/web/lib/hr/payroll-run.ts` |
| **A manual disbursement rail already ships** — NACHA ACH file generation plus human attestation | `apps/web/lib/hr/nacha.ts`, `apps/web/lib/hr/manual-disbursement.ts` |
| A full disbursement design with a 14-BI manifest already exists; its §6 claims the epic and BIs were filed, but they are absent from the live epic list (unbacked doc anchor) | `docs/superpowers/specs/2026-08-11-payroll-disbursement-rails-epic-and-backlog.md` |
| The monolithic `schema.prisma` is gone — schema is split by domain | `packages/db/prisma/schema/*.prisma` |
| Timesheet -> payroll earnings and timesheet -> billable invoice wiring exists | `apps/web/lib/hr/labor-billing.ts`, `apps/web/lib/hr/labor-service.ts` |
| Reimbursement spine complete: claim, items, approval token, storefront approver, GL | `ExpenseClaim`, `ExpenseItem`, `/finance/expense-claims`, `/s/expense-approve/[token]` |
| **The tax compliance spine is tax-type generic, not sales-tax specific** — `taxType` is a free string, `sourceType`/`sourceId` are generic, credentials carry `mfaMode: human_step_up`, runs carry `executionMode` and `preparedByAgentId` | `TaxRegistration`, `TaxObligationPeriod`, `TaxLiabilityEntry`, `TaxDecisionSnapshot`, `TaxFilingArtifact`, `TaxRemittanceRun`, `TaxAuthorityCredential`, `TaxIssue` |
| Jurisdiction seed is config-driven over all 50 US states + EU + GB, but seeds **no US federal authority** and defaults US states to `taxTypes: ["sales_tax"]` only | `packages/db/data/tax_jurisdiction_reference.json` |
| The only sales-tax-shaped fields in the whole tax spine are `TaxObligationPeriod.salesTaxAmount` / `.inputTaxAmount` | `packages/db/prisma/schema.prisma` |
| No mileage substrate exists — no `Vehicle`, `Trip`, or rate model in 588 models | — |
| Mobile app ships `expo-location` but foreground one-shot only; no background task manager | `apps/mobile`, `src/hooks/useGeolocation.ts` |

**Consequence:** payroll tax filing is largely an emitter problem, not a build-it-all
problem. A `PayRun` writing `TaxDecisionSnapshot` -> `TaxLiabilityEntry` reuses the
entire accrue -> period -> due -> prepare -> approve -> file -> confirm machinery
that already ships for sales tax.

---

## Model deltas (ours, not theirs)

### Mileage (new)

- `Vehicle` — owner (`EmployeeProfile` or org), identifier, class, active window;
  links to `FixedAsset` when company-owned so depreciation and mileage share one asset.
- `Trip` — start/end timestamp and coordinates, resolved place, distance, `source`
  (`auto` | `manual` | `imported`), `classification`
  (`business` | `personal` | `commute` | `unclassified`), `classifiedBy`
  (`driver` | `rule` | `admin`), optional customer/job attribution, applied rate,
  computed reimbursable amount, `expenseItemId` once monetised.
- `TripClassificationRule` — one model covering repeated-route auto-classify,
  work-hours classification, and commute exclusion: rule kind, scope
  (driver/team/org), predicate, resulting classification.
- `MileageRatePlan` / `MileageRate` — effective-dated per jurisdiction and trip
  purpose, with org override for company-set rates. Effective-dating is
  non-negotiable: a trip reimburses at the rate in force on its date.
- `DriverLocationConsent` — explicit per-driver consent record with granted/revoked
  timestamps and a stated retention window.

### Payroll (new)

- `PayRun` — period, pay date, frequency, status
  (`draft` -> `calculated` -> `approved` -> `posted` -> `paid`), `journalEntryId`,
  approver, agent preparer.
- `Payslip` — per employee per run.
- `PayComponentLine` — code/label/amount, `type`
  (`earning` | `pre_tax_deduction` | `statutory` | `post_tax_deduction` |
  `employer_cost` | `reimbursement`), `ledgerAccountId`, `taxable` flag. This single
  model is what makes GL posting, reimbursement-in-payroll, and payroll tax emission
  all fall out of one shape.
- `EmployeeDeductionElection` — benefits, retirement, garnishments, effective-dated.
- `PayrollTaxRule` — the concrete implementation behind the existing plug point,
  effective-dated per jurisdiction and year so prior-year history never re-computes.

### Tax (extend, do not add)

- Generalize `TaxObligationPeriod` amount fields to carry payroll semantics
  (employee-withheld vs employer-contribution) alongside the existing sales fields.
- Seed a US federal authority row; add `payroll_withholding`, `fica`, `futa`, `suta`
  to state `taxTypes`.
- Add `sourceType: "payroll_run"` emitters so a `PayRun` writes
  `TaxDecisionSnapshot` -> `TaxLiabilityEntry` exactly as an invoice does.
- `TaxDepositSchedule` — lookback-based semiweekly/monthly determination driving
  `TaxObligationPeriod` generation.

---

## Phases

Each phase exits on a **use case working in the portal build**, not on a passing unit
suite. Structural verification is not functional verification.

### Phase 1 — Mileage capture and classification (EP-MILEAGE-ABSORB)

`Vehicle`, `Trip`, `TripClassificationRule`, `DriverLocationConsent`; background
location in the mobile app via `expo-task-manager` behind explicit consent; swipe
classify; rules engine for repeated-route, work-hours, and commute exclusion using
`WorkLocation` -> `Address` coordinates.

- [ ] Consent record, retention window, and visible off-switch designed before capture code
- [ ] Background location task registered; personal-trip detail never leaves the device beyond distance
- [ ] Repeated-route and work-hours rules classify without driver action

**Exit:** a driver installs, drives, and a correctly classified trip appears with the
commute leg excluded, having touched nothing.

### Phase 2 — Mileage to money (EP-MILEAGE-ABSORB)

`MileageRatePlan`/`MileageRate`; trip -> `ExpenseItem` monetisation; admin
bulk-approve surface; job/customer attribution mirroring `TimesheetEntry`;
IRS-format mileage log export as a `TaxFilingArtifact`.

**Exit:** a full month of trips reimburses through the existing claim -> GL -> payment
path, and the MileIQ subscription can be cancelled.

### Phase 3 — Payslip component lines and GL posting (EP-PAYROLL-ABSORB)

`PayRun` and `Payslip` are ALREADY SHIPPED — do not rebuild them. What remains:
refactor `Payslip`'s `earnings` / `employeeDeductions` / `employerCosts` Json blobs into
durable `PayComponentLine` rows (expand→contract), add `EmployeeDeductionElection`, and
add GL posting (Dr Wages Expense / Cr Net Pay Payable / Cr Tax Payable) — verified absent,
no `JournalEntry` reference exists in `payroll-run.ts` or `labor-service.ts`. Statutory
calculation still runs on `flatRateStatutory`. GL posting overlaps BI-DR-13 in the
disbursement spec; reconcile that epic before starting.

**Exit:** a run computes from real approved timesheets, produces payslips, and posts a
balanced journal — cost-of-labour truth without a single tax rule written.

### Phase 4 — US statutory engine (EP-PAYROLL-ABSORB)

`PayrollTaxRule` effective-dated; federal withholding, FICA, FUTA, state withholding
and state UI as the concrete `StatutoryDeductionFn`; contractor/1099 path.

- [ ] Golden-case fixtures hand-computed against published tables per filing status
- [ ] Prior-year rates provably immutable once a period closes

**Exit:** payslip withholdings match hand-computed IRS and state figures for the
fixture set. This phase must not ship on structural verification.

### Phase 5 — Payroll tax filing on the existing spine (EP-PAYROLL-ABSORB)

Federal jurisdiction seed and payroll tax types; period-total generalization;
`payroll_run` liability emitters; `TaxDepositSchedule`; 941/940/W-2/W-3/1099-NEC
generators as `TaxFilingArtifact`s; agent-prepared `TaxRemittanceRun` with human
approve and MFA step-up.

**Exit:** a monthly federal deposit and a quarterly 941 are prepared by an agent,
approved by a human, filed, and the confirmation reference retained.

### Phase 6 — Reimbursement in payroll, and disbursement (EP-PAYROLL-ABSORB)

Mileage and expense claims ride a pay run as non-taxable `reimbursement` component
lines. Net-pay disbursement is NOT external as the first pass claimed: the manual NACHA
rail is native and shipped. Only the AUTOMATED provider rail remains gated, on a
tool-evaluation and provider decision (disbursement spec BI-DR-05). No agent moves money.

**Exit:** one pay run pays wages and reimburses the month's mileage in a single
payslip, with the reimbursement correctly excluded from taxable pay.

---

## Cross-cutting obligations

1. **Background location consent** is the most consequential surface in this plan.
   Consent record, retention window, visible off-switch, and personal-trip minimisation
   are Phase 1 design inputs, never a retrofit.
2. **Penalty exposure.** Late or incorrect payroll deposits carry real financial
   penalties. Every filing path is agent-prepared and human-approved; no phase
   introduces unattended remittance.
3. **The honesty layer.** This plan reverses a recorded stance. The
   finance-workforce maturity matrix rows for "Payroll processing" and "Payroll tax
   filing engine" must be updated in the same PR that ships Phase 3, with the kernel
   decision id cited.
