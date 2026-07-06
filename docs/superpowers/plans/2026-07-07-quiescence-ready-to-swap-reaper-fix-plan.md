# Plan — Stop the 2-min quiescence reaper from killing ready-to-swap (BI-QUIESCE-READY-REAP)

Date: 2026-07-07. Spec: docs/superpowers/specs/2026-05-24-activity-quiescence-protocol-design.md §5.7.

## Symptom

Local self-upgrades reliably wedge: the run reaches drain, a pre-upgrade backup runs,
then ~2 minutes later `[taskrun-watchdog] quiescence-recovery: reaped stuck coordinator
QR-… (was ready-to-swap)` fires, the deployed SHA never changes, and the `SelfUpgradeRun`
row is left stuck `running`. Blocks every deploy on this instance.

## Root cause

`recoverStuckQuiescenceCoordinators` (apps/web/lib/queue/functions/taskrun-watchdog.ts)
reaps any non-terminal `QuiescenceRun` whose `lastHeartbeatAt` is older than
`STUCK_COORDINATOR_TIMEOUT_MS = 2 min`. That window is correct for the DRAIN phases
(pending/preparing/draining), which heartbeat every 5s wait-tick — a >2min gap there
means the coordinator genuinely crashed while holding the platform draining.

But at **ready-to-swap** the coordinator parks in `step.waitForEvent(swap-complete)` and
**stops heartbeating by design** while the caller (`runSelfUpgrade`) takes the recovery-
point backup and runs the promoter — a `docker build` that routinely exceeds 2 minutes in
local mode. So the reaper kills a perfectly healthy coordinator mid-build, flips the
quiescence level back to normal, and wedges the swap half-done. (17:11 runs that happened
to build in <2 min slipped through; anything slower wedged — the intermittency that hid
this.)

## Fix

Exclude the caller-owned states `ready-to-swap` and `swapping` from the 2-min reaper's
query (`status.notIn`). Those states are already bounded by:
- the coordinator's own 60-min `waitForEvent` timeout (`COORDINATOR_TIMEOUT_MS`), and
- the promoter timeout + `runSelfUpgrade`'s failure path (`failQuiescenceSwap`),

so a genuinely-crashed swap is still recovered — just not by this aggressive short-window
reaper. The drain-phase crash case the reaper exists for is unchanged.

## Verification

- Unit: new regression test asserts `ready-to-swap`/`swapping` are in `notIn` while the
  drain phases (pending/preparing/draining) are not. Full `taskrun-watchdog.test.ts` green
  (12/12).
- Live: trigger a self-upgrade and watch it pass ready-to-swap → promoter build → swap →
  new deployed SHA without a reap. (This deploy also carries the fix, so subsequent local
  upgrades no longer need heartbeat-babysitting.)
