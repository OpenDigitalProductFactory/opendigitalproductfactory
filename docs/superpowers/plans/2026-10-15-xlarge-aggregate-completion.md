---
status: active
---

# Complete decomposed xlarge initiatives

Backlog: BI-DA407BD9. Workroom: WC-E1DAB3B9.

## Existing contract

Reuse the approved proportional-gates design, section 4:
docs/superpowers/specs/2026-09-02-work-shape-taxonomy-and-proportional-gates-design.md.
Its xlarge delivery is all children done; acceptance reconciles the hypothesis.
The current shape policy applies the implementation prohibition to completion.
Native BI-71ABBD95 reproduces this on source
776f4af5e819260acbfde9beafbe769e3a2cd241. This is WWMD reliability work.

## One atomic repair

AGGREGATE-CLOSE implements AC-IMPLEMENTATION, AC-CLOSE, AC-BOUNDARY,
AC-READWRITE and AC-REGRESSION together. The gate, shared evidence adapter and
negative regressions cannot ship independently without either retaining the
dead end or allowing an unproven parent to close. No child BI is a new deliverable.

1. Freeze this plan and record native atomic coverage before source changes.
2. Add failing policy and adapter regressions. Prove that valid decomposed
   completion can close, while xlarge implementation remains denied.
3. Reuse the existing governed plan-coverage validator and immutable artifact
   reader in a bounded aggregate-completion helper. Select only the newest
   parent coverage. Require a valid decomposed graph, at least two distinct
   real children, no self mapping and every required child done. Missing,
   malformed, stale, cyclic, unavailable or incomplete evidence stays closed.
4. Feed evidence through the existing completion evaluator and projector.
   The read projection and serializable terminal transition use the same helper.
   For xlarge completion, a parent merge/deployment does not substitute for
   child delivery, independent reviews or actual parent outcome reconciliation.
   Keep other shapes and inherited child baseline behavior unchanged.
5. Retain the existing completion codes and give xlarge coverage/delivery
   blockers actionable guidance. No new tool, table, status or approval lane.
6. Run new regressions, affected initiative-readiness, planning coverage and
   acceptance-sweep tests, and both web TypeScript programs. Test parent merge
   and deployment shortcuts as negative cases, including the safety property
   recorded by BI-E75773B8. Reuse the objective-mapping route from BI-0F8E39D5.
   Do not mark either related item fixed by this narrower repair.
7. Obtain independent exact-source review, DCO publication and protected CI.
   Native/full integration remains UNRUN unless actually executed. Reuse the
   standing bounded DEV publication authorization truthfully if needed.
8. The existing sole release owner publishes and deploys a containing canonical
   release. Verify native readiness and original aggregate closure only with
   actual coverage, children and outcome proof; do not fabricate acceptance.
   Preserve the earlier refusal; source tests are not production outcomes.

## Verification obligations

The graph lookup found linked tests for existing edited source; the new helper
has no indexed tests and receives colocated tests plus adapter coverage.
Include linked canonical-plan, judged-design, terminal transition,
readiness-guidance, independent-review and acceptance-sweep regressions.
Run the claimed style guard, doc-index freshness, spec status and diff checks.

Requirement refs: AC-IMPLEMENTATION, AC-CLOSE, AC-BOUNDARY, AC-READWRITE, AC-REGRESSION.
Contract refs: apps/web/lib/backlog/initiative-readiness/shape-requirements.ts,
apps/web/lib/backlog/initiative-readiness/backlog-completion-evaluation.ts,
apps/web/lib/planning/plan-backlog-coverage.ts.
Flow refs: get_backlog_item, update_backlog_item_status.
Verification refs: apps/web/lib/backlog/initiative-readiness/aggregate-completion.test.ts,
apps/web/lib/backlog/initiative-readiness/shape-requirements.test.ts,
apps/web/lib/backlog/initiative-readiness/backlog-completion-evaluation.test.ts.

## Risk and rollback

The critical risk is false aggregate completion. Preserve evidence validation,
reviewed baseline and outcome mapping, and database serialization. A failed child
read is not delivery. No live record is changed to make the fix pass. Revert the
policy/adapter repair to restore the previous closed boundary; historical
evidence remains untouched. No migration.
