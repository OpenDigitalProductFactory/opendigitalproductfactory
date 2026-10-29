---
status: active
---
# Reject impossible evidence requests before approval

Backlog: BI-035BE8D1. Workroom: WC-C2A687B9. Delivery: medium repair.

## Problem and current evidence

The operator asked this chat to complete the existing approval repair. The live mirrored backlog records 45 approved calls that failed artifact provenance and two later calls whose authenticated writer context was absent. On source `64a1056f865e5f543e4608fb8601b81263e0e913`, `mcp-governed-execute.ts` runs the existing preflight before authority escalation, but `mcp-governed-execute-preflight.ts` checks only recovered review authority, room access and invitations. The evidence handler resolves its accepted TaskRun binding and calls the canonical artifact resolver only after authority escalation. Human consent cannot supply missing author provenance or missing execution context.

The recent BI-68EED40A report authorized but not run is retained as a separate observation; it does not establish this defect's cause. The existing refusal breaker and UI presentation retain their other owners. Exact Workroom WC-F4F9BC21 read was refused and is not bypassed.

## Choice and existing substrate

CT-ADM is the existing governed preflight followed by unchanged receipt authorization. FLOW-ADM is trusted binding selection, read-only prerequisite resolution, then the original authority gate and final writer.

Extend the existing preflight with a read-only evidence admission check. Share trusted binding selection with the existing evidence handler; resolve item, reviewer and immutable artifact using their existing canonical readers. Do not duplicate provenance rules in an approval-specific validator, execute a writer as a probe, synthesize authority, or treat preflight as permission. The final writer continues to revalidate mutable facts after approval.

A new approval system or blanket approval of reports would not address impossible requests. This repair keeps existing envelope and authority contracts. The scope is ordinary non-independent research/classification/dependency evidence and the necessary read-only eligibility of exact semantic-review exception requests. Objective-mapping proposals and independent review lanes retain their own issued-packet writers; their specialized contracts must not be accidentally narrowed by this change.

## Exact-action validity amendment

The same parent records an exact `record_semantic_review_exemption` request whose action `expiresAt` elapsed while its approval envelope remained offered for seven days. At source `f4ef6a41c6ba9e0d2eda16e5423a9ab0977564e9`, `change-review/semantic-review-policy-exemption.ts::validIdentity` checks the current identity and a positive expiry of at most 24 hours only after `humanApprovalForExecution`. Preflight cannot create a human waiver, repair expired arguments, widen DEV authority or certify independent review. It can reject an impossible exact request without consulting private Workroom evidence.

Share the existing parameter-only identity/expiry validation between admission and the final writer. Reject expired, malformed or overlong requests before the escalation boundary with a fixed remedy to submit a fresh exact request. A currently valid request retains its governing human approval and DEV-only writer checks. Approval completion skips early admission so the original writer can settle an action that became stale after approval. Existing offered historical envelopes remain immutable; no request is approved, refreshed or replayed by this repair.

## Necessary exception eligibility amendment

PR #6742 merged at `6858dc2e7b5ac03144b87dc1adc9ca8e6967cc5a` with the artifact and exception-parameter checks above. It does not complete the parent acceptance. A subsequent executed diagnostic, activity `cmvsv27kz12xz01k0leccmkfr`, used the existing exception test harness on its published source: otherwise valid parameters passed early admission on a mocked production/operate-organization installation, while the final writer refused that installation after consulting the mocked human approval. The intended early-refusal assertion failed; the final refusal and absence of a write were verified. No live approval or exception was created.

Complete the same admission boundary by sharing the final writer's necessary read-only preparation. Check authenticated operator context and acting-agent identity, canonical installation class and operating intent, current Workroom/source identity, current executed verification and client-assessment bindings, and the absence of an existing failed review. Reuse `isEngineeringDevelopment`, `resolveBindings`, `findCurrentSemanticFailure` and the original canonical readers rather than adding parallel policy. The preflight must not call the human approval verifier, create evidence, reserve an envelope, or lock a room.

Existing exact-room OAuth admission runs before this helper (`mcp-governed-execute.ts::oauthRoomRefusal` and `defaultGovernedToolPreflight`). Retain that ordering and test that a room refusal prevents eligibility reads. Carry the actual authenticated execution context; do not invent an operator identity, token scope, room membership or grant to make admission pass. Return fixed public remedies for known failures and a safe inconclusive refusal when necessary reads fail; neither path may expose private room, branch, contact or evidence details.

The final writer still requires its existing exact human approval and reruns the shared preparation against current state. Keep the transactional room fence and final identity comparison through insertion. An admission result is not a reusable permit: installation intent, source, evidence, reviewer authority, expiry and failed-review state can change while a person decides. Approval completion continues to skip early admission so its original writer can record terminal refusal rather than strand an approved envelope.

## Objectives and acceptance

The existing parent acceptance remains the following, including its wider precondition coverage:

- No approval card is minted for a call whose declared preconditions fail.
- `record_initiative_evidence`'s artifact-author check runs in preflight.

**OBJ-ADM-1:** An evidence request that lacks deterministic author or immutable artifact prerequisites is refused before an approval envelope can be created.
**OBJ-ADM-2:** Valid evidence retains its exact current authorization and final writer checks.
**OBJ-ADM-3:** The admission check uses the same trusted binding as execution and creates no receipts, approvals or grants.
**OBJ-ADM-4:** An exact exception request that is already invalid cannot consume human approval.

| Acceptance ID | Objective IDs | Statement |
| --- | --- | --- |
| AC-ADM-1 | OBJ-ADM-1 | Missing artifact author or immutable artifact returns the canonical refusal before the authority escalation boundary. |
| AC-ADM-2 | OBJ-ADM-2 | Valid current evidence proceeds to the original gate; provenance changes before execution remain refused by the original writer. |
| AC-ADM-3 | OBJ-ADM-3 | Caller-supplied item, artifact or workroom fields cannot replace an accepted TaskRun binding. |
| AC-ADM-4 | OBJ-ADM-2, OBJ-ADM-3 | Objective mapping and platform independent-review flows preserve their existing behavior. |
| AC-ADM-6 | OBJ-ADM-2, OBJ-ADM-4 | Expired, malformed and overlong exact exception requests are rejected before approval; a valid request retains human authorization and final expiry revalidation. |
| AC-ADM-7 | OBJ-ADM-3, OBJ-ADM-4 | An exact exception with missing authenticated operator/agent context, an ineligible installation, stale source, invalid current evidence bindings or a failed current review is refused before an authority row or approval envelope is created. |
| AC-ADM-8 | OBJ-ADM-2, OBJ-ADM-4 | A fully eligible exact exception still requires human approval; a necessary fact that changes afterward is rechecked by the final writer and cannot produce an exception. |
| AC-ADM-9 | OBJ-ADM-3, OBJ-ADM-4 | Exact-room refusal precedes private eligibility reads; failed reads return fixed safe copy, create no authority, and remain inconclusive rather than passed. |
| AC-ADM-5 | OBJ-ADM-1, OBJ-ADM-2 | On the served revision, a safely bounded impossible evidence request produces no pending approval, while authorized routine evidence can still record its result. |

## Ordered work and verification

1. Claim source paths and resolve test impact before Red. Add a first-failing regression at the current preflight boundary.
2. Extract shared trusted input binding, add read-only prerequisite checks through existing canonical readers, and leave final receipt authorization intact.
3. Add a first-failing expired-exception preflight regression. Reuse the existing exception identity validator without moving or removing final human authorization, DEV scope, evidence or expiry checks. Cover valid, malformed, boundary expiry, future-overlong and approved-then-expired cases.
4. Before the eligibility extension, publish this amended ordered design and record its immutable coverage. Retain the production-installation reproduction as a tracked first-failing test. Resolve graph-linked tests, then extract shared read-only exception preparation without moving or removing exact human authorization or the final transaction fence.
5. Cover current eligible DEV/evolve-dpf requests, missing/mismatched authenticated context, production/organization intent, changed room/head, invalid or expired executed evidence, client-assessment mismatch, a current failed native review, exact-room refusal, safe unknown/read failures, and facts changing between admission and final writing. Prove impossible requests create no authority row or envelope and eligible requests retain one exact human approval. Preserve the prior parameter, privacy, independent-lane and settlement controls.
6. Run preflight, normal/accepted-review/steward/platform-review, exception writer and artifact provenance tests, both web typechecks, applicable guards and the canonical shared integration gate. The graph also links the existing bounded-handoff database test; record its canonical execution or an explicit infrastructure limit.
7. Obtain independent source assessment, publish through a DCO-signed protected PR, advance through the canonical upgrade procedure, and exercise AC-ADM-5 plus the bounded exception eligibility controls against the served revision. Record source, deployment and behavior evidence separately.

## Boundaries and rollback

No migration, grant, credential, private-room admission, standing autonomy setting, approval replay, historic-request rewrite or final receipt validation is changed. A provider read failure is inconclusive, never approval of an unknown artifact. Preflight may repeat reads; no admission result authorizes a subsequent write. Rollback is a normal protected source revert.

Canonical artifact errors can include restricted room heads or sign-off identities because their existing writers run after authorization. Early admission preserves their typed refusal code but returns fixed remedies without raw resolver text. A first-failing regression on `d173cd3e3632d38eed5a3adbedba8b2081342fa4` reproduced the disclosure with sentinel room, branch, head and email values; tests cover all three canonical artifact refusal codes. No denied-room live probe is needed or authorized.

PR #6742 delivered the documented artifact/context and exact exception-parameter preconditions. This continuation adds the existing exception writer's necessary read-only eligibility and binding checks. Other operation-specific prerequisites and the overall operator objective still require their own evidence; passing these checks does not prove every tool has declared every prerequisite. Existing final handlers remain authoritative.

## Backlog coverage

Atomic coverage receipt `cmvsrpgi60dqh01myay2528pn` binds this ordered repair to BI-035BE8D1. Research receipt `initiative-0b282cba-866a-484a-9c22-ef98be73fdef` records the named-source reproduction and first-failing test. The author is responsible for source delivery and canonical live verification; neither receipt declares deployment or acceptance passed.

The exact-action validity amendment retains the existing parent acceptance and CT-ADM/FLOW-ADM. Its updated immutable coverage is recorded before that runtime extension; source restructuring preserves the prior assessed implementation under a local checkpoint and does not publish runtime bytes without their gate.

The necessary-eligibility amendment retains the same parent and CT-ADM/FLOW-ADM, adding AC-ADM-7 through AC-ADM-9 to its atomic coverage before implementation. Prior source and merge evidence remains attached to its actual revisions; neither a later plan nor a metadata merge relabels an old check as evidence for new runtime bytes.
