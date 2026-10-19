---
title: Reject unresolved semantic-review evidence before admission
status: draft
backlogItem: BI-0A5E19DE
---

# Reject unresolved semantic-review evidence before admission

## Evidence and scope

BI-0A5E19DE owns this atomic fix. On source
`d46195aec042067b619ca5610c5fc901cc7ef390`, a pure request probe returned
`valid=false`, `missing-or-ambiguous-evidence:executed-test`, and
`packetCreated=true`. No provider was dispatched. The MCP pack resolves stored
evidence but creates the immutable packet and reserves review work without
checking validity. Background execution checks it later and reports changed
evidence. Successful historical native requests disprove the item's original
universal-failure claim; this fix addresses the reproduced admission defect.

The existing validator, evidence resolver, immutable request and background
revalidation remain authoritative. No new table, authority, receipt format or
evidence matcher is required. Preserve unmatched completed gate results and
legacy immutable requests. Do not rewrite historical failed tasks.

## Ordered implementation

1. Add boundary regressions in `change-review-pack.test.ts`: missing/malformed
   analysis, unresolved evidence, wrong-room evidence, wrong tree and wrong
   diff must produce a structured synchronous refusal with no TaskRun writes
   or enqueue. Use the real resolver with mocked persisted rows so tests also
   exercise stored evidence scope and currency checks.
2. In `change-review-pack.ts`, validate the already resolved analysis and exact
   request identity before coordination, packet creation or single-flight
   reservation. Return existing validator reasons and a remedy to reconcile
   the Workroom head and record current matching verification evidence.
3. Repair the valid concurrent-submission fixture to supply genuinely matching
   stored evidence. Assert one task and one enqueue, with the other caller
   subscribing. Keep execution-time revalidation unchanged and verify that
   submission and execution resolve the same digest for identical inputs.
4. Run affected pack, validator, evidence, request, single-flight and background
   suites; package typechecks; Style Drift Guard; derived-document checks;
   exact-tree canonical CI and independent review. Publish one DCO PR through
   the protected queue, deploy canonically, then exercise valid and invalid
   Codex requests on the served target. A valid source test is not live proof.

## Acceptance and traceability

The item's acceptance is: "a submission whose failure analysis cites a passing
local_integration_ci row for the workroom head settles as a reviewed receipt
(publish/repair/escalate), and a unit test pins that the submission-time and
execution-time digests agree for identical inputs."

- REQ-EVIDENCE-ADMISSION: Invalid evidence consumes no reviewer capacity and
  creates no task; a current valid request retains duplicate-request reuse.
- CONTRACT-FAILURE-ANALYSIS: Reuse `validateFailureAnalysis` and
  `resolveFailureAnalysisEvidence`, preserving background revalidation and
  immutable packet compatibility.
- FLOW-CODEX-REVIEW: Codex submits bound source and persisted evidence, receives
  either an immediate actionable refusal or the canonical review task, and
  observes its independently authored receipt.
- VERIFY-EVIDENCE-ADMISSION: Boundary regression, identity/digest regressions,
  exact canonical gate and post-deployment valid/invalid request exercises.

## Risks and rollback

Clients that previously omitted analysis will now receive the failure before
queueing rather than after it. Update test fixtures to model valid persisted
evidence rather than permitting invalid admission. Expired evidence must be
refreshed, not silently reused. A protected revert restores prior admission
behavior; no migration or historical evidence mutation is involved.

## Backlog coverage

One deliverable maps to BI-0A5E19DE. Tests, boundary validation and diagnostic
documentation are one change: shipping only the tests or documentation does
not correct admission. Canonical coverage is recorded against this immutable
design before implementation. Completion requires the live receipt and
failure exercise above; this draft does not claim them.
