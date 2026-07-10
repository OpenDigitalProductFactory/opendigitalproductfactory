# Governance findings plane — one contract + one severity ladder (opener)

_Status: opener + increment 2 landed under BI-7CD647B0 · EP-8DC217EB BET-12 · 2026-07-09_
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

## Landed in increment 2 (BI-7CD647B0 · behavior-preserving)

Two duplication-collapsing extractions, no observable-behavior change; existing
tests stayed green and new unit tests cover the helpers:

1. **`lib/governance/reconcile-keyed-findings.ts`** — the generic keyed-upsert +
   auto-resolve loop (`reconcileKeyedFindings<TRow, TFinding>` +
   `stableStringify`), storage-agnostic via caller-supplied
   `loadOpen` / `keyOf` / `hasChanged` / `create` / `update` / `resolve`.
   `ea/conformance-issue-reconciler.ts` is now a **thin adapter** over it —
   plugging in the `eaConformanceIssue` delegate, the `detailsJson.issueKey` key
   extraction, and the message/severity/detailsJson change detection. Its
   exported signature and `{created, updated, resolved}` return shape are
   unchanged, so **the stewards that call it need zero changes** (architecture-
   parity, data-architecture-steward-apply, consolidation-parity). The other
   streams (wiki-lint, assurance, security) can adopt the loop later without
   touching it. (`reconcile-it4it-coverage.ts` keeps its own parallel
   `detailsJson.key` loop for now — a future adoption candidate, left untouched.)
2. **`lib/assurance/with-assurance-run.ts`** — `assuranceRunId(prefix, buildId,
   toolExecutionId)` (shared sanitize + `slice(0,64)`) and `createAssuranceRun`,
   which applies the fixed AssuranceRun contract (scopeType `build`,
   scopeId = buildId, startedAt = completedAt = injected `now`) and takes the
   varying fields as params. `scan-job.ts` and `bom-job.ts` call it and deleted
   their duplicated local `createRunId` copies; the runId strings, field values,
   and `summary as Prisma.InputJsonValue` cast are byte-for-byte preserved.

## Deliberately deferred (later BET-12 increments)

Per the plan's land-order and the Inside-Out hot-zone rule, these are **not** yet
built:

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
each tool's native scale. The `reconcile-keyed-findings` target already existed
in-repo as `reconcileConformanceIssues` — increment 2 generalized it in place
rather than inventing a parallel loop.
