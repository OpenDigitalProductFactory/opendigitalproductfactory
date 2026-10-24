---
status: active
---

# Semantic review provider admission

Parent: BI-06AE6833. Admission executor: WC-27D00458.
Canonical design: [delivery throughput](../specs/2026-09-03-local-first-agentic-delivery-throughput-design.md), provider admission slice and sections 11/15.1.
Approved baseline: baseline-524959f8-8508-4c5a-afbf-8bc285f77587.
Design blob: 511894b16063195e4bf9f6977f1f5a3fd0549693.

## Delivery boundary

This branch implements provider admission only. The broader baseline remains
decomposed below; listing another deliverable does not claim its implementation
or completion. WC-4A72DC95 owns execution/visibility design reconciliation and
retains its own branch. Preserve the approved baseline until this admission PR
lands; reconcile later additions through explicit baseline supersession.

The scoped defect is verified on main 061eeeee8c7e17ee63b9aef7a9d52bb69d103624:
`apps/web/lib/change-review/routed-semantic-review.ts` probes local capacity
before provider selection and labels all review input confidential. The existing
`callProvider` boundary in `inference/ai-inference.ts` already checks capacity for
the selected provider, including calls from `routing/fallback.ts`. Ordinary
development reviews can use eligible external providers without starting a local
model while CI owns the host.

## Backlog coverage

Decision: decomposed. Live coverage is recorded through
`record_plan_backlog_coverage` against the published plan revision; the database
is the receipt source of truth.
All requirements and acceptance IDs below come from the approved baseline.
Contract and flow references name the corresponding existing design sections.

| Key | Existing BI | Requirement | Acceptance | Contract / flow | Dependency |
| --- | --- | --- | --- | --- | --- |
| admission | BI-06AE6833 | OBJ-DELIVERY-CONVERGENCE, OBJ-DELIVERY-REFACTOR | AC-DELIVERY-ADMISSION, AC-DELIVERY-REFACTOR | CONTRACT-ADMISSION / FLOW-REVIEW-DISPATCH | none |
| convergence | BI-06AE6833 | OBJ-DELIVERY-CONVERGENCE | AC-DELIVERY-CONVERGENCE | CONTRACT-CONVERGENCE / FLOW-REVIEW-RECOVERY | admission |
| visibility | BI-9DC43E17 | OBJ-DELIVERY-VISIBILITY | AC-DELIVERY-VISIBILITY | CONTRACT-DELIVERY-RAIL / FLOW-DELIVERY-INSPECTION | none |
| campaign | BI-1CB9D97B | OBJ-DELIVERY-CAMPAIGN | AC-DELIVERY-CAMPAIGN | CONTRACT-CAMPAIGN / FLOW-DEPENDENCY-WAVES | convergence, visibility, placement |
| placement | BI-8D56F777 | OBJ-DELIVERY-PLACEMENT | AC-DELIVERY-PLACEMENT | CONTRACT-PLACEMENT / FLOW-PAIRED-DISPATCH | none |
| measurement | BI-69803ACC | OBJ-DELIVERY-MEASUREMENT | AC-DELIVERY-MEASUREMENT | CONTRACT-SCORECARD / FLOW-COHORT-MEASUREMENT | none |

The admission/convergence rows are separate shippable slices of the same existing
BI, with different Workrooms; neither closes BI-06AE6833 alone. Cross-item campaign
and placement dependencies remain the canonical design's portfolio scope, not a
prerequisite imposed on this small admission fix.

CONTRACT-ADMISSION and FLOW-REVIEW-DISPATCH implement sections 11/15.1: screen the
actual payload, choose an eligible provider, check capacity at its dispatch
boundary, then independently collect every required review branch. A unavailable
branch is infrastructure-inconclusive, not a semantic failure or passing review.
CONTRACT-CONVERGENCE and FLOW-REVIEW-RECOVERY refer to section 8: durable attempts,
independent receipts, stale-worker fencing and protected PR closeout.
CONTRACT-DELIVERY-RAIL and FLOW-DELIVERY-INSPECTION refer to sections 6/7: a shared
Workroom projection and accessible evidence navigation.
CONTRACT-CAMPAIGN and FLOW-DEPENDENCY-WAVES refer to section 9: bounded dependency
waves and verified child completion.
CONTRACT-PLACEMENT and FLOW-PAIRED-DISPATCH refer to section 11: eligible placement
across existing installations without duplicate claims.
CONTRACT-SCORECARD and FLOW-COHORT-MEASUREMENT refer to section 10: complete
outcome cohorts with explicit denominators and measurement limitations.

## Admission implementation sequence

1. Claim the wrapper and its colocated tests; consume impact advice. First add
   behavior tests demonstrating that active, queued and unavailable local capacity
   do not prevent an eligible external review. Expect internal sensitivity for
   ordinary development input, independent specialist branches and unchanged
   infrastructure-inconclusive aggregation. Observe failure before the fix.
2. Remove the wrapper's duplicate local capacity predicate and import. Pass
   internal classification into the existing screened routing entry point.
   Preserve explicit residency, provider clearance, export obligations and mixed
   sensitive-content screening. No new provider setting or admission controller.
3. Verify both fallback directions. Cloud failure followed by a capacity-deferred
   local candidate must retain the typed refusal as the aggregate error's cause
   alongside failed-attempt details; a blocked local primary may
   continue to an eligible cloud fallback. Run the actual adapter-boundary and
   screening tests alongside the wrapper tests; mocks alone are not dispatch proof.
4. Run affected tests, typecheck and relevant source guards in this compile-ready
   worktree. Use protected cloud CI for the production build, DCO and mechanical
   PR health before merge. Record exact source and check results.
5. After governed release/install advance, execute a real semantic review using
   eligible external inference while local CI is reserved. Read provider/attempt
   evidence and persisted review result. Verify local dispatch is still fenced
   and sensitive mixed payload still constrained. Record served SHA and receipt;
   an accepted request alone is not a passing review.

## Verification and rollback

Affected suites: `change-review/routed-semantic-review.test.ts`,
`routing/local-provider-capacity.test.ts`, `inference/ai-inference.test.ts`,
`routing/fallback-local-capacity.test.ts`, `routing/fallback-screened-dispatch.test.ts`
and source-code/DCO data-screening tests discovered by the impact query.
Include provider outage, no local model, active/queued/unavailable host registry,
mixed sensitive payload and required specialist failure. Do not reserve live CI
capacity merely for a mock test; use the shared leased environment for runtime
verification and preserve existing lease owners.

At least 20% of this slice is consolidation/verification of shared dispatch:
delete the redundant policy and prove primary/fallback callers retain one
canonical check. No migration or visual layout change; the user-visible workflow
change is verified through actual review execution. Roll back the wrapper change
as one revert if dispatch or classification regresses; retain receipts, existing
provider settings and canonical capacity enforcement. Broader delivery-rail and
recovery outcomes remain open until their owners provide their own live evidence.
