---
status: active
backlogItem: BI-25CB699C
workroom: WC-796A89FA
---

# Avoid repeated consent for owned DEV lease cleanup

## Observed defect and design grounding

On canonical Recovery 10 (d1c9f591eaaefcdb0dc19ae9d207583172015ea9), original-owner cleanup of expired NPEL-023726C752 created approval cmv66dkpn05x401o7ig8m7f6v. Completing the distinct admitted PostgreSQL test lease NPEL-727A39DE6F then created cmv66mg4n0ca301o7l2l2qf9v. Both required human intervention. Historical requests, outcomes and test failures remain intact.

Existing specs/plans reviewed: `docs/superpowers/specs/2026-08-31-lease-retry-storm-control.md`, `docs/superpowers/plans/2026-10-12-terminal-lease-wait.md`, and the source contracts for per-call consequence narrowing. Current code substrate reviewed: `apps/web/lib/mcp/packs/nonprod-lease-pack.ts`, `apps/web/lib/tool-consequence.ts`, `apps/web/lib/nonprod/environment-lease.ts`, `apps/web/lib/nonprod/durable-wait.ts`, `apps/web/lib/work-capsules/scope-claim-consequence.ts` and canonical instance stance.

The release tool currently declares authority for every call. Reuse its supported `consequenceForCall` refiner, canonical instance stance, original durable-wait provenance and existing release handler. No new tool, grant, table, identity, approval channel or lease transition is needed. Missing evidence retains the declared consequence. Effective permission checks and explicit human-only policy continue to apply.

## Acceptance criteria from the live item

- AC-1: After a PASS at commit A, a signed merge of origin/main with no change to the branch's own diff can be pushed after the refresh tier passes, without waiting for a full local-CI slot.
- AC-2: A merge that changes the branch's own diff, such as hand-resolved conflicts in the branch's files, runs the affected tests. A merge that alters branch-authored logic still requires the full gate.
- AC-3: The merge queue remains the authoritative main+PR build. Nothing merges without it.
- AC-4: A re-claimed waiting gate keeps its queue position.

The October 12 founder clarification supersedes AC-2's unconditional broad local replay. This bounded continuation repairs consent at AC-4's cleanup boundary; it does not close the parent or claim the other criteria are newly verified.

## Atomic implementation and verification

CT-OWNED-DEV-LEASE / FLOW-LEASE-CLEANUP / VC-CLEANUP-CONSENT:

1. Add a failing release-definition regression demonstrating that a server-proven owned DEV cleanup stays ordinary. Resolve the pack's graph-linked test and expand to the existing dispatch, consequence, release and durable-wait suites. New helper tests cover the full refusal matrix.
2. Narrow only on an installation proven development/evolve-dpf, exact original session, supported local-CI lease, and independently stored original-user/durable-wait binding. Retain authority for malformed or missing identity, foreign ownership, unknown states, unsupported environments, live host-process reservations, non-DEV stance and unavailable classification.
3. Keep lease release, immutable owner checks, locking, execution containment, FIFO reconciliation, terminal projection and audit unchanged. Regression tests verify this refactor does not mint admission, command success or completion credit.
4. Run affected tests and both web TypeScript programs once, plus the returned style/module/source guards and generated-artifact checks. Freeze a signed commit and obtain independently attributed review. Publish through protected GitHub CI/merge queue; full local integration is delegated/UNRUN under the existing bounded operator authorization.
5. Build and qualify canonical images, deploy via one ordinary self-upgrade, and verify one authentic owned cleanup on the served version. Do not repeat old approval envelopes, fabricate owner provenance or label an expired wait as executed tests.

These steps are internal sequencing of one independently revertible classifier correction. The existing BI is the sole deliverable; no phase ships independently. Coverage references: AC-4, CT-OWNED-DEV-LEASE, FLOW-LEASE-CLEANUP, VC-CLEANUP-CONSENT.

## Risks and rollback

The risk is narrowing on caller-asserted rather than server-recorded ownership. Require both original authenticated user and complete durable binding; ambiguous/legacy records retain authority. Refiner read failures fail closed through the existing resolver. The handler's grants, immutable owner checks and process fencing remain mandatory. Rollback reverts the classifier and pack hook, restoring prior consent without deleting evidence.

## Documentation impact

There is no UI control or public API shape change. Update `docs/operations/local-ci-sandbox-slots.md` with owned cleanup eligibility, retained approval boundaries and truthful terminal behavior. Live acceptance and native semantic review remain UNRUN until independently recorded.

## Backlog coverage

Initial native planning receipt: cmv67i1ua1a4001o78yav9uoh, atomic, covering immutable plan commit de5743aef92bdeac08b9a122f4fc08594bd72067/blob 6d01322b2e670e45c80df1d540df47116512d79d. Parent BI-25CB699C, Workroom WC-796A89FA; atomic deliverable mapped to the existing BI, with no dependencies. Final source publication will reconcile current coverage in the Workroom without treating this initial receipt as a code-review or runtime verdict.
