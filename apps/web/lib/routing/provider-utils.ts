// apps/web/lib/routing/provider-utils.ts

/**
 * EP-INF-008a: Shared provider ID helpers.
 * Extracted from recipe-seeder.ts for use across routing modules.
 */

export function isAnthropic(providerId: string): boolean {
  return providerId === "anthropic" || providerId.startsWith("anthropic-");
}

export function isOpenAI(providerId: string): boolean {
  return providerId === "openai" || providerId.startsWith("openai-");
}

export function usesCliAdapter(providerId: string): boolean {
  // anthropic-sub uses Claude Code CLI instead of direct HTTP to /v1/messages.
  // OAuth tokens are not supported on the direct Messages API — the CLI routes
  // through Anthropic's subscription infrastructure with generous rate limits.
  return providerId === "anthropic-sub";
}

export function usesResponsesApi(providerId: string): boolean {
  // Both codex and chatgpt require the Responses API.
  // Codex models (gpt-5.3-codex, gpt-5.4, codex-mini) are Responses-only — Chat Completions
  // is deprecated for these models per OpenAI docs.
  // OAuth auth → chatgpt.com/backend-api (SSE streaming).
  // API key auth → api.openai.com/v1/responses (JSON response).
  return providerId === "codex" || providerId === "chatgpt";
}
