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

export function usesResponsesApi(providerId: string): boolean {
  // Both codex and chatgpt use the Responses API via chatgpt.com/backend-api.
  // This routes through the ChatGPT subscription (flat-rate billing) rather
  // than the per-token API. The SSE parser now captures function call events.
  return providerId === "codex" || providerId === "chatgpt";
}
