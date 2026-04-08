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
  // Only chatgpt uses the Responses API (chatgpt.com/backend-api).
  // Codex uses api.openai.com/v1 which supports standard Chat Completions
  // with tool use — the same format as GPT-4o. Routing codex through the
  // Responses API caused empty responses because the SSE event parser
  // didn't capture function call events from the ChatGPT backend.
  return providerId === "chatgpt";
}
