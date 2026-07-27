// Versioned, architecture-safe registry for the governed AI-routing projection.
// This is the one design-stage source consumed by the BPMN, SysML, and ArchiMate
// projectors. It contains no prompt, customer, credential, or token-map content.

export { AI_ROUTING_ARCHITECTURE_VERSION } from "@/lib/routing/routing-architecture-version";
import { AI_ROUTING_ARCHITECTURE_VERSION } from "@/lib/routing/routing-architecture-version";

export type AiRoutingLane =
  | "request"
  | "data-governance"
  | "routing"
  | "provider-adapter"
  | "response-authorization";

export type AiRoutingSourceStatus = "implemented" | "partial" | "proposed";

export type AiRoutingSource = {
  path: string;
  symbol?: string;
  version: string;
  status: AiRoutingSourceStatus;
};

export type AiRoutingStage = {
  id: string;
  ownerLabel: string;
  technicalName: string;
  lane: AiRoutingLane;
  bpmnTypeSlug:
    | "bpmn_start_event"
    | "bpmn_end_event"
    | "bpmn_user_task"
    | "bpmn_service_task"
    | "bpmn_business_rule_task"
    | "bpmn_exclusive_gateway";
  source: AiRoutingSource;
};

export type AiRoutingFlow = {
  from: string;
  to: string;
  relSlug: "sequence_flow" | "conditional_flow" | "default_flow";
  conditionCode?: string;
  ownerLabel?: string;
};

export const IMPLEMENTED = (
  path: string,
  symbol?: string,
): AiRoutingSource => ({
  path,
  symbol,
  version: AI_ROUTING_ARCHITECTURE_VERSION,
  status: "implemented",
});

export const PARTIAL = (
  path: string,
  symbol?: string,
): AiRoutingSource => ({
  path,
  symbol,
  version: AI_ROUTING_ARCHITECTURE_VERSION,
  status: "partial",
});

export const PROPOSED_SENSITIVE_ROUTING = (
  symbol?: string,
): AiRoutingSource => ({
  path: "docs/superpowers/plans/2026-07-26-pre-dispatch-sensitive-llm-routing.md",
  symbol,
  version: AI_ROUTING_ARCHITECTURE_VERSION,
  status: "proposed",
});

export const AI_ROUTING_STAGES: readonly AiRoutingStage[] = [
  {
    id: "request",
    ownerLabel: "Work asks for AI help",
    technicalName: "Routed inference entry",
    lane: "request",
    bpmnTypeSlug: "bpmn_start_event",
    source: IMPLEMENTED("apps/web/lib/inference/routed-inference.ts", "routeAndCall"),
  },
  {
    id: "assemble-payload",
    ownerLabel: "Assemble the work context",
    technicalName: "Prompt and tool payload assembly",
    lane: "request",
    bpmnTypeSlug: "bpmn_service_task",
    source: IMPLEMENTED("apps/web/lib/inference/routed-inference.ts", "prepareRoute"),
  },
  {
    id: "sensitive-screen",
    ownerLabel: "What work and data are involved?",
    technicalName: "Pre-dispatch sensitive-data screen",
    lane: "data-governance",
    bpmnTypeSlug: "bpmn_business_rule_task",
    source: PARTIAL(
      "apps/web/lib/inference/data-screening/classify-payload.ts",
      "classifyInferencePayload",
    ),
  },
  {
    id: "resolve-governed-context",
    ownerLabel: "Resolve purpose, actor, and governed assets",
    technicalName: "Governed activity-context resolution",
    lane: "data-governance",
    bpmnTypeSlug: "bpmn_service_task",
    source: PROPOSED_SENSITIVE_ROUTING("InferenceDataScreenInput"),
  },
  {
    id: "data-policy-decision",
    ownerLabel: "May this data cross the chosen boundary?",
    technicalName: "Data PDP evaluation",
    lane: "data-governance",
    bpmnTypeSlug: "bpmn_business_rule_task",
    source: PARTIAL("apps/web/lib/govern/data/policy-decision.ts", "evaluateDataPolicy"),
  },
  {
    id: "data-policy-gateway",
    ownerLabel: "What did data policy decide?",
    technicalName: "Allow, protect, review, or deny gateway",
    lane: "data-governance",
    bpmnTypeSlug: "bpmn_exclusive_gateway",
    source: PARTIAL(
      "apps/web/lib/inference/data-screening/evaluate-inference-policy.ts",
      "evaluateInferenceDispatchPolicy",
    ),
  },
  {
    id: "protect-payload",
    ownerLabel: "Omit, mask, tokenize, or aggregate",
    technicalName: "Mask-before-dispatch transform",
    lane: "data-governance",
    bpmnTypeSlug: "bpmn_service_task",
    source: PROPOSED_SENSITIVE_ROUTING("Masking And Rehydration"),
  },
  {
    id: "local-review-or-stop",
    ownerLabel: "Keep it local, request approval, defer, or stop",
    technicalName: "Fail-closed handling",
    lane: "data-governance",
    bpmnTypeSlug: "bpmn_user_task",
    source: PROPOSED_SENSITIVE_ROUTING("Product Shape"),
  },
  {
    id: "compile-request-contract",
    ownerLabel: "Build the allowed route set",
    technicalName: "RequestContract compilation",
    lane: "routing",
    bpmnTypeSlug: "bpmn_service_task",
    source: PARTIAL("apps/web/lib/routing/request-contract.ts", "inferContract"),
  },
  {
    id: "route-eligibility",
    ownerLabel: "Which routes can actually do the work?",
    technicalName: "Hard eligibility filters",
    lane: "routing",
    bpmnTypeSlug: "bpmn_business_rule_task",
    source: PARTIAL("apps/web/lib/routing/pipeline-v2.ts", "getExclusionReasonV2"),
  },
  {
    id: "eligible-route-gateway",
    ownerLabel: "Is any route eligible?",
    technicalName: "Eligible-set gateway",
    lane: "routing",
    bpmnTypeSlug: "bpmn_exclusive_gateway",
    source: IMPLEMENTED("apps/web/lib/routing/pipeline-v2.ts", "routeEndpointV2"),
  },
  {
    id: "availability-and-limits",
    ownerLabel: "Which routes are available within current limits?",
    technicalName: "Capacity, cooldown, and quota evaluation",
    lane: "routing",
    bpmnTypeSlug: "bpmn_business_rule_task",
    source: IMPLEMENTED(
      "apps/web/lib/routing/capacity-routing-exclude.ts",
      "applyCapacitySoftExclusion",
    ),
  },
  {
    id: "availability-gateway",
    ownerLabel: "Is the preferred route currently available?",
    technicalName: "Availability and limit gateway",
    lane: "routing",
    bpmnTypeSlug: "bpmn_exclusive_gateway",
    source: IMPLEMENTED("apps/web/lib/routing/capacity-routing-exclude.ts"),
  },
  {
    id: "eligible-fallback",
    ownerLabel: "Find an eligible fallback, defer, or stop",
    technicalName: "Governed fallback selection",
    lane: "routing",
    bpmnTypeSlug: "bpmn_service_task",
    source: PARTIAL("apps/web/lib/routing/fallback.ts", "buildFallbackPlan"),
  },
  {
    id: "fallback-gateway",
    ownerLabel: "Is an eligible fallback available?",
    technicalName: "Fallback availability gateway",
    lane: "routing",
    bpmnTypeSlug: "bpmn_exclusive_gateway",
    source: PARTIAL("apps/web/lib/routing/fallback.ts", "callWithFallbackChain"),
  },
  {
    id: "rank-quality-time-cost",
    ownerLabel: "Balance quality, time, and cost",
    technicalName: "Eligible-set ranking",
    lane: "routing",
    bpmnTypeSlug: "bpmn_service_task",
    source: IMPLEMENTED("apps/web/lib/routing/pipeline-v2.ts", "routeEndpointV2"),
  },
  {
    id: "dispatch",
    ownerLabel: "Dispatch through the selected adapter",
    technicalName: "Inference adapter invocation",
    lane: "provider-adapter",
    bpmnTypeSlug: "bpmn_service_task",
    source: IMPLEMENTED("apps/web/lib/inference/ai-inference.ts", "callProvider"),
  },
  {
    id: "record-safe-receipt",
    ownerLabel: "Record a privacy-safe decision and outcome",
    technicalName: "Route, adapter, outcome, token, and screen evidence",
    lane: "provider-adapter",
    bpmnTypeSlug: "bpmn_service_task",
    source: PARTIAL("apps/web/lib/inference/routed-inference.ts", "routeAndCall"),
  },
  {
    id: "rehydration-gateway",
    ownerLabel: "May protected values be restored here?",
    technicalName: "Fresh response-rehydration authorization",
    lane: "response-authorization",
    bpmnTypeSlug: "bpmn_exclusive_gateway",
    source: PROPOSED_SENSITIVE_ROUTING("Masking And Rehydration"),
  },
  {
    id: "return-masked-response",
    ownerLabel: "Return a masked answer and explanation",
    technicalName: "Protected response",
    lane: "response-authorization",
    bpmnTypeSlug: "bpmn_end_event",
    source: PROPOSED_SENSITIVE_ROUTING("Masking And Rehydration"),
  },
  {
    id: "return-authorized-response",
    ownerLabel: "Return the authorized answer",
    technicalName: "Authorized response delivery",
    lane: "response-authorization",
    bpmnTypeSlug: "bpmn_end_event",
    source: PROPOSED_SENSITIVE_ROUTING("Masking And Rehydration"),
  },
];

export const AI_ROUTING_FLOWS: readonly AiRoutingFlow[] = [
  { from: "request", to: "assemble-payload", relSlug: "sequence_flow" },
  { from: "assemble-payload", to: "sensitive-screen", relSlug: "sequence_flow" },
  { from: "sensitive-screen", to: "resolve-governed-context", relSlug: "sequence_flow" },
  { from: "resolve-governed-context", to: "data-policy-decision", relSlug: "sequence_flow" },
  { from: "data-policy-decision", to: "data-policy-gateway", relSlug: "sequence_flow" },
  {
    from: "data-policy-gateway",
    to: "protect-payload",
    relSlug: "conditional_flow",
    conditionCode: "allow-with-obligations",
    ownerLabel: "Allowed after protection",
  },
  {
    from: "data-policy-gateway",
    to: "local-review-or-stop",
    relSlug: "conditional_flow",
    conditionCode: "deny-or-review",
    ownerLabel: "Not allowed to cross this boundary",
  },
  {
    from: "data-policy-gateway",
    to: "compile-request-contract",
    relSlug: "default_flow",
    conditionCode: "allow",
    ownerLabel: "Allowed without transformation",
  },
  { from: "protect-payload", to: "compile-request-contract", relSlug: "sequence_flow" },
  { from: "compile-request-contract", to: "route-eligibility", relSlug: "sequence_flow" },
  { from: "route-eligibility", to: "eligible-route-gateway", relSlug: "sequence_flow" },
  {
    from: "eligible-route-gateway",
    to: "local-review-or-stop",
    relSlug: "conditional_flow",
    conditionCode: "no-eligible-route",
    ownerLabel: "No route satisfies every hard constraint",
  },
  {
    from: "eligible-route-gateway",
    to: "availability-and-limits",
    relSlug: "default_flow",
    conditionCode: "eligible-route-exists",
    ownerLabel: "At least one route is eligible",
  },
  { from: "availability-and-limits", to: "availability-gateway", relSlug: "sequence_flow" },
  {
    from: "availability-gateway",
    to: "eligible-fallback",
    relSlug: "conditional_flow",
    conditionCode: "temporarily-unavailable-or-limited",
    ownerLabel: "Preferred route is unavailable or at a limit",
  },
  {
    from: "availability-gateway",
    to: "rank-quality-time-cost",
    relSlug: "default_flow",
    conditionCode: "available",
    ownerLabel: "Eligible routes are available",
  },
  { from: "eligible-fallback", to: "fallback-gateway", relSlug: "sequence_flow" },
  {
    from: "fallback-gateway",
    to: "local-review-or-stop",
    relSlug: "conditional_flow",
    conditionCode: "no-eligible-fallback",
    ownerLabel: "No fallback preserves the route obligations",
  },
  {
    from: "fallback-gateway",
    to: "rank-quality-time-cost",
    relSlug: "default_flow",
    conditionCode: "eligible-fallback-available",
    ownerLabel: "An obligation-preserving fallback is available",
  },
  { from: "rank-quality-time-cost", to: "dispatch", relSlug: "sequence_flow" },
  { from: "dispatch", to: "record-safe-receipt", relSlug: "sequence_flow" },
  { from: "record-safe-receipt", to: "rehydration-gateway", relSlug: "sequence_flow" },
  { from: "local-review-or-stop", to: "return-masked-response", relSlug: "sequence_flow" },
  {
    from: "rehydration-gateway",
    to: "return-masked-response",
    relSlug: "conditional_flow",
    conditionCode: "rehydration-not-authorized",
    ownerLabel: "The receiving actor or surface is not authorized",
  },
  {
    from: "rehydration-gateway",
    to: "return-authorized-response",
    relSlug: "default_flow",
    conditionCode: "rehydration-authorized",
    ownerLabel: "Fresh authorization permits restoration",
  },
];

export const LANE_LABELS: ReadonlyArray<{ key: AiRoutingLane; label: string }> = [
  { key: "request", label: "Work request" },
  { key: "data-governance", label: "Data governance" },
  { key: "routing", label: "Route selection" },
  { key: "provider-adapter", label: "Provider adapter" },
  { key: "response-authorization", label: "Response authorization" },
];

export const BPMN_KEY = (suffix: string) => `ai-routing:bpmn:${suffix}`;
export const ARCH_KEY = (suffix: string) => `ai-routing:arch:${suffix}`;
export const SYSML_KEY = (suffix: string) => `sysml:aic:${suffix}`;

export function sourceKey(source: AiRoutingSource): string {
  return source.symbol ? `${source.path}#${source.symbol}` : source.path;
}
