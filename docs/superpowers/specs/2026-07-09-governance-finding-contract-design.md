# Governance findings plane — one contract + one severity ladder (opener)

_Status: implemented with BI-7CD647B0 · EP-8DC217EB BET-12 (opener) · 2026-07-09_
_Parent plan: [`2026-07-07-vertical-integration-inward-plan.md`](../plans/2026-07-07-vertical-integration-inward-plan.md) §4 BET-12_

## The gap

Four "finding" streams never meet: `WikiLintFinding` (wiki lint), `ReviewFinding`
(derived from the `DecisionInteraction` ledger), `AssuranceFinding` (supply-chain
scans), and `SecurityCase` (SOC). Each carries the same logical shape — a
stable-keyed finding with a severity, a status, a title/detail, and a review
action — but with its own severity ladder (5+ ladders across the streams) and no
shared read-shape, so no surface (and not the BI-83AC1A03 reporting composer)
can render or roll them up together.

## What landed (pure-additive core)

- **`lib/governance/severity.ts`** — the single canonical ladder
  `GovernanceSeverity = critical > high > medium > low > info` + rank / compare /
  max / highest helpers + mappers that fold each stream's vocabulary on:
  `fromLintSeverity` (info/warn/error → info/medium/high) and `fromLadderString`
  (the security/assurance vocabulary, already canonical; unknown → info).
- **`lib/governance/finding-contract.ts`** — the `GovernanceFinding`
  presentational contract (`source`, `key`, `severity`, `status`, `title`,
  `detail`, `count`, optional `href`/`actionLabel`/`actionHref`) + the four
  `from*` adapters (lint / review / assurance / security), plus
  `sortFindingsBySeverity` and `rollupFindings` for a unified surface. The
  adapters read narrow structural views of each source type (no import of the
  persistence/detector modules), so this stays a leaf with no new deps and no
  hot-zone touch.

## Deliberately deferred (later BET-12 increments)

Per the plan's land-order and the Inside-Out hot-zone rule, these are **not** in
this PR:

1. **`reconcile-keyed-findings` extraction** — generalize the keyed-upsert +
   auto-resolve loop out of `ea/conformance-issue-reconciler.ts` (a live file
   used by 3 stewards) into a reusable helper, refactoring the reconciler as a
   thin adapter. Behavior-preserving refactor of a live path → its own increment.
2. **`withAssuranceRun` wrapper** — collapse the duplicated `AssuranceRun` ledger
   block in `assurance/scan-job.ts` + `bom-job.ts`.
3. **case→evidence generalization** — mirror `securityCaseToEvidenceInput` for
   assurance runs so `ComplianceEvidence` is fed by more than security.
4. **detector → `ingestBacklogItem` fan-in** — route SOC cases (which today
   never become BIs) and wiki lint through the front door. **Touches
   `lib/queue`** (`siem-correlation-sweep.ts`) → coordinate with the Inside-Out
   notification substrate (BI-997503EC) before building, so the two epics don't
   grow parallel dispatchers.

## Consumers

The contract is the shared read-shape the four display surfaces
(`admin/wiki/lint`, `wiki/review`, `portfolio/.../supply-chain`, `ops/security`)
and BI-83AC1A03's composer project into. Page adoption is additive and follows
in increment 1+ — this PR ships the contract + adapters + rollup as the library
foundation, unit-tested against each source shape.

## Research & benchmarking

The single-ladder + per-source mapper approach matches how SIEM/GRC tools
(e.g. DefectDojo's unified finding model) normalize heterogeneous scanner
severities onto one ordinal scale before dedup/rollup, rather than rendering
each tool's native scale. The `reconcile-keyed-findings` target already exists
in-repo as `reconcileConformanceIssues` — increment 1 generalizes it rather
than inventing a parallel loop.
