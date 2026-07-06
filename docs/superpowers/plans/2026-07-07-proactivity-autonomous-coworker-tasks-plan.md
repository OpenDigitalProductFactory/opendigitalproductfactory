# Plan — Proactivity → autonomous coworker self-tasks (BI-3F09BDD4)

Date: 2026-07-07. Epic: EP-B9DD37C7 (coworker trust / autonomy).

## Problem

The per-coworker **Proactivity** setting (quiet | balanced | assertive) reads as a
promise that an Assertive coworker works harder on its own. It did not. The setting
fed only two things: the in-conversation Initiative block (PR #2571) and notification
cadence. With no human message, an Assertive coworker did nothing — so the Marketing
Strategist sat at Assertive + Higher Reasoning while `/customer/marketing` stayed empty.
The operator: *"Is the proactivity setting completely broken? I fail to see how it
helps given what it was meant to help deliver in terms of autonomous activity."*

The autonomous substrate already exists and is healthy — `ScheduledAgentTask` rows are
run every 5 minutes by the `agent/task-dispatch` Inngest cron via
`executeScheduledAgentTask`, which runs the named `agentId` in **act** mode with that
coworker's granted tools. Four system tasks (Data Model Mirror, SysML Reconcile,
External Catalog Scout, Discovery Taxonomy Triage) ride it nightly. Nothing connected
the Proactivity toggle to it.

## Substrate finding (dpf-verify-substrate-first)

- Create/cancel API: `scheduleAgentTaskFor` / `cancelAgentTaskFor` in
  `apps/web/lib/operate/scheduled-jobs/agent-task-core.ts` — userId-parameterized, not
  `"use server"`. De-conflicts ticks (`occupiedTicks` + `deconflictCron`), mirrors a
  `ScheduledJob` for calendar projection, computes `nextRunAt` via `computeNextCronRun`.
- The Marketing Strategist (`marketing-specialist`) **already holds** `marketing_write`
  and the `create_marketing_campaign_brief` tool. **No new tool or grant is needed** —
  only something to trigger the work on a cadence.
- Hook point: `saveCoworkerProactivityPreference` in `apps/web/lib/actions/proactivity.ts`.

## Design

- **`apps/web/lib/operate/scheduled-jobs/coworker-self-tasks.ts`** (new):
  - `COWORKER_SELF_TASKS`: a small curated registry keyed by agentId. A coworker earns
    an autonomous self-task only when there is a concrete, **idempotent, non-destructive**
    unit of work worth running on a cadence. Seed entry: `marketing-specialist` →
    refresh/create a campaign brief on `/customer/marketing`, with a prompt that says to
    finish (no human is watching) and to **not duplicate** an existing recent brief.
  - `coworkerSelfTaskId(agentId, userId)` → deterministic `self-<agentId>-<userId>`, so
    reconcile is idempotent (flipping the setting never piles up duplicate schedules).
  - `reconcileCoworkerSelfTask(userId, agentId, level)`:
    - no registry entry → `none`;
    - `quiet` → deactivate the self-task (`isActive:false`) + disable its ScheduledJob;
    - `balanced` → weekly cron; `assertive` → daily cron. De-conflicted, upserted by the
      deterministic taskId, ScheduledJob mirrored. Cadence is the only difference between
      balanced and assertive — same unit of work, dialed intensity.
- **Hook**: `saveCoworkerProactivityPreference` calls `reconcileCoworkerSelfTask` after
  persisting the fact, wrapped best-effort so a scheduling hiccup can't fail the save.

No schema change: the deterministic taskId gives idempotency without a new column.

## Verification

- Unit tests (`coworker-self-tasks.test.ts`): deterministic id; no-entry no-op; assertive
  = daily (DOW wildcard); balanced = weekly (DOW pinned); quiet = deactivate, no upsert;
  seed entry shape.
- Live: set the Marketing Strategist to Assertive → confirm a `self-marketing-specialist-*`
  ScheduledAgentTask appears (active, daily) → on the next dispatch tick a campaign brief
  populates `/customer/marketing`. Flip to Quiet → task deactivates.

## Deliberately deferred

- Broadening the registry beyond Marketing (CRM follow-up sweeps, etc.) — add entries as
  each coworker gets a proven idempotent unit of work.
- Per-user timezone for the cadence (engine is UTC-only today).
