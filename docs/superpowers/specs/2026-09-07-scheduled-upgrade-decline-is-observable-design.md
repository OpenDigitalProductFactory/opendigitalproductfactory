---
status: active
title: A declined unattended upgrade tick says so, and the queue status stops contradicting the throttle
backlog_item: BI-3CA18934
---

# A declined unattended upgrade tick says so

- **Date:** 2026-09-07
- **Scope:** platform — self-upgrade scheduled path, self-upgrade MCP status
- **Backlog item:** `BI-3CA18934`
- **Profile:** fix
- **Status:** Design — implemented in this branch.

**OBJ-UPGRADE-VISIBILITY-1:** An operator or agent reading the self-upgrade status can tell whether the unattended path will run, why it declined if it did, and when the next unattended check is due, without inferring any of it from the absence of a run.

## 1. Defect, on a named ref

Measured on this operator install on 2026-09-07. Release `v2026.09.07-small-shape-completion.1` at `9afc62c` published and verified at 06:28. At 07:04 the install still ran revision `0713430`, which predates it, and `SelfUpgradeRun` held no row for the 06:00 or 07:00 tick.

The scheduler was behaving correctly. `self_upgrade.lastCheckedAt` was `2026-09-07T05:39:09.895Z` and the install stores no `checkIntervalHours`, so the default of 24 applied (`apps/web/lib/self-upgrade/config.ts:136`): every tick until 05:39 the next day returns `interval-not-elapsed`. Two things made that unreadable, and I drew the wrong conclusion from them before reading the source.

- **A scheduled decline leaves no trace.** `skipAttempt` persists only through `skipRun(params.runId, …)`, and the cron calls `runSelfUpgrade({ triggeredBy: "scheduled", scheduled: true })` with no `runId` (`apps/web/lib/queue/functions/self-upgrade.ts`). So `interval-not-elapsed`, `outside-window`, `cooldown`, `blackout-period`, `promoter-unavailable` and `no-window-needs-timezone` all vanish. The only evidence is an absent run, which is indistinguishable from a dead scheduler.
- **The status contradicts the throttle.** `get_self_upgrade_queue_status` computed `routineUpgradeEligible: support.enabled && batch.eligible` (`apps/web/lib/mcp/packs/self-upgrade-pack.ts:221`) from release-batch eligibility alone, never consulting the interval, window, cooldown or blackout. It reported eligible at 07:04 while the next unattended check was 22 hours away.

Consequence: two merged fixes (BI-A57B6185, BI-05F8860A) could not close, because the completion resolver on the install predates them, and nothing in the product said why or when that would change.

Ruled out by reading the live config rather than assuming: a broken cron (it fires; the throttle declines it), a stale quiescence coordinator (the reconcile line names a run from the previous day and does not gate run creation), and the release batch (it reports eligible throughout).

## 2. Fix sequence

1. New `apps/web/lib/self-upgrade/scheduled-gate.ts`: `nextScheduledCheckAt` and `scheduledCheckIsThrottled` (pure, and asserted to agree with `isCheckIntervalElapsed` so the reported schedule and the applied gate cannot drift), `declineIsCurrent`, and a durable `recordScheduledDecline` / `getScheduledDecline` pair on `self_upgrade.lastScheduledDecline`.
2. `self-upgrade.ts`: when `skipAttempt` has no `runId` and the attempt is `scheduled`, record the decline. Recording never throws into the upgrade path.
3. `self-upgrade-pack.ts`: report `lastCheckedAt`, `checkIntervalHours`, `nextScheduledCheckAt` and `scheduledGate`; expose the raw `releaseBatchEligible`; and make `routineUpgradeEligible` require that the unattended path is not throttled.

Policy is untouched: the interval, window, cooldown and blackout remain the operator's settings.

## 3. Acceptance criteria

| Criterion | Objective | Statement |
| --- | --- | --- |
| AC-1 | OBJ-UPGRADE-VISIBILITY-1 | A scheduled tick that declines records its reason and time where a later read retrieves it |
| AC-2 | OBJ-UPGRADE-VISIBILITY-1 | The queue status reports lastCheckedAt, checkIntervalHours, nextScheduledCheckAt and the active scheduled gate |
| AC-3 | OBJ-UPGRADE-VISIBILITY-1 | routineUpgradeEligible is false while the unattended path is throttled, and releaseBatchEligible still reports batch eligibility separately |
| AC-4 | OBJ-UPGRADE-VISIBILITY-1 | A decline recorded before the last successful check is dropped rather than reported as current, and the reported schedule always agrees with the gate the cron applies |

## 4. Non-goals

- Changing the default 24-hour interval or the window policy: operator settings, not defects.
- The 2026-09-06 observation of a swap to an older revision with no run row. It is unreproduced and needs its own evidence.
