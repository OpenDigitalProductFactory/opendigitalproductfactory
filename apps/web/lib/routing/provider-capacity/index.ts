import { parseRetryAfterSeconds } from "./headers";
import { classifyZaiCapacity } from "./zai";
import type {
  ProviderCapacityClassification,
  ProviderCapacityClassifierInput,
} from "./types";

export { parseRetryAfterSeconds } from "./headers";
export type {
  ProviderCapacityAction,
  ProviderCapacityClassification,
  ProviderCapacityClassifierInput,
  ProviderCapacityState,
} from "./types";

function retryAtFromSeconds(now: Date, seconds: number): Date {
  return new Date(now.getTime() + seconds * 1000);
}

function isZaiProvider(providerId: string): boolean {
  return providerId === "zai" || providerId === "zai-coding";
}

export function classifyProviderCapacity(
  input: ProviderCapacityClassifierInput,
): ProviderCapacityClassification {
  if (isZaiProvider(input.providerId)) {
    const zai = classifyZaiCapacity(input);
    if (zai) return zai;
  }

  const retryAfterSeconds = parseRetryAfterSeconds(input.headers, input.now);
  if (input.statusCode === 429 && retryAfterSeconds !== null) {
    return {
      state: "rate_limited",
      action: "retry_at",
      retryAt: retryAtFromSeconds(input.now, retryAfterSeconds),
      retryAfterSeconds,
      safeSummary: "The provider is temporarily rate limited. DPF will retry after the provider's reset time.",
      confidence: "header",
      isHumanActionRequired: false,
    };
  }

  if (input.statusCode === 429) {
    return {
      state: "rate_limited",
      action: "retry_with_backoff",
      safeSummary: "The provider is temporarily rate limited. DPF will retry with backoff.",
      confidence: "heuristic",
      isHumanActionRequired: false,
    };
  }

  if (input.statusCode === 401 || input.statusCode === 403) {
    return {
      state: "reauth_required",
      action: "reconnect",
      safeSummary: "The provider rejected the saved credential. Reconnect this provider to restore access.",
      confidence: "heuristic",
      isHumanActionRequired: true,
    };
  }

  if (input.statusCode === 402) {
    return {
      state: "billing_action_required",
      action: "add_credits_or_plan",
      safeSummary: "The provider account needs billing attention before this request can run.",
      confidence: "heuristic",
      isHumanActionRequired: true,
    };
  }

  if (input.statusCode === 413) {
    return {
      state: "request_too_large",
      action: "reduce_request",
      safeSummary: "The request is too large for this provider. Reduce or split the request.",
      confidence: "heuristic",
      isHumanActionRequired: false,
    };
  }

  return {
    state: "unknown",
    action: "none",
    safeSummary: "Provider capacity state is unknown.",
    confidence: "unknown",
    isHumanActionRequired: false,
  };
}
