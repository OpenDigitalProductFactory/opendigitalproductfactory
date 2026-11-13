---
status: draft
---

# Complete PR follow-through on the existing Workroom plane

Backlog: BI-ED7CD0DD. Workroom: WC-BA0FB550. Canonical design:
[PR follow-through](../specs/2026-10-01-pr-follow-through-workroom-duty-design.md).
This continues the remaining slices split from BI-88341B5D. It does not replace
the existing decision engine, recovery budget, Workroom, queue or runtime.

## Observed boundary (revised 2026-11-13, `origin/main` 9463c0e1)

- `build-pr-delivery-reconcile` runs every 5 minutes over every non-terminal
  room with a bound PR. The live install sets
  `DPF_BUILD_PR_DELIVERY_RECONCILER_MODE=enforce`.
- Build Studio rooms dispatch a repair through the build's own gauntlet loop and
  publish one fast-forward follow-up commit (#7030). Every other room gets
  `repairAuthority` from its posture and has no `dispatchRepair`, so a defect
  stops at a staged packet for a person.
- `classifyFailingChecks` is conclusions-only: any `FAILURE` is a defect.
- The signed webhook route accepts only `push` and `pull_request`. The install
  has never received a delivery (`GitPromotionCandidate` is empty).
- The three alarm scripts run in GitHub Actions and only comment.

## Delivery sequence

Each deliverable is covered by the filed continuation BI-ED7CD0DD. Each row is
its own PR through the merge queue. The spec and plan revision lands with the
first implementation PR; there is no documentation-only PR.

| Key | Requirement | Design | Verification | Dependency |
| --- | --- | --- | --- | --- |
| intake | AC-1 | §3.3 (`DI-80B30E396AE6`) | duplicate, stale-head, fork, merge-group fixtures; 304 path | none |
| classify | AC-2 (precondition) | §3.4 (`DI-50FF611567E3`) | setup vs product step with the same `failure`; jobs read unavailable; list ratchet | none |
| repair | AC-2 | §3.5 (`DI-0EE9FA83598B`) | live lease refuses; fork refuses; moved head refuses; one dispatch per head; budget carried | classify |
| alarms | AC-3 | §3.8 (`DI-B01D623164CE`) | one attention per detector and head; script output unchanged | none |
| enable | AC-4 | §7 slice 6 | shadow comparison recorded; live red-PR check | intake, repair, alarms |

1. **Intake.** Extend `git-promotion-intake.ts` to accept `check_suite`
   (completed), `workflow_run` (completed) and `merge_group`, on the existing
   signature check, delivery-ID dedupe and emit-pending redelivery. Each emits
   one `build/pr-delivery.ci-event` with repository and head SHA. Refactor
   `runBuildPrDeliveryReconcile` so one room can be reconciled by itself, and
   add an event-triggered function that reconciles only rooms whose repository
   and bound head match. Add a one-minute function for rooms with pending or
   unjudged failing checks: it sends the stored ETag for the head's
   check-suites list and runs the full readiness read only when that list has
   changed. The 5-minute net is unchanged. The compare-and-swap on
   `Workroom.updatedAt` already makes concurrent passes safe, and the per-head
   judgment makes a duplicate a no-op.

2. **Classify.** Add `apps/web/lib/build/ci-setup-steps.ts` (runner-generated
   step names plus the repository's setup step names) and a test that reads
   the workflow and action YAML and fails when a listed name no longer exists.
   In the observation adapter, for each completed `FAILURE` check with a
   workflow job, read that job's steps once per judged head and cache them on
   the follow-through record. Classify it as `infrastructure` when the first
   failed step is a setup step, `defect` when it is a product step, and
   `unclassified` when it cannot be read. The repair packet carries the job ID
   and step name.

3. **Repair for rooms outside Build Studio.** When the decision is `repair`,
   the room has no `featureBuildId`, its executor's lease has lapsed and its
   posture permits dispatch, open a Build Studio repair build bound to the PR's
   branch and current head. Reuse `dispatchBuildPrCiRepair` and the
   `followUpOf` publish path from #7030. Refuse on a live executor lease, a fork
   or foreign repository, a remote head that moved, or a spent budget. A live
   executor hears first through room readback (§3.6) for one drive interval.
   The reservation is written before enqueue, so a redelivery cannot dispatch
   twice for one head.

4. **Alarms.** Move `findStuckPullRequests`, `analyzeChurn` and
   `findMissingDispatch` into a shared module imported by both the scripts and
   the reconciler. The reconciler runs them on the PR data it already reads and
   raises one room attention per detector and head, using `attentionKey` dedupe.
   The script CLIs and their comments are unchanged.

5. **Enable and prove.** List every follow-through path still in observe-only
   or propose mode on the live install (from configuration and code, not the
   source default). Record a shadow comparison over current room PRs, then
   switch each on through its authorized configuration route. Advance the live
   install only through `request_self_upgrade`. Then make one deliberately red
   PR in a room whose executor lease has lapsed, and record wall time, model
   calls, dispatch attempts, CI waits and the merged SHA, with no person or chat
   session acting.

After this, BI-C3EBDCEC (PRs with no room: Dependabot and orphans) reuses the
repair dispatch.

## Verification and stop conditions

Run affected unit tests and the package typecheck locally for each PR. Heavy
gates run in the shared governed runtime. Test identity, dedupe and
classification deterministically; no live inference in tests. Infrastructure
uncertainty is reported as unrun or inconclusive, never as a pass.

Stop a particular effect on foreign ownership, a missing grant, an ambiguous
head or an unchanged provider failure. Keep its durable checkpoint and continue
other authorized work.

## Risk and rollback

The material risks are a duplicate repair, a push over another author's head,
and a dispatcher switched on without proof. Contain them with the existing
ownership and grants, exact-head checks, per-head reservations and the
unchanged protected merge queue. To roll back, set the reconciler mode through
its authorized configuration route, or revert the specific PR. Keep
outstanding room records and attempts; do not delete them.
