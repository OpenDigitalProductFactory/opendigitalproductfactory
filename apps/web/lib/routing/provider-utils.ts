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

export function usesCodexCli(providerId: string): boolean {
  // Codex subscription OAuth tokens are NOT supported via direct HTTP calls to
  // chatgpt.com/backend-api — the backend requires session auth that only the
  // Codex CLI binary provides.  Route through `codex exec` in the sandbox
  // container (same pattern as anthropic-sub → claude -p).
  return providerId === "codex";
}

export function usesResponsesApi(providerId: string): boolean {
  // ChatGPT provider uses the Responses API via chatgpt.com/backend-api.
  // Codex is handled separately by the codex-cli adapter (see usesCodexCli).
  return providerId === "chatgpt";
}
