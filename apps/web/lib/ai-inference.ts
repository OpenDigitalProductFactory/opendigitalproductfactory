// apps/web/lib/ai-inference.ts
// Shared inference module — plain server-only module (NOT "use server").
// Server actions in actions/*.ts can import from here freely.

import { prisma } from "@dpf/db";
import { decryptSecret } from "@/lib/credential-crypto";
import { computeTokenCost, computeComputeCost } from "@/lib/ai-provider-types";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type InferenceResult = {
  content: string;
  inputTokens: number;
  outputTokens: number;
  inferenceMs: number;
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
};

// ─── Error Types ─────────────────────────────────────────────────────────────

export class InferenceError extends Error {
  constructor(
    message: string,
    public readonly code: "network" | "auth" | "rate_limit" | "model_not_found" | "provider_error",
    public readonly providerId: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = "InferenceError";
  }
}

function classifyHttpError(status: number, providerId: string, body: string): InferenceError {
  if (status === 401 || status === 403) {
    return new InferenceError(`Auth failed for ${providerId}: ${body.slice(0, 200)}`, "auth", providerId, status);
  }
  if (status === 429) {
    return new InferenceError(`Rate limited by ${providerId}`, "rate_limit", providerId, status);
  }
  if (status === 404) {
    return new InferenceError(`Model not found on ${providerId}: ${body.slice(0, 200)}`, "model_not_found", providerId, status);
  }
  return new InferenceError(`HTTP ${status} from ${providerId}: ${body.slice(0, 200)}`, "provider_error", providerId, status);
}

// ─── Auth Helpers (extracted from actions/ai-providers.ts) ───────────────────

export async function getDecryptedCredential(providerId: string) {
  const cred = await prisma.credentialEntry.findUnique({ where: { providerId } });
  if (!cred) return null;
  return {
    ...cred,
    secretRef:    cred.secretRef    ? decryptSecret(cred.secretRef)    : null,
    clientSecret: cred.clientSecret ? decryptSecret(cred.clientSecret) : null,
  };
}

function isAnthropicProvider(providerId: string): boolean {
  return providerId === "anthropic" || providerId.startsWith("anthropic-");
}

export function getProviderExtraHeaders(providerId: string): Record<string, string> {
  if (isAnthropicProvider(providerId)) return { "anthropic-version": "2023-06-01" };
  return {};
}

/** Detect if an Anthropic key is a subscription OAuth token (from `claude setup-token`) */
export function isAnthropicOAuthToken(apiKey: string): boolean {
  return apiKey.includes("sk-ant-oat");
}

/** Beta headers required for Anthropic subscription token auth */
export const ANTHROPIC_OAUTH_BETA_HEADERS = "claude-code-20250219,oauth-2025-04-20";

export async function getProviderBearerToken(providerId: string): Promise<{ token: string } | { error: string }> {
  const credential = await getDecryptedCredential(providerId);
  if (!credential) return { error: "No credential configured" };
  if (!credential.clientId || !credential.clientSecret || !credential.tokenEndpoint) {
    return { error: "OAuth credentials incomplete — need client ID, secret, and token endpoint" };
  }

  // Return cached token if still valid (5-minute buffer)
  if (credential.cachedToken && credential.tokenExpiresAt) {
    const buffer = 5 * 60 * 1000;
    if (credential.tokenExpiresAt.getTime() > Date.now() + buffer) {
      return { token: credential.cachedToken };
    }
  }

  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: credential.clientId,
    client_secret: credential.clientSecret,
    ...(credential.scope ? { scope: credential.scope } : {}),
  });

  try {
    const res = await fetch(credential.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { error: `Token exchange failed: HTTP ${res.status}` };

    const body = await res.json() as { access_token: string; expires_in: number };
    const expiresAt = new Date(Date.now() + body.expires_in * 1000);

    await prisma.credentialEntry.update({
      where: { providerId },
      data: { cachedToken: body.access_token, tokenExpiresAt: expiresAt, status: "ok" },
    });

    return { token: body.access_token };
  } catch (e) {
    return { error: `Token exchange error: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ─── Build Auth Headers ──────────────────────────────────────────────────────

async function buildAuthHeaders(
  providerId: string,
  authMethod: string | null,
  authHeader: string | null,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...getProviderExtraHeaders(providerId),
  };

  if (authMethod === "api_key") {
    const cred = await getDecryptedCredential(providerId);
    if (!cred?.secretRef || !authHeader) throw new InferenceError("No credential configured", "auth", providerId);

    // Anthropic subscription tokens (from `claude setup-token`) use Bearer auth, not x-api-key
    if (isAnthropicProvider(providerId) && isAnthropicOAuthToken(cred.secretRef)) {
      headers["Authorization"] = `Bearer ${cred.secretRef}`;
      headers["anthropic-beta"] = ANTHROPIC_OAUTH_BETA_HEADERS;
    } else {
      headers[authHeader] = authHeader === "Authorization" ? `Bearer ${cred.secretRef}` : cred.secretRef;
    }
  } else if (authMethod === "oauth2_client_credentials") {
    const tokenResult = await getProviderBearerToken(providerId);
    if ("error" in tokenResult) throw new InferenceError(tokenResult.error, "auth", providerId);
    headers["Authorization"] = `Bearer ${tokenResult.token}`;
  }
  // "none" auth (e.g., local Ollama) — no auth headers needed

  return headers;
}

// ─── callProvider ────────────────────────────────────────────────────────────

export async function callProvider(
  providerId: string,
  modelId: string,
  messages: ChatMessage[],
  systemPrompt: string,
  tools?: Array<Record<string, unknown>>,
): Promise<InferenceResult> {
  const provider = await prisma.modelProvider.findUnique({ where: { providerId } });
  if (!provider) throw new InferenceError("Provider not found", "provider_error", providerId);

  const baseUrl = provider.baseUrl ?? provider.endpoint;
  if (!baseUrl) throw new InferenceError("No base URL configured", "provider_error", providerId);

  const headers = await buildAuthHeaders(providerId, provider.authMethod, provider.authHeader);

  // Build provider-specific request
  let chatUrl: string;
  let body: Record<string, unknown>;
  let extractText: (data: Record<string, unknown>) => string;

  if (providerId === "anthropic" || providerId.startsWith("anthropic-")) {
    // Anthropic (including anthropic-sub): system prompt is a separate param
    chatUrl = `${baseUrl}/messages`;
    body = {
      model: modelId,
      max_tokens: 4096,
      system: systemPrompt,
      messages: messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content })),
    };
    extractText = (d) => (d.content as Array<{ text?: string }>)?.[0]?.text ?? "";
  } else if (providerId === "gemini") {
    // Gemini: system as first user content, then alternating user/model turns
    chatUrl = `${baseUrl}/models/${modelId}:generateContent`;
    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
    if (systemPrompt) {
      contents.push({ role: "user", parts: [{ text: systemPrompt }] });
      contents.push({ role: "model", parts: [{ text: "Understood. I will follow these instructions." }] });
    }
    for (const m of messages) {
      contents.push({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] });
    }
    body = { contents };
    extractText = (d) => {
      const candidates = d.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined;
      return candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    };
  } else {
    // OpenAI-compatible: system prompt prepended to messages array
    // Covers: openai, azure-openai, ollama, groq, together, fireworks, xai, mistral, cohere (v2), deepseek, openrouter, litellm, portkey, martian
    const apiBase = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
    chatUrl = `${apiBase}/chat/completions`;
    const allMessages = [
      { role: "system" as const, content: systemPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];
    body = { model: modelId, messages: allMessages, max_tokens: 4096, keep_alive: -1 };
    if (tools && tools.length > 0) {
      body.tools = tools;
    }
    extractText = (d) => {
      const msg = (d.choices as Array<{ message?: { content?: string; reasoning?: string; tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }>)?.[0]?.message;
      // Some models (qwen3) use chain-of-thought: content has the answer, reasoning has the thinking
      // If content is empty but reasoning exists, the model may not have finished thinking within token limit
      return msg?.content || msg?.reasoning || "";
    };
  }

  const startMs = Date.now();
  let res: Response;
  try {
    res = await fetch(chatUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000), // 3min — local models need time to load on first call
    });
  } catch (e) {
    throw new InferenceError(
      `Network error calling ${providerId}: ${e instanceof Error ? e.message : String(e)}`,
      "network",
      providerId,
    );
  }
  const inferenceMs = Date.now() - startMs;

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw classifyHttpError(res.status, providerId, errBody);
  }

  const data = await res.json() as Record<string, unknown>;
  const usage = typeof data.usage === "object" && data.usage !== null
    ? data.usage as Record<string, unknown>
    : {};

  const readUsageNumber = (...keys: string[]): number => {
    for (const key of keys) {
      const value = usage[key];
      if (typeof value === "number") return value;
    }
    return 0;
  };

  // Extract tool calls if present (OpenAI-compatible only)
  let toolCalls: InferenceResult["toolCalls"];
  const rawMsg = (data.choices as Array<{ message?: { tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }>)?.[0]?.message;
  if (rawMsg?.tool_calls && rawMsg.tool_calls.length > 0) {
    toolCalls = rawMsg.tool_calls
      .filter((tc) => tc.function?.name)
      .map((tc) => ({
        name: tc.function!.name!,
        arguments: tc.function?.arguments ? JSON.parse(tc.function.arguments) as Record<string, unknown> : {},
      }));
  }

  return {
    content: extractText(data),
    inputTokens: readUsageNumber("input_tokens", "prompt_tokens"),
    outputTokens: readUsageNumber("output_tokens", "completion_tokens"),
    inferenceMs,
    ...(toolCalls !== undefined && { toolCalls }),
  };
}

// ─── Token Usage Logging ─────────────────────────────────────────────────────

export async function logTokenUsage(input: {
  agentId: string;
  providerId: string;
  contextKey: string;
  inputTokens: number;
  outputTokens: number;
  inferenceMs?: number;
}): Promise<void> {
  const provider = await prisma.modelProvider.findUnique({ where: { providerId: input.providerId } });

  let costUsd = 0;
  if (provider) {
    if (provider.costModel === "compute" && input.inferenceMs !== undefined) {
      costUsd = computeComputeCost(
        input.inferenceMs,
        provider.computeWatts ?? 150,
        provider.electricityRateKwh ?? 0.12,
      );
    } else if (provider.costModel === "token") {
      costUsd = computeTokenCost(
        input.inputTokens,
        input.outputTokens,
        provider.inputPricePerMToken ?? 0,
        provider.outputPricePerMToken ?? 0,
      );
    }
  }

  await prisma.tokenUsage.create({
    data: {
      agentId:      input.agentId,
      providerId:   input.providerId,
      contextKey:   input.contextKey,
      inputTokens:  input.inputTokens,
      outputTokens: input.outputTokens,
      ...(input.inferenceMs !== undefined && { inferenceMs: input.inferenceMs }),
      costUsd,
    },
  });
}
