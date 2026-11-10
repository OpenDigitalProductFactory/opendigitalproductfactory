/**
 * Account-aware Codex CLI model eligibility.
 *
 * The Codex provider can be authenticated either with an API key or with a
 * ChatGPT subscription. The CLI's model catalog is not identical across those
 * account modes, so a model that is valid for API-key traffic can be rejected
 * before inference for subscription traffic. Keep that distinction at the
 * endpoint-manifest boundary so ranking, dry-run previews, and runtime health
 * all consume the same eligibility decision.
 */

const CHATGPT_CODEX_UNSUPPORTED_MODELS = new Set(["gpt-5.3-codex"]);

export function codexSubscriptionModelExclusionReason(input: {
  providerId: string;
  authMethod: string;
  modelId: string;
}): string | null {
  if (input.providerId !== "codex") return null;
  if (input.authMethod !== "oauth2_authorization_code") return null;
  if (!CHATGPT_CODEX_UNSUPPORTED_MODELS.has(input.modelId)) return null;

  return `Model '${input.modelId}' is not supported when Codex uses a ChatGPT account; select a subscription-supported model such as 'gpt-5.4' or connect Codex with an API key`;
}
