# Scheduling surface buildout — implementation plan

- Date: 2026-06-21
- Epic: `EP-SCHEDULING-SURFACE`
- Spec: [docs/superpowers/specs/2026-06-21-scheduling-surface-review-design.md](../specs/2026-06-21-scheduling-surface-review-design.md)
- Branch: `claude/scheduling-surface-buildout`

Implements the five remaining BIs from the scheduling-surface review in one PR. (`BI-SCHED-CATALOG-PARITY` shipped earlier as PR #2227.)

## BI-SCHED-CANONICAL-MAP — canonical scheduling map
- New `apps/web/lib/operate/scheduled-jobs/scheduling-map.ts`: `SCHEDULING_MAP` spans every scheduled unit across substrates — 26 Inngest crons (derived from `SCHEDULED_JOB_CATALOG`, so it can't drift) + 4 seeded `ScheduledAgentTask`s — each tagged with `substrate`, `cron`, `cadence`, `category`. `SUBSTRATE_DATA_MODEL` maps each substrate to its Prisma data-model node; `cronCollisions()` groups by identical cron.
- Agent-task entries are restated as literals (not imported): the `@dpf/db` vitest alias resolves to a light client barrel that does not re-export the seed-config constants, so a cross-package import resolves `undefined` under test. The literals mirror `packages/db/src/*-config.ts`.
- Test: `scheduling-map.test.ts`.

## BI-SCHED-GRAPH-EXTRACTOR — scheduling as a first-class graph surface (keystone)
- New `apps/web/lib/ea/scheduled-job-extract.ts`: `buildSchedulingModel()` projects the map into a SysML package (`package` → `part_definition` per substrate → `part_usage` per job) with cross-layer `traces` edges to `prisma:model:ScheduledJob` / `prisma:model:ScheduledAgentTask`. Mirrors `operational-bridge-extract.ts`.
- New `reconcile-scheduled-jobs.ts`: thin IO shell, registered in `reconcile-sysml-projections.ts` so it runs on every nightly/on-demand parity reconcile. `architecture-parity-steward.ts` gains a `scheduledJobs` domain label.
- Test: `scheduled-job-extract.test.ts`. Answers the founder's question: scheduling is now a navigable surface in the architecture graph.

## BI-SCHED-STAGGER — de-herd + contention guard
- Staggered 8 crons off shared ticks: the every-15m 5-way (issue-report-triage :03, coworker-regression :06, log-signature :09, release-health :12; code-graph stays :00); discovery poll → :05, sweep → :10; model-discovery → 03:10, material-freshness → 03:20. Function `cron()` and catalog `cron`/`cadence` updated together; DR-backup-first and data-retention-after-backup invariants preserved.
- Guard: `scheduling-map.test.ts` fails if any cron expression is shared by 3+ entries. Post-stagger max is 2.

## BI-SCHED-DORMANT — wire/document dormant substrates
- Wired: `marketing/scheduler-dispatch` (every 30m → `tickScheduler()`) and `finance/recurring-invoice-dispatch` (daily 06:30 → `generateDueInvoices()`). Both `editable` (operator kill switch), gated by the master flag + quiescence; outbound sends still pass the kernel veto. Catalog entries added (the parity guard forces this).
- Documented: `TaxRemittanceRun.scheduledFor` already dispatches via a per-run `ScheduledAgentTask` (no central poller needed) — clarifying comment added.

## BI-SCHED-DEADCODE — remove superseded code
- Deleted `apps/web/lib/self-upgrade/activity.ts` + `activity.test.ts` (zero live importers; superseded by `quiescence.ts`). `rate-recovery.ts` confirmed already clean — no action.

## Validation
- Local vitest: scheduled-jobs (map/contention/parity), EA (extractor/projection/steward), queue/functions index — all green.
- Full `apps/web` typecheck.
