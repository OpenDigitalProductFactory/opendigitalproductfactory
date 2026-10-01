---
status: active
---

# Durable jobs on Postgres: replace the Inngest server with an owned `@dpf/jobs` engine

**Plan:** [dependency diet, move M3](../plans/2026-09-08-dependency-diet-and-vertical-integration-plan.md) · **Epic:** `EP-8DC217EB` · **Backlog:** `BI-068BBA33` · **Sequenced behind:** BET-11 scheduling substrate (`BI-B72328D5`) · **Doctrine:** `absorb-dont-adopt` (commandment)
**Decision:** `own_postgres_jobs`, founder, 2026-09-26 (plan §10.6.1). §8 keeps the inputs, which the `principle_decide` record still owes. The DPF MCP server was unreachable from the deciding session. The §7 benchmarks gate turning the Postgres engine on (§6 step 2), not the facade (§6 step 1).

## 1. Problem

Every background workflow in the platform runs through a self-hosted Inngest server. The inventory below was taken from `main` on 2026-09-25; file references are to that tree.

**What it costs to run:**

- Two always-on containers with no profile gate: `inngest` (`inngest/inngest:v1.36.0`, 1 GB / 1 CPU limit, `docker-compose.yml:948-1000`) and `redis` (`redis:7-alpine`, `:913`). A third, `redis-exporter`, runs under `runtime-durable-automation`. Redis exists only for Inngest.
- A second database, `inngest`, inside the platform Postgres, created by `scripts/init-inngest-db.sh` (baked into `docker/postgres/Dockerfile:36`).
- Every step is an HTTP round trip: portal → `inngest:8288` → portal `/api/inngest` (`app/api/inngest/route.ts`).
- The `INNGEST_*` env surface (`docker-compose.yml:309-323`), which falls back to fixed placeholder event and signing keys written into the compose file itself.
- Boot-time self-registration: `instrumentation.ts:1214-1240` retries a PUT to `/api/inngest` up to six times, because self-hosted Inngest does not discover apps.

**What we have built around it, which exists only because of it:**

- `lib/operate/inngest-retention/` opens a raw `pg` connection to the `inngest` database every six hours. It reaps `function_runs` older than 24 hours whose Redis state has already expired, and trims `spans` and `history`.
- `scripts/drain-inngest-poison-queue.sh` deletes Redis queue items with a nil environment ID.
- `lib/queue/job-engine-health.ts` and `components/ops/SelfUpgradeJobEngineHealthAlert.tsx` record and surface registration and gateway health.
- A Prometheus scrape job and a service-status tile.

**Supply chain and licence:**

- The `inngest` SDK is the largest production root in the portal. At 4.21.0 it declares 23 runtime dependencies, including the OpenTelemetry auto-instrumentation stack and `@traceloop/instrumentation-anthropic`. The plan measured about 380 packages in its production closure, and it is the source of the duplicate `typescript@5.9.3` and `@types/node@22` in the image. Re-measure with `scripts/sbom/runtime-surface.mjs` at implementation time.
- The SDK released 70 stable versions in the last 12 months.
- The server image is licensed **SSPL-1.0** with a delayed Apache-2.0 grant (`inngest/inngest` `LICENSE.md`). SSPL is not an OSI licence, and we ship that image to every customer install.

## 2. What the platform actually uses

125 functions are registered in `lib/queue/functions/index.ts`: 74 on cron, 51 on events. They are defined in 93 files. The plan's figure of "117 across 86 files" predates recent additions. The feature surface is narrow:

| Inngest feature | Use | Notes |
|---|---|---|
| cron trigger | 74 | all gated by `DPF_SCHEDULED_INNGEST_FUNCTIONS_ENABLED` |
| event trigger | 55 triggers | `deliberation-run.ts` listens to two events |
| `step.run` (memoised step) | 228 calls in 92 files | the core semantic to preserve |
| retries | 71×1, 41×2, 10×0, 5×3 | small counts; no custom backoff |
| concurrency | 84 configs | 67 are "one at a time per function"; the rest are limit 1 keyed on `event.data.<id>` (`operationId`, `organizationId`, `buildId`, `providerId`, `parentTaskRunId`, `deliberationRunId`, `environmentKey`), plus the shared account-scope lane in `lib/queue/admission.ts:63` |
| `step.sleep` / `sleepUntil` | 5 | `rate-recovery`, `quiescence-run`, `coworker-certification`, `async-inference-operation` |
| `step.waitForEvent` | 2 direct + `gateBetweenSteps` | the gate (`lib/queue/quiescence-gates.ts:134`) waits for `platform.quiescence-cleared`, timeout 30 minutes, and is used by 4 functions |
| `cancelOn` | 1 | `route-work-item` on `cwq/item.cancelled` |
| `onFailure` | 1 | `build-execute` |
| event `id` (send-side dedupe) | 4 send sites | no function-level `idempotency` |
| `inngest.send` | 47 sites | 44 outside functions, 3 inside |
| `step.invoke`, `step.sendEvent`, throttle, rateLimit, debounce, batchEvents, priority, singleton, function timeouts, fan-out | **0** | |

Observability already lives in our own tables. `/ops` reports from `TaskRun`, and the stall detector (`lib/queue/functions/taskrun-watchdog.ts`) watches `TaskRun`, not Inngest. Nothing in the codebase reads the Inngest dashboard or its API.

**Conclusion:** we use Inngest as a durable-step executor with cron, simple keyed mutexes, a handful of sleeps and waits, and one cancel. We use none of its flow-control features.

## 3. Research & Benchmarking

Four candidates, measured against what §2 needs. Package facts were taken from the npm registry on 2026-09-25.

| | Inngest self-hosted (today) | pg-boss 12.35 | graphile-worker 0.18 | River |
|---|---|---|---|---|
| Runtime | Go server + Redis + Postgres, SDK in portal | library in the portal process | library in the portal process | Go library; the npm `riverqueue` package is an insert-only TypeScript client |
| Licence | SDK Apache-2.0; **server SSPL-1.0** | MIT | MIT | core MPL-2.0; npm client LGPL-3.0 |
| Runtime deps | 23 (SDK) | 4 (`pg`, `cron-parser`, `rrule-temporal`, `serialize-error`) | 8, including `yargs`, `cosmiconfig`, `graphile-config` (beta) | n/a for Node workers |
| Stable releases, last 12 months | SDK 70 | 83 | 5 (pre-1.0) | — |
| Queue claim | Redis | `SKIP LOCKED` | `SKIP LOCKED` + `LISTEN/NOTIFY` | `SKIP LOCKED` |
| Cron | yes | yes | yes (crontab) | yes |
| Retries/backoff | yes | yes | yes (exponential) | yes |
| Keyed mutex | concurrency keys | `singletonKey` / policies | `job_key` + named queues (serial) | unique jobs |
| **Memoised steps (`step.run` replay)** | yes | **no** | **no** | no |
| **`waitForEvent` / `sleep` inside a run** | yes | no | no | no |
| `cancelOn` | yes | no (cancel by id) | no (remove by key) | cancel by id |
| Schema ownership | its own DB | own schema, migrates itself | own schema, migrates itself | own migrations |

**What DPF adopts:**

- **The `SKIP LOCKED` claim pattern**, as used by pg-boss, graphile-worker, River and Solid Queue. It is the proven way to run a queue on Postgres without a broker.
- **graphile-worker's `LISTEN/NOTIFY` wake-up** with a polling fallback. Workers wake within milliseconds without busy polling, and a missed notification costs at most one poll interval. The platform already has a working `pg_notify`/`LISTEN` pair in `lib/work-capsules/activity-events.ts:81,111`.
- **Inngest's programming model**: `createFunction` plus `step.run` memoisation, `sleep` and `waitForEvent`. 92 files are written against it, and it is the right model for long, resumable, side-effecting workflows.

**What DPF rejects, and why:**

- **Keeping Inngest.** It costs three containers, a second datastore (Redis), a per-step HTTP hop, an SSPL server in every customer install, the largest production dependency root, and a maintenance layer (retention reaper, poison-queue drain, registration retries). We use none of the flow-control features that would justify that cost.
- **Renting pg-boss or graphile-worker as the engine.** Neither provides memoised steps, in-run sleep, `waitForEvent` or `cancelOn`. Those are exactly the semantics 92 files depend on, so we would still build the durable-step layer ourselves on top.
  - A rented queue beneath it would add a second schema we do not own (both migrate themselves, outside Prisma and outside our "migration applies cleanly against any data state" rule).
  - It would also add a dependency with its own cadence: pg-boss released 83 times in 12 months, and graphile-worker is pre-1.0 and depends on a beta config package.
  - The queue part we would rent is the small part: a claim query, retry bookkeeping, a keyed mutex, and a cron tick that BET-11 already owns.
- **River.** Workers must be written in Go, and the platform's workflows are TypeScript.

## 4. Recommendation

Own a small durable-job engine, `@dpf/jobs`, on the platform Postgres. Keep the Inngest programming model as its API, so the 125 functions and 47 send sites move by changing an import, not by rewriting.

This is the plan's `own_postgres_jobs` option. The precedent is the same shape as M4: we used a narrow slice of a large rented system, and owning that slice was smaller and safer than renting either the system or a second one.

## 5. Design

### 5.1 API (facade)

`@dpf/jobs` exports a `jobs` client that mirrors the subset in §2:

- `jobs.createFunction({ id, concurrency, retries, cancelOn, onFailure }, trigger, handler)`
- `step.run(id, fn)`, `step.sleep(id, duration)`, `step.sleepUntil(id, date)`, `step.waitForEvent(id, { event, timeout, if })`
- `jobs.send(event | event[])`

A type-level test pins the facade to the options in use. Anything outside §2 is a compile error, not a silent no-op.

### 5.2 Tables (Prisma, one migration)

| Table | Purpose | Key columns |
|---|---|---|
| `JobEvent` | the event log (replaces Inngest's event store) | `id` (sender-supplied or generated; unique, which gives today's send-side dedupe), `name`, `data jsonb`, `receivedAt` |
| `JobRun` | one run of one function | `functionId`, `eventId`, `status` (`queued`, `running`, `sleeping`, `waiting`, `completed`, `failed`, `cancelled`), `attempt`, `runAfter`, `concurrencyKey`, `leaseOwner`, `leaseExpiresAt`, `error` |
| `JobStep` | memoised step results | `(runId, stepId)` unique; `output jsonb`; `completedAt` |
| `JobWait` | a run parked on `waitForEvent` | `runId`, `eventName`, `matchExpr`, `expiresAt` |

Status is a Prisma enum (AGENTS.md §8). Run history reuses the existing `TaskRun` linkage for `/ops`; `JobRun` is the engine's state, not a second reporting model.

### 5.3 Execution

- **Claim.** `UPDATE "JobRun" SET status='running', leaseOwner=$1, leaseExpiresAt=now()+$2 WHERE id IN (SELECT id FROM "JobRun" WHERE status='queued' AND runAfter<=now() AND <concurrency admissible> ORDER BY runAfter FOR UPDATE SKIP LOCKED LIMIT $n) RETURNING *`.
- **Concurrency.** Limit 1 per function or per key is enforced by a partial unique index on `(functionId, concurrencyKey) WHERE status='running'`. A second claimer fails the insert-or-update and skips the row. This covers all 84 configs, which are all limit 1. A limit above 1 is out of scope until something needs it; the facade type rejects it. The shared account-scope lane in `admission.ts` becomes a second key column with the same index.
- **Replay.** Each attempt re-invokes the handler from the top. `step.run` looks up `JobStep(runId, stepId)`: on a hit it returns the stored output without running `fn`; on a miss it runs `fn`, stores the result and continues. Repeated step ids inside one run get Inngest's counter suffix, so replay order matches.
- **Sleep.** `step.sleep` records the step, sets `runAfter=wakeAt`, sets status `sleeping` and ends the invocation. The claimer picks the run up again after `wakeAt`, and replay skips the steps already done.
- **`waitForEvent`.** It inserts a `JobWait`, sets status `waiting` and ends the invocation. `jobs.send` inserts the `JobEvent` and, in the same transaction, matches open `JobWait` rows by name and match expression. Each match gets the event stored as that step's output, and its run is set back to `queued`. `pg_notify('dpf_jobs', …)` wakes a worker. On timeout, the wait's step output is `null`, as in Inngest.
- **`cancelOn`.** A matching event moves the run to `cancelled`. A running handler sees this at its next step boundary.
- **Retries.** A thrown error increments `attempt` and sets `runAfter=now()+backoff(attempt)` until `retries` is exhausted, then runs `onFailure` and marks the run `failed`.
- **Lease recovery.** A run whose `leaseExpiresAt` has passed goes back to `queued`. That is the lease-expiry pattern `lib/operate/backups/reconcile-stuck-runs.ts` already uses for backup runs, which the BET-11 notes describe as engine-agnostic.
- **Workers.** A worker loop in the portal process listens on `dpf_jobs` and polls every few seconds as a fallback. No new container.

### 5.4 Cron

The 74 cron functions register in the BET-11 `ScheduledJob` substrate: one `nextRunAt(schedule)` and one tick. The tick inserts a `JobEvent` per due schedule, so cron runs use the same execution path. This is why M3 is sequenced behind BET-11: the scheduler lands once.

## 6. Migration

1. **Facade over Inngest.** Introduce `@dpf/jobs` with an Inngest adapter and move every import to it. There is no behaviour change, and CI proves the mechanical move.
2. **Postgres engine behind a flag, one domain at a time.** A per-function `engine` setting routes a function to Postgres or Inngest. `TaskRun` outcomes and the `taskrun-watchdog` stall detector are the oracle: a domain moves on only after a clean soak.
3. **Retire.** Remove:
   - the `inngest` and `redis` services, `redis-exporter` and their image pins;
   - the `INNGEST_*` env and `scripts/init-inngest-db.sh`;
   - `lib/operate/inngest-retention/`, `drain-inngest-poison-queue.sh` and self-registration;
   - the Prometheus job and the status tile;
   - the `inngest` package, added to the allowlist's `retired` map so it cannot come back without a decision.

**Existing installs.** Runs in flight in Inngest at upgrade time must finish before its container goes. One release carries both engines, with every function on Postgres and Inngest draining. `/ops/self-upgrade` quiescence already waits for in-flight work. The following release removes the containers, and the `inngest` database is dropped a release after that, once a guard confirms it has no unfinished runs. Existing installs converge on the next `/ops/self-upgrade` with no operator step.

## 7. Benchmarks required before implementation

None of these can be run in a sandbox without Postgres; they are acceptance criteria, not results.

- **Throughput and latency:** event-to-first-step latency at p50 and p99 against today's Inngest on the same host, at 10× the busiest observed hour of `JobEvent`-equivalent traffic, taken from Inngest's `function_runs`.
- **Lock contention:** claim throughput with 125 functions and 84 concurrency keys under an overlapping cron minute.
- **Postgres load:** extra WAL and connections, against the portal's existing pool budget.
- **Failure drills:** kill the portal mid-step, mid-sleep and mid-wait, and prove each run resumes exactly once with memoised steps not re-executed.

If Postgres cannot sustain the load with headroom, that is the evidence for `keep_inngest`, and this spec says so rather than bending the design.

## 8. Decision inputs (`principle_decide`)

- **Options:** `own_postgres_jobs` (§4), `keep_inngest`, `rent_pg_boss`.
- **Axes:** `operational_independence`, `vendor_lock_in`, `long_term_maintainability`, `blast_radius`, `operator_effort`.

Magnitudes as this spec reads them, for the decision to test (on cost axes, higher is worse):

| | own_postgres_jobs | keep_inngest | rent_pg_boss |
|---|---|---|---|
| operational_independence | high: no extra containers or datastores | low: 3 containers, Redis, SSPL server | high |
| vendor_lock_in (cost) | low | high: SDK model plus server | medium: its schema and cadence; still needs our step layer |
| long_term_maintainability | medium: we own about the §5.3 surface | medium: we already maintain a reaper, drain and registration layer | lower: two layers, one not ours |
| blast_radius (cost) | high during migration; mitigated by §6 | none now | high, plus a second migration surface |
| operator_effort (cost) | low after retirement | medium: poison queue, retention, registration | low |

## 9. Out of scope

- Flow-control features the platform does not use (§2).
- Moving the event-to-workflow authoring model (BI-8E07CCA5 / BI-D80D16C4). The facade keeps today's model; a new authoring model can target `@dpf/jobs` later.
- Neo4j/Qdrant retirement (BET-5), which has its own spec.
