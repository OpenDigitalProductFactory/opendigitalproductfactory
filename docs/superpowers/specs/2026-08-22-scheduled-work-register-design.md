---
status: active
---

# Scheduled work register — design

Surface: `/admin/scheduled-jobs`
Supersedes the single-table view shipped on this route under EP-PROACTIVE-OPS.

## Problem

The surface read one table (`ScheduledJob`) and treated every row in it as a live
recurring job. Measured against the live install, that page showed **110 rows**:

| Population | Rows | What it is |
| --- | ---: | --- |
| Recurring, with a live row | 24 | The jobs actually turning over (7 are coworker tasks). |
| Catalog entries that never ran | 47 | Code-registered crons with no row. Badged `NEVER RUN`, no further explanation. |
| Dated one-shot dispatches | 17 | `mcp-efficiency-aiops-<date>` — one new permanent row per day, cron pinned to a single date. Nothing retires them. |
| GPU eval slot-locks | 18 | `eval-<modelId>`, schedule `manual`. Not scheduled work: `claimEvalSlot` writes a row to obtain an atomic mutex. |
| Quarantine debris | 5 | `__dpf_quarantined__…` rows renamed aside by the index-integrity repair. |

Five defects followed from having no model able to tell these apart.

1. **Wrong table for agent-backed work.** Seven `ScheduledAgentTask` rows are
   mirrored into `ScheduledJob`. The dispatcher reads only the first; the page
   read only the second, and they had drifted. `self-marketing-specialist-…`
   displayed schedule *Disabled* beside next run *"in 11h · Aug 22, 09:07"*.
2. **The kill switch was not load-bearing.** Every mutation wrote to
   `ScheduledJob`. `sysml-projection-nightly` carries `enabled = false` and runs
   nightly regardless.
3. **The editor silently retuned jobs.** Any cadence outside eight named tokens
   fell back to `"hourly"`; saving moved the job to hourly. Reproduced against
   `sysml-projection-nightly` (`0 4 * * *`), whose dialog opened on *Hourly*.
4. **A stopped job read healthy.** Health derived from `lastStatus` alone, with
   no state meaning *overdue* — the same blind spot as the 13-day silent
   code-graph outage that motivated the original page.
5. **No manual run for most of the register.** 97 of 110 rows (88%) rendered no
   run-now control.

## Model

Storage stays substrate-first: crons keep their catalog, agent tasks keep their
table. A read model spans them and adds three derived facts.

- **`kind`** — `recurring` | `one-shot` | `slot-lock`, derived from the schedule
  string, which already carried the answer (`isOneShotCron`; `manual`).
  Lifecycle and permitted operator actions differ per kind.
- **`substrate`** — which engine runs the work, and therefore which record is
  **authoritative**. For agent-backed work the `ScheduledAgentTask` wins; the
  `ScheduledJob` mirror is display debris.
- **`agent`** — the coworker, its `routeContext`, and its last task run.

Health gains two states the three-way pill could not express: **`overdue`**
(active, recurring, past due by more than one cadence — floored at 15 minutes,
capped at a day) and **`spent`** (a one-shot that already fired). Rows also flag
a next-run projection that cannot be reconciled with the cadence.

## Modules

| Module | Role |
| --- | --- |
| `work-model.ts` | Pure derivation: kind, health, cadence prose, view assembly. |
| `register.ts` | Reads both substrates; drops quarantine debris. |
| `cadence.ts` | Pure cadence vocabulary — validation, projection, preset→cron retune. |
| `control.ts` | Substrate-aware mutations; core-locked policy. |
| `schedule-window.ts` | Forward projection over a day / week / month window. |

`cadence.ts` and `work-model.ts` are pure so the editor can validate and preview
in the browser rather than round-tripping to learn its own value was rejected.

## Decisions

- **Retire is non-destructive.** A spent row is disabled and stamped, not
  deleted, because the eval slot-locks are a live GPU mutex keyed on their own
  `lastRunAt`. Retiring clears the register view only.
- **Agent cadences are five-field UTC crons.** The BI-0A82D3B4 extension below
  replaces the former daily-or-slower parser restriction. Frequency presets
  remain daily, weekly and monthly; explicit valid crons may be sub-daily.
- **Frequency presets preserve time of day.** Making the 14:07 campaign brief
  weekly leaves it at 14:07.
- **Run-now is widened, not universal.** Availability goes from 13 rows to 37.
  The remainder are crons that never registered a manual-trigger event — a gap
  in the catalog, surfaced rather than hidden.

## Not in scope

The AI-Ops handoff still writes one permanent one-shot `ScheduledJob` mirror per
day. Retire clears them; **reaping at the source** belongs in the existing
retention sweep and is the follow-up.

Two pre-existing observations left flagged rather than resolved:
`external-catalog-scout-weekly` is named weekly and runs daily at 08:17; and 22
rows have no catalog entry and no agent task, now badged `UNREGISTERED`.

## Six-hour agent-task continuation — BI-0A82D3B4

This is an ordered fix design for the existing bug, not a new scheduling
feature. The implementation and deployed correction remain pending until their
recorded checks pass. Workroom: `WC-5F310E22`; branch:
`codex/scheduled-agent-cron-steps`.

### Reproduction and research

On source `574f7e92dcb12ab9f2679a5b566c55629cce68c4`,
`agent-task-core.ts:313` resumes through `computeNextCronRun`. That helper parses
hour `*/6` with `parseInt`, obtains `NaN`, and returns the supplied time plus
24 hours. The existing monitor `agent-task-56e05d88` was resumed at approximately
2026-10-18T19:44Z with its unchanged cron `23 */6 * * *`; canonical readback
showed `isActive:true`, `nextRunAt:2026-10-19T19:44:22.832Z`, and the prior error
run at 2026-10-18T17:10:00.358Z. Intended next fire was 2026-10-19T00:23Z.

The dispatcher selects authoritative `ScheduledAgentTask` rows only when active
and `nextRunAt <= now`. Therefore the error affects eligibility, not only its
display. Resaving or enabling repeats the same projection; claim and successful
or failed completion re-arm through the same helper. The task is already
enabled, so another enable is not evidence of reliable recurrence.

The existing full UTC evaluator `computeNextCronFire` was delivered by
BI-85E6EF14 for the owned jobs engine; reuse it. The existing
[durable jobs design §5.4](2026-09-25-postgres-durable-job-engine-design.md#54-cron)
and its phase-2 plan explicitly left the agent-task consumer unchanged. This
extension supersedes that compatibility boundary for this consumer gap.

The [Cronie crontab manual](https://github.com/cronie-crond/cronie/blob/master/man/crontab.5)
defines steps within each field, so `*/6` hours selects 0, 6, 12 and 18, and
uses OR when both day-of-month and day-of-week are restricted. DPF retains its
existing UTC-only task contract. Adopt those existing parser semantics; reject
a new cron dependency, duplicate monitor, runtime database patch, or immediate
rerun as a repair. Governed RED and GREEN observations will be recorded against
the exact source; source inspection alone is not a test result.

### Contracts and scope

- **REQ-CRON-UTC:** `computeNextCronRun` keeps its public `Date` return type and
  delegates valid five-field expressions to the existing full UTC evaluator.
  Fixed daily, weekday, weekly and monthly schedules retain their UTC intent;
  wildcard, range, list and step expressions use the same semantics in every
  caller. Tests use explicit UTC instants rather than the host's timezone.
- **CONTRACT-CRON-PROJECTION:** For malformed or impossible expressions the
  internal compatibility API retains its explicit `from + 24h` fallback.
  Operator validation requires a reachable future UTC match through the
  existing evaluator rather than the permissive regex. This rejects invalid
  fields and impossible dates such as February 31 instead of presenting the
  fallback as a valid schedule. Disabled schedules continue to project `null`.
- **CONTRACT-TASK-IDENTITY:** Create/resume/claim/re-arm and schedule Save/Enable
  share the same projection. `ScheduledAgentTask` remains authoritative and
  its `ScheduledJob` mirror agrees on `nextRunAt`. The existing owner-checked
  MCP Resume writes the authoritative `isActive` and leaves the mirror's legacy
  `enabled` flag unchanged; the register derives enablement from the task.
  Save and admin Enable retain their existing flag synchronization. No broader
  mirror-flag repair is claimed here. Owner checks, guarded due claims, retry
  cadence and history remain intact. `isOneShotCron` is unchanged, including
  its existing pinned-month/day classification; this fix does not reclassify
  date lists or redesign one-shot behavior.
- **CONTRACT-SCHEDULE-WINDOW:** Full-parser validity replaces the concrete
  minute/hour projection restriction. The chart uses the full evaluator and
  its `null` outcome rather than inventing invalid fires. It plots six-hour
  occurrences; cadences finer than the chosen bucket remain continuous.
- **FLOW-MONITOR-RECOVERY:** After deployed source identity is verified, restore
  the existing monitor through its ordinary owner-checked Resume route. Retain
  its id, prompt, cron, configuration and history. Verify the actual next cron
  match and later ordinary dispatch/re-arm. No duplicate, new schedule,
  immediate rerun, provider-budget change or direct database correction.

### Ordered implementation and verification

One atomic deliverable implements all contracts above. The plan is internal
sequencing: a parser change without re-arm and register agreement would leave
the reported defect unresolved.

1. **VER-CRON-RED:** Add exact UTC regression assertions for the existing
   monitor's resume, unchanged Save, Enable and repeated guarded claim. Cover
   00:23, 06:23, 12:23, 18:23 UTC and day rollover; assert authoritative/mirror
   agreement, no task recreation, preserved owner refusal and one-shot behavior.
   Add parser validation and six-hour window tests. Run through the existing
   governed host-resource runner and observe the wrong 24-hour projection.
2. **FLOW-CRON-SHARED:** Make `computeNextCronRun` a compatibility wrapper over
   `computeNextCronFire`; remove the obsolete parallel field parser. Align
   cadence validation, projectability and schedule-window projection. Keep
   preset choices and one-shot classification unchanged; reconcile comments
   and obsolete refusal wording. No schema, dependency or runtime changes.
3. **VER-CRON-GREEN:** Run the same regressions, existing cron daily/monthly/
   weekday/union/leap-year/malformed cases, task core and scheduler completion/
   failure/proactivity cases, register/window tests, both graph-linked AI Ops
   handoff tests and ecosystem triage. Verify UTC independently of host timezone.
   Graph advice naming the absent `scheduled-jobs/scheduled-jobs.test.ts` is
   stale; use the real colocated control/core suites rather than claiming it ran.
4. **VER-CRON-GATE:** Run web source/test typechecks, impact-contract style guard,
   docs lint/index checks, and the exact-tree canonical gate. Obtain independent
   change review and a protected DCO-signed PR; observe merge and canonical
   deployment. A failed or unavailable gate remains failed or unrun.
5. **VER-MONITOR-LIVE:** Execute FLOW-MONITOR-RECOVERY and retain bounded canonical
   evidence of the correct next run and ordinary recurring dispatch. Enablement,
   source tests or a future timestamp alone do not prove repeated reliability.

### Backlog coverage

Implementation parent: `BI-0A82D3B4`. Atomic coverage will bind this immutable
design to REQ-CRON-UTC, CONTRACT-CRON-PROJECTION, CONTRACT-TASK-IDENTITY,
CONTRACT-SCHEDULE-WINDOW, FLOW-CRON-SHARED, FLOW-MONITOR-RECOVERY and
VER-CRON-RED/GREEN/GATE/MONITOR-LIVE before implementation. No coverage receipt
or passing execution is claimed by this draft.
