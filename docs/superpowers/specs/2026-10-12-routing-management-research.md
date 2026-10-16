---
status: active
---

# Routing management research — BI-2BBD9D34

The operator reviewed the clickable prototype and asked to deliver its consolidated navigation and investigation model. Founder-funded direction is 80% refactoring and usability simplification, 20% necessary additions. This replaces the earlier 20% allocation in the conversation; these are investment targets, not literal token quotas.

## Problem and choice

The current Operations Map places architecture maturity, topology filters, replay, activity evidence and diagnostic controls ahead of the operator's immediate questions: where did work go, why, did it work, what stopped it, and what did it cost? Provider settings are a separate destination and investigation loses context. The chosen composition makes Traffic and Evaluation views of the same routing workspace, with contextual links to the existing provider catalog and details. Decision investigation opens an overlay. Technical architecture and A2A remain available through disclosure.

Alternatives considered: keep adding cards and controls to the current map; create a separate dashboard with duplicated provider settings; or consolidate the existing surface and preserve authoritative actions. The third approach is operator-approved and recommended by platform decision DI-8B2807DF98EC. It reduces duplicated state and keeps one home for overrides.

## Industry research

- [LiteLLM routing](https://docs.litellm.ai/docs/routing): distinguish model groups, deployment targets, retries, cooldown and fallback. Adopt separate attempt and exclusion evidence; do not adopt an additional configuration language or engine.
- [Portkey routing](https://portkey.ai/docs/product/ai-gateway): conditional and fallback strategies make the selected path explainable. Adopt progressive decision inspection; avoid exposing raw configuration as the default operator UX.
- [OpenRouter provider routing](https://openrouter.ai/docs/features/provider-routing): provider selection includes price and provider policy constraints. Adopt cost and eligibility context; do not assume all channels of a provider have identical data policy.
- [TrueFoundry routing](https://www.truefoundry.com/blog/llm-router): routing has several objectives, including cost and task suitability. Adopt task/model evaluation cohorts; vendor savings claims are not DPF measurements.
- User-supplied blogs and Reddit were discovery leads. Timestamped YouTube pages were inaccessible and were not reviewed. The reference diagram is conceptual inspiration, not platform instructions.

## Existing DPF substrate

Reviewed source at 4f5def81786cd51816eb880740049a8a629b1faa: load-map-data, routing-evidence-conformance, project-activity-outcomes, ActivityRoutingWorkbench, OperationsMapLiveShell, AiOperationsMap, PlatformTabNav, report-kit, ProviderRoutingControlPanel, ProviderClearanceOverridePanel and AgentModelRoutingCard. The July routing explainability design and August owner-first cockpit plan supply the existing evidence/privacy model. RouteDecisionLog, AdapterRunTelemetry, RouteOutcome, TokenUsage, ModelProfile and activity harness projections remain canonical. No new ledger, routing engine or policy editor is proposed.

Privacy: reconstruct safe DTOs at the server boundary. Never send candidate trace objects, prompts, detected values, secrets, raw account details or adapter payloads to the client. Join attempts only by an exact nonempty trace; ambiguous or absent correlation is explicit. Deduplicate usage attribution across attempts and show coverage. Model catalog entries come from ModelProfile, not only models observed in traffic. Evaluation quality and operator feedback are separate, and unavailable fields remain unavailable.

## Preserved ownership

BI-E2BDE90B already delivered provider restrictions and timed operator pauses. Reuse it. BI-7AA4EB6B / WC-DF238BD5 owns provider account UX; provider write forms are out of this edit scope. Provider sensitivity overrides retain rationale, risk acknowledgement, sensitivity scope, expiry, revoke and permission behavior. Coworker pins remain in assignment controls. The routing workspace links to these owners while preserving provider/task/data/time context.

The preserved prototype under docs/ux-fit/2026-10-12-routing-management/routing-explorer.html is illustrative, with fictional traffic and memory-only actions. It is a review artifact, not evidence of live deployment or benchmark performance.
