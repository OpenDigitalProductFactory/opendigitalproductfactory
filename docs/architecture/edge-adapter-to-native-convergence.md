# Edge-Adapter-to-Native Convergence Doctrine

**Status:** binding product doctrine for company-running integrations  
**Backlog:** BI-COP-005 / EP-COMPANY-OPS-PARITY  
**Related:** BI-COP-006 (complexity shield acceptance), BI-A72CE946 (external planning-reference boundary), EP-ECOSYSTEM-ABSORPTION-ARCH, connector lifecycle specs

## Purpose

Edge adapters (WorkOS, Workday, QuickBooks, Gusto, ADP, Xero, Stripe, Plaid, and similar) are **bridges**, not the end state of DPF company-running capability.

DPF uses adapters to:

1. **Coexist** with systems customers already run.
2. **Learn** entity shapes, event cadences, and operator jobs worth absorbing.
3. **Bridge** during migration without forcing a big-bang cutover.

Over time, **broadly useful** company-running functionality graduates into **native DPF modules** so every install and ecosystem participant benefits — not only tenants that keep a particular vendor forever.

## Thesis (one sentence)

**Integrate to bridge and learn; absorb into native modules when the job is common, the model is stable, and the operator workflow can be simplified under the complexity shield.**

## Non-goals

- This does not ban long-lived adapters (some regulated or payment rails stay external forever).
- This does not require rewriting every connector as native before first value.
- This does not authorize one-off brittle forks per customer as "native."
- This does not replace connector lifecycle ownership (auth, sync health, teardown) already specified elsewhere.

## Decision modes

Every company-running capability in a design or PR must pick **exactly one** primary mode and record it.

| Mode | When to choose it | Operator-facing promise |
| --- | --- | --- |
| **Integrate (edge adapter)** | Source of truth must stay in the external system for legal, contractual, or ecosystem reasons; or DPF is early and needs a bridge | "Works with your X" |
| **Native absorb** | Job is common across installs; DPF can own the system of record (or a clear dual-write window); complexity shield can simplify the workflow | "DPF does this job" |
| **Coexist (dual)** | Temporary or permanent dual-running with explicit authority for each field/event | "Synced with X; DPF owns Y" |
| **Defer** | Demand unproven, license/risk blocked, or higher-leverage work first | "Not in this slice" |

### Choose **Integrate** when

- External system is the legal or banking system of record (e.g. card rails, some payroll tax filings).
- Customer will not migrate SoR in this horizon.
- DPF needs read models or outbound actions without owning the ledger yet.

### Choose **Native absorb** when

- The operator job appears across many archetypes (invoicing drafts, basic GL, staffing signals, identity roles).
- Entity mapping is stable enough to commit a DPF schema (not a per-tenant column soup).
- Graduating removes ongoing per-vendor tax for all installs.
- Complexity-shield acceptance (BI-COP-006) can be met without recreating the enterprise suite UI.

### Choose **Coexist** when

- Cutover is multi-phase; field-level authority must be explicit.
- Adapter remains for historical import while new activity is native.

### Choose **Defer** when

- Only one customer needs it and there is no reusable pattern.
- Competitive research is Layer B only (see external planning-reference boundary) with no DPF digest yet.

## Graduation criteria (adapter → native)

A capability may graduate when **all** of the following hold (or the PR explicitly waives with rationale):

1. **Common job** — Named operator job in plain language, not a vendor module name.
2. **Stable model** — Canonical DPF entities/events exist or are introduced in the same change set.
3. **Authority map** — Documented which system is SoR per field during and after graduation.
4. **Multi-install benefit** — Value does not require that specific vendor forever.
5. **Complexity shield** — Happy path meets BI-COP-006 (or successor) acceptance axes.
6. **Exit ramp** — Adapter path remains for customers not ready to cut over, or a one-way import is explicit.
7. **Evidence** — At least one reviewed digest or runtime proof that the job is real (not a brochure feature).

Cross-link ecosystem work:

| Concern | Typical home |
| --- | --- |
| Graduation criteria detail | BI-ECO-002 family |
| Entity mapping | BI-ECO-003 family |
| Event / action / receipt flow | BI-ECO-004 family |
| Shared primitives | BI-ECO-005 family |
| Product learning loop | BI-ECO-006 family |

## Anti-patterns (fail review)

| Anti-pattern | Why it fails |
| --- | --- |
| **Adapter forever by default** | Leaves every install paying vendor tax for a common job |
| **Native fork per customer** | Not absorption — it is bespoke debt |
| **UI clone of vendor admin** | Fails complexity shield even if data model is native |
| **Silent dual-write** | No authority map; reconciliation becomes folklore |
| **Marketing "we replace X"** | While SoR and evidence still live only in the adapter |
| **Copying vendor schemas 1:1 into Prisma** | Imports their complexity instead of absorbing the job |

## PR / spec checklist

Authors of parity, connector, or finance/workforce PRs:

- [ ] Primary mode stated: Integrate / Native absorb / Coexist / Defer
- [ ] If Integrate: coexistence and learning goals named; not framed as end state for common jobs
- [ ] If Native absorb: graduation criteria table filled (or explicit waiver)
- [ ] Authority map for SoR fields during transition
- [ ] Complexity-shield note for operator workflow
- [ ] No Layer B competitor dumps committed (planning-reference boundary)

## Worked examples

### Good — QuickBooks bridge then native GL slice

Integrate for historical import and live sync while customers keep QB; native absorb for a small invoice → payment happy path DPF owns; coexist with field-level SoR; complexity shield keeps owner steps short.

### Good — Stripe stays integrate

Card capture and payout rails remain edge adapters; DPF owns customer invoices and AR presentation as native where appropriate.

### Bad — "Native Workday"

Porting Workday's full HCM admin surface into DPF routes without simplifying jobs or defining DPF SoR.

## Related

- BI-COP-005 — this doctrine
- BI-COP-001 — parity scorecard (what to build)
- BI-COP-004 — docs vs code maturity labels
- BI-COP-006 — complexity shield acceptance
- Connector lifecycle / benchmark PRs (lifecycle ownership stays in connector specs)

## Change control

New default modes or graduation gate changes land via PR against this file. Feature PRs should not invent a private absorption story that contradicts this doctrine.
