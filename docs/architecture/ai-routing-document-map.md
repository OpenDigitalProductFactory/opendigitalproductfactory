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
| How is the designed route projected into EA? | `apps/web/lib/ea/ai-routing-architecture-registry.ts`, `apps/web/lib/ea/ai-routing-architecture-extract.ts`, and `apps/web/lib/ea/reconcile-ai-routing-architecture.ts`; one versioned registry projects synchronized BPMN, SysML, and ArchiMate model kinds |
| What happened operationally? | Route decisions, adapter attempts, inference outcomes, token usage, capacity state, and safe screen/suitability receipts in the live install, correlated by request-scoped `traceId` for new traffic |

Current implementation truth comes from code plus live evidence. A diagram, design
document, or seeded row does not override those sources.

## Approved adjacent delivery contract

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
