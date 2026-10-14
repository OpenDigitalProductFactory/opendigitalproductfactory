---
status: active
---

# Keep truncated golden calibration observations unverified

Backlog: BI-A9059BB0. Workroom: WC-49F9899D.

## Problem and measured boundary

The existing `runGoldenTest` scores content and tool calls without checking
`InferenceResult.truncated`. An independent source regression against the actual
exported function returned a perfect score for a known-truncated exact match;
its complete control also scored ten. The reproduction used a mocked provider
and made no vendor call or database write.

The trace acceptance run DE-ED63B59C stored three codegen scores of ten at 500
output tokens. Those historical caps are not proof of truncation: the completion
flag was not retained. This change never backfills or rerates those observations.
BI-7C93EEE7 remains delivered: its scope was real request provenance, not quality.

## Grounding and decision

Reuse the [golden provenance design](2026-10-14-golden-test-trace-provenance-design.md),
the [endpoint diagnostic design](2026-10-14-responses-endpoint-diagnostics-design.md),
`eval-golden-test.ts`, `eval-runner.ts`, the existing inconclusive dimension flow,
and EndpointTestRun results JSON. The kernel's
[report-only-the-verdict rule](../../founder-kernel/wiki/principles/report-only-the-verdict-you-reached.md)
requires an unknown observation to remain distinguishable from success and failure.

Use a nullable score and the actual optional truncation flag in the existing
TestResult contract. A known-truncated response has no measured score; its actual
partial content, trace and explanatory reason remain available. A complete
control retains existing scoring. An absent historical flag stays absent.

Stop the selected calibration run at an incomplete golden observation. Hold all
quality, capability, confidence, evaluation-count and lifecycle writes for that
run, including updates computed from earlier dimensions. Record an incomplete
run with no aggregate quality score. Attempt timestamps may still advance to
avoid immediate repeat work; they are not evidence of measured quality.

This conservative boundary matches the existing endpoint diagnostic's whole-run
quality-write boundary. Adding a new observation store or retroactively assigning
truncation would create unsupported evidence. Raising fixture output allowances
would change the experiment rather than repair its verdict; allowances stay fixed.

## Objective and acceptance

**OBJ-1:** Calibration never derives measured model quality from known-incomplete generation and preserves truthful provenance.

| Acceptance | Objectives | Statement |
| --- | --- | --- |
| AC-1 | OBJ-1 | A known-truncated golden response is unverified and cannot receive a measured success or failure score, including exact-match and tool-call outputs. |
| AC-2 | OBJ-1 | A selected calibration run encountering this incomplete observation stops further tests and leaves quality scores, capability projections, confidence, evaluation count and model lifecycle unchanged; its recorded run is incomplete with no aggregate quality score. |
| AC-3 | OBJ-1 | The existing real trace, actual partial content and known truncation remain recorded; complete controls still score normally and historical missing flags remain unknown. |
| AC-4 | OBJ-1 | Genuine RED-to-GREEN regressions, affected tests and both TypeScript programs pass; protected merge, qualified canonical deployment and one bounded live acceptance establish delivered behavior. |

## Ordered atomic implementation

1. Resolve impact advice for both evaluator modules. Add meaningful failing tests
   for known-truncated exact/tool-call matches and an incomplete observation after
   an earlier complete dimension. Assert no numeric quality or lifecycle writes.
2. Guard the golden leaf before scoring. Extend the existing result contract with
   a nullable score and optional actual completion evidence; retain real traces.
3. Propagate the incomplete observation through the current dimension/run flow,
   stop remaining inference, and hold metadata/drift projections. Preserve prior
   scores and genuine complete controls without fabricating zero-quality data.
4. Run affected suites and both TypeScript programs, then the exact canonical
   integration gate. Document independent source assessment separately from any
   native review and use the protected merge queue.
5. The existing sole publisher qualifies and deploys the merged bytes. Verify the
   prospective behavior on the canonical install with one bounded observation;
   never change models, authority, allowances or history just to manufacture a pass.

Contract references: `CONTRACT-known-incomplete-generation`,
`FLOW-selected-calibration`, `VERIFY-neutral-metadata-and-trace`.

## Scope, risk and rollback

One atomic deliverable: the nullable observation and its consuming write boundary
are inseparable. Five edit paths: the golden leaf/tests, dimension runner/tests,
and this proportional fix design. No new tool, queue, store, schema, grant, model
reactivation or output-budget increase. Existing scoring for complete responses
and existing historical rows are retained.

Nullable-score consumers must be found before changing the type. The tests must
prove an incomplete late dimension cannot promote confidence or degrade/retire a
model. Revert the guard and consuming boundary together through a protected PR;
prior provenance remains independently delivered.
