# Plan — Fold the Assurance-Findings queue into the backlog (auto-file + reconcile)

_Status: implemented · BI-91D1524F · EP-ASSURANCE-LEDGER · 2026-06-22_

## Problem

The Build Studio Assurance Gate was an **un-folded parallel queue**. The scan
persisted findings into a panel with its own `Status` lifecycle, and findings
only became backlog items via a **manual per-finding button**
(`requestBacklogFromAssuranceFinding`). If no operator clicked, the findings were
a lost queue invisible to the backlog — found only by manually exploring a build.
The queue-reduction sweep did not flag it.

Compounding it: build FB-12D1D4FE filed 24 "Remediate:" findings that were **all
stale false positives** — the audit ran against a tree (the deployed portal,
lagging main during the self-upgrade window) whose lockfile predated main's
security overrides (it observed `hono@4.12.19`, `protobufjs@7.5.8`, `undici@8.3.0`
while main floors `4.12.25` / `7.6.4` / `7.28.0` & `8.5.0`). `pnpm scan:deps`
(OSV) over main = 0 active. So naive auto-file would **auto-manufacture** that
noise. Auto-file is therefore only safe coupled with reconcile.

## Founder-kernel ruling (auto-file scope)

`principle_decide` (in_platform_coworker, 2026-06-22) → **severity-tiered**
(composite 9.55, margin 0.40, confidence high, no commandment conflict):

- high / critical → auto-file as build BIs
- moderate → auto-file as deferred / low-priority BIs
- low / info → evidence only (rolled up, promotable)

## Design (EP-INTAKE-UNIFY pattern — mirrors the improvements→backlog fold)

1. **`finding-reconcile.ts`** (pure) — `decideFindingDisposition(finding, ctx)`:
   fail-closed when context unavailable → already-linked → accepted-in-baseline →
   stale-on-main → severity policy.
2. **`advisory-context.ts`** (server I/O) — builds the `ReconcileContext`
   (accepted advisory ids from `sbom/vuln-baseline.json`; main's resolved
   versions parsed from `pnpm-lock.yaml`) behind injectable readers.
   **Carrier decision:** read from the platform `PROJECT_ROOT` at scan time;
   `available=false` when unreadable → **auto-file fails closed** (never creates
   work it cannot verify).
3. **`auto-file-findings.ts`** — applies dispositions: files genuine findings via
   the shared `ingestBacklogItem` front door (origin `assuranceFinding`), links
   them on the finding, suppresses accepted (→`accepted`) / stale (→`false-positive`),
   annotates `evidence.autoFile` for the panel.
4. **`scan-job.ts`** — runs the auto-file step after persist; opt-in via
   `autoFile.enabled` (production caller `queue/functions/assurance-scan.ts`
   enables it; default off keeps unit tests off the real backlog).
5. **UI fold** — `BuildAssuranceGateCard` renders `AssuranceFindingsList` in
   `readOnly` mode: no per-finding button, no parallel status dropdown; each row
   shows its linked BI or a friendly disposition label. `finding-read.ts` exposes
   `backlogItemId` + `autoFileReason` from evidence.

## Tests

`finding-reconcile.test.ts`, `advisory-context.test.ts`, `auto-file-findings.test.ts`,
additions to `scan-job.test.ts` (default-off + enabled paths) and
`AssuranceFindingsList.test.tsx` (linked + disposition display).

## Follow-ups (not in this PR)

- Point the reconcile root at **current origin/main** (vs the deployed tree) so the
  stale-version check (c) eliminates deploy-lag false-highs; today it bites only
  when the canonical root is more current than the audited tree.
- Bundle a generated advisory-context snapshot so verification also works inside a
  stripped standalone image (otherwise it fails closed there — no regression).
- Auto-resolve findings absent from a later clean scan (clear transient BIs).
- Queue-reduction sweep heuristic: flag any surface with a manual "convert to BI"
  action + its own status lifecycle as a parallel queue.
