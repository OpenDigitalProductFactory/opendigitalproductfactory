# Finance and Workforce Documentation Maturity Matrix

**Status:** operator-facing reconciliation of docs vs code (living matrix)  
**Backlog:** BI-COP-004 / EP-COMPANY-OPS-PARITY  
**Related:** [archetype-owner-positioning](archetype-owner-positioning.md), BI-COP-005 (edge-adapter convergence), BI-COP-006 (complexity shield), EP-FINANCE-ACCOUNTING-CORE, EP-QUICKBOOKS-ACCOUNTING-BRIDGE, EP-WORKFORCE-OPS

## Purpose

Public and internal language about finance and workforce has drifted: some docs still say DPF is "not a full accounting system" while code already includes ledger, journal, AR/AP, banking, assets, and QuickBooks import staging. Workforce docs describe staffing direction that is only partially shipped.

This matrix is the **single place** that labels capability maturity so operators, marketers, and agents do not over- or under-claim.

## Maturity labels (closed set)

| Label | Meaning | Safe public claim |
| --- | --- | --- |
| **usable-now** | Reachable in the portal for a normal install with clear happy path | "You can do X in DPF today" |
| **experimental** | Present in code/routes but incomplete, admin-only, or not complexity-shield ready | "Preview / evolving — not production-critical yet" |
| **bridge-only** | Value depends on an external system of record via adapter | "Works with X; X remains SoR for …" |
| **planned** | Spec/roadmap only; do not imply shipped | "On the roadmap" |
| **out-of-scope** | Explicit non-goal for current product | "DPF does not replace …" |

## Finance matrix (snapshot)

Labels are intentional and conservative. Promote a row only when UX verification and complexity-shield acceptance support it.

| Capability | Code anchors (indicative) | Maturity | Notes for docs/marketing |
| --- | --- | --- | --- |
| Chart of accounts / ledger accounts | `LedgerAccount`, finance shell routes | **experimental** | Substrate exists; do not claim full GL product parity |
| Journal entry / subledger posting | `JournalEntry`, general-ledger reports | **experimental** | Internal posting paths; owner happy path still thin |
| AR invoices | `/finance/invoices`, invoice APIs | **usable-now** (core path) | Customer-facing invoice flows exist; keep complexity shield |
| AP / bills | AP models and finance routes | **experimental** | Present; verify per install before production claims |
| Banking | `/finance/banking` | **experimental** | Surfaces exist; Plaid/bank rails remain partial |
| Fixed assets / currency | asset & currency models | **experimental** | Not a full fixed-asset suite claim |
| QuickBooks import / sync | QB bridge plans/specs, import staging | **bridge-only** | External SoR during bridge; see convergence doctrine |
| Full multi-entity statutory accounting | — | **out-of-scope** (current) | Aligns with owner-positioning: do not claim full accounting suite replacement |
| Payroll tax filing engine | `lib/hr/payroll-tax-emission.ts`, `lib/hr/statutory-us.ts`, the `Tax*` spine | **experimental** (was out-of-scope) | Native absorb decided — DI-87A27C692B16, EP-PAYROLL-ABSORB. The calculation and emission mechanism exist; the real IRS/state rates are NOT seeded, so do not claim a business can file from DPF today |
| Payments (cards) | Stripe-class adapters | **bridge-only** | Rails stay external |

### Payroll absorption — stance reversal (2026-08-22)

This matrix previously recorded payroll processing as **bridge-only** and payroll tax
filing as **out-of-scope**, preferring Gusto/ADP-class bridges. That stance is reversed
by kernel decision **DI-87A27C692B16** under **EP-PAYROLL-ABSORB**.

Read the ledger rather than the headline: the kernel's own recommendation was to bridge
payroll and absorb only mileage, on speed-to-value and reversibility grounds. Full
absorption scored HIGHER on Architecture Over Shortcuts, Ground New Work In Existing
Platform, Proper Fix Over Quick Fix and Optimize for the Whole. The objection was about
sequencing, not scope, and the founder retained authority and answered it by shipping
mileage first. `principle_decide` is advisory by contract.

**What the new labels do and do not claim.** Both rows move to *experimental*, not
*usable-now*. The mechanism exists and is tested; what is missing is the seeded
jurisdiction data. A rate that cannot be cited must not be printed into source, so the
statutory engine consumes effective-dated rules with a `sourceUrl` instead. Until those
are seeded, **no install can run a real payroll or file a real return**, and no public
claim may imply otherwise.

### Payroll tax persistence and period components (2026-08-26)

The payroll tax emitter shipped as a pure function in PR #4490 and nothing wrote
its output. That write path now exists, along with the two substrate pieces it
needed.

**Period totals are normalized.** `TaxObligationPeriod` carried `salesTaxAmount`
and `inputTaxAmount` — the only home for a component total, and sales-shaped.
Payroll needs employee-withheld and employer-contribution totals on the same
spine. Kernel decision **DI-31F2D7D10E25** (composite 9.631, margin 3.581) chose
one row per component per period over adding two more columns: a new tax family
now adds an enum value, not a column pair that is dead weight on every other
family's rows. The migration backfills every existing sales figure into
component rows before dropping the columns, so no filed or draft period loses
its numbers. The full data-safety argument for the drop is in
[tax-period-component-migration.md](tax-period-component-migration.md). `netTaxAmount` deliberately stays on the period, because a filed
return's bottom line must remain frozen even if a component is later corrected.

**Withheld money adds to the liability, never nets off.** Sales input tax is
recoverable and subtracts. Both payroll components are owed and add — including
the employee-withheld portion, which the business does not own but must still
remit. Netting it off because it "isn't the company's money" would understate
what is due.

**Deposit cadence is now recorded, not just computed.** `TaxDepositSchedule` is
effective-dated so the cadence that governed a past pay date stays readable
after a later determination replaces it — that is the evidence for why a past
deposit was timed as it was. It records the lookback total, the threshold, and
the `sourceUrl` the threshold came from. Resolution returns null when no
determination covers a date, and callers must surface that rather than assume
monthly: assuming the gentler cadence is how a business that should deposit
semiweekly silently takes a penalty.

**Semiweekly spans are deliberately not computed.** The federal semiweekly rule
keys the due date off which day of the week wages were paid and needs the
authority's banking-day and holiday calendar. `depositPeriodFor` returns null
for it rather than fabricating a span that would produce a confident wrong due
date.

**Accruals only.** The write path records what is owed and when. It never files,
never remits and never touches an authority credential. Filing stays
agent-prepared and human-approved with MFA step-up.

Still outstanding on EP-PAYROLL-ABSORB: the 941, 940, W-2/W-3 and 1099-NEC
generators, which need cited form layouts under the same constraint as the
rates, and the statutory rates themselves (BI-4EB27955).

### Mileage jurisdiction resolution (2026-08-26)

The organization operates in several countries and sends people abroad, so a mile
driven in Mexico may reimburse differently from one driven in the US. Kernel decision
**DI-5E5AFE040A1F** (composite 9.355, margin 1.876, autonomy eligible) sets the
precedence for choosing which `MileageRatePlan` prices a trip:

1. a plan for the country the trip was **driven** in, when the org has one
2. otherwise a plan for the **employee's country of record**
3. otherwise an unscoped plan — an org-wide override, or a statutory plan carrying
   no jurisdiction

The tier is decided first and never mixed. An org override wins **within** a
jurisdiction, never across one: a US override must not outrank the statutory rate for
Mexico when the drive happened in Mexico.

**Country is derived, never picked.** `Trip.countryCode` is ISO 3166-1 alpha-2 that the
capturing device reverse-geocoded from its own location. No driver-facing country
picker exists on any surface, and the server never infers a country from an address.
NULL is a legitimate value — an older client, no signal, or a withheld location
permission — and prices the trip on the employee's country of record rather than
holding it. A driver who declined location still gets paid.

**Country of record has no new column.** It is read through the canonical MDM chain
`EmployeeAddress -> Address -> City -> Region -> Country.iso2`. An employee with several
addresses and no single primary resolves to NULL rather than an arbitrary row, because
paying someone against an arbitrary address is worse than falling back to an unscoped
plan.

**Known simplification.** A drive that crosses a border prices entirely on the country
it started in. Splitting one drive across two plans needs per-segment distance
attribution and a far denser reverse geocode than a device makes; recording the start
honestly beats inventing a split. Revisit if cross-border driving becomes common.

As with the payroll rows above, the mechanism is tested but the **statutory per-country
rates are still unseeded** (BI-4EB27955). Jurisdiction-aware resolution does not by
itself make any install able to pay a real mileage claim.

### Finance doc reconciliation rules

1. **Do not** say "DPF has no ledger" — the models exist; say **experimental** or **usable-now** per row.
2. **Do not** say "DPF replaces QuickBooks/Xero/Workday Finance" — use **bridge-only** + **planned** native slices.
3. User guides should link this matrix when describing finance setup.
4. Market vision remains the outer promise boundary; this matrix is the honesty layer for what is shipped.

## Workforce matrix (snapshot)

| Capability | Code anchors (indicative) | Maturity | Notes for docs/marketing |
| --- | --- | --- | --- |
| AI coworker roster / occupations | agent registry, occupation seed | **usable-now** | Core platform workforce of agents |
| HR employee records (human) | HR workforce core models | **experimental** | Core models; not full HCM |
| Timesheets | timesheet models | **experimental** | Present; owner UX varies by install |
| Staffing / scheduling | workforce ops plans, scheduling specs | **experimental** / **planned** (depth) | Direction real; depth varies — do not claim Workday HCM |
| Recruiting coworker | talent BIs | **planned** | Not a default claim |
| Payroll processing | `PayRun`, `Payslip`, `PayComponentLine`, `lib/hr/payroll.ts`, `lib/hr/payroll-gl.ts` | **experimental** (was bridge-only) | Native absorb decided — DI-87A27C692B16. Gross-to-net, payslip component lines and GL posting ship; the manual NACHA disbursement rail also ships. The automated provider rail stays gated on a tool-evaluation |
| Full Workday HCM admin | — | **out-of-scope** (current) | Complexity shield: ship jobs, not suite clones |

### Workforce doc reconciliation rules

1. Separate **AI workforce** (coworkers) from **human HR/HCM** in every public sentence.
2. Staffing/scheduling language must match maturity — prefer "substrate + evolving UX" over "complete WFM."
3. Identity/role features (WorkOS-class) follow edge-adapter convergence, not workforce marketing copy.

## How to update this matrix

| Event | Action |
| --- | --- |
| Feature PR ships a finance/workforce happy path | Update the row label in the **same PR** or a fast follow |
| Adapter-only path | Label **bridge-only** and name the external SoR |
| Docs-only claim without code | Reject; open a BI instead |
| Uncertainty | Choose the **more conservative** label |

## PR checklist (finance/workforce docs)

- [ ] Claims map to a row in this matrix
- [ ] No upgrade of label without UX proof
- [ ] Bridge paths name the external system
- [ ] Complexity-shield considered for owner-facing flows
- [ ] Positioning docs (`archetype-owner-positioning`, market vision) not contradicted

## Related backlog

- BI-COP-004 — this reconciliation
- BI-COP-001 — capability parity scorecard (what to build next)
- BI-COP-005 — when bridge becomes native
- BI-COP-006 — acceptance for simplified operator workflows
- BI-COP-008 — market narrative alignment

## Change control

Matrix label changes are documentation of product truth. Inflating a label without runtime proof is a defect; deflating a stale overclaim is always welcome.
