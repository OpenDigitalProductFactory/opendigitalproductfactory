---
status: draft
---

# Semantic review response budget

Status: implementation admitted; independent acceptance pending.
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
a second routing substrate. Implementation admission IRD-48BDAFCA05C7
binds this approach; provider dispatch and runtime acceptance remain to verify.

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

## Follow-up: local shared-context admission (2026-10-11)

Local follow-up owner: BI-128AEC8D, WC-43E6BF3F. The originating
WC-9F8B48B9 remains on its originating installation; this room claims the
existing federated item without replacing that room or its evidence.
Decision DI-6FEBDC3DDB97 selects observed shared-context capacity. Its scores
are engineering estimates, not runtime measurements.

On source `4bf3422a1daf24eb0a0dfe93380966b1ba36f22a`, local discovery
leaves `maxOutputTokens` null and activity admission rejects null exactly as
it rejects a numeric limit below the requested allowance. The transport review
TR-GATE-DCAF88912D13BF578D366639 was excluded before dispatch. The specific
live profile value remains unverified; source behavior must be reproduced in
tests before claiming that value caused the live failure.

[Docker's configuration contract](https://docs.docker.com/ai/model-runner/configuration/)
defines configured context as input plus generated output and distinguishes it
from advertised model context. Use the existing bounded runtime read for the
exact local model, rather than seeding the requested allowance as a model fact.
An observed shared window bounds both total context and the maximum possible
completion; any lower explicit output cap remains binding. The existing activity
admission still checks the sum of input and completion. Unknown runtime context
remains excluded, including when a catalog/profile advertises a larger window.
Cloud endpoints retain their existing explicit output-capacity requirement.

Ordered follow-up delivery:

1. Reproduce absent local output metadata, incorrect model selection and unread
   runtime configuration using failure-injection tests.
2. Reuse the context probe with exact-model and provider identity. Derive bounded
   local manifests without database, provider-setting or request changes.
3. Distinguish unknown capacity from a known insufficient limit in admission
   diagnostics; retain numeric caps, input headroom and the 16,384 allowance.
4. Run affected tests, typechecks, source guards, canonical gate and independent
   review. Deliver through DCO PR, merge queue and canonical deployment.
5. The transport owner performs supported recovery only after fresh runtime
   verification. Preserve the saved review identity and obtain a genuine verdict.

Additional acceptance under OBJ-1: exact-model selection, unavailable/invalid
runtime capacity, insufficient shared context, explicit lower output caps and
unchanged cloud behavior have regressions. Runtime health, original review
recovery and deployment remain unrun until supported evidence exists.

The existing backlog acceptance remains binding, quoted here for delivery
coverage against this immutable plan:

- Reproduce the 4,096-output ceiling with the actual selected recipe and show where it is imposed.
- Add a regression proving the review's output allowance reaches actual dispatch and stays within model/context limits, including reasoning consumption where relevant.
- A truncated response remains inconclusive, never PASS.
- Resume the preserved OAuth prerequisite review after deployed repair; obtain a complete change-reviewer verdict and reuse the architecture pass when valid.
- No repeated identical inference after the same failure recurs.

Source reproduction on the named base: 11 expected failing regressions and 42
passing controls in the loader/context suites on 2026-10-11. Research receipt
`initiative-917ba525-be6f-4117-a6ca-3f237aa6af9a` records the run. No green
implementation, deployed repair or recovered review is claimed by this design.

## Follow-up: admit the bounded thinking plan (2026-10-24)

Continuation owner: BI-128AEC8D, WC-BCF94ED5. Source base
`c49c13e5d2f5e1f87aa9b35011085ebb56368c14` already bounds fixed thinking
inside an activity's total completion allowance at plan binding. Admission
instead compared the unbounded proportional thinking request with that total.
For a 50,000-token high-depth request, this rejected a 32,768-token thinking
request before the existing binder could fit it within the 16,384-token total.

The three routes for review `TR-GATE-84A3E645E0C53BA4A72E9FC8` on
2026-10-24 each excluded all 13 Anthropic API candidates for that exact fixed
thinking condition. Their declared output limits were 64,000–128,000 tokens.
The other candidates remained excluded for confidential clearance or structured
output support. These observations establish a calculation defect; they do not
establish that any provider completed the review.

Reuse the existing binder's calculation in admission and execution: reserve the
greater of 2,048 tokens or one quarter of the activity total for final output,
bounded by the total minus one, and cap the requested thinking inside the
remainder. A 16,384-token allowance therefore retains at most 12,288 thinking
tokens and at least 4,096 final-output tokens. Keep provider minimum thinking
requirements, invalid-value checks, known output/context capacity, input limits,
high effort, confidentiality and structured-output gates intact. No configuration,
credential, permission, retry-budget or review-verdict changes are part of this
repair. Calls without an activity retain their existing behavior.

Delivery sequence and additional acceptance under OBJ-1:

1. Reproduce the admission/binding contradiction for Anthropic and Google with
   high-depth input above the activity total. Confirm normal and recipe plans
   carry the same bounded settings; a provider minimum that cannot fit refuses.
2. Share the existing bounded-thinking implementation, and verify the actual
   route selects the capable confidential endpoint while excluding insufficient
   output capacity, unknown capacity, missing schema support and missing clearance.
3. Run source tests, typechecks, canonical verification and protected publication.
   After governed deployment, obtain fresh scoped remediation evidence before
   using supported recovery of the saved review. A source test is not a native
   verdict; original review and recovery histories remain intact.

No operator UI, schema or documented user action changes. The existing activity
contract and this design remain the architecture and contributor reference.

## Existing architecture

- [Activity routing harness](2026-06-28-activity-level-ai-routing-harness-design.md)
- [Execution recipes](2026-03-20-execution-recipes-design.md)

No UI, schema or new persistent entity is proposed.
