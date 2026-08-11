# Recruiting → hiring → paying: the seamless spine (design)

**Status:** design + first slice in-flight. **Anchor BIs:** BI-F3AEBF68 (native recruiting → hire), BI-E5561DC9 (Greenhouse absorption), EP-PAYROLL-COMP-BENEFITS / EP-F7BD23BB (payroll / Paycom parity). **Filed:** pending — the DPF MCP was disconnected this session, so the governed BI + `record_plan_backlog_coverage` receipt are deferred to reconnect; this doc is the durable design of record until then.

> Operator directive (2026-08-11): "recruiting, hiring, then paying the employees we hire needs to be seamless." Close the gaps on the Greenhouse-replacement effort AND tightly integrate with the payroll processes from the Paycom-replacement thread.

## 1. The spine

`EmployeeProfile` is the single worker object across all three phases. A person is recruited (Candidate/Application), hired (Application → EmployeeProfile), and paid (payroll reads EmployeeProfile). No re-keying at any hop. The seam is seamless iff each hop **carries the data the next hop needs** onto that one spine.

## 2. Grounded gap analysis (verified 2026-08-11)

The spine is already the right shape on both ends — but the middle is severed:

- **Payroll already reads the spine.** `lib/hr/labor-service.ts#getEmployeePayrollEarnings` reads `EmployeeProfile.{payType, hourlyRate, annualSalary, standardAnnualHours}` (via `compensationFromEmployee`) + approved `TimesheetPeriod`s → `lib/hr/payroll.ts#computePayslip`. The comp contract is `lib/hr/labor.ts#Compensation` (discriminated `hourly | salary`).
- **The hire boundary drops comp on the floor.** `lib/integrate/greenhouse/land-hire.ts` and `lib/onboarding/roster-import-actions.ts#importRoster` write identity + `startDate` + `status:"onboarding"` only. `Offer.compensation` is an **untyped JSON blob with zero consumers** (grep: zero). So a fresh hire lands with **no comp** → `getEmployeePayrollEarnings` returns `no-compensation` → **unpayable** until someone hand-enters comp via `setEmployeeCompensation`. **This is the seam break.**
- **Payroll is a compute library, not a running capability.** `computePayslip` (pure) and `getEmployeePayrollEarnings` (reads the spine) exist, but the resolver has **no caller**, there is **no `PayRun`/`Payslip` persistence, no GL posting, no disbursement**, and only a stub statutory function. The Paycom epic (EP-F7BD23BB) is research/epic only — zero code.
- **No effective-dated comp spine.** BI-36FEECC4 is spec-only; comp is overwrite-in-place. A hire's comp has no effective date today.

## 3. Design

### 3.1 Slice 1 — the compensation handoff (this PR)

`lib/recruiting/offer-compensation.ts`: type the offer's comp as the payroll `Compensation` union (one contract, not a fork), and map it to the exact `EmployeeProfile` columns payroll reads.
- `parseOfferCompensation(json) → Compensation | null` — validate the untyped `Offer.compensation` blob; null (graceful, hire still lands unpaid) when absent/malformed.
- `offerCompensationToEmployeeColumns(comp) → { payType, hourlyRate?, annualSalary?, standardAnnualHours? }` — **round-trips with `compensationFromEmployee`** (the seam invariant: what recruiting writes at hire is exactly what payroll reads to pay).
- Wire into `land-hire.ts` (Greenhouse hire) now; the future native offer-accept (BI-5B320990, native recruiting P4) reuses the **same mapper**, so Greenhouse-sourced and natively-authored hires land payable identically.

Effect: a hired candidate is immediately payable — the recruiting→hiring→paying comp handoff is closed with one small, testable module and no schema/migration change (the `Offer.compensation` column already holds JSON).

### 3.1b Slice 2 — the payroll run (this PR)

`lib/hr/labor-service.ts#computeEmployeePayslip(employeeProfileId, periodStart, periodEnd, statutory, opts)` — the missing caller that turns the landed comp into an actual payslip. It calls `getEmployeePayrollEarnings` (previously **dead code — no caller**) → `computePayslip` (gross→net), returning a `Payslip` or `{no-employee|no-compensation}`. This closes the hiring→**paying** compute hop: a Greenhouse (or native P4) hire whose offer carried comp now produces a real gross-to-net payslip from that comp + approved timesheets. An end-to-end test drives offer comp → the columns slice 1 writes → `computeEmployeePayslip` → asserted gross/net, and makes the `no-compensation` gap explicit (a hire without comp is provably not payable). Pure compute over the spine — no persistence yet.

### 3.1c Slice 3 — durable, disbursable payroll (this PR)

The computed payslip is now persisted. New Prisma models `PayRun` (a run per pay period) + `Payslip` (per-employee gross/net/deductions + `disbursementStatus`), whose shape mirrors the pure `Payslip` compute type (no arbitrary fork). `lib/hr/payroll-run.ts#runPayroll` computes each employee's payslip (slice 2) and persists one `Payslip` per employee under a `PayRun`, idempotent per `(payRunId, employee)`, **skipping anyone not yet payable (no comp) with a reason** so the gap stays visible. `markPayslipDisbursed` records the money-movement outcome (`pending → paid|failed` + `paidAt`).

**Money-movement boundary (deliberate):** this module never moves money. Actual net-pay disbursement (bank file / ACH / payment-provider send) is a governed provider bridge performed outside; `disbursementStatus` is the auditable hook it writes back. So the platform can *run and record* payroll for a hire end to end; wiring a real payment provider + the operator's explicit per-run approval is the remaining, deliberately-separate step. Regulated records: `PayRun`/`Payslip` are retained per payroll/tax law (data-impact manifest `docs/data-impact/2026-08-11-payroll-run-payslip.data-impact.json`).

### 3.2 Downstream (still open)

What remains after slices 1–3 — the deeper payroll capabilities, contract-pinned to the spine:
1. **Effective-dated comp (BI-36FEECC4):** a dated comp row (effective = offer `startDate`) instead of overwrite-in-place; slice 1 sets the current value + supplies the effective date for the first dated row when this lands.
2. **GL posting** of a `PayRun` (Dr wages / Cr net-pay-payable / Cr tax-payable) into the finance ledger.
3. **Real statutory engine** (production jurisdictions — US/Mexico for Infinitum) plugged into slice 2's `statutory` parameter, replacing the demo flat function.
4. **Payment-provider bridge** that performs the actual disbursement and calls `markPayslipDisbursed` + **pay-stub delivery** to the employee.
5. **Onboarding → payroll enrollment:** the `OnboardingTask` packet (`lib/actions/onboarding.ts`, exists) gains a "payroll enrollment" task satisfied once comp + effective date are present — so onboarding and payroll share one readiness signal.

These belong in EP-PAYROLL-COMP-BENEFITS / EP-F7BD23BB with kernel decisions where the shapes are open; they build **on** the persisted `PayRun`/`Payslip` this PR lands.

## 4. Sequence (replace-first, seamless-first)

Slice 1 (comp handoff) ships now — it makes every hire payable and is the connective tissue. Native recruiting authoring P1→P4 (BI-94E57017/6ECF5996/282CE5B6/5B320990) then reuses the slice-1 mapper at native offer-accept. Payroll persistence (§3.2) is the larger downstream lift owned with the payroll thread; this design pins its input contract to the spine so recruiting→hiring→paying stays one path.

## 5. Verification & governance

- Round-trip unit test (offer comp → columns → `compensationFromEmployee` → same comp) is the seam proof; `land-hire` lands comp; graceful null path covered.
- No schema change (JSON column reused) → no migration/data-impact gauntlet.
- **Governance deferral:** the governed BI + `record_plan_backlog_coverage` + kernel ratification of any sub-fork are deferred until the DPF MCP reconnects; this doc + the round-trip test carry the design intent meanwhile.
