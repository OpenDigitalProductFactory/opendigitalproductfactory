# Labor Economics — wage time + billable labor

- **Date:** 2026-07-04
- **Status:** Design; Phase 1 (pure engine) landing
- **Author:** Claude (Enterprise Architect lens)
- **Epic:** EP-LABOR-ECONOMICS (new) — companion to EP-SAP-PARITY
- **Operator directive:** "the association to employee wage time (hourly or salary) and how the
  company may sell services or resources to bill for that labor needs to be factored in."

## 1. Purpose

DPF has timecards (`TimesheetPeriod`/`TimesheetEntry`, with an approval workflow) and — from the
SAP-parity work — a payroll gross-to-net engine, an invoicing sub-ledger, and a general ledger.
But the timecard is **wired to nothing**, employee **compensation is unmodeled**, and there is
**no billable dimension** on time. This capability connects them: an hour of an employee's time
has a **cost** (what the company pays for it) and, for labor-selling businesses, a **revenue**
(what the company bills a client for it); the difference is **margin**.

Two axes the directive names explicitly:

1. **Wage time — hourly *or* salary.** How the employee is paid differs by pay type; how their
   time is *costed* for margin is a separate, always-hourly figure.
2. **Selling labor — services / resources.** The company bills labor at a **bill rate** drawn
   from a rate card of the services/resources it sells — distinct from the wage.

## 2. Current-state audit (grounded — verified 2026-07-04)

| Concern | State | Location |
| --- | --- | --- |
| Timecards | ✅ `TimesheetPeriod` (employee, `weekStarting`, `status` draft→submitted→approved/rejected, `totalHours`, `overtimeHours`) + `TimesheetEntry` (`hours`, `breakMinutes`, per day). Approval workflow. | `schema.prisma` ~6785 |
| Timecard wiring | ❌ Standalone — consumed by neither payroll nor billing | — |
| Employee compensation | ❌ **Absent** — no pay fields on `EmployeeProfile`, `Position`, or `EmploymentType` | `schema.prisma` 284/393/407 |
| Billable dimension | ❌ Absent — no customer/job/billable/rate on `TimesheetEntry`; no `Job`/`WorkOrder` model (`ServiceTicket` has `customerAccountId`/`customerSiteId` but no hours) | — |
| Payroll engine | ✅ `computePayslip` (pure) — takes `baseSalary`/`hoursWorked`+`hourlyRate` as *inputs* | `lib/hr/payroll.ts` |
| Invoicing + GL | ✅ `createInvoice`, `postInvoiceIssued`, ledger | `lib/actions/finance.ts`, `lib/finance/*` |
| Archetype feature gating | ✅ Proven pattern: `FinancialProfile` flags (`purchaseOrdersEnabled`, `dunningEnabled`, `recurringBillingEnabled`) + `OrgSettings.appliedProfileSlug` + `OrganizationCapabilityActivation` overlay (has a `project-work` capability) | `finance-templates`, `capability-registry.ts` |

## 3. Research & Benchmarking (per AGENTS.md §10)

The pattern is **PSA / job costing** (professional-services automation — Harvest, Toggl,
BigTime, SAP CATS + SD service billing). Adopted ideas: **cost rate vs bill rate** as distinct
figures (the margin is the whole point); a **rate card** of billable services rather than a rate
buried per employee; **billable vs non-billable** hours as a first-class flag; time approved
before it can be billed or paid. Rejected for SMB scale: multi-tier rate hierarchies, utilization
forecasting, revenue recognition schedules, WIP accounting — deferred until asked. Anti-pattern
avoided: billing at the wage rate (erases margin) or paying salaried staff by the hour.

## 4. The model — cost, revenue, margin

**Cost side (per employee).** Compensation has a `payType`:
- `hourly`: `hourlyRate`. Pay = `hourlyRate × hoursWorked` (variable). Cost rate = `hourlyRate`.
- `salary`: `annualSalary` + `standardAnnualHours` (e.g. 2080). Pay = `annualSalary / periodsPerYear`
  (fixed, independent of hours). **Cost rate** (for costing an hour of their time) =
  `annualSalary / standardAnnualHours`.

The key nuance: for a salaried employee, **pay ≠ cost-of-time**. Pay is fixed; each logged hour is
still *costed* at the derived hourly cost rate so job margin is real.

**Revenue side (billable hours).** The company sells labor as **services/resources** on a **rate
card** (`BillableRate`: a named service/resource with a `billRate` per unit). A billable time
entry references a rate (or carries an override) and a customer; revenue = `billRate × billableHours`.

**Margin.** For a set of hours: `margin = billableRevenue − laborCost`; `marginPct = margin / revenue`.

## 5. Phasing

- **Phase 1 (this PR) — pure engine (`lib/hr/labor.ts`).** `hourlyCostRate(comp)`,
  `computeLaborCost(comp, hours)`, `computeWagePay(comp, hoursInPeriod, periodsPerYear)` (hourly
  variable / salary fixed), `computeBillableRevenue(billRate, billableHours)`, and
  `summarizeLaborEconomics(...)` → `{ cost, revenue, margin, marginPct }`. Pure, fully unit-tested.
- **Phase 2 — schema + migration.** Compensation fields on `EmployeeProfile`
  (`payType`, `hourlyRate?`, `annualSalary?`, `standardAnnualHours?`); a `BillableRate` rate-card
  model (org-scoped: `name`, `unit`, `billRate`, `active`); a billable dimension on `TimesheetEntry`
  (`customerAccountId?`, `billableRateId?`, `billable`, `billableHours`, optional `serviceTicketId?`);
  a `billableTimeEnabled` flag on `FinancialProfile` (on for `trades_construction`,
  `professional_services`, `fitness_recreation`, `beauty_personal`, `pet_services`,
  `healthcare_wellness`; off for retail/food/nonprofit/banking/software).
- **Phase 3 — wiring, archetype-gated.** Approved `TimesheetPeriod` hours → `computePayslip`
  (hourly staff paid rate×hours; salary staff paid fixed); **billable** hours → **draft invoice
  lines** (via `createInvoice`, posting to the ledger through the existing invoice→GL path);
  the billable UI/route appears only when `billableTimeEnabled`.
- **Phase 4 — UX.** Compensation on the employee record; a rate-card admin; billable columns on
  the timesheet (customer + service + billable hours), shown only when enabled; a "generate
  invoice from billable time" action; a labor-margin view for the owner.

**Non-negotiables:** cost rate vs bill rate stay distinct; salaried pay never varies with hours;
billable is off entirely for non-labor archetypes; every downstream money movement rides the
ledger/invoicing/payroll engines already merged — no parallel record.

## 6. Phase 3 — the wiring, as built (delivered 2026-07-05)

Phases 1 (#2598) and 2 (#2621) are merged. Phase 3 connects them:

- **`lib/hr/labor-billing.ts` (pure, tested).**
  - `payrollEarningsFromTimesheet(comp, approvedTotals, opts)` → the earnings side of a
    `PayrollInput`: salary → fixed `baseSalary` (hours ignored); hourly → regular hours
    (`totalHours − overtimeHours`, so overtime is never double-paid) at `hourlyRate` plus
    overtime at `hourlyRate × multiplier` (default 1.5).
  - `buildBillableInvoiceLines(entries, rateCard)` → one draft invoice line per rate-card
    service (hours aggregated, date range in the description). Entries with no resolvable
    rate or zero hours are **skipped and reported — never billed at £0**. Returns the
    priced entry ids so the caller stamps exactly what was billed.
- **`lib/hr/labor-service.ts` (Prisma).**
  - `getEmployeePayrollEarnings(employeeId, from, to)` — compensation from
    `EmployeeProfile` + **approved-only** `TimesheetPeriod` totals → payroll earnings;
    feeds `computePayslip` with the org's statutory function.
  - `generateInvoiceFromBillableTime(customerAccountId)` — **archetype-gated**
    (`billableTimeEnabled` on the applied financial profile; disabled installs get a
    typed refusal, not a hidden failure). Collects **approved, un-invoiced** billable
    entries for the customer, prices them from the active `BillableRate` card, creates a
    **draft invoice** via `createInvoice` (`sourceType: "billable-time"`; posts to the GL
    through the existing invoice→GL path when sent), then stamps entries
    `invoiceId`/`invoicedAt` guarded on `invoiceId IS NULL` — hours can never be billed
    twice, even concurrently.
- **Migration `20260705100000_billable_time_invoice_link`** — `TimesheetEntry.invoiceId`
  / `invoicedAt` + index: the idempotency link between billed hours and their invoice.

**Approval is the money gate on both flows:** unapproved time is neither payable nor
billable. Phase 4 (UX: compensation on the employee record, rate-card admin, billable
timesheet columns, generate-invoice action, margin view) remains.

## 7. Phase 4 — the UX, as built (delivered 2026-07-06)

Four surfaces, each embedded in its existing home (kernel-scored placement: no new hub,
no new global nav; every billable surface disappears entirely when the applied financial
profile lacks `billableTimeEnabled`, so non-labour archetypes never see any of it).

- **Pay on the employee record** (`components/employee/CompensationPanel.tsx`, mounted on
  `/employee` directory view). Plain words: pick a person → "Paid hourly" or "Salaried" →
  one number (hourly rate or annual salary). Standard annual hours (the salary→hourly
  cost divisor) sits behind an **Advanced** disclosure, blank = 2,080. Saves through the
  governed `setEmployeeCompensation` action (`lib/actions/workforce.ts`,
  `employee_profile.set_compensation`, risk band medium); switching pay type never
  destroys the other type's stored value. Read model:
  `lib/hr/compensation-data.ts`. Pay is universal (payroll), so this panel is NOT
  archetype-gated.
- **Labour rate card** (`/finance/settings/rate-card` +
  `components/finance/RateCardManager.tsx`). "What do you bill labour as?" — name +
  rate/hour + active toggle, inline add/edit via `upsertBillableRate`
  (`lib/actions/labor.ts`, `manage_finance`-gated, org-scoped). The Finance settings page
  shows a **Labour Rates** card (active-rate count + Manage link) only when
  `billableTimeEnabled`; the route itself explains "billable time isn't used for your
  business type" for everyone else.
- **Billable columns on the timesheet** (`components/employee/TimesheetGrid.tsx`,
  `billing` prop wired from `/employee?view=timesheets`). One extra column — a
  "Bill to customer" checkbox per day; ticking it discloses a sub-row: customer picker,
  service picker (active rates), billable hours (defaults to the day's hours, capped at
  them). A missing customer/service shows an inline warning so hours can't silently
  never-bill. Entries whose hours are on an invoice render an **Invoiced** chip and their
  billing is frozen — enforced again server-side in `saveTimesheetEntries`
  (`lib/actions/timesheet.ts`), which refuses billing-field changes for invoiced entries
  and re-caps billable hours.
- **Billable time on the customer account** (`components/customer/BillableTimeSection.tsx`
  on `/customer/[id]`, shown only when the account has approved billable hours). A
  report-kit StatCard band — **Labour cost / Billed value / Margin** (with %) — computed
  by `lib/hr/labor-report.ts` (`aggregateAccountLaborEconomics`, pure + unit-tested;
  hours from employees with no pay set are counted and surfaced as "true cost is higher",
  with a Set-their-pay link, never silently costed at £0). "Create draft invoice" runs
  through `confirmDialog` → `generateBillableInvoice` (`lib/actions/labor.ts`) and shows
  the typed result: draft invoice link (`/finance/invoices/[id]`), hours/entries billed,
  and skipped entries with a **Fix the rates →** nudge to the rate card — skips are a
  decision surface, never silent.

Verification: `lib/hr/labor-report.test.ts` (aggregation), employee page tests extended
for the new reads, full `components/*` + `lib/actions` vitest sweep and `web` typecheck
green in the worktree.

**Live-verified on the deployed install (2026-07-06, sha `e0a7e35`).** Full happy path
driven end-to-end: set an hourly employee's pay ($50/h, governed action logged `allow`)
→ add a rate-card service (Consulting $150/h) → mark 8 billable timesheet hours to a
customer + service → approve → **Create draft invoice** on the customer account produced
draft `INV-2026-0003` (`sourceType='billable-time'`, one line `Consulting (8 hours …)` at
8 × $150 = **$1,200**), stamped `TimesheetEntry.invoiceId`/`invoicedAt` so the hours drop
out of the unbilled set (double-bill guard confirmed live). Margin band computed exact
throughout: $400 cost / $1,200 billed / $800 margin (66.67%). The archetype gate is
structural — only the 6 labour profiles set `billableTimeEnabled: true`; every other
profile falls through `?? false`, so non-labour installs render none of the billable
surfaces.

A confirm-dialog defect was caught during this verification and fixed in a follow-up
(#2649): the "Create draft invoice" button raised `confirmDialog` inside `startTransition`,
which deferred the dialog's render so it never became interactive. Fixed to await the
dialog before the transition (the pattern every other `confirmDialog` caller uses).
