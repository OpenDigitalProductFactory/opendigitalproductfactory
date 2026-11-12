# Review-stage missing-shape recovery

Status: Draft ordered fix. No implementation or runtime acceptance is claimed.
Backlog: BI-1173F1CC. Workroom: WC-DAC78CEF.

**OBJ-RECOVERY:** Restore absent delivery-shape metadata for an existing native build-owned Workroom before review-stage recovery, without expanding authority or bypassing readiness.

## Design grounding

Extend the missing-shape recovery established by BI-C60EB507 and BI-454451F1. Keep the bounded repair loop from BI-FBA2FDBE and actual plan/sensitivity requirements from BI-6F2872FC. The [work-shape taxonomy and proportional-gates design](2026-09-02-work-shape-taxonomy-and-proportional-gates-design.md) remains authoritative: derive through resolveDeliveryShape and assessDeliverySensitivity, retain valid pinned definitions, and refuse ambiguity.

At main 6d1ce4762307ded266a732076edbe1a99f9518a7, resume-pre-build-phase.ts returns from review before its existing healer; gauntlet-repair.ts calls readiness without reconciliation. Public activity cmwcxk9ub573a0emf8mmexnpk records PLAN_REQUIRED for FB-E91802DE, whose native room projection has no shape. This establishes an uncovered recovery path, not a claim that shape repair alone resolves that build's real requirements or guard failures.

The existing full healer creates rooms and admits coworkers. It is unsuitable for this narrower path. Its earlier-phase behavior remains intact. Add a narrowly named existing-room reconciliation function in the same module; reuse the canonical registry, sensitivity assessor, delivery-claim builder, prepareCurrentArtifactObservation source-binding guard and scopeWriteWhere compare-and-set primitive. Bind under the existing subject/source lock convention, including the build identity, then recheck the complete observed binding. Do not invoke attachment, admission, rebind or explicit override APIs.

## Acceptance

| ID | Objective | Statement |
| --- | --- | --- |
| AC-OWN | OBJ-RECOVERY | An existing unshaped native room receives only the shape derived from its own build's governing backlog item. |
| AC-GATE | OBJ-RECOVERY | Normal sensitivity, approved-plan and implementation readiness remain authoritative; a genuine denial produces no phase transition or dispatch. |
| AC-HOLD | OBJ-RECOVERY | Missing or foreign rooms, absent originators, malformed or conflicting declarations, ambiguous derivation and concurrent identity/source changes remain held. |
| AC-AUTH | OBJ-RECOVERY | No room, participant, coworker membership, role, grant, provider or budget is added; private content access remains unchanged. |
| AC-BOUND | OBJ-RECOVERY | Existing valid pinned shapes are no-ops; recovery counters, consumed assessments, findings and escalation bounds are retained. |

## Ordered fix

One atomic deliverable: existing-room reconciliation and its two review-stage callers must ship together. Neither caller alone covers the recovery entry points; no independent child work is created.

1. Write failing behavior tests before production edits. Related-test discovery on all three production paths returned the healer test, both resume test files, and the existing gauntlet pure tests. Add a focused route integration test rather than changing the pure decision suite. Exercise missing shape, exact native ownership, valid existing shape, malformed/duplicate declarations, true PLAN_REQUIRED, no admission calls, source/actor and claims races, and exhausted attempts.
2. Implement existing-room shape-only reconciliation. Resolve the exact FeatureBuild, its originating item and a unique native room with matching executor, build FK and backlog carrier. Use the existing source item classification and shared sensitivity rules, never another room's declaration. Validate the raw carrier before treating an absent parsed shape as missing. Append only the canonical delivery claim, preserving every other record and ownership epoch. Bind with a transaction and snapshot compare-and-set; changed build, source, actor, scope or room identity refuses rather than overwrites. No room creation or membership APIs are called. A valid pinned registry definition is retained; malformed, unknown, duplicate or contradictory declarations are held.
3. Call reconciliation in periodic review recovery and before guard-repair readiness. On a held reconciliation, return an accurate bounded refusal. On a valid or newly bound shape, continue the unchanged normal gate/queue path. Do not reset attempt counts or replay completed assessment work. In tests, restored metadata followed by actual plan/access sensitivity still yields PLAN_REQUIRED and zero dispatch.
4. Run affected tests and both web type programs, style-drift and all impact-contract guards. Then canonical local integration gate, one exact native independent review, signed PR, protected checks/merge and governed deployment. Infrastructure failures remain inconclusive; no skipped gate is passed.
5. Verify through the served portal using authorized fixtures: stale review recovery, repair hand-back when eligible, accurate retained plan denial, saved recovery evidence and reload. Do not mutate the private publisher room or manufacture production outcomes. Its owner retains source repair, scope reconciliation and Finance acceptance.

## Verification

V-RED: Failing-before tests run on the named baseline.
V-GREEN: Current affected behavior tests and both web typechecks pass, including no-access-change and real-denial cases.
V-DELIVERY: Canonical gate, current exact independent receipt and protected delivery are recorded.
V-SERVED: Authorized served/fixture recovery and retained refusals are observed and saved. Until then this check is unrun.

## Impact and rollback

No schema, endpoint, UI, seed, install, provider or grant change. Existing scopeClaims is the sole persistent carrier; use its shared canonical claim and CAS contracts. The build-gate runbook is not affected because runtime leases, gate authority and receipt requirements do not change. This ordered fix documents the recovery ordering. The generated documentation index requires its own normal shared-file admission; do not overwrite its other owner's claim.

Risk: stale classification could lower actual obligations or concurrent recovery could overwrite a declaration. Exact identity/snapshot checks, shared sensitivity and unchanged readiness contain these failures. A failed or ambiguous reconciliation holds work rather than guessing. Rollback is a normal revert PR; retain recorded metadata and evidence, never erase approval history or repair counters.

## Backlog coverage

Pending immutable publication and normal live atomic coverage receipt. No coverage, implementation admission, passing tests or delivery is implied by this draft.
