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
