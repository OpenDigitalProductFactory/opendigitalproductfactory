# Reject impossible evidence requests before approval

Backlog: BI-035BE8D1. Workroom: WC-C2A687B9. Delivery: medium repair.

## Problem and current evidence

The operator asked this chat to complete the existing approval repair. The live mirrored backlog records 45 approved calls that failed artifact provenance and two later calls whose authenticated writer context was absent. On source `64a1056f865e5f543e4608fb8601b81263e0e913`, `mcp-governed-execute.ts` runs the existing preflight before authority escalation, but `mcp-governed-execute-preflight.ts` checks only recovered review authority, room access and invitations. The evidence handler resolves its accepted TaskRun binding and calls the canonical artifact resolver only after authority escalation. Human consent cannot supply missing author provenance or missing execution context.

The recent BI-68EED40A report authorized but not run is retained as a separate observation; it does not establish this defect's cause. The existing refusal breaker and UI presentation retain their other owners. Exact Workroom WC-F4F9BC21 read was refused and is not bypassed.

## Choice and existing substrate

CT-ADM is the existing governed preflight followed by unchanged receipt authorization. FLOW-ADM is trusted binding selection, read-only prerequisite resolution, then the original authority gate and final writer.

Extend the existing preflight with a read-only evidence admission check. Share trusted binding selection with the existing evidence handler; resolve item, reviewer and immutable artifact using their existing canonical readers. Do not duplicate provenance rules in an approval-specific validator, execute a writer as a probe, synthesize authority, or treat preflight as permission. The final writer continues to revalidate mutable facts after approval.

A new approval system or blanket approval of reports would not address impossible requests. This repair keeps existing envelope and authority contracts. Ordinary non-independent research/classification/dependency evidence is the bounded first deliverable. Objective-mapping proposals and independent review lanes retain their own issued-packet writers; their specialized contracts must not be accidentally narrowed by this change.

## Objectives and acceptance

The existing parent acceptance remains the following, including its wider precondition coverage:

- No approval card is minted for a call whose declared preconditions fail.
- `record_initiative_evidence`'s artifact-author check runs in preflight.

**OBJ-ADM-1:** An evidence request that lacks deterministic author or immutable artifact prerequisites is refused before an approval envelope can be created.
**OBJ-ADM-2:** Valid evidence retains its exact current authorization and final writer checks.
**OBJ-ADM-3:** The admission check uses the same trusted binding as execution and creates no receipts, approvals or grants.

| Acceptance ID | Objective IDs | Statement |
| --- | --- | --- |
| AC-ADM-1 | OBJ-ADM-1 | Missing artifact author or immutable artifact returns the canonical refusal before the authority escalation boundary. |
| AC-ADM-2 | OBJ-ADM-2 | Valid current evidence proceeds to the original gate; provenance changes before execution remain refused by the original writer. |
| AC-ADM-3 | OBJ-ADM-3 | Caller-supplied item, artifact or workroom fields cannot replace an accepted TaskRun binding. |
| AC-ADM-4 | OBJ-ADM-2, OBJ-ADM-3 | Objective mapping and platform independent-review flows preserve their existing behavior. |
| AC-ADM-5 | OBJ-ADM-1, OBJ-ADM-2 | On the served revision, a safely bounded impossible evidence request produces no pending approval, while authorized routine evidence can still record its result. |

## Ordered work and verification

1. Claim source paths and resolve test impact before Red. Add a first-failing regression at the current preflight boundary.
2. Extract shared trusted input binding, add read-only prerequisite checks through existing canonical readers, and leave final receipt authorization intact.
3. Run preflight, normal/accepted-review/steward/platform-review and artifact provenance tests, both web typechecks, applicable guards and the canonical shared integration gate.
4. Obtain independent source assessment, publish through a DCO-signed protected PR, advance through the canonical upgrade procedure, and exercise AC-ADM-5 against the served revision. Record source, deployment and behavior evidence separately.

## Boundaries and rollback

No migration, grant, credential, private-room admission, standing autonomy setting, approval replay, historic-request rewrite or final receipt validation is changed. A provider read failure is inconclusive, never approval of an unknown artifact. Preflight may repeat reads; no admission result authorizes a subsequent write. Rollback is a normal protected source revert.

The broader BI-035BE8D1 includes other precondition families (including expired semantic review exceptions). This bounded delivery cannot by itself close those gaps or the overall operator objective. Remaining families must retain explicit live coverage until verified.
