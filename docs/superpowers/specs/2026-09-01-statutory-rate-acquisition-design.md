---
status: active
---

# Statutory rate acquisition — canonical design

**Backlog item:** BI-8E1FD1BD · **Schema dependency:** BI-4EB27955 item 3
**Workroom:** WC-0BE07607 · **Branch:** `feat/statutory-rate-acquisition`
**Founder direction (2026-08-27):** authorise the fetch, but route it through the proper AI coworker. If the coworker cannot do its job, complete the platform so it can.

## Problem

The payroll and mileage engines compute correctly and cannot be used, because no statutory figure can be recorded in a form anything trusts.

Three facts establish the shape of the gap:

1. **The research capability already exists and cannot deliver.** AGT-WS-COMPLIANCE and AGT-905 both hold `web_search`, and both have exactly this charter — evidence freshness, jurisdiction-layered findings, *"without guessing legal facts"*. Neither holds any grant that persists reference data. The grant catalog carried 157 grants and not one wrote a tax figure; the Compliance Officer's entire write surface was `backlog_write` plus `policy_write`, and `policy_write` is honoured by a single tool, `propose_leave_policy`. A researched IRS figure could become a paragraph in a backlog item and nothing else.
2. **There was no table to write to.** BI-4EB27955 item 3 specified `PayrollTaxRule` in August. It was never built.
3. **The absence was silent.** An install with no figures looked identical to one with fresh figures. The only symptom was a payroll that produced no liabilities, which reads as *"nothing was owed"* rather than *"I could not compute"*.

## Constraints that do not move

- A figure that cannot be cited to the authority's own publication must never drive a filing. A late or wrong deposit carries a real financial penalty.
- Nothing an agent writes may compute money before a person has confirmed it.
- A gap must be reported as a gap, never filled with a plausible number.
- A closed period must re-compute identically after a later tax year is loaded.

## Research & benchmarking

**Scope of this comparison, stated honestly.** This is a design-shape comparison against how the field handles statutory reference data. It is not a code-level audit of the named projects; this environment has no web access, so implementation specifics were not verified against current source. The patterns below are the well-established shapes, and the argument turns on the shape rather than on any project's particulars.

**A. Rates as configuration-as-code.** The common shape in payroll libraries: brackets and wage bases live in source, keyed by tax year, shipped in a release.
*Rejected.* A figure in source cannot carry provenance a reviewer can check, and a wrong figure ships to every install at once and is corrected only by a release. It also inverts the trust model this platform needs: the operator would be trusting the vendor's reading rather than the authority's publication.

**B. External rate-service dependency.** The Avalara / TaxJar / Symmetry shape: an API returns the rate, and correctness is the vendor's problem.
*Rejected*, for two platform-specific reasons. It contradicts operational independence — a sovereign install must run without an external dependency — and it does not solve the actual problem, because the install still holds no citable local record of what was applied and why.

**C. Effective-dated reference tables maintained by an administrator.** The open-source ERP shape (Odoo, ERPNext and similar): tax brackets and salary rules are data records with validity windows that an admin maintains.
*Adopted as the base*, because effective dating is the only shape that keeps a closed period reproducible. This is the standard being followed — a slowly-changing-dimension type-2 record, which is the ordinary data-warehousing answer to "what was true then, and what is true now".

**What DPF adds that none of the three has: provenance and a ratification gate.** In all three shapes, a figure's authority is whoever typed it. Here every row carries `sourceUrl`, `sourceExcerpt` and `retrievedAt`, and a `status` that starts at `proposed`. That is what makes it safe to let an agent do the reading: its output is a citation for review, never an input to a filing.

**The platform's own precedent is the strongest citation.** `LicenseRequirementReference` is already an acquired external corpus carrying `sourceUrls`, `confidence` and `lastResearchedAt`, maintained by AGT-905, with `reference-freshness` supplying a 90-day re-verification ceiling. This design deliberately reuses that shape rather than inventing a second one — the same freshness module, the same citation fields, the same accountable coworker.

## Design

### `PayrollTaxRule`

Effective-dated per `(jurisdiction, taxType, ruleKind, side, effectiveFrom)`. `taxType` is a closed `PayrollTaxKind` enum mirroring the union the emitter already computes against, so a figure and its computation cannot drift apart on a typo (AGENTS.md §8). `ruleKind` separates a `rate` from a `wage_base`, `threshold` or `amount`, because an authority publishes all four and conflating them is how a ceiling gets applied as a percentage.

Attribution columns are real relations with `ON DELETE SET NULL`: attribution is audit context, not ownership, so a departed employee must not pin a statutory figure in place.

### The propose / ratify split

- `checkStatutoryProposal` refuses an uncited or undated figure **before the write**. A row that exists tends to get used, so it must not exist.
- `checkStatutoryRatification` refuses a non-human actor **unconditionally**. Without this the split is decorative: an uncited figure computing withholding behind an audit trail that makes it look reviewed.
- `resolveStatutoryRule` returns only `ratified` rows. A proposal is a research finding; `null` is the correct answer for "nobody has confirmed a figure yet", and the caller must surface it.

### Readiness

`assessStatutoryReadiness` separates two failures that need different human actions — *never researched* versus *researched and waiting on a confirmation* — and blocks on a stale or never-verified authority record. It is the first consumer of `packages/db/src/reference-freshness`, which had carried its ceiling and its `unverified`/`stale` distinction since 2026-08-25 with zero importers.

### Tools

`list_statutory_rate_gaps` and `propose_statutory_rate`, behind a new `statutory_reference_propose` grant held by AGT-WS-COMPLIANCE and AGT-905. **No ratify tool exists**, deliberately: confirming a figure is a human action on the finance surface, and exposing it to MCP would let an agent confirm its own research.

## Out of scope

- **The figures themselves** (BI-4EB27955). `PayrollTaxRule` ships empty. Seeding one would fabricate the exact evidence a filing depends on.
- **Reachability of the research coworker** (BI-67CAF494). The `youth-sensitive` detector matches governance vocabulary rather than value-shaped evidence, so a research coworker can still be pinned local-only. This design gives it somewhere to deliver; that item decides whether it can be reached.
- **The ratification surface.** The rules and the gate exist; the finance-surface control a human clicks is not built here.
- Return generators, 941/940/W-2/W-3/1099-NEC (BI-947F8703 item 6).

## Verification

1,636 tests across `lib/finance` and `lib/mcp`, including the tool-registry contract test asserting pack grants mirror the gating source; 27 assertions on the propose/ratify/resolve rules, of which the load-bearing two are *"REFUSES to use a proposed figure"* and *"REFUSES an agent, even on a perfectly good proposal"*. `tsc` clean on web and db.
