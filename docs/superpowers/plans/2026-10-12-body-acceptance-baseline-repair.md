# Body acceptance baseline repair

Objective: restore independent acceptance for deployed medium item BI-CAP-437F7745 without removing its product association or weakening acceptance.

Backlog: BI-CAP-EB18E093; Workroom WC-D2EB96F3, fix/body-acceptance-baseline. Operator explicitly authorized this repair. WWMD DI-DD66202EE424 recommends baseline persistence. Existing BI-0F8E39D5 is done for earlier routing work; its deferred body-baseline scope is activated by this concrete blocked item.

## Acceptance criteria

- Capture immutable body scope and exact line anchors using existing retention and repository reader contracts without fabricated spec approval.
- Preserve approved/inherited baselines and reject stale body scope, conflicting heads and unauthorized supersession.
- Restore the existing independent objective-mapping reviewer route and permission intersection.
- Verify original item closes through restored independent acceptance after protected deployment.

## Traceability

One atomic deliverable: body-baseline capture and acceptance routing. Requirement reference BODY-ACCEPTANCE-1 covers the four criteria above. Contract reference BODY-SCOPE-CONTRACT refers to baseline-repository.ts, receipt-schema.ts and the existing immutable reader contract. Flow reference BODY-REVIEW-FLOW is capture -> fresh runtime evidence -> existing independent objective-mapping -> governed completion. Verification reference BODY-VERIFICATION covers body-baseline-snapshot.test.ts, recorder/admission/recovery regression tests, protected cloud build and live BI-CAP-437F7745 completion. These phases are internal sequencing, not independently shippable deliverables.

Extend the proportional work-shape design's medium body baseline and existing immutable repository reader, baseline retention, and objective-mapping writer. A frozen repository snapshot is an archive of the current item title and body, not a spec and not approval. The server compares its exact bytes with live content before recording scope. Its provenance explicitly identifies body capture; independent acceptance still requires the existing reviewer receipt.

1. Add a deterministic snapshot/manifest builder using the existing acceptance parser. Reject empty criteria, stale content and duplicate statements. Preserve line anchors and statement digests.
2. Extend record_initiative_evidence with body-baseline capture. Require an authorized author call, effective medium shape, immutable provider-resolved bytes, one current chain head, and managed retention. Refuse replacing approved or inherited scope. Reuse identical captures; require explicit dispositions for changed scope.
3. Reject stale body baselines in readiness, dispatch admission and objective-mapping writes. Extend existing recovery guidance to name capture and then the existing independent route.
4. Test stale/duplicate snapshots, approved scope preservation, supersession, retained immutable identity, author/reviewer separation and successful route issuance. Run affected web tests and typecheck, protected cloud build, then live acceptance. No schema migration.

Atomic delivery: capture, stale-scope enforcement and reviewer routing must land together; no independently shippable phase. No UI layout changes. Update the owning backlog runbook and tool guidance. Formal plan coverage will bind this immutable plan; no passing gate is fabricated while unavailable.

Risk: stale acceptance or weakened independent review. Preserve existing approved/inherited baseline history and all authorization and immutable-source guards. Rollback through a revert PR; retain all baseline archives and evidence, never delete or silently translate them.
