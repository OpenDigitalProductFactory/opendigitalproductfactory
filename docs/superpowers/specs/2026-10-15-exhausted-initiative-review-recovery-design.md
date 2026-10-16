---
status: proposed
backlog: BI-18EB4283
---

# Exhausted initiative review recovery

## Problem and evidence

BI-C684AF45 reached terminal-writer-retry-exhausted on its exact owned
design-spec task without a receipt. At b338f06e581e6cc7886c334b519f098feb142865,
the existing history predicate and reviewer-selection loop both limit exhaustion
recovery to plan-review. The returned instruction to select an alternate cannot
advance design-spec, spec-approval or architecture-review. This differs from
BI-D3E1F6D9 (a baseline-dependent request-key collision) and extends PR #6244.

**OBJ-RECOVER:** Route an exact owned exhausted independent review to the next eligible reviewer while preserving all authority and immutable evidence boundaries.

| Criterion | Objectives | Observable result |
|---|---|---|
| AC-RECOVER | OBJ-RECOVER | Each independent design/spec/architecture gate excludes an exact owned exhausted packet and selects the next eligible reviewer. |
| AC-PRESERVE | OBJ-RECOVER | A live, completed, capacity-held, authorization-held, mismatched-owner/digest/artifact or unresolved execution packet is never replaced. |
| AC-EXHAUSTED | OBJ-RECOVER | If every eligible reviewer is exhausted, return the existing actionable escalation. |
| AC-COMPAT | OBJ-RECOVER | Existing plan-review recovery and non-review behavior remain unchanged. |
| AC-VERIFY | OBJ-RECOVER | Focused failing-then-passing tests prove the above and package typecheck passes. |

## Design grounding and research

Reuse `createExhaustedPlanReviewPredicate` and
`resolveInitiativeReviewerRecovery`; do not add a parallel task/retry registry.
The existing exact request digest, authenticated user/authority, immutable
artifact, required writer, independent-reviewer eligibility and terminal
exhaustion proof remain mandatory. No counter reset, receipt synthesis,
provider/privacy override, grant change or live-task replacement is allowed.
Retain the existing exported property/function names for source compatibility;
document their expanded independent-review scope rather than editing unrelated
callers. Exclude author-satisfiable research/classification from this change.

Compare the already shipped plan-review implementation with each affected gate.
A parameterized regression proves both predicate admission and alternate
selection. Negative fixtures preserve non-exhausted/foreign/uncertain states.
No external dependency or protocol is adopted. No schema, endpoint, install or
UI change is required. Rollback restores the two plan-only guards; historical
tasks and receipts remain untouched.

## Ordered implementation and verification

1. Reproduce the three affected gates with failing predicate/selection fixtures.
2. Extend the existing predicate's closed gate set and the selection loop to
   independent reviewer lanes. Preserve all matching and refusal checks.
3. Run graph-linked tests (14 related suites plus the history predicate), package
   typecheck, style-drift guard and governed exact-tree integration gate.
4. Submit the protected DCO PR; after canonical deployment, refresh the original
   Workroom's recovery and verify it issues an eligible alternative rather than
   replaying the exhausted task.

This is one atomic repair: the broadened history predicate without the selection
loop cannot recover a room, and a broadened loop without exact history never
excludes the failed packet. Canonical coverage binds all five criteria and
`OBJ-RECOVER` to BI-18EB4283 and this ordered fix design.
