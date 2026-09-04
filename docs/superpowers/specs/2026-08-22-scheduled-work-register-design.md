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
- **Agent cadences are cron-only, daily or slower.** `computeNextCronRun` treats
  minute and hour as concrete fields and cannot express sub-daily cadences;
  offering those presets would have rescheduled coworker work to midnight.
  They are refused with the reason instead.
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
