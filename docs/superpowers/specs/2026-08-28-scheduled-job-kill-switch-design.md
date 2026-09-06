# Scheduled-job kill switch — design

Backlog item: BI-7E49FA15 · Workroom: WC-5586F794 · Profile: fix
Implementation plan: `docs/superpowers/plans/2026-08-28-scheduled-job-kill-switch.md`

## Problem

`ScheduledJob.enabled` is documented as a per-job kill switch. Six of the 55
catalogued crons consult it, and five of those six hand-roll the query instead of
calling the shared `isJobEnabled()` helper. For every other recurring job,
pressing **Disable** on the Scheduled Jobs surface writes a column nobody reads
and the job runs on its next tick. The operator is told the job is off and it is
not.

`#4667` already made the surface honest — the catalog carries `honorsEnabledGate`
and a row without it renders "no kill switch". This design makes the switch true
rather than merely honestly labelled.

Two defects sit under one symptom, and this design addresses both:

- **Coverage.** 49 catalogued crons never read the column.
- **Single source of truth.** The gate is implemented six times. The copies have
  already drifted: three swallow read failures with `.catch(() => null)` and
  default to running, one lets the read throw, and two fold the read into an
  upsert that also materialises the row.

## Research & benchmarking

Three shapes were considered for where the gate belongs.

### 1. Per-cron hand-rolled check — the status quo

How five of the six enforcing jobs do it today: a local
`select: { enabled: true }` followed by `if (job.enabled === false) return`.

**Rejected.** It is the single-source-of-truth violation underneath the coverage
gap, it has already drifted across call sites, and extending it to 49 more crons
would multiply the drift by eight.

### 2. Inngest middleware on the client

Inngest's `InngestMiddleware` exposes `onFunctionRun({ ctx, fn })`, so a single
client-level middleware could see every function's id and gate every run with no
per-function edits. This is how the comparable open-source schedulers express
cross-cutting run gates:

- **Temporal** — worker *interceptors* wrap every workflow/activity execution and
  are the documented place for cross-cutting concerns.
- **Sidekiq** — server-side *middleware* wraps every job; the ecosystem's standard
  pause/kill plugins (`sidekiq-limit_fetch`, Sidekiq Pro's queue pause) hook there.
- **Celery** — the `task_prerun` signal plus `Task.throws`, again a single
  cross-cutting hook rather than per-task code.

DPF adopts the *principle* these three share — one cross-cutting gate, not N
copies — and **rejects the middleware mechanism specifically**, because Inngest's
middleware cannot short-circuit a run. The only abort available is throwing
`NonRetriableError`, which records a **failure** in run history rather than a
skip. That is the opposite of what an operator pressing Disable should see, and
it would poison the `lastStatus` the scheduled-work register reads to derive job
health — a disabled job would render as failing.

### 3. Extend the existing shared entry gate — adopted

`gateAtEntry(step)` in `apps/web/lib/queue/quiescence-gates.ts` is already called
by 55 cron modules for the Activity Quiescence Protocol. It returns
`{ proceed: false, skipped: true, reason }` — exactly the skip shape a kill switch
wants, already handled by every caller, and already recorded as a skip rather
than a failure.

This is the same cross-cutting-hook principle as Temporal/Sidekiq/Celery,
expressed through the hook this platform already has. It also keeps the kill
switch from becoming a *second* mechanism for "reasons this tick did not run":
quiescence and the kill switch answer that question in one place, in one shape.

## Design

The gate needs to know which job it is gating. `gateAtEntry` takes a **required**
second parameter, the Inngest function id, and resolves the `jobId` through the
catalog. Required rather than optional so the compiler — not a lint rule, not
review attention — enforces that every gated cron declares its identity.

1. `catalog-types.ts` gains `ungatedReason?: string`: the declared reason a job is
   deliberately not gated. Every catalog entry must carry exactly one of
   `honorsEnabledGate: true` or a non-empty `ungatedReason`.
2. `catalog.ts` gains `getCatalogEntryByInngestId(inngestId)`.
3. `core.ts` `isJobEnabled()` becomes the one implementation of the gate,
   including its read-failure posture: **a failed read defaults to enabled.** A
   kill switch that failed closed would take the whole schedule down on a database
   blip. Three of the five existing call sites already fail open; this makes that
   uniform and stated rather than accidental.
4. `gateAtEntry(step, inngestId)` checks quiescence first, then the kill switch,
   returning `reason: "disabled-by-operator"`. The check is its own `step.run` so
   it is checkpointed like the quiescence check.
5. The five hand-rolled sites call `isJobEnabled()`. They keep a check of their
   own because they are also reached by the run-now event path, which does not
   pass through `gateAtEntry`.
6. All `gateAtEntry(step)` call sites pass their function id.
7. Catalog entries flip to `honorsEnabledGate: true` as each is wired.

### Deliberate exemptions

`self-upgrade` and `all-backups-daily` are the quiescence *callers*; the protocol
already forbids gating them, and a kill switch on the upgrade path would strand
an install with no route to a fix. Catalogued crons whose modules do not call
`gateAtEntry` keep an `ungatedReason` until they are wired.

## Consequences

No schema change — `ScheduledJob.enabled` already exists, and every job defaults
to enabled, so a green install sees no behaviour change at all. The change is
observable only where an operator has actually set `enabled = false`, which is
the entire point.
