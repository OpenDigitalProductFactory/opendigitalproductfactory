import type {
  ProviderCapacityClassification,
  ProviderCapacityClassifierInput,
} from "./types";

type ZaiErrorBody = {
  error?: {
    code?: string | number;
    message?: string;
    next_flush_time?: string | number;
  };
};

function parseBody(bodyText: string | undefined): ZaiErrorBody | null {
  if (!bodyText) return null;
  try {
    return JSON.parse(bodyText) as ZaiErrorBody;
  } catch {
    return null;
  }
}

function parseRetryAt(value: string | number | undefined): Date | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") {
    const ms = value > 10_000_000_000 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function classifyZaiCapacity(
  input: ProviderCapacityClassifierInput,
): ProviderCapacityClassification | null {
  const parsed = parseBody(input.bodyText);
  const code = parsed?.error?.code !== undefined ? String(parsed.error.code) : undefined;
  if (!code) return null;

  if (code === "1113") {
    return {
      state: "billing_action_required",
      action: "add_credits_or_plan",
      providerCode: code,
      safeSummary: "Z.ai needs coding credits or a resource package before this request can run.",
      confidence: "exact",
      isHumanActionRequired: true,
    };
  }

  const retryAt = parseRetryAt(parsed?.error?.next_flush_time);
  if (retryAt) {
    return {
      state: "quota_resets_at",
      action: "retry_at",
      retryAt,
      retryAfterSeconds: Math.max(0, Math.ceil((retryAt.getTime() - input.now.getTime()) / 1000)),
      providerCode: code,
      safeSummary: "Z.ai quota is temporarily exhausted. DPF will retry when the quota refreshes.",
      confidence: "exact",
      isHumanActionRequired: false,
    };
  }

  return null;
}
