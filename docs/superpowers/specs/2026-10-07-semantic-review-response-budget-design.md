# Semantic review response budget

Status: proposed; implementation and independent acceptance pending.
Owner: BI-128AEC8D, WC-9F8B48B9. Parent outcome: BI-06AE6833.

Platform decision DI-77524B019489 selected the existing activity-budget path
over a global default increase or separate reviewer dispatch. Scores were
engineering estimates, not runtime measurements.

## Problem and evidence

On served revision 511ad02e, OAuth prerequisite review
TR-GATE-8A7F6BD1D197ED8ECC1B14BD passed architecture review but twice
truncated change review at 13,848 input and 4,096 output tokens. Evidence
cmuxku3nysknb01qqmtnq25bt preserves the inconclusive result. Classification
repair review TR-GATE-9585F9667151DDA2FE57AA97 independently reproduced
truncation on both branches. Neither result authorizes publication.

Source inspection at bc2fd4c2c995eb24775dde8d45c18f1f92f8cc74 confirms:

- `routed-semantic-review.ts` supplies effort and a context floor, without an
  activity output allowance.
- `execution-plan.ts` defaults to 4,096 tokens when no recipe matches.
- `semantic-review-context-floor.ts` independently reserves 4,096 tokens.
- ActivityContract already declares numeric input/output envelopes. Harness
  attachment records qualitative token policy without changing dispatch tokens.
- The generic activity review default is 2,000 output tokens; attaching that
  unchanged would not resolve the observed defect.

The selected local Qwen3.8 model had a served 40,960-token context and no
champion recipe, according to the originating owner's routing evidence.
Source inspection is not yet a failing/passing regression proof.

## Proposed bounded design

Reuse ActivityContract and the canonical execution plan. Give semantic review
an explicit bounded completion allowance that includes reasoning consumption
where the provider counts it against completion. Use the same allowance for
context admission and actual provider dispatch. Resolve model output/context
limits before dispatch and fail with an observable capacity reason when the
requested complete review cannot fit. Do not silently reduce the immutable
review payload or treat a shortened answer as an approval.

Keep existing recipe selection, data screening, residency, grant intersection,
checkpoint identity, retry limits and truncation-as-inconclusive semantics.
Existing callers without an activity allowance retain their current behavior.
The semantic caller will reserve 16,384 completion tokens, including reasoning
on providers with a shared completion budget. This is a bounded initial allowance,
not a promise that every review will finish. The observed 13,848 input tokens plus
this allowance fit the reported 40,960-token window; admission must still include
prompt estimation headroom and enforce the actual endpoint's limits.
Do not change provider configuration, credentials, database records or introduce
a second routing substrate. Final budget value and binding point require the
dispatch trace and regression proof before implementation admission.

## Acceptance

**OBJ-1:** A complete review receives a bounded, admitted output allowance.

| ID | Objective | Statement |
| --- | --- | --- |
| AC-1 | OBJ-1 | A regression reproduces the default 4,096 ceiling and proves the declared allowance reaches actual dispatch. |
| AC-2 | OBJ-1 | Input plus completion/reasoning reservation respects served context and model output limits, including fallback routes. |
| AC-3 | OBJ-1 | Truncated responses remain inconclusive; privacy, authority and retry constraints remain enforced. |
| AC-4 | OBJ-1 | After governed deployment, the saved OAuth review obtains a complete verdict while reusing valid architecture evidence. |

## Ordered delivery and refactoring

1. Trace ActivityContract through routing and provider dispatch; select one
   authoritative budget calculation and record research evidence.
2. Add failing regression tests for actual dispatch, limits and truncation.
3. Bind admission and dispatch to the shared calculation. Consolidate duplicated
   response-reserve logic as part of the repair, rather than add independent knobs.
4. Run affected tests, typechecks, exact-source shared verification and independent
   review; publish through protected PR and canonical self-upgrade.
5. Verify served containment, resume saved reviews using supported recovery,
   and record complete runtime verdicts against the original carriers.

This is one atomic deliverable under BI-128AEC8D. Its implementation coverage
and readiness receipts are pending; this document alone is not admission.

## Existing architecture

- [Activity routing harness](2026-06-28-activity-level-ai-routing-harness-design.md)
- [Execution recipes](2026-03-20-execution-recipes-design.md)

No UI, schema or new persistent entity is proposed.
