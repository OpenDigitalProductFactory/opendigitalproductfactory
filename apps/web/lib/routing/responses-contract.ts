/** Shared endpoint contract for inference and provider readiness. */
export function isChatGptBackend(providerId: string, baseUrl: string): boolean {
  return providerId === "chatgpt" || baseUrl.includes("chatgpt.com/backend-api");
}

export function buildResponsesUrl(providerId: string, baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  if (isChatGptBackend(providerId, base)) return `${base}/codex/responses`;
  return `${base.endsWith("/v1") ? base : `${base}/v1`}/responses`;
}
