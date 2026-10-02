---
status: active
---

# Plan — an upgrade waits for work; it never ends "skipped" (BI-F9EE05E5)

**Spec:** [Activity Quiescence Protocol §11a](../specs/2026-05-24-activity-quiescence-protocol-design.md) (amendment 2026-09-30; decision 7).
**Operator direction (2026-09-30):** close the door to new work, wait up to 60 minutes with live progress, then ask. Never "skipped".

Each slice is its own PR, gated, reversible, and verified on the live install before the next begins. File anchors are on origin/main 2026-09-30.

## Slice A — the drain waits instead of skipping or stopping work

**Status (2026-10-01): implemented on `feat/upgrade-drain-waits-for-work`.** Items 1–10 are done. Item 0 (build before the door closes) has a concrete proposal (a promoter build-only mode) and is deferred to its own PR, because it changes the promoter shell contract. The review added: a durable abort (`QuiescenceRun.abortRequestedAt/By`, migration `20260930180000`), admission re-asserted after a portal restart mid-drain, a swap guard that never swaps with admission open, and a swap-complete wait sized to the promoter budget.

The core behavior. After A, "Upgrade now" with a build in flight waits for it and then installs.

0. **Build before the door closes.** Build and verify the candidate image before `startQuiescence`, so admission is closed only for the swap. Live evidence, SUR-3B7203FD (2026-09-30): admission closed at 17:04, the promoter was then killed mid-`next build` (`promoter-timeout`), and the drain held the door about 10 minutes for nothing. Check how `runPromoter` splits build and swap before changing the order.
1. `queue/functions/self-upgrade.ts:203-247` — remove the `activity-in-flight` early skip for manual and scheduled runs; both enter the drain.
2. `self-upgrade.ts:524` — pass `budgetMs` from a new `drainWaitBudgetMs` setting (default 60 minutes).
3. `queue/functions/quiescence-run.ts:106` — flip TaskRuns to `quiescing` only after hard blockers reach zero, or on force. Admission closes at drain start as today.
4. `lib/self-upgrade/quiescence.ts:~1103` — the dead-phase reaper counts `quiescing` TaskRun heartbeats as live, so a drain cannot reap a working build.
5. `quiescence-run.ts:127` — the wait loop re-reads its deadline each tick (`drainStart + budgetMs`), so Keep waiting can extend it. Sleep with `step.waitForEvent` (abort / keep-waiting / force) instead of short sleeps, so a 60-minute wait stays within the job engine's step budget and Abort works mid-drain.
6. `quiescence.ts:146` — add the non-terminal status `awaiting-operator`. At the deadline the coordinator pauses (level stays `draining`) and waits for an operator event.
7. Save the latest blocker snapshot each tick; blocker lines carry build id, phase and elapsed time.
8. `self-upgrade.ts:538` `awaitReady` follows the moving deadline and treats `awaiting-operator` as still waiting. Split `runSelfUpgrade` into pre-drain, wait and swap steps instead of one long step.
9. `instrumentation.ts:~1049,1065` reconcilers and `taskrun-watchdog.ts:~83`: never fail or reap a draining or `awaiting-operator` run that is still heartbeating.
10. `self-upgrade.ts:546-560` — no cooldown or `failRun` on the waiting path; only an explicit operator Abort ends it.
11. Tests: a new coordinator test (waits while a phase runs; flips after clear; pauses at the bound; keep-waiting extends; force swaps; abort mid-drain; no reaping of a live phase); an update to `self-upgrade.test.ts:451-499`; reconciler and watchdog tests.

## Slice B — the door is actually shut

**Status (2026-10-01):** implemented. `admitPhaseTransition` (lib/build/build-phase-run.ts) refuses ideate→plan (both design-review paths), plan→build and review→ship before the phase write, and records the wait on the build's trail. Ideate dispatch defers. `gateBetweenSteps` re-checks after each 30-minute wait (up to 6 h) instead of proceeding mid-drain. Deliberation runs and the manual tee-up suspend instead of dropping. `actions/build.ts` (creating a build) needs no change: the proxy quiescence gate already refuses portal mutations during a drain.

12. Stop swallowing the phase-start refusal in `ideate-on-approval.ts:332`, `plan-to-build-transition.ts:490`, `ship-on-review-approval.ts:359`, `mcp/build-design-review-handler.ts:140,688` and `actions/build.ts:120`. Park the transition at the boundary with a durable reason; `resumeStrandedBuildsOnBoot` resumes it after the swap. The rule: the current phase finishes, the next phase waits.
13. `queue/functions/build-execute.ts:77` — keep waiting while the drain holds; never proceed after a fixed 30 minutes.
14. `queue/functions/deliberation-run.ts:468` — suspend instead of dropping the event.
15. `queue/functions/governed-backlog-tee-up.ts:36-58` — gate the manual/event path.
16. Tests per entry point: refused or parked during the drain, resumed after it.

## Slice C — the operator can act while it waits

**Status (2026-10-01):** implemented. `POST /api/ops/self-upgrade/control` (view_operations; lib/self-upgrade/drain-control.ts) carries keep-waiting / force / abort. It is the only `/api/ops` path allow-listed in lib/proxy/quiescence-gate.ts. The upgrade page shows time waited against the limit and offers Keep waiting at `awaiting-operator`; Force now and Abort now post to the route. MCP safe list (item 19): `heartbeat_workroom` and `heartbeat_runtime_target` are allowed during a drain (liveness only); evidence writes stay refused and are retried after. The `activity-in-flight` skip copy is kept, because historical runs still carry it.

17. Move Force now / Keep waiting / Abort to one authenticated route (`/api/ops/self-upgrade/control`, `requireOpsAccess`). Allow-list only that route in `lib/proxy/quiescence-gate.ts`; every other mutation stays refused. Test both.
18. The upgrade page shows a waiting panel (builds and phases still running, time waited, the limit). On `awaiting-operator` it shows Keep waiting / Force now / Abort. Remove the skip/defer copy for this path; retire `activity-in-flight` in `skip-reason.ts`. A 503 during a drain is not shown as "restarting".
19. Decide which MCP evidence and heartbeat tools join the drain's safe list, so external agents are not locked out for an hour.

## Slice D — documentation

20. The user guide's self-upgrade page: what "Upgrade now" does while work is running.
21. Fix §6.4's stale scheduled-path note (spec line ~581).

## Risks carried

- Admission can stay closed for up to 60 minutes; the portal banner must say why and for how long.
- A ship phase has no natural end during a drain; it reaches `awaiting-operator` by design.
- A hung phase converges only through the 15-minute no-heartbeat reaper; slice A item 4 must land with item 3.
- BI-397736ED: the drain still ignores local-CI leases (out of scope).
- Unverified until slice A is tested live: the job engine's per-run step limit and serve timeout on this install.
