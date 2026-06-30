export type ProviderCapacityState =
  | "available"
  | "cooling_down"
  | "quota_resets_at"
  | "rate_limited"
  | "billing_action_required"
  | "reauth_required"
  | "unsupported_plan"
  | "request_too_large"
  | "provider_degraded"
  | "unknown";

export type ProviderCapacityAction =
  | "retry_at"
  | "retry_with_backoff"
  | "switch_provider"
  | "reduce_request"
  | "reconnect"
  | "add_credits_or_plan"
  | "change_plan_or_model"
  | "contact_provider"
  | "none";

export type ProviderCapacityConfidence = "exact" | "header" | "heuristic" | "unknown";

export type ProviderCapacityClassifierInput = {
  providerId: string;
  statusCode?: number;
  headers?: Headers | Record<string, string | string[] | undefined>;
  bodyText?: string;
  errorMessage?: string;
  now: Date;
};

export type ProviderCapacityClassification = {
  state: ProviderCapacityState;
  action: ProviderCapacityAction;
  retryAt?: Date;
  retryAfterSeconds?: number;
  providerCode?: string;
  safeSummary: string;
  confidence: ProviderCapacityConfidence;
  isHumanActionRequired: boolean;
};
