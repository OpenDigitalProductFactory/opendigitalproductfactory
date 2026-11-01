import type {
  ProviderCapacityClassification,
  ProviderCapacityClassifierInput,
} from "./types";

type AnthropicErrorBody = { error?: { type?: string; message?: string } };

/**
 * Anthropic reports an exhausted workspace spend limit as HTTP 400
 * invalid_request_error, not 429, with the reset time only in prose:
 * "You have reached your specified API usage limits. You will regain access on
 * 2026-11-01 at 00:00 UTC." Left unclassified it reads as a generic provider
 * error, so routing kept selecting the provider for every call until the reset.
 */
const USAGE_LIMIT_RE = /reached your specified API usage limits/i;
const REGAIN_ACCESS_RE = /regain access on (\d{4}-\d{2}-\d{2}) at (\d{2}):(\d{2}) UTC/i;

function readMessage(bodyText: string | undefined): string | null {
  if (!bodyText) return null;
  try {
    const parsed = JSON.parse(bodyText) as AnthropicErrorBody;
    return typeof parsed?.error?.message === "string" ? parsed.error.message : null;
  } catch {
    return bodyText;
  }
}

function parseRegainAccessAt(message: string): Date | undefined {
  const match = REGAIN_ACCESS_RE.exec(message);
  if (!match) return undefined;
  const date = new Date(`${match[1]}T${match[2]}:${match[3]}:00.000Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function isAnthropicProvider(providerId: string): boolean {
  return providerId === "anthropic" || providerId.startsWith("anthropic-");
}

export function classifyAnthropicCapacity(
  input: ProviderCapacityClassifierInput,
): ProviderCapacityClassification | null {
  const message = readMessage(input.bodyText) ?? input.errorMessage ?? null;
  if (!message || !USAGE_LIMIT_RE.test(message)) return null;
  const retryAt = parseRegainAccessAt(message);
  const safeSummary =
    "The provider account's usage limit is reached. DPF routes to other providers and retries when the provider says access returns; " +
    "raising the limit in the provider console restores it sooner.";
  if (!retryAt) {
    return { state: "rate_limited", action: "switch_provider", safeSummary, confidence: "heuristic", isHumanActionRequired: false };
  }
  return {
    state: "quota_resets_at",
    action: "retry_at",
    retryAt,
    retryAfterSeconds: Math.max(0, Math.ceil((retryAt.getTime() - input.now.getTime()) / 1000)),
    safeSummary,
    confidence: "exact",
    isHumanActionRequired: false,
  };
}
