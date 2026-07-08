# Inngest history-retention + orphan-reaper janitor (BI-0AB96FE7, EP-B9DD37C7)

**Status:** Slice 1 implemented — this PR.
**BI:** BI-0AB96FE7 (priority-1 bug, triage: build). Claim capsule WC-AD5235EF.
**Kernel decision:** `principle_decide` (reliability-hardening-scope) recommended
**janitor-first-slice** with high confidence (composite 11.13, margin 3.05) over
"all-three-now" (6.36) and "promote-build-studio" (8.09).

## Problem

Self-hosted Inngest v1.30 splits run state: live state in Redis under a
~12–16h TTL; durable history in Postgres `db=inngest` (`function_runs`, `spans`,
`traces`, `history`, `trace_runs`, `function_finishes`) with **no TTL and no
GC**. When a run's Redis `{estate}` state TTL-expires, its Postgres rows strand;
the single executor retries the orphan forever (`run not found in state store` +
`duplicate key spans_pkey`). Orphans accumulate unbounded (21,838 unfinished
`function_runs` / ~987k spans at the choke point) until the executor chokes and
drives **zero** executions — a silent, total outage of all scheduled and
autonomous dispatch. A self-upgrade is only the tipping point, not the cause.

The 2026-07-07 manual drain recovered the system but is a one-shot runbook.
Notably it truncated `trace_runs` but **not** `traces`, which still holds
338,514 rows older than 7 days — the largest single unbounded table.

## Slice 1 — this PR (non-destructive prevention)

A scheduled janitor that bounds the history and reaps orphans before they can
starve the executor. Modeled exactly on the `data-retention-sweep` pattern.

- `apps/web/lib/operate/inngest-retention/constants.ts` — ids, `17 */6 * * *`
  cron, 24h orphan-age / 7d history windows, `resolveInngestDatabaseUrl` (derive
  `db=inngest` from `DATABASE_URL`, or explicit `INNGEST_POSTGRES_URI`).
- `execute.ts` — pure engine over an injected `SqlRunner`: reap unfinished
  `function_runs` older than 24h (Redis state provably gone), then trim each
  history table by its **own** timestamp (run_id is encoded differently per
  table — bytea/text/char(26) — so never cross-join). Batched ctid deletes,
  per-table cap, best-effort per table, dry-run = count-only.
- `run.ts` — operator kill switch (`ScheduledJob.enabled`), short-lived `pg`
  connection to `db=inngest`, heartbeat + recent-run summary persistence.
- `apps/web/lib/queue/functions/inngest-retention-sweep.ts` — scheduled +
  requested Inngest functions, quiescence-gated, concurrency 1.
- Registry: `functions/index.ts`, catalog: `scheduled-jobs/catalog.ts`
  (parity-tested), seed: `packages/db/src/seed-platform-inngest-retention.ts`.

### Why 24h orphan age

Observed Redis `{estate}` TTLs are ~12–16h. An unfinished `function_runs` row
older than 24h has certainly lost its Redis state (so it can never complete),
while no legitimate function runs that long (self-upgrade < 1h; quiescence waits
are budget-bounded). 24h is therefore both safe and exactly equivalent to the
BI's "Redis state is gone" signal — reachable without Redis credentials.

## Deferred to follow-up slices (filed intent, not this PR)

2. **Executor-starvation probe + auto-recovery.** A health probe that detects
   "cron timers firing but 0 executions in N min" **cannot** be an Inngest cron
   (chicken-and-egg when Inngest is wedged) — it must be an external portal-side
   watchdog, and auto-drain is destructive (Redis `FLUSHALL` + container
   restart) needing a docker capability the portal does not hold today. Higher
   blast radius; belt-and-suspenders once Slice 1 keeps orphans from ever
   reaching the choke point.
3. **Config hardening.** Align Redis run-state TTL with Postgres, audit
   every-minute crons (`taskrun-watchdog` is a deliberate liveness guard — do
   not widen carelessly), consider an Inngest version bump.

## Verification

- Unit: `execute.test.ts` (11) — reap-then-trim ordering, dry-run counts only,
  Date vs unix-ms bounds, per-table cap flag, per-table error isolation,
  EXISTS/NOT-EXISTS partition; plus `resolveInngestDatabaseUrl` +
  `nextInngestRetentionRunAt`.
- Live schema: every predicate run against `db=inngest` returns valid counts;
  the ctid batched DELETE plan is valid. First real run trims 338,514 stale
  `traces` rows (capped over 2 runs).
- Post-deploy: operator "run now" with `dryRun:true` preview, then a real run;
  confirm `ScheduledJob(inngest-retention-sweep)` heartbeat + `recentRuns`.
