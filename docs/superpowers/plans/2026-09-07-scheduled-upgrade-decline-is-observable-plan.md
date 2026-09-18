---
status: active
title: A declined unattended upgrade tick says so — fix plan
backlog_item: BI-3CA18934
design: docs/superpowers/specs/2026-09-07-scheduled-upgrade-decline-is-observable-design.md
---

# A declined unattended upgrade tick says so — fix plan

- **Backlog item:** `BI-3CA18934` (fix profile, atomic)
- **Design:** [`2026-09-07-scheduled-upgrade-decline-is-observable-design.md`](../specs/2026-09-07-scheduled-upgrade-decline-is-observable-design.md)

## Backlog coverage

- Decision: atomic
- Parent: `BI-3CA18934`
- Receipt: `blocked-by: the coverage receipt is minted against this plan blob once it is on the bound Workroom head; recorded on the next push`
- Rationale: the trace and the status are one contract. Recording declines that
  nothing reports leaves the operator exactly as blind; reporting a schedule
  with no decline reason still cannot say why a due tick did not run.
- Dependencies: none

| Key | Requirement refs | Contract refs | Flow refs | Verification refs |
| --- | --- | --- | --- | --- |
| scheduled-decline-observable | OBJ-UPGRADE-VISIBILITY-1 | self_upgrade.lastScheduledDecline, nextScheduledCheckAt, releaseBatchEligible | record the decline when skipAttempt has no runId and the attempt is scheduled; report the schedule and gate in the queue status | AC-1, AC-2, AC-3, AC-4 |

## Fix sequence (all complete)

1. `apps/web/lib/self-upgrade/scheduled-gate.ts`: pure `nextScheduledCheckAt` / `scheduledCheckIsThrottled` / `declineIsCurrent`, plus durable `recordScheduledDecline` / `getScheduledDecline`.
2. `apps/web/lib/queue/functions/self-upgrade.ts`: a scheduled `skipAttempt` with no runId records its reason.
3. `apps/web/lib/mcp/packs/self-upgrade-pack.ts`: report the schedule and gate; `routineUpgradeEligible` requires an unthrottled unattended path; `releaseBatchEligible` preserves the previous meaning.
4. Tests: AC-1 and AC-4 in `scheduled-gate.test.ts`, AC-2 and AC-3 in `self-upgrade-pack.consumer.test.ts`.

## Verification

Red-then-green: the new assertions fail against `origin/main` source and pass with the fix. OBJ-UPGRADE-VISIBILITY-1 is covered by AC-1, AC-2, AC-3, AC-4.
