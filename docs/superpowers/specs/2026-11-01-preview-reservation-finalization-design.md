---
status: draft
date: 2026-11-01
backlog: BI-B4EEE635
---

# Contributor preview reservation finalization

BI-B4EEE635 / WC-FA6282D9. Small repair of the existing preview caller.
Research ref: 5a0bf6794ed4d1fea2fa128ee199f53fc9604a67.

## Evidence and existing contracts

Fresh governed preview NPEL-C108069FBE served feature 49a8927cf81c7e11b3eb8b63236c9a8b5d092f5d through protected host controller 80fe61890cf028baef5a80770c17c8dc18be342a. The complete container map was loopback-only; native preview sign-in and the intended browser page succeeded. That port repair is BI-4E94B021, already delivered.

The owner's single generic release produced waiting envelope cmvxg2vyd0bpb01qrn2ua2ui8. Exact persisted readback showed local-integration-ci/slot-0, null slotManifestVersion, a linked deterministic wait Task, and a non-null Docker cleanup command. Current source explains this shape: dev-portal-lease.sh defaults to local-integration-ci and supplies the cleanup command; dev-preview-runtime.mjs requests generic release in supervised and prerequisite-failure finalization.

The server deliberately requires immutable manifest-1 local-CI provenance or process-free active-candidate ownership. This full preview satisfies neither. A linked Task or matching session string does not change that authority boundary.

Reuse [owned host cleanup](2026-10-26-owned-host-cleanup-design.md), its exact readback helper, and the existing supervisor observation callback. [Owned process-free preview cleanup](2026-10-30-owned-preview-cleanup-design.md) explicitly excludes this shape and remains unchanged. BI-521A92CF, BI-31AC1F90, BI-10AC904B, BI-6B109903 and BI-E95458DE remain delivered. Live lexical searches and a bounded read-only database overlap query found no exact active corrective carrier; semantic search was paused and was not resumed.

## Outcome and boundary

**OBJ-PF-1:** A completed or fenced preview stops renewal and reports its reservation without requesting unsupported immediate release.
**OBJ-PF-2:** Writer cleanup, command outcome, reservation settlement and UX acceptance remain distinct.
**OBJ-PF-3:** Shared readback validation stays consistent across host and preview callers without changing cleanup authority.

| Acceptance | Objectives | Statement |
| --- | --- | --- |
| AC-PF-1 | OBJ-PF-1 | Supervised normal and fenced preview finalization and unsupervised prerequisite failure make no generic release call. |
| AC-PF-2 | OBJ-PF-1, OBJ-PF-2 | Existing writer termination, declaration reclamation, source/container checks and protected-service checks remain intact; errors and authority loss keep their existing verdicts. |
| AC-PF-3 | OBJ-PF-2, OBJ-PF-3 | A retained admitted binding permits one exact read with exact lease, claim, environment, provider/session, worktree and branch matching; preview target URL and ports also match. |
| AC-PF-4 | OBJ-PF-2 | Active/queued readback is pending, a consistent terminal row is settled, and absent, malformed, mismatched or unavailable proof is unknown. None proves process cleanup or UX success. |
| AC-PF-5 | OBJ-PF-3 | The host observer retains its current contract and tests; process-free and immutable-CI release predicates and their negative/race tests are untouched. |
| AC-PF-6 | All | First-failing source regressions become green, canonical integration and protected publication pass, and a fresh ordinarily admitted preview finalization creates no unsupported release envelope. |

No server classifier, grant, credential, public MCP argument, table, tool, scheduler, TTL or reaper changes. Do not backfill provenance, erase cleanup commands, relabel an environment or manifest, execute the current waiting envelope, or force the current preview cleanup. Existing operation owners retain that decision and native fence.

## Implementation and refactoring

One atomic deliverable PF maps only to BI-B4EEE635. The following steps are sequencing, not independently shippable work.

1. Add failing behavior tests for preview finalization without a release call and exact preview readback. Include prerequisite failure before admission, retained admission, fenced completion, mismatched targets and unavailable readback.
2. Refactor host-reservation-observation.mjs into shared private exact-binding/readback validation with existing observeHostReservation behavior preserved and a narrowly named preview wrapper. The preview wrapper accepts the controller's local-integration-ci target only; unsupported shapes report unknown, never select a release path. Keep processCleanupVerified false.
3. Retain the validated admitted lease in the existing preview cleanup state. Pass an observation callback to superviseLeaseRun instead of release. Replace the unsupervised generic-release finally branch with bounded observation; without retained valid admission, report binding-unproven and perform no mutation. Resolve credentials only when a read is actually needed.
4. Report reservation-observed and observation-unavailable events without private provider errors. Preserve existing lifecycle finally blocks, writer/declaration cleanup, renewal shutdown and exception propagation. Reuse the supervisor's tested finalization fence rather than adding timers or polling.
5. Update existing contributor-preview operating guidance to explain pending versus settled reservation state and controlled immediate release. Run affected Node tests, host-observer/supervisor controls, unchanged server authority negatives, applicable typechecks/guards and the exact-tree shared integration gate. Independently assess the frozen change and publish a DCO PR through protected CI and merge queue.
6. After normal host controller adoption, the existing preview owner verifies a fresh admitted attempt and finalization. Record actual writer cleanup separately from the exact reservation result; preserve current historical envelopes and original review uncertainty.

At least one fifth of implementation is shared validation/finalization refactoring and regression controls. Do not duplicate the host observer or broaden its accepted binding. No database migration or UI change is required. Documentation is part of the same delivery.

## Failure analysis and rollback

An unavailable reader or incomplete admission cannot become a cleanup pass. A changed target, owner or lease must return unknown. Terminal readback must have null activeKey; terminality never proves writer exit. A failed writer cleanup still rejects before successful completion. Existing supervisor late-renewal tests must remain green; observation cannot rearm renewal or consume a release callback.

The CLI may remain pending until the normal reaper persists expiry. An elapsed TTL or missing active-list row is not settlement. Do not promise a later observation unless an actual bounded owner continuation is arranged. This repair does not accelerate expiry.

Revert the preview caller and shared observer refactor together if necessary. A revert restores controlled release, not a new permission. Existing source artifacts and historical waiting/unknown outcomes stay retained.

## Capture status

This is the proportional design and ordered implementation plan, not an implementation or acceptance claim. Record immutable plan coverage and author reproduction research before implementation admission. Current funding scope is unresolved; no funding allocation or provider policy is changed here.
