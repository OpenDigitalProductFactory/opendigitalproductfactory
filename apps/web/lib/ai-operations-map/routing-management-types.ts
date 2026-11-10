import type { ProviderRoutingControlView } from "@/lib/routing/provider-routing-control";
import type { SafeInferenceScreenReceipt } from "./routing-evidence-conformance";

export type RoutingHold = "policy" | "tokens" | "quota" | "payment" | "disabled" | "operator" | "capacity" | "authentication" | "other";
export const ROUTING_HOLD_LABEL: Record<RoutingHold, string> = {
  policy: "Data policy / clearance", tokens: "Token / context limit", quota: "Quota / cooldown",
  payment: "Payment required", disabled: "Disabled configuration", operator: "Operator pause",
  capacity: "Capacity evidence unavailable", authentication: "Sign-in required", other: "Other exclusion",
};
export type RoutingAttempt = {
  id: string; providerId: string; modelId: string; channel: string;
  status: string; startedAt: string; durationMs: number | null;
  estimatedCostUsd: number | null; inputTokens: number | null; outputTokens: number | null;
  agentMessageId?: string | null;
  feedback: boolean | null;
  feedbackSource?: "human" | "agent" | null;
  hold: RoutingHold | null;
};
export type RoutingReceipt = {
  id: string; occurredAt: string; actorId: string | null; task: string; sensitivity: string;
  providerId: string | null; modelId: string | null; endpointId: string;
  correlation: "exact" | "missing" | "ambiguous";
  screen: SafeInferenceScreenReceipt | null;
  exclusions: Array<{ providerId: string | null; modelId: string | null; hold: RoutingHold }>;
  attempts: RoutingAttempt[];
  execution: "success" | "error" | "blocked" | "pending" | "unknown";
  selectedExecution: RoutingReceipt["execution"];
  shadowMode: boolean;
  costUsd: number | null; tokens: number | null; costSource: "token-usage" | "route-outcome" | null;
  sourceIds: string[];
  recipeKey: string | null; evaluator: string | null;
  quality: number | null; // Only an exact decision-linked evaluator may populate this.
};
export type RoutingManagementData = {
  observedAt: string;
  receipts: RoutingReceipt[];
  models: Array<{ endpointId: string; providerId: string; modelId: string; label: string; status: string }>;
  controls: Array<{ providerId: string; view: ProviderRoutingControlView }>;
};
