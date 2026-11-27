---
status: draft
---

# Federated Workroom claim recovery repair

Backlog BI-35E8A80F · Workroom WC-3C48506D · design-only admission

Implement the [owned-recovery amendment](../specs/2026-10-28-federated-twin-identity-design.md#owned-recovery-for-a-refused-claim-bi-35e8a80f).
Keep the home-only claim guard. The status of BI-756C899D and BI-C43FD3E5
does not gate development of this separate repair, and this repair does not
claim or release either home Workroom.

## Acceptance criteria

- The exact refused claim produces one durable recovery obligation using existing GPP/Workroom facilities. Bind home, item, holder and observed identity, currently delegated actor or explicit unavailable disposition, next action, trigger and bounded next check. A real active claim remains held; no local takeover by elapsed expiry.
- An inaccessible or unauthorized home route remains an owned wait, not an acknowledged dispatch. An independent eligible lane can advance. Reserve human action for actual human-only decisions or exhausted authorized recovery.
- An attributable home disposition synchronized through existing work-sync wakes the waiting action once, even if the item version did not change. Revalidate current authority and ordinary eligibility before any start. Restart, lost acknowledgment and repeated or stale delivery reconcile the original effect without a second start.
- Isolated synthetic proof counts actual acknowledged effects and terminal evidence, not scheduled jobs, notifications or review reports. Run source regression, test/type verification, independent review and appropriate nonproduction served-path acceptance separately.

## One delivery, three verification steps

1. **Falsify the current wake path.** Pin the claim handler, twin gate, and
   existing work-sync claim-change comparison at the start of the admitted
   implementation. Reproduce the known missing action in
   `apps/web/lib/work-capsules/twin-claim-gate.test.ts`. Extend the handler
   test to require an exact retained recovery identity and to disallow
   claimant creation or peer send when route authority is absent. Add the
   work-sync integration case that observes an attributable disposition at
   unchanged item version. Red must fail on behavior, not missing setup.
2. **Connect the existing owners.** Extend
   `apps/web/lib/work-capsules/claim-backlog-item-handler.ts` and
   `apps/web/lib/work-capsules/twin-claim-gate.ts` to return the refusal
   and owned recovery action together. Resolve the exact permitted current
   coordinator and reuse the current work/task context for durability. Reuse
   the home exchange in `apps/web/lib/federation/work-claim-exchange.ts`
   where currently authorized, and `apps/web/lib/federation/work-sync.ts`
   for the attributable state observation. Confirm the exact existing writer,
   recipient admission, event consumer and transactional identity with the
   architecture reviewer before implementation. Re-enter ordinary eligibility
   rather than replaying the original external command on a now-stale grant.
3. **Verify the whole loop.** In `apps/web/lib/federation/work-sync.test.ts`
   and the current owner surfaces, test an actually counted synthetic effect
   and terminal receipt. Test before-wake and after-effect-before-ack crashes,
   duplicate and stale observations, same-version home disposition, an
   unreachable executor and a genuine human decision. Keep a disjoint eligible
   lane advancing. Run affected tests and typecheck, then independent review
   and governed nonproduction served acceptance. Record the worktree and
   served results separately. Re-resolve change impact for actual source scope.

## Backlog coverage

Proposed decision: atomic under BI-35E8A80F. The refusal projection and
verified-disposition return path implement one observable repair. Neither
ships alone as completed recovery.

- Requirement refs: OBJ-CLAIM-RECOVERY, AC-CLAIM-01, AC-CLAIM-02,
  AC-CLAIM-03, AC-CLAIM-04.
- Contract refs: the home-only claim exchange and the ordinary admission
  check in `apps/web/lib/work-capsules/claim-backlog-item-handler.ts`.
- Flow refs: refusal → owned recovery → attributed home disposition → one
  ordinary admission re-evaluation.
- Verification refs: `apps/web/lib/work-capsules/twin-claim-gate.test.ts`,
  `apps/web/lib/work-capsules/claim-backlog-item-handler.test.ts`, and
  `apps/web/lib/federation/work-sync.test.ts`.

Bind coverage to the exact reviewed immutable source using the server's
ordinary receipt. No receipt, independent verdict or implementation
admission has been recorded by this draft.

## Failure and rollback

Keep a true hold on auth loss or unverifiable peer identity. Do not turn a
transport failure or expired claim projection into home consent. If the
repair must be rolled back, stop new automatic recovery dispatch, preserve
existing obligation and receipt identities, and restore the previous
protected behavior without clearing or transferring any claim.
