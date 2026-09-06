# Make the scheduled-job kill switch load-bearing (BI-7E49FA15)

Status: implemented (branch fix/scheduled-job-kill-switch-v2) · Umbrella backlog item: BI-7E49FA15 · Workroom: WC-5586F794

## Problem

`ScheduledJob.enabled` is documented as a per-job kill switch. In practice six of
the 55 catalogued crons consult it, and five of those six hand-roll the query
instead of calling the shared `isJobEnabled()` helper. For every other recurring
job, pressing **Disable** on the Scheduled Jobs surface writes a column nobody
reads and the job runs on its next tick. The operator is told the job is off and
it is not.

`#4667` already made the surface honest — the catalog carries `honorsEnabledGate`
and a row without it renders "no kill switch". This plan makes the switch true
rather than merely honestly labelled.

## Research & benchmarking

Three shapes were considered for where the gate belongs.

1. **Per-cron hand-rolled check** — the status quo for five jobs. Rejected: it is
   the single-source-of-truth violation underneath the coverage gap, and its
   default-on-missing-row semantics have already drifted between call sites
   (three sites swallow read failures with `.catch(() => null)`, one does not).
2. **Inngest middleware on the client** (`onFunctionRun`, which does see `fn.id`).
   This is how Temporal interceptors and Sidekiq middleware express cross-cutting
   run gates, and it needs zero per-function edits. Rejected: Inngest middleware
   cannot short-circuit a run. The only abort is throwing `NonRetriableError`,
   which records a *failure* in run history rather than a skip — the opposite of
   what an operator pressing Disable should see, and it would corrupt the
   `lastStatus` the register reads.
3. **Extend the existing shared entry gate** — `gateAtEntry(step)` in
   `apps/web/lib/queue/quiescence-gates.ts`, already called by 55 of the cron
   modules for the Activity Quiescence Protocol. It returns
   `{ proceed: false, skipped: true, reason }`, which is exactly the skip shape a
   kill switch wants, and every caller already handles it. **Adopted.**

Option 3 is also what the platform already does for the other operator-facing
run gate (quiescence), so the kill switch does not become a second mechanism for
"reasons this tick did not run" — consistent with §1 single source of truth.

The gate needs to know *which* job it is gating. `gateAtEntry` takes a **required**
second parameter, the Inngest function id, and resolves the `jobId` through the
catalog. Required rather than optional so the compiler — not a lint rule and not
review attention — enforces that every gated cron declares its identity.

## Design

1. `catalog-types.ts` gains `ungatedReason?: string`: the declared reason a job is
   deliberately not gated. Every catalog entry must carry exactly one of
   `honorsEnabledGate: true` or a non-empty `ungatedReason`.
2. `catalog.ts` gains `getCatalogEntryByInngestId(inngestId)`.
3. `core.ts` `isJobEnabled()` becomes the one implementation of the gate,
   including its read-failure posture: a failed read defaults to **enabled**. A
   kill switch that fails closed would take the platform down on a database blip;
   three of the five existing call sites already fail open and this makes that
   uniform and stated.
4. `quiescence-gates.ts` `gateAtEntry(step, inngestId)` checks quiescence first,
   then the kill switch, returning `reason: "disabled-by-operator"`. The check is
   its own `step.run` so it is checkpointed like the quiescence check.
5. The five hand-rolled sites (`catalog-sweep-runner.ts`,
   `identity-inference-runner.ts`, `operate/retention/run.ts`,
   `operate/inngest-retention/run.ts`, `queue/functions/mdm-steward-sweep.ts`)
   call `isJobEnabled()`. They keep their own check because they are also reached
   by the run-now event path, which does not pass through `gateAtEntry`.
6. All 64 `gateAtEntry(step)` call sites pass their function id.
7. Catalog entries flip to `honorsEnabledGate: true` as each is wired.

### Deliberate exemptions

`self-upgrade` and `all-backups-daily` are the quiescence *callers*; the existing
protocol already forbids gating them, and a kill switch on the upgrade path would
strand an install with no route to a fix. Catalogued crons whose modules do not
call `gateAtEntry` keep `ungatedReason` until they are wired.

## Verification

- Unit: `quiescence-gates.test.ts` — disabled job skips with
  `disabled-by-operator`; enabled job proceeds; quiescence still takes precedence;
  unknown inngest id proceeds; read failure proceeds.
- Unit: `catalog.test.ts` — every entry declares exactly one of
  `honorsEnabledGate: true` or a non-empty `ungatedReason`.
- Unit: source-scan guard — every `gateAtEntry(step, X)` passes an id that appears
  as this module's own `id:` and resolves to a catalogued entry, so a copy-paste
  of the wrong constant fails the build rather than silently gating the wrong job.
- Production build: `pnpm --filter web build`.
- Migration: none — no schema change; `ScheduledJob.enabled` already exists.
- UX: no route markup changes. The Scheduled Jobs surface already renders
  `killSwitchEnforced` from `honorsEnabledGate`; the rows stop saying "no kill
  switch" as a consequence of the catalog data, not of a component change.

## Rollout

One PR, no schema change, one clean revert. It changes the runtime behaviour of
live jobs only when an operator has actually set `enabled = false` — every job
defaults to enabled, so a green install sees no behaviour change at all.
