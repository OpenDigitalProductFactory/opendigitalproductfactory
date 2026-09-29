# M3 phase 2: the Postgres durable-job engine behind the `@/lib/jobs` facade

**Spec:** [Durable jobs on Postgres](../specs/2026-09-25-postgres-durable-job-engine-design.md) §5 (as amended 2026-09-29) and §6 step 2 · **Backlog:** `BI-85E6EF14` (child of `BI-068BBA33`) · **Epic:** `EP-8DC217EB` · **Decision:** `own_postgres_jobs`, WWMD DI-E52E32AEA1E4 · **Phase 1:** #5760

## Goal

Every job function can run on an owned Postgres engine instead of Inngest, chosen by a flag that defaults to Inngest. With the flag unset, nothing changes. The spec's §7 benchmarks run against real Postgres and are recorded in the spec; the flag flips only after they pass and a per-domain soak is clean. Retiring Inngest is phase 3 and a separate PR.

## Deliverables

The phase ships as one PR because nothing in it is reachable until the flag is set: a half-built engine behind an off flag is not independently useful, and splitting it would ship dead code first. The steps below are the review order inside that PR.

| # | Step | Files | Verification |
|---|---|---|---|
| 1 | **Schema and migration.** `JobEvent`, `JobRun` (+ `JobRunStatus` enum), `JobStep`, `JobWait`, `JobConcurrencySlot`, `JobCronState`. One forward-only migration that only creates objects, so it applies to any existing data state. | `packages/db/prisma/schema/ops-telemetry.prisma` (or a new `jobs.prisma`), `packages/db/prisma/migrations/<ts>_durable_job_engine/` | migration applies on a fresh schema and on a copy of the live schema; enum generator + `db:generate` clean |
| 2 | **Full cron evaluator.** `computeNextCronFire(expr, from)` beside `computeNextCronRun`: `*`, lists, ranges, steps, Vixie day-of-month/day-of-week OR. `computeNextCronRun`'s behaviour for the agent-task scheduler is unchanged. | `apps/web/lib/operate/cron-next-run.ts` + test | table test over every expression in `lib/queue/functions` |
| 3 | **Engine core.** Registry of `JobFunction`s; `run(runId)` replays the handler with a step context: memoised `step.run` (stored as jsonb, `Jsonify` semantics, Inngest's `:n` counter for repeated ids), `sleep`/`sleepUntil` (park with `runAfter`), `waitForEvent` (park with a `JobWait`; `if` evaluated by the same restricted expression evaluator used for concurrency keys), retries 0–3 with backoff, `onFailure` with the `inngest/function.failed` event shape. | `apps/web/lib/jobs/postgres/engine.ts`, `steps.ts`, `expressions.ts` | unit tests against a real test database for each semantic in AC-2 |
| 4 | **Claim and concurrency.** `FOR UPDATE SKIP LOCKED` claim; per-lane `pg_advisory_xact_lock` in sorted order; lowest free slot below the lane's limit; unique `(laneKey, slot)` backstop; slots released on every exit from `running`; lease-expiry recovery (reuses the `reconcile-stuck-runs` pattern). | `apps/web/lib/jobs/postgres/claim.ts`, `lanes.ts` | limit 1, limit 2, limit 4, account lane with operator N, two lanes at once; concurrent claimers never exceed a limit |
| 5 | **Send, waits and cancel.** `send` inserts `JobEvent` (sender id = unique dedupe key), starts a run per Postgres-routed function triggered by the event, resolves matching `JobWait`s and applies `cancelOn`, all in one transaction, then `pg_notify('dpf_jobs', …)`. | `apps/web/lib/jobs/postgres/send.ts` | dedupe, fan-out to several functions, wait match and timeout, cancel mid-run |
| 6 | **Worker loop and cron tick.** Starts in the portal process only when some function is routed to Postgres; `LISTEN dpf_jobs` with a polling fallback; bounded parallelism; cron tick over `JobCronState`, gated by `DPF_SCHEDULED_INNGEST_FUNCTIONS_ENABLED` and `ScheduledJob.enabled` as today. | `apps/web/lib/jobs/postgres/worker.ts`, `cron.ts`, `instrumentation.ts` hook | worker start/stop; notify wake; poll fallback; cron fires once per due time, not per missed time |
| 7 | **Engine selection.** `DPF_JOBS_ENGINE` (`inngest` default, `postgres`) and `DPF_JOBS_POSTGRES_FUNCTIONS`; a routing client behind `jobs` that registers each function with its engine and sends to both engines while any function remains on Inngest. `serveJobs` serves only Inngest-routed functions. | `apps/web/lib/jobs/index.ts`, `routing.ts`, `serve.ts` | flag unset: every existing job test passes and the Inngest adapter is byte-for-byte the call path (AC-1) |
| 8 | **Benchmarks and drills (spec §7).** A script that drives the engine against the platform Postgres (or its `local-integration-ci` slot) at 10× the busiest observed hour, measures event-to-first-step p50/p99 against Inngest on the same host, claim throughput for 125 functions / 84 keys in an overlapping cron minute, extra WAL and connections, and kills the worker mid-step, mid-sleep and mid-wait. Results are written into the spec's §7, pass or fail. | `apps/web/scripts/job-engine-bench.ts`, spec §7 | the numbers themselves, recorded |

## Guardrails

- The `inngest` import stays confined to `lib/jobs/inngest-adapter.ts` and `serve.ts` (`check-no-direct-job-engine-import.mjs`); the Postgres engine lives under `lib/jobs/postgres/` and imports neither.
- No new dependency. `pg_notify`/`LISTEN` use the existing Prisma/pg stack, as `lib/work-capsules/activity-events.ts` does.
- `/ops` and the `taskrun-watchdog` keep reading `TaskRun`; `JobRun` is engine state, not a second reporting model.
- The flag is read at process start. Changing it is a restart, which `/ops/self-upgrade` already owns.

## Out of scope

- Flipping the flag on any install (after §7 passes and a soak).
- Phase 3: retiring Inngest, Redis, `redis-exporter`, `INNGEST_*`, the retention reaper, the poison-queue drain and the package (a separate item after the flag has been on).
