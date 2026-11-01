# AI routing document map

This page is the entry point for understanding DPF's LLM and AI coworker routing.
It separates what the platform does now from proposed architecture and historical
records.

## Current authority

| Question | Authority |
| --- | --- |
| How does an operator configure and understand routing today? | [Model Routing & Lifecycle](../user-guide/ai-workforce/model-routing-lifecycle.md) |
| What code chooses and dispatches a route? | `apps/web/lib/inference/routed-inference.ts`, `apps/web/lib/routing/request-contract.ts`, and `apps/web/lib/routing/pipeline-v2.ts` |
| What policy decides whether governed data may leave the install? | `apps/web/lib/govern/data/policy-decision.ts` and `apps/web/lib/govern/data/policy-enforcement.ts` |
| How is provider/account suitability compiled into route constraints? | [AI provider suitability routing design](../superpowers/specs/2026-07-19-ai-provider-suitability-routing-design.md) and its implemented contracts |
| How does routing distinguish multiple accounts of one provider? | [Provider account identity](provider-accounts.md), [account routing guide](../user-guide/ai-workforce/provider-account-routing.md), and [capacity refactor delivery plan](../superpowers/plans/2026-10-14-provider-account-capacity-refactor.md). The delivery plan distinguishes source qualification from served acceptance. |
| How is the designed route projected into EA? | `apps/web/lib/ea/ai-routing-architecture-registry.ts`, `apps/web/lib/ea/ai-routing-architecture-extract.ts`, and `apps/web/lib/ea/reconcile-ai-routing-architecture.ts`; one versioned registry projects synchronized BPMN, SysML, and ArchiMate model kinds |
| What happened operationally? | Route decisions, adapter attempts, inference outcomes, token usage, capacity state, and safe screen/suitability receipts in the live install, correlated by request-scoped `traceId` for new traffic |

Current implementation truth comes from code plus live evidence. A diagram, design
document, or seeded row does not override those sources.

## Restricted present reassessment

The [review settlement amendment](../superpowers/specs/2026-10-16-original-initiative-review-settlement-design.md)
defines a separate, restricted path for a new assessment of an exact immutable
artifact. Its R2 source binds an existing in-process HTTP provider/account/model
composition and exposes only `read_source_at_version` and the bound canonical
writer. It disables native execution, provider fallback, tool-free inference and
auxiliary grounding or reflection. Ordinary routing retains its existing behavior.

Qualification records the actual current budget configuration and execution
bounds, then rechecks them before each provider start. This source work does not
establish release or served acceptance. In particular, finite total-token
qualification still refuses without an authenticated input-bound producer; the
normal 50,000-token case has not yet passed positive qualification. New task
admission and genuine current review receipts remain separate required evidence.

## Streaming versus result delivery

`RouteAndCallOptions.requiresStreaming` expresses token-streaming demand; it
does not change `interactionMode` or authorize asynchronous result handles.
Autonomous agentic loops and semantic-review branches set it to `false` because
they consume completed results. Omitted values retain the existing sync-chat/background
defaults; explicit `true` still requires a streaming-capable endpoint.
Tool capability, sensitive-data screening, provider policy and receipt checks
continue to constrain eligible routes independently.

Durable background operations remain a separate delivery contract. A caller
must support their operation handles before selecting background mode.

Durable semantic review binds autonomous inference origin around its reviewer
execution subtree. Concurrent primary and specialist calls use the shared
autonomous admission budget while interactive callers retain priority. This
origin tag does not change synchronous result delivery or the review deadline.

Reviewer delivery evidence remains bound to an immutable change and its
Workroom. Canonical local-CI reuse can reconcile a missing Workroom link after
executor identity is corrected, using only the recorded branch, commit and
session. Ambiguous or foreign links are refused; reconciliation never changes
the test verdict, expiry, lease or evidence contents.

## Approved adjacent delivery contract

Governed reviewer responses cut off at the output-token limit use at most two
in-turn continuations before the missing-receipt result is returned. Continuation
preserves the current tool surface and immutable writer binding; it does not
rotate a provider merely for truncation. Exhaustion reports the output budget,
not completed-prose noncompliance, and therefore does not enter automatic
prose-recovery replay. A writer already recorded or awaiting approval is not
called again. Receipt verification remains the completion authority.

[Pre-dispatch sensitive LLM routing](../superpowers/plans/2026-07-26-pre-dispatch-sensitive-llm-routing.md)
defines the implementation sequence for classifying governed payloads, evaluating
the data PDP/PEP, enforcing masking/tokenization obligations, constraining provider
eligibility, preserving constraints through fallback, and authorizing response
rehydration. It landed through PR #3602. Delivery progress must still be read from
its backlog items and implementation evidence; a merged plan is not evidence that
every planned behavior is already live.

## Proposed architecture

| Artifact | Status and purpose |
| --- | --- |
| [Task-aware inference routing](../superpowers/specs/2026-10-11-task-aware-inference-routing-design.md) | Draft source-grounded review and delivery plan for task readiness, prompt scope, constraint explanations, cloud capacity, admission and owner visibility. Live backlog reconciliation and scoped decisions remain pending; no runtime behavior changes are delivered by this document. |
| [AI Routing Architecture & Explainability](../superpowers/specs/2026-07-26-ai-routing-architecture-explainability-design.md) | Architecture authority. The deterministic Designed projection is implemented; Observed/Compare evidence, technical drill-through, and the completed owner-facing Operations Map remain later child BIs. |
| [Routing Control Plane / Data Plane](../superpowers/specs/2026-04-27-routing-control-data-plane-design.md) | Proposed and deferred RIB/FIB target state; not the current per-request routing runtime |

## Historical records

[Routing architecture dated snapshot](../superpowers/specs/2026-04-20-routing-architecture-current.md)
records the platform's 2026-04-20 understanding. Earlier routing designs that point
to that file remain historical context as well.

## Provider and model pin semantics

The verified current behavior is:

1. Seed and first-run bootstrap leave agent provider/model pins empty.
2. A persisted pin is mapped to a preferred provider/model for routed inference.
3. Routing first constructs the candidate set and applies hard exclusions.
4. The preference may replace the cost/quality winner only with a non-excluded
   candidate.
5. An excluded or unavailable preference target produces a warning and falls back
   to the normal V2 winner.
6. Startup audits non-null pins because they are intentional exceptions to dynamic
   routing.

A live query on 2026-07-26 found 24 `AgentModelConfig` rows, 0 provider pins, and
0 model pins in the current install. This is time-bounded operational evidence, not
a fleet invariant.

## Planned one-picture experience

The target experience uses one stable route geometry:

- **Designed** shows the governed route that should be available.
- **Observed** overlays privacy-safe evidence for a selected time window.
- **Compare** exposes missing evidence, unexpected paths, stale design, and
  attribution gaps.

New routed traffic carries one privacy-safe `traceId` across the existing decision,
adapter, outcome, and usage ledgers. Conversation IDs remain attribution; historic
rows without a trace or design revision remain visible as coverage gaps and are not
joined heuristically.

The owner view uses plain-language subway stations. BPMN, SysML, ArchiMate/C4,
source versions, rule detail, and remediation appear through progressive
drill-through rather than competing diagrams.


## Exact saved-answer feedback

The [exact-response design](../superpowers/specs/2026-10-31-exact-response-routing-feedback-design.md)
and [operator workflow](../user-guide/ai-workforce/model-routing-lifecycle.md#investigate-routing-and-record-feedback)
share one domain in `apps/web/lib/routing/response-feedback.ts`. Browser actions,
the existing work-thread MCP pack and authorized surfaces recheck current actor,
conversation ownership, Workroom admission, exact producer and saved content.
The browser save-envelope helper belongs in
`apps/web/lib/actions/coworker-response-persistence.ts`; its failure presentation
uses the allowed actions-to-build dependency.

Owned data-architecture decision DI-DF76FEA979F7 preserves one indexed soft
telemetry reference so capture failure and 180-day telemetry removal do not
control answer delivery. The exception names only AgentMessage.responseAttemptId
and retains the existing baseline owner and expiry. Human acceptance, coworker
judgment, execution evidence, evaluated quality and cost coverage remain distinct;
the platform does not infer missing attribution or scores.
