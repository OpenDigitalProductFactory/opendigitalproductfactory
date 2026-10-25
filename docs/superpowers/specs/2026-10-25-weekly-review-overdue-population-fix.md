---
status: draft
---
# Weekly review overdue recommendation population repair

Owner: BI-F55BBB6B / EP-0AF96937. Acceptance repair under BI-19CEC4B4.

## Problem and evidence

The existing weekly loader reads createdAt in the recent seven-day window. The
unlearned measure requires recommendations at least seven days old. Their populations
overlap only at the cutoff: a ten-day-old recommendation cannot reach that measure.
The original weekly-review design section 4.1 already requires the older population.
This is a source-confirmed query/measure mismatch; live impact remains to be verified.

## Objective and scope

**OBJ-OVERDUE:** Report overdue recorded-choice gaps using the population the existing
measure requires, without treating historical recommendations as this week's activity.

| Acceptance | Objectives | Statement |
|---|---|---|
| AC-1 | OBJ-OVERDUE | A recommendation created ten days before the review with no recorded choice appears in the overdue-choice measure. |
| AC-2 | OBJ-OVERDUE | Older recommendations with recorded choices remain in the overdue denominator, while rows without recommendations are excluded. |
| AC-3 | OBJ-OVERDUE | Weekly volume and other weekly measures use only the declared recent window; loading older recommendations does not inflate them. |
| AC-4 | OBJ-OVERDUE | The overdue read uses stable bounded ordering and explicitly reports incomplete coverage when its row limit is exceeded. |
| AC-5 | OBJ-OVERDUE | The executor passes both populations to the existing deterministic measures without changing approval, delegation, weights, trust, inference routing or scheduling policy. |

Verbatim body acceptance, retained for proportional coverage:
- AC-1: A recommendation created ten days before the review with no recorded choice appears in the overdue-choice measure.
- AC-2: Older recommendations with recorded choices remain in the overdue denominator, while rows without recommendations are excluded.
- AC-3: Weekly volume and other weekly measures use only the declared recent window; loading older recommendations does not inflate them.
- AC-4: The overdue read uses stable bounded ordering and explicitly reports incomplete coverage when its row limit is exceeded.
- AC-5: The executor passes both populations to the existing deterministic measures without changing approval, delegation, weights, trust, inference routing or scheduling policy.

## Boundary and population contract

CONTRACT-REVIEW-POPULATIONS: the loader owns two independent reads and their mapping.
Recent rows retain the caller's recent window. Overdue rows contain recommendations
created at or before the fixed seven-day maturity cutoff, including those with recorded
choices so the denominator is not selected by missing choice. No lower date bound is
invented. A recorded choice is not a verified outcome or proof of human authorship.

FLOW-RECENT-OVERDUE: the executor passes each population to its corresponding pure
measure. Other weekly measures continue to consume recent rows only. The legacy direct
pure-function input can retain its existing default when no separate population is
provided; the scheduled executor must pass the explicit overdue population.

Bound the overdue read using the existing 20,000-row limit plus one look-ahead row.
Use deterministic ordering by createdAt then unique interactionId. Return at most the
limit and a completeness signal; an overflow produces an explicit incomplete-coverage
review line even when the sampled ratio would not raise a finding. Counts over a
truncated population are labeled sampled. This repair does not claim a full traversal
or authorize policy tuning from the sample.

Use the same declared selected fields and profile mapping for both reads. Keep current
thresholds, scope projection and recommendation/choice semantics. Do not add a store,
schema, scheduler, approval rule, grant, inference call or UI control.

## Ordered atomic plan

1. V-OVERDUE-REGRESSION: a query-aware fixture contains recent activity, a ten-day-old
   missing choice, older recorded choices and a row without a recommendation. Exercise
   computeWeeklyReview and first observe the omitted overdue finding. Assert recent
   volume stays unchanged. Include exact maturity cutoff and caller-defined days.
2. Separate loader reads, reuse row mapping, add explicit population/coverage fields,
   and wire only the unlearned measure to the older rows. Test stable bounded reads,
   limit and overflow without materializing an unbounded database scan.
3. Run all self-review tests, graph-linked tests, affected typecheck, style guard and
   ordinary source/PR verification. Publish through normal DCO and independent review.
   Live acceptance must use the canonical runtime containing the merged change.

The steps are internal sequencing of one defect repair: an unwired query or a changed
measure without the correct denominator is not independently useful delivery.

## Compatibility, risk and rollback

No schema migration. Existing direct computeReviewLines callers keep their current
fallback population. The executor adopts the explicit population. Preserve the
weekly schedule, routing, held-work behavior and existing report format.

The extra query adds read load. The inspected schema has composite createdAt indexes,
not a global createdAt index. The return limit does not bound database scan/sort work;
observe the query plan and cost on the canonical runtime before claiming fleet-scale
performance. A look-ahead proves overflow only, not the total overdue count.
Retain coverage evidence in returned review lines. This does not fix the broader
review persistence, provenance, routing-failure or correction-execution gaps.

Rollback reverts this atomic source change; no stored authority or outcomes are
rewritten. No existing pending requests are replayed.

## Existing context and exclusions

The original behavior is in
[weekly-review design section 4.1](2026-09-10-decision-engine-weekly-self-review-design.md#41-measures-deterministic-sql-over-the-trailing-7-days-prior-7-for-deltas).
The unmerged integration amendment at aeeafe0ca70a25696a8d077b157611cecb63ee36 remains a
separate proposal. BI-73780C2E owns correction through outcome validation. Inference
classification/routing is being repaired in another owner-started chat.

## Backlog coverage

Atomic delivery BI-F55BBB6B. Requirement refs: AC-1, AC-2, AC-3, AC-4, AC-5.
Contract ref: CONTRACT-REVIEW-POPULATIONS. Flow ref: FLOW-RECENT-OVERDUE.
Verification ref: V-OVERDUE-REGRESSION.
Canonical coverage receipt must be recorded and checked before implementation.

## Verification progress

The owner selected delivery-small@1.0.0 on 2026-10-25. The implementation claim
IRD-C4497FAF301A admitted that exact shape and source identity. The first query-aware
regression run executed seven tests and failed, including the missing ten-day-old
recommendation finding. After the source repair, all five self-review test files and
54 tests passed. Green unit tests do not establish live integration acceptance.

The atomic coverage writer was refused during self-upgrade quiescence after the
Small implementation claim was admitted. Record and recheck the receipt when the
portal returns; no coverage pass is claimed here. The already authorized source repair
continues within that admitted scope. Runtime gates, native review and deployment
remain to be verified through their supported paths.
