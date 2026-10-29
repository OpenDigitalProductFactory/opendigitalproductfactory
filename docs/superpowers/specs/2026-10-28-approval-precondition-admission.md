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

A new approval system or blanket approval of reports would not address impossible requests. This repair keeps existing envelope and authority contracts. Ordinary non-independent research/classification/dependency evidence and the parameter-only validity of exact semantic-review exception requests form this bounded admission repair. Objective-mapping proposals and independent review lanes retain their own issued-packet writers; their specialized contracts must not be accidentally narrowed by this change.

## Exact-action validity amendment

The same parent records an exact `record_semantic_review_exemption` request whose action `expiresAt` elapsed while its approval envelope remained offered for seven days. At source `f4ef6a41c6ba9e0d2eda16e5423a9ab0977564e9`, `change-review/semantic-review-policy-exemption.ts::validIdentity` checks the current identity and a positive expiry of at most 24 hours only after `humanApprovalForExecution`. Preflight cannot create a human waiver, repair expired arguments, widen DEV authority or certify independent review. It can reject an impossible exact request without consulting private Workroom evidence.

Share the existing parameter-only identity/expiry validation between admission and the final writer. Reject expired, malformed or overlong requests before the escalation boundary with a fixed remedy to submit a fresh exact request. A currently valid request retains its governing human approval and DEV-only writer checks. Approval completion skips early admission so the original writer can settle an action that became stale after approval. Existing offered historical envelopes remain immutable; no request is approved, refreshed or replayed by this repair.

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
| AC-ADM-5 | OBJ-ADM-1, OBJ-ADM-2 | On the served revision, a safely bounded impossible evidence request produces no pending approval, while authorized routine evidence can still record its result. |

## Ordered work and verification

1. Claim source paths and resolve test impact before Red. Add a first-failing regression at the current preflight boundary.
2. Extract shared trusted input binding, add read-only prerequisite checks through existing canonical readers, and leave final receipt authorization intact.
3. Add a first-failing expired-exception preflight regression. Reuse the existing exception identity validator without moving or removing final human authorization, DEV scope, evidence or expiry checks. Cover valid, malformed, boundary expiry, future-overlong and approved-then-expired cases.
4. Run preflight, normal/accepted-review/steward/platform-review, exception writer and artifact provenance tests, both web typechecks, applicable guards and the canonical shared integration gate. The graph also links the existing bounded-handoff database test; record its canonical execution or an explicit infrastructure limit.
5. Obtain independent source assessment, publish through a DCO-signed protected PR, advance through the canonical upgrade procedure, and exercise AC-ADM-5 against the served revision. Record source, deployment and behavior evidence separately.

## Boundaries and rollback

No migration, grant, credential, private-room admission, standing autonomy setting, approval replay, historic-request rewrite or final receipt validation is changed. A provider read failure is inconclusive, never approval of an unknown artifact. Preflight may repeat reads; no admission result authorizes a subsequent write. Rollback is a normal protected source revert.

Canonical artifact errors can include restricted room heads or sign-off identities because their existing writers run after authorization. Early admission preserves their typed refusal code but returns fixed remedies without raw resolver text. A first-failing regression on `d173cd3e3632d38eed5a3adbedba8b2081342fa4` reproduced the disclosure with sentinel room, branch, head and email values; tests cover all three canonical artifact refusal codes. No denied-room live probe is needed or authorized.

This delivery covers the documented artifact/context and exact exception-parameter preconditions. Other operation-specific prerequisites and the overall operator objective still require their own evidence; passing these checks does not prove every tool has declared every prerequisite. Existing final handlers remain authoritative.

## Backlog coverage

Atomic coverage receipt `cmvsrpgi60dqh01myay2528pn` binds this ordered repair to BI-035BE8D1. Research receipt `initiative-0b282cba-866a-484a-9c22-ef98be73fdef` records the named-source reproduction and first-failing test. The author is responsible for source delivery and canonical live verification; neither receipt declares deployment or acceptance passed.

The exact-action validity amendment retains the existing parent acceptance and CT-ADM/FLOW-ADM. Its updated immutable coverage is recorded before that runtime extension; source restructuring preserves the prior assessed implementation under a local checkpoint and does not publish runtime bytes without their gate.
