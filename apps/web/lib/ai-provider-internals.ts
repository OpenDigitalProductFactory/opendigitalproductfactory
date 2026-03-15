// apps/web/lib/ai-provider-internals.ts
// Internal discovery/profiling logic and shared private helpers.
// NOT a server action file — must never have "use server" directive.
// Called by checkBundledProviders() (page-load health check) and
// by the server actions in ai-providers.ts (which add auth guards).

import { prisma, type Prisma } from "@dpf/db";
import { decryptSecret } from "@/lib/credential-crypto";
import {
  computeTokenCost,
  computeComputeCost,
  getTestUrl,
  parseModelsResponse,
} from "@/lib/ai-provider-types";
import {
  rankProvidersByCost,
  buildProfilingPrompt,
  parseProfilingResponse,
  type ProfileResult,
} from "@/lib/ai-profiling";

// ─── Shared helpers (exported for use by ai-providers.ts server actions) ─────

/** Decrypt the API key / client secret for a provider (server-only). */
export async function getDecryptedCredential(providerId: string) {
  const cred = await prisma.credentialEntry.findUnique({ where: { providerId } });
  if (!cred) return null;
  return {
    ...cred,
    secretRef:    cred.secretRef    ? decryptSecret(cred.secretRef)    : null,
    clientSecret: cred.clientSecret ? decryptSecret(cred.clientSecret) : null,
  };
}

/** Provider-specific headers required beyond auth (e.g. Anthropic API versioning). */
export function getProviderExtraHeaders(providerId: string): Record<string, string> {
  if (providerId === "anthropic") return { "anthropic-version": "2023-06-01" };
  return {};
}

type TokenUsage = {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

export function extractTokenUsage(data: Record<string, unknown>): TokenUsage {
  const usage = asRecord(data.usage);

  if (!usage) {
    return {
      inputTokens: undefined,
      outputTokens: undefined,
    };
  }

  return {
    inputTokens: asNumber(usage.input_tokens) ?? asNumber(usage.prompt_tokens),
    outputTokens: asNumber(usage.output_tokens) ?? asNumber(usage.completion_tokens),
  };
}

/** OAuth token exchange — obtain or refresh bearer token for a provider. */
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

  // Exchange for new token
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
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Token exchange error" };
  }
}

// ─── Internal helpers (not exported — only used within this module) ──────────

/** Known cheap models per provider for profiling tasks. */
const PROFILING_MODELS: Record<string, string> = {
  anthropic:      "claude-haiku-4-5-20251001",
  openai:         "gpt-4o-mini",
  "azure-openai": "gpt-4o-mini",
  gemini:         "gemini-2.0-flash",
  cohere:         "command-r",
  mistral:        "mistral-small-latest",
  deepseek:       "deepseek-chat",
  groq:           "llama-3.1-8b-instant",
  together:       "meta-llama/Llama-3-8b-chat-hf",
  fireworks:      "accounts/fireworks/models/llama-v3p1-8b-instruct",
  xai:            "grok-2-latest",
  openrouter:     "meta-llama/llama-3.1-8b-instruct:free",
};

/** Pick a model for profiling: prefer discovered models (proven valid), then known defaults. */
async function getProfilingModel(providerId: string): Promise<string> {
  // Prefer a discovered model — we know the account has access to it
  const discovered = await prisma.discoveredModel.findMany({
    where: { providerId },
    orderBy: { modelId: "asc" },
    select: { modelId: true },
  });

  if (discovered.length > 0) {
    // Try to match a known cheap model from the discovered list
    const known = PROFILING_MODELS[providerId];
    if (known && discovered.some((d) => d.modelId === known)) return known;

    // Otherwise pick the first discovered model that looks like a chat model
    // (skip embedding-only, whisper, tts, dall-e, etc.)
    const skipPatterns = /embed|whisper|tts|dall-e|moderation|babbage|davinci-00/i;
    const chatModel = discovered.find((d) => !skipPatterns.test(d.modelId));
    if (chatModel) return chatModel.modelId;

    // Last resort: first discovered model
    return discovered[0]!.modelId;
  }

  // No discovered models — use the hardcoded default
  const known = PROFILING_MODELS[providerId];
  if (known) return known;

  throw new Error(`No known or discovered model for profiling on ${providerId}`);
}

async function callProviderForProfiling(
  profilingProviderId: string,
  prompt: string,
): Promise<{ text: string; inputTokens: number | undefined; outputTokens: number | undefined }> {
  const prov = await prisma.modelProvider.findUnique({ where: { providerId: profilingProviderId } });
  if (!prov) throw new Error("Provider not found");

  const baseUrl = prov.baseUrl ?? prov.endpoint;
  if (!baseUrl) throw new Error("No base URL");

  const model = await getProfilingModel(profilingProviderId);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...getProviderExtraHeaders(profilingProviderId),
  };

  if (prov.authMethod === "api_key") {
    const cred = await getDecryptedCredential(profilingProviderId);
    if (!cred?.secretRef || !prov.authHeader) throw new Error("No credential");
    headers[prov.authHeader] = prov.authHeader === "Authorization"
      ? `Bearer ${cred.secretRef}` : cred.secretRef;
  } else if (prov.authMethod === "oauth2_client_credentials") {
    const tokenResult = await getProviderBearerToken(profilingProviderId);
    if ("error" in tokenResult) throw new Error(tokenResult.error);
    headers["Authorization"] = `Bearer ${tokenResult.token}`;
  }

  // Each provider family has its own endpoint + request/response shape
  let chatUrl: string;
  let body: Record<string, unknown>;
  let extractText: (data: Record<string, unknown>) => string;

  if (profilingProviderId === "anthropic") {
    chatUrl = `${baseUrl}/messages`;
    body = { model, max_tokens: 4096, messages: [{ role: "user", content: prompt }] };
    extractText = (d) => (d.content as Array<{ text?: string }>)?.[0]?.text ?? "";
  } else if (profilingProviderId === "cohere") {
    chatUrl = `${baseUrl}/chat`;
    body = { model, message: prompt, max_tokens: 4096 };
    extractText = (d) => (d.text as string) ?? "";
  } else if (profilingProviderId === "gemini") {
    // Gemini uses generateContent endpoint with different structure
    chatUrl = `${baseUrl}/models/${model}:generateContent`;
    body = { contents: [{ parts: [{ text: prompt }] }] };
    extractText = (d) => {
      const candidates = d.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined;
      return candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    };
  } else {
    // OpenAI-compatible (OpenAI, Azure, Mistral, Groq, Together, Fireworks, xAI, OpenRouter, LiteLLM, etc.)
    const apiBase = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
    chatUrl = `${apiBase}/chat/completions`;
    body = { model, messages: [{ role: "user", content: prompt }], max_tokens: 4096, keep_alive: -1 };
    extractText = (d) => (d.choices as Array<{ message?: { content?: string } }>)?.[0]?.message?.content ?? "";
  }

  const res = await fetch(chatUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(600_000), // 10min — profiling generates detailed JSON, local models are slow
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} from ${profilingProviderId}: ${errBody.slice(0, 200)}`);
  }
  const data = await res.json() as Record<string, unknown>;

  const text = extractText(data);
  const usage = extractTokenUsage(data);

  return {
    text,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  };
}

async function logTokenUsage(input: {
  agentId: string;
  providerId: string;
  contextKey: string;
  inputTokens: number;
  outputTokens: number;
  inferenceMs?: number;
}): Promise<void> {
  // Internal helper — callers (profileModelsInternal) already guard at the action layer

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

// ─── Exported internal functions (no auth guard) ─────────────────────────────

export async function discoverModelsInternal(
  providerId: string,
): Promise<{ discovered: number; newCount: number; error?: string }> {
  const provider = await prisma.modelProvider.findUnique({ where: { providerId } });
  if (!provider) return { discovered: 0, newCount: 0, error: "Provider not found" };

  const providerRow = {
    ...provider,
    families: provider.families as string[],
    enabledFamilies: provider.enabledFamilies as string[],
    supportedAuthMethods: provider.supportedAuthMethods as string[],
  };

  const testUrl = getTestUrl(providerRow);
  if (!testUrl) return { discovered: 0, newCount: 0, error: "No base URL configured" };

  // Build auth headers (same logic as testProviderAuth)
  const headers: Record<string, string> = {
    ...getProviderExtraHeaders(providerId),
  };
  if (provider.authMethod === "api_key") {
    const cred = await getDecryptedCredential(providerId);
    if (cred?.secretRef && provider.authHeader) {
      headers[provider.authHeader] = provider.authHeader === "Authorization"
        ? `Bearer ${cred.secretRef}` : cred.secretRef;
    }
  } else if (provider.authMethod === "oauth2_client_credentials") {
    const tokenResult = await getProviderBearerToken(providerId);
    if ("error" in tokenResult) return { discovered: 0, newCount: 0, error: tokenResult.error };
    headers["Authorization"] = `Bearer ${tokenResult.token}`;
  }

  let json: unknown;
  try {
    const res = await fetch(testUrl, { headers, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return { discovered: 0, newCount: 0, error: `HTTP ${res.status}` };
    json = await res.json();
  } catch (err) {
    return { discovered: 0, newCount: 0, error: err instanceof Error ? err.message : "Fetch error" };
  }

  const models = parseModelsResponse(providerId, json);
  let newCount = 0;

  for (const m of models) {
    const existing = await prisma.discoveredModel.findUnique({
      where: { providerId_modelId: { providerId, modelId: m.modelId } },
    });
    if (existing) {
      await prisma.discoveredModel.update({
        where: { id: existing.id },
        data: { rawMetadata: m.rawMetadata as unknown as Prisma.InputJsonValue },
      });
    } else {
      await prisma.discoveredModel.create({
        data: { providerId, modelId: m.modelId, rawMetadata: m.rawMetadata as unknown as Prisma.InputJsonValue },
      });
      newCount++;
    }
  }

  return { discovered: models.length, newCount };
}

export async function profileModelsInternal(
  providerId: string,
  modelIds?: string[],
): Promise<{ profiled: number; failed: number; error?: string }> {
  const provider = await prisma.modelProvider.findUnique({ where: { providerId } });
  if (!provider) return { profiled: 0, failed: 0, error: "Provider not found" };

  // Get models to profile
  const whereClause = modelIds
    ? { providerId, modelId: { in: modelIds } }
    : { providerId };
  const models = await prisma.discoveredModel.findMany({ where: whereClause });
  if (models.length === 0) return { profiled: 0, failed: 0, error: "No models to profile" };

  // Find cheapest active provider to do the profiling
  const allProviders = await prisma.modelProvider.findMany({
    select: { providerId: true, status: true, outputPricePerMToken: true },
  });
  const ranked = rankProvidersByCost(allProviders);
  if (ranked.length === 0) return { profiled: 0, failed: 0, error: "No active AI provider available for profiling" };

  // Build prompt
  const modelEntries = models.map((m) => ({
    modelId: m.modelId,
    providerName: provider.name,
    rawMetadata: m.rawMetadata as Record<string, unknown>,
  }));

  // Batch in groups of 20
  let totalProfiled = 0;
  let totalFailed = 0;

  for (let i = 0; i < modelEntries.length; i += 20) {
    const batch = modelEntries.slice(i, i + 20);
    const prompt = buildProfilingPrompt(batch);

    let profiles: ProfileResult[] = [];
    let usedProviderId: string | null = null;
    let lastError: string | null = null;

    // Try each provider in cost order
    for (const candidateId of ranked) {
      try {
        const result = await callProviderForProfiling(candidateId, prompt);
        profiles = parseProfilingResponse(result.text);

        // If JSON parse failed, retry once with a stricter prompt
        if (profiles.length === 0) {
          const stricterPrompt =
            "IMPORTANT: Respond ONLY with a valid JSON array. No markdown code fences, no explanation text.\n\n" +
            prompt;
          const retryResult = await callProviderForProfiling(candidateId, stricterPrompt);
          profiles = parseProfilingResponse(retryResult.text);

          if (profiles.length > 0) {
            usedProviderId = candidateId;
            await logTokenUsage({
              agentId: "system:model-profiler",
              providerId: candidateId,
              contextKey: `profile-${providerId}-batch-${i}`,
              inputTokens: (result.inputTokens ?? 0) + (retryResult.inputTokens ?? 0),
              outputTokens: (result.outputTokens ?? 0) + (retryResult.outputTokens ?? 0),
            });
            break;
          }

          lastError = `${candidateId}: response was not valid JSON`;
          await logTokenUsage({
            agentId: "system:model-profiler",
            providerId: candidateId,
            contextKey: `profile-${providerId}-batch-${i}-failed`,
            inputTokens: 0,
            outputTokens: 0,
          }).catch(() => {});
          continue;
        }

        usedProviderId = candidateId;
        await logTokenUsage({
          agentId: "system:model-profiler",
          providerId: candidateId,
          contextKey: `profile-${providerId}-batch-${i}`,
          inputTokens: result.inputTokens ?? 0,
          outputTokens: result.outputTokens ?? 0,
        });
        break;
      } catch (err) {
        lastError = `${candidateId}: ${err instanceof Error ? err.message : "Unknown error"}`;
        console.error(`[profiling] ${lastError}`);
        await logTokenUsage({
          agentId: "system:model-profiler",
          providerId: candidateId,
          contextKey: `profile-${providerId}-batch-${i}-failed`,
          inputTokens: 0,
          outputTokens: 0,
        }).catch(() => {});
        continue;
      }
    }

    // If all providers failed for this batch, return the last error
    if (profiles.length === 0 && lastError) {
      return { profiled: totalProfiled, failed: batch.length, error: lastError };
    }

    // Save successful profiles
    for (const profile of profiles) {
      await prisma.modelProfile.upsert({
        where: { providerId_modelId: { providerId, modelId: profile.modelId } },
        create: {
          providerId,
          modelId: profile.modelId,
          friendlyName: profile.friendlyName,
          summary: profile.summary,
          capabilityTier: profile.capabilityTier,
          costTier: profile.costTier,
          bestFor: profile.bestFor,
          avoidFor: profile.avoidFor,
          contextWindow: profile.contextWindow ?? null,
          speedRating: profile.speedRating ?? null,
          generatedBy: usedProviderId ?? "unknown",
        },
        update: {
          friendlyName: profile.friendlyName,
          summary: profile.summary,
          capabilityTier: profile.capabilityTier,
          costTier: profile.costTier,
          bestFor: profile.bestFor,
          avoidFor: profile.avoidFor,
          contextWindow: profile.contextWindow ?? null,
          speedRating: profile.speedRating ?? null,
          generatedBy: usedProviderId ?? "unknown",
          generatedAt: new Date(),
        },
      });
      totalProfiled++;
    }

    const profiledIds = new Set(profiles.map((p) => p.modelId));
    totalFailed += batch.filter((b) => !profiledIds.has(b.modelId)).length;
  }

  return { profiled: totalProfiled, failed: totalFailed };
}
