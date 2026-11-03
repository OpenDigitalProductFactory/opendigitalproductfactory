---
status: active
---

# Show ordinary initiative review receipts in Workroom

Backlog: BI-537E3E75. Epic: EP-WORK-CONVERGENCE. Workroom: WC-564AE32A.
Delivery shape: small. This document describes the finite corrective outcome;
it does not reopen BI-CAP-21C511CA or authorize task recovery.

## Problem and existing architecture

An ordinary initiative review can complete with a committed native FAIL receipt
while its Workroom says no correlated receipt and no recorded reason. The gap
is in the read model; task completion alone remains insufficient evidence.

Extend the existing [shared reviewer design](2026-07-27-shared-change-reviewer-control-design.md),
Workroom readback successor section. PR6553/6563 delivered its original projection.
This corrective successor preserves existing receipts and closed rooms.
BI-31BA518E owns the separate task-status/writer reconciliation defect.

### Design grounding

The existing `loadReviewRoomCandidates`, `initiativeRoomIdentity` and
`loadSemanticReviewRoomProjection` already identify authorized room-scoped
review requests, immutable source versions and incomplete reads.
`ReviewerExecutionList` already renders a receipt when supplied. The projector
currently excludes ordinary initiative receipts and only qualifies semantic
receipts. Reuse `loadTaskInitiativeReviewOutcome`, `loadInitiativeReviewOutcome`,
receipt validation and `readBoundReviewAuthorityTask` for the canonical meaning
of an initiative receipt. Refactor their pure identity checks or introduce a
bounded shared metadata adapter where necessary; do not copy a second verdict
or readiness implementation into the Workroom path.

## Objectives and acceptance

**OBJ-1:** Show the authentic recorded result for the exact ordinary request.

**OBJ-2:** Preserve uncertainty, access restrictions and current/historical identity.

| Criterion | Objective | Observable result |
| --- | --- | --- |
| AC-1 | OBJ-1 | An authentic PASS or FAIL receipt from the original task's bound writer is visible with its recorded summary and receipt identity. The existing not-applicable domain decision remains explicit rather than being converted into PASS. |
| AC-2 | OBJ-2 | Item, gate, immutable artifact, task, source and authority mismatches, competing receipts, unavailable reads and missing provenance show no asserted verdict. Full sensitive result content remains behind existing requester and content access. |
| AC-3 | OBJ-2 | Current and historical receipts retain their source identity; neither a receipt nor task completion changes Workroom status, acceptance, provider settlement or recovery authority. |
| AC-4 | OBJ-1 | Targeted regression fails on the prior projection, passes with the correction, and preserves existing semantic-review observations. Canonical containing-release desktop light/dark, keyboard and zoom checks show the original failed disclosure corrected. |

## Data and runtime boundary

Read existing TaskRun metadata, successful bound writer observations and
BacklogItemActivity initiative gate receipts. Authenticate original task/writer
provenance and exact immutable binding before selecting one outcome. Missing
writer response may be reconciled only through the canonical committed effect
and authority link, never through prose or status. A tool success alone is not
a verdict. Do not blindly remove the semantic-only condition.

Keep room and per-lane history bounds. Reuse typed summary-only receipt facts
across authorized browser and MCP projections. Avoid loading full request or
provider payloads and avoid an unbounded readiness/history read for every room
row. A failed or truncated lookup stays explicitly incomplete. Domain receipt
references retain their actual source table and kind; do not label initiative
activities as semantic ExternalEvidenceRecord receipts.

No schema migration, new ledger, permission, provider dispatch, receipt write,
task status reconciliation or approval action is part of this correction.
Rollback removes the additive projection while preserving native records.

## Implementation and verification sequence

1. Record repository research and current source identity; obtain normal
   implementation admission for the declared small edit scope.
2. Write focused failing tests for authentic FAIL and its exact task/writer
   binding; include missing, mismatched, historical, ambiguous and read-failure
   cases. Inspect related tests before changing production code.
3. Add the bounded shared receipt metadata reader, using canonical validation
   and provenance checks. Project ordinary receipt facts without changing the
   existing semantic or lifecycle meaning. Consolidate duplicated checks.
4. Run the affected source-local tests and both required TypeScript programs
   from the admitted worktree. Run the canonical integration gate once after
   fresh capacity coordination, then native review and protected DCO delivery.
5. Verify the original disclosure on the canonical containing deployment.
   Native iOS remains a separate application; no new narrow-browser campaign.

The worktree initially classified source-only (dependencies absent). Managed
dependency readiness must be established before local tests or typechecks;
source-local results do not establish canonical integration or live acceptance.

## Risks and stop conditions

Incorrect correlation could disclose a different request's result or imply
approval. Reuse existing authorization, artifact equality, independent writer
and authority-task binding; fail closed on ambiguity. Do not recover inference,
backfill UNKNOWN evidence or broaden grants to make a receipt appear. Stop on
any denied source/room action or a conflicting edit claim, preserving its actual
native remedy. Shared design and generated-index claims require normal
coordination rather than a forced overlap.
