// apps/web/lib/ai-provider-internals.ts
// Internal discovery/profiling logic and shared private helpers.
// NOT a server action file — must never have "use server" directive.
// Called by checkBundledProviders() (page-load health check) and
// by the server actions in ai-providers.ts (which add auth guards).

import { prisma, type Prisma } from "@dpf/db";
import { decryptSecret, encryptSecret } from "@/lib/credential-crypto";
import {
  computeTokenCost,
  computeComputeCost,
  getTestUrl,
  parseModelsResponse,
} from "@/lib/ai-provider-types";
import { extractModelCardWithFallback } from "@/lib/routing/adapter-registry";
import { assignTierFromModelId, TIER_DIMENSION_BASELINES } from "@/lib/routing/quality-tiers";
import { KNOWN_PROVIDER_MODELS, type KnownModel } from "@/lib/routing/known-provider-models";

// ─── Shared helpers (exported for use by ai-providers.ts server actions) ─────

/** Decrypt the API key / client secret for a provider (server-only).
 *  Returns null when the credential row is missing OR when decryption fails
 *  (e.g. the encryption key was rotated after these credentials were stored). */
export async function getDecryptedCredential(providerId: string) {
  const cred = await prisma.credentialEntry.findUnique({ where: { providerId } });
  if (!cred) {
    console.warn(`[credentials] getDecryptedCredential("${providerId}") → null: row not found`);
    return null;
  }
  const secretRef    = cred.secretRef    ? decryptSecret(cred.secretRef)    : null;
  const clientSecret = cred.clientSecret ? decryptSecret(cred.clientSecret) : null;
  const cachedToken  = cred.cachedToken  ? decryptSecret(cred.cachedToken)  : null;
  const refreshToken = cred.refreshToken ? decryptSecret(cred.refreshToken) : null;
  // If every encrypted field failed to decrypt, the key was rotated — treat as no credential.
  const hadEncrypted = [cred.secretRef, cred.clientSecret, cred.cachedToken, cred.refreshToken]
    .some(v => v?.startsWith("enc:"));
  const allFailed = hadEncrypted && !secretRef && !clientSecret && !cachedToken && !refreshToken;
  if (allFailed) {
    console.warn(`[credentials] All encrypted fields for "${providerId}" failed to decrypt — re-configure this provider.`);
    console.warn(`[credentials] Diagnostic for ${providerId}: ` +
      `secretRef=${cred.secretRef ? `enc(${cred.secretRef.slice(0,8)})→${secretRef ? "ok" : "null"}` : "none"}, ` +
      `clientSecret=${cred.clientSecret ? `enc(${cred.clientSecret.slice(0,8)})→${clientSecret ? "ok" : "null"}` : "none"}, ` +
      `cachedToken=${cred.cachedToken ? `enc(${cred.cachedToken.slice(0,8)})→${cachedToken ? "ok" : "null"}` : "none"}, ` +
      `refreshToken=${cred.refreshToken ? `enc(${cred.refreshToken.slice(0,8)})→${refreshToken ? "ok" : "null"}` : "none"}`);
    // Flag for the admin UI so it stops showing green.  Fire-and-forget — we
    // already know the decrypt failed, so we return null either way.  See
    // PROVIDER-ACTIVATION-AUDIT.md F-16.
    if (cred.status !== "key_rotated") {
      prisma.credentialEntry
        .update({ where: { providerId }, data: { status: "key_rotated" } })
        .catch((err) => console.warn(`[credentials] Failed to mark ${providerId} as key_rotated:`, err));
    }
    return null;
  }
  return { ...cred, secretRef, clientSecret, cachedToken, refreshToken };
}

/** Provider-specific headers required beyond auth (e.g. Anthropic API versioning). */
export function isAnthropicProvider(providerId: string): boolean {
  return providerId === "anthropic" || providerId.startsWith("anthropic-");
}

export function getProviderExtraHeaders(providerId: string): Record<string, string> {
  if (isAnthropicProvider(providerId)) return { "anthropic-version": "2023-06-01" };
  return {};
}

/**
 * Beta header required for Anthropic subscription (OAuth) token inference.
 * Only `oauth-2025-04-20` is needed — `claude-code-20250219` is for Claude Code
 * agentic features and causes HTTP 400 on non-agentic calls (e.g. evals, Haiku).
 */
export const ANTHROPIC_OAUTH_BETA_HEADERS = "oauth-2025-04-20";

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

/** OAuth token exchange — obtain or refresh bearer token for a provider.
 *  Dispatches by authMethod: oauth2_authorization_code uses refreshOAuthToken,
 *  oauth2_client_credentials uses the client_credentials grant.
 */
export async function getProviderBearerToken(providerId: string): Promise<{ token: string } | { error: string }> {
  const provider = await prisma.modelProvider.findUnique({ where: { providerId } });
  if (!provider) return { error: "Provider not found" };

  if (provider.authMethod === "oauth2_authorization_code") {
    const { refreshOAuthToken } = await import("@/lib/provider-oauth");
    const credential = await getDecryptedCredential(providerId);
    if (!credential) return { error: "No credential configured" };

    if (credential.cachedToken && credential.tokenExpiresAt) {
      const buffer = 5 * 60 * 1000;
      if (credential.tokenExpiresAt.getTime() > Date.now() + buffer) {
        return { token: credential.cachedToken };
      }
    }
    // chatgpt shares Codex OAuth — refresh via codex provider (has tokenUrl/clientId)
    const refreshProviderId = providerId === "chatgpt" ? "codex" : providerId;
    return refreshOAuthToken(refreshProviderId);
  }

  // Existing client_credentials flow
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
      data: {
        cachedToken: encryptSecret(body.access_token),
        tokenExpiresAt: expiresAt,
        status: "ok",
      },
    });

    return { token: body.access_token };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Token exchange error" };
  }
}

// ─── ChatGPT Backend Model Discovery ────────────────────────────────────────

/**
 * Discover models from the ChatGPT backend `/backend-api/models` endpoint.
 * Works with OAuth subscription tokens (codex, chatgpt providers).
 * Returns the same shape as parseModelsResponse for consistency.
 */

// Response shape from chatgpt.com/backend-api/models
interface ChatGptModelEntry {
  slug?: string;
  max_tokens?: number;
  title?: string;
  description?: string;
  tags?: string[];
  capabilities?: Record<string, unknown>;
  product_features?: Record<string, unknown>;
}

interface ChatGptModelsResponse {
  models?: ChatGptModelEntry[];
  categories?: Array<{
    category?: string;
    human_category_name?: string;
    default_model?: string;
  }>;
}

export async function discoverChatGptBackendModels(
  providerId: string,
  headers: Record<string, string>,
  baseUrl?: string,
): Promise<{ models: { modelId: string; rawMetadata: Record<string, unknown> }[]; error?: string }> {
  const backend = baseUrl ?? "https://chatgpt.com/backend-api";
  const modelsUrl = `${backend}/models`;

  try {
    const res = await fetch(modelsUrl, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return { models: [], error: `HTTP ${res.status} from ${modelsUrl}` };
    }

    const json = await res.json() as ChatGptModelsResponse;
    const entries = json.models ?? [];

    const models = entries
      .filter((m) => typeof m.slug === "string" && m.slug.length > 0)
      .map((m) => ({
        modelId: m.slug!,
        rawMetadata: {
          ...m as Record<string, unknown>,
          id: m.slug,
          source: "chatgpt_backend_discovery",
          // Tag the provider so the adapter can distinguish codex (api.openai.com)
          // from chatgpt (chatgpt.com/backend-api) — they share this discovery path
          // but have different tool support characteristics.
          discoveredForProvider: providerId,
        },
      }));

    console.log(
      `[discovery] ChatGPT backend returned ${models.length} models for ${providerId}: ` +
      `[${models.map(m => m.modelId).join(", ")}]`,
    );

    return { models };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Fetch error";
    console.warn(`[discovery] ChatGPT backend discovery failed for ${providerId}: ${msg}`);
    return { models: [], error: msg };
  }
}

// ─── Exported internal functions (no auth guard) ─────────────────────────────



export async function discoverModelsInternal(
  providerId: string,
): Promise<{ discovered: number; newCount: number; error?: string }> {
  const provider = await prisma.modelProvider.findUnique({ where: { providerId } });
  if (!provider) return { discovered: 0, newCount: 0, error: "Provider not found" };

  // Codex and ChatGPT subscription providers use the ChatGPT backend
  // /backend-api/models endpoint (not the standard /v1/models). Discover
  // models from the live API so capabilities come from the provider, not
  // from hardcoded seed data.
  if (provider.authMethod === "oauth2_authorization_code" &&
      (provider.category === "agent" || providerId === "chatgpt")) {
    const tokenResult = await getProviderBearerToken(providerId);
    if ("error" in tokenResult) {
      return { discovered: 0, newCount: 0, error: tokenResult.error };
    }
    const headers = { Authorization: `Bearer ${tokenResult.token}` };
    const result = await discoverChatGptBackendModels(
      providerId,
      headers,
      provider.baseUrl ?? undefined,
    );
    if (result.error && result.models.length === 0) {
      return { discovered: 0, newCount: 0, error: result.error };
    }

    let newCount = 0;
    for (const m of result.models) {
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

    return { discovered: result.models.length, newCount };
  }

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
  } else if (provider.authMethod === "oauth2_authorization_code") {
    const tokenResult = await getProviderBearerToken(providerId);
    if ("error" in tokenResult) return { discovered: 0, newCount: 0, error: tokenResult.error };
    headers["Authorization"] = `Bearer ${tokenResult.token}`;
    if (isAnthropicProvider(providerId)) {
      headers["anthropic-beta"] = ANTHROPIC_OAUTH_BETA_HEADERS;
    }
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

  const freshModelIds = new Set(models.map((m) => m.modelId));

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

  // ── EP-INF-002: Discovery reconciliation — detect gone models ──
  const isLocalProvider = providerId === "local" || providerId === "ollama";
  if (!isLocalProvider) {
    const allKnown = await prisma.discoveredModel.findMany({
      where: { providerId },
      select: { id: true, modelId: true, missedDiscoveryCount: true },
    });

    for (const known of allKnown) {
      if (freshModelIds.has(known.modelId)) {
        // Model still exists — reset counter and reactivate if retired
        if (known.missedDiscoveryCount > 0) {
          await prisma.discoveredModel.update({
            where: { id: known.id },
            data: { missedDiscoveryCount: 0 },
          });
          // Don't reactivate models retired due to a provider-confirmed error
          // (model_not_found, deprecated by provider).  Google still lists
          // sunset aliases in their model catalog even though calls are rejected.
          await prisma.modelProfile.updateMany({
            where: {
              providerId,
              modelId: known.modelId,
              modelStatus: "retired",
              retiredReason: { notIn: [
                "model_not_found from provider",
                "Deprecated by provider at discovery time",
              ] },
            },
            data: { modelStatus: "active", retiredAt: null, retiredReason: null },
          });
        }
      } else {
        // Model not in fresh list — increment counter
        const newMissedCount = known.missedDiscoveryCount + 1;
        await prisma.discoveredModel.update({
          where: { id: known.id },
          data: { missedDiscoveryCount: newMissedCount },
        });

        if (newMissedCount >= 2) {
          await prisma.modelProfile.updateMany({
            where: { providerId, modelId: known.modelId },
            data: {
              modelStatus: "retired",
              retiredAt: new Date(),
              retiredReason: `Model no longer listed by provider after ${newMissedCount} discovery cycles`,
            },
          });
          console.log(`[discovery] Retired model ${known.modelId} from ${providerId} (missed ${newMissedCount} discoveries)`);
        }
      }
    }
  }

  return { discovered: models.length, newCount };
}


/**
 * EP-INF-002: Sync model profiles for all (or specified) discovered models.
 * Uses rawMetadata extraction + family baseline registry — no LLM calls.
 * Run after discovery to populate routing dimension scores and pricing.
 */
export async function profileModelsInternal(
  providerId: string,
  modelIds?: string[],
): Promise<{ profiled: number; failed: number; error?: string }> {
  const provider = await prisma.modelProvider.findUnique({ where: { providerId } });
  if (!provider) return { profiled: 0, failed: 0, error: "Provider not found" };

  // Check model restrictions — if provider has an allowlist, skip models that don't match
  const restrictions = (provider.modelRestrictions ?? []) as string[];
  function modelMatchesRestrictions(modelId: string): boolean {
    if (restrictions.length === 0) return true; // no restrictions = all allowed
    return restrictions.some(pattern => {
      const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
      return regex.test(modelId);
    });
  }

  const whereClause = modelIds
    ? { providerId, modelId: { in: modelIds } }
    : { providerId };
  const models = await prisma.discoveredModel.findMany({ where: whereClause });
  if (models.length === 0) return { profiled: 0, failed: 0, error: "No models to profile" };

  let profiled = 0;
  for (const m of models) {
    // If the model doesn't match provider restrictions, retire it
    if (!modelMatchesRestrictions(m.modelId)) {
      const card = extractModelCardWithFallback(providerId, m.modelId, m.rawMetadata);
      const metadataFields = {
        modelFamily: card.modelFamily,
        modelClass: card.modelClass,
        maxInputTokens: card.maxInputTokens,
        inputModalities: card.inputModalities,
        outputModalities: card.outputModalities,
        // For Ollama: force streaming=true (all models support it) since the
        // model card probe can't detect this and returns null for everything.
        // Null capabilities cause routing exclusion (streaming required for sync).
        capabilities: (providerId === "local" || providerId === "ollama")
          ? { ...card.capabilities, streaming: true } as any
          : card.capabilities as any,
        pricing: card.pricing as any,
        supportedParameters: card.supportedParameters,
        defaultParameters: card.defaultParameters as any,
        instructType: card.instructType,
        trainingDataCutoff: card.trainingDataCutoff,
        reliableKnowledgeCutoff: card.reliableKnowledgeCutoff,
        deprecationDate: card.deprecationDate,
        perRequestLimits: card.perRequestLimits as any,
        metadataSource: card.metadataSource,
        metadataConfidence: card.metadataConfidence,
        lastMetadataRefresh: new Date(),
        rawMetadataHash: card.rawMetadataHash,
        maxContextTokens: card.maxInputTokens,
        inputPricePerMToken: card.pricing.inputPerMToken,
        outputPricePerMToken: card.pricing.outputPerMToken,
        supportsToolUse: card.capabilities.toolUse ?? provider!.supportsToolUse ?? false,
      };
      await prisma.modelProfile.upsert({
        where: { providerId_modelId: { providerId, modelId: m.modelId } },
        create: {
          providerId,
          modelId: m.modelId,
          friendlyName: m.modelId,
          summary: "Not accessible with current provider credentials",
          capabilityTier: "restricted",
          costTier: "$",
          bestFor: [],
          avoidFor: [],
          modelStatus: "retired",
          retiredReason: "Model not accessible with provider credential type",
          generatedBy: "system:metadata-sync",
          ...metadataFields,
          reasoning: 50, codegen: 50, toolFidelity: 50,
          instructionFollowingScore: 50, structuredOutputScore: 50,
          conversational: 50, contextRetention: 50,
          profileSource: "seed",
          profileConfidence: "low",
        },
        update: {
          modelStatus: "retired",
          retiredReason: "Model not accessible with provider credential type",
        },
      });
      console.log(`[profiling] Retired restricted model ${m.modelId} from ${providerId}`);
      continue; // skip normal profiling for this model
    }
    const card = extractModelCardWithFallback(providerId, m.modelId, m.rawMetadata);

    // Auto-retire deprecated models — provider says this model is end-of-life
    if (card.status === "deprecated" || card.status === "retired") {
      await prisma.modelProfile.upsert({
        where: { providerId_modelId: { providerId, modelId: m.modelId } },
        create: {
          providerId, modelId: m.modelId,
          friendlyName: card.displayName || m.modelId,
          summary: "Deprecated by provider",
          capabilityTier: "deprecated", costTier: "$",
          bestFor: [], avoidFor: [],
          modelStatus: "retired",
          retiredAt: new Date(),
          retiredReason: `Deprecated by provider${card.deprecationDate ? ` (${card.deprecationDate.toISOString().split("T")[0]})` : ""}`,
          generatedBy: "system:metadata-sync",
          profileSource: "seed", profileConfidence: "low",
          reasoning: 50, codegen: 50, toolFidelity: 50,
          instructionFollowingScore: 50, structuredOutputScore: 50,
          conversational: 50, contextRetention: 50,
        },
        update: {
          modelStatus: "retired",
          retiredAt: new Date(),
          retiredReason: `Deprecated by provider${card.deprecationDate ? ` (${card.deprecationDate.toISOString().split("T")[0]})` : ""}`,
        },
      });
      console.log(`[profiling] Auto-retired deprecated model ${m.modelId} from ${providerId}`);
      continue;
    }

    // Auto-retire models with a past deprecation date
    if (card.deprecationDate && card.deprecationDate < new Date()) {
      await prisma.modelProfile.upsert({
        where: { providerId_modelId: { providerId, modelId: m.modelId } },
        create: {
          providerId, modelId: m.modelId,
          friendlyName: card.displayName || m.modelId,
          summary: "Past deprecation date",
          capabilityTier: "deprecated", costTier: "$",
          bestFor: [], avoidFor: [],
          modelStatus: "retired",
          retiredAt: new Date(),
          retiredReason: `Deprecation date passed: ${card.deprecationDate.toISOString().split("T")[0]}`,
          generatedBy: "system:metadata-sync",
          profileSource: "seed", profileConfidence: "low",
          reasoning: 50, codegen: 50, toolFidelity: 50,
          instructionFollowingScore: 50, structuredOutputScore: 50,
          conversational: 50, contextRetention: 50,
        },
        update: {
          modelStatus: "retired",
          retiredAt: new Date(),
          retiredReason: `Deprecation date passed: ${card.deprecationDate.toISOString().split("T")[0]}`,
        },
      });
      console.log(`[profiling] Auto-retired past-deprecation model ${m.modelId} from ${providerId}`);
      continue;
    }

    // Derive legacy display fields from available data (no LLM needed)
    const friendlyName = card.displayName !== m.modelId
      ? card.displayName
      : m.modelId
          .replace(/[-_:]/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase());
    const reasoning = card.dimensionScores.reasoning;
    const capabilityTier = reasoning >= 85 ? "deep-thinker"
      : reasoning >= 70 ? "strong"
      : reasoning >= 50 ? "moderate"
      : "fast-cheap";
    const price = card.pricing.outputPerMToken;
    const costTier = price == null ? "$" : price < 5 ? "$" : price < 15 ? "$$" : "$$$";

    // EP-INF-003: Drift detection — check if provider metadata changed
    const existingProfile = await prisma.modelProfile.findUnique({
      where: { providerId_modelId: { providerId, modelId: m.modelId } },
      select: { rawMetadataHash: true, profileSource: true, supportsToolUse: true },
    });
    const driftDetected = existingProfile?.rawMetadataHash != null
      && existingProfile.rawMetadataHash !== card.rawMetadataHash;
    if (driftDetected) {
      console.log(
        `[drift] Provider metadata changed for ${providerId}/${m.modelId} — hash ${existingProfile.rawMetadataHash!.slice(0, 8)}→${card.rawMetadataHash.slice(0, 8)}`
      );
      // For seed-level profiles, allow scores to be re-derived on this sync.
      // For evaluated/admin profiles, flag for admin review via driftDetectedAt.
      if (existingProfile.profileSource === "seed") {
        await prisma.modelProfile.update({
          where: { providerId_modelId: { providerId, modelId: m.modelId } },
          data: { driftDetectedAt: new Date() },
        });
      } else {
        await prisma.modelProfile.update({
          where: { providerId_modelId: { providerId, modelId: m.modelId } },
          data: { driftDetectedAt: new Date() },
        });
        console.log(`[drift] ${providerId}/${m.modelId} has evaluated/admin profile — flagged for review`);
      }
    }

    // EP-INF-003: ModelCard metadata fields — always safe to overwrite on re-sync.
    // supportsToolUse uses a fallback chain:
    //   1. extracted value (non-null) — authoritative from provider metadata
    //   2. existing DB value when profileSource is evaluated/admin — preserves manual overrides
    //   3. provider-level supportsToolUse flag — provider knows its models better than per-model metadata
    //   4. null — unknown (not false); prevents permanent tool disabling on undiscovered models
    const extractedToolUse = card.capabilities.toolUse;
    const isManuallySet = existingProfile?.profileSource === "evaluated" || existingProfile?.profileSource === "admin";
    const resolvedToolUse = extractedToolUse !== null && extractedToolUse !== undefined
      ? extractedToolUse
      : isManuallySet
        ? (existingProfile.supportsToolUse ?? provider!.supportsToolUse ?? null)
        : (provider!.supportsToolUse ?? null);

    const metadataFields = {
      modelFamily: card.modelFamily,
      modelClass: card.modelClass,
      maxInputTokens: card.maxInputTokens,
      inputModalities: card.inputModalities,
      outputModalities: card.outputModalities,
      capabilities: (providerId === "local" || providerId === "ollama")
        ? { ...card.capabilities, streaming: true } as any
        : card.capabilities as any,
      pricing: card.pricing as any,
      supportedParameters: card.supportedParameters,
      defaultParameters: card.defaultParameters as any,
      instructType: card.instructType,
      trainingDataCutoff: card.trainingDataCutoff,
      reliableKnowledgeCutoff: card.reliableKnowledgeCutoff,
      deprecationDate: card.deprecationDate,
      perRequestLimits: card.perRequestLimits as any,
      metadataSource: card.metadataSource,
      metadataConfidence: card.metadataConfidence,
      lastMetadataRefresh: new Date(),
      rawMetadataHash: card.rawMetadataHash,
      discoveryHash: card.rawMetadataHash,   // EP-MODEL-CAP-001: explicit discovery hash column
      // Backward compat
      maxContextTokens: card.maxInputTokens,
      inputPricePerMToken: card.pricing.inputPerMToken,
      outputPricePerMToken: card.pricing.outputPerMToken,
      supportsToolUse: resolvedToolUse,
    };

    // EP-INF-012: Assign quality tier from model family
    const qualityTier = assignTierFromModelId(m.modelId);
    const tierBaseline = TIER_DIMENSION_BASELINES[qualityTier];

    // EP-INF-012b: Use card.dimensionScores (from family-baselines or known catalog)
    // when available. Fall back to flat tier baselines only when the card has no
    // family match (dimensionScoreSource === "inferred").
    const ds = card.dimensionScoreSource !== "inferred"
      ? card.dimensionScores
      : {
          reasoning: tierBaseline.reasoning,
          codegen: tierBaseline.codegen,
          toolFidelity: tierBaseline.toolFidelity,
          instructionFollowing: tierBaseline.instructionFollowing,
          structuredOutput: tierBaseline.structuredOutput,
          conversational: tierBaseline.conversational,
          contextRetention: tierBaseline.contextRetention,
        };

    // Dimension scores — only write on CREATE or when profileSource is still "seed".
    // Never overwrite evaluated or production scores with family baselines.
    const existingFull = existingProfile
      ? await prisma.modelProfile.findUnique({
          where: { providerId_modelId: { providerId, modelId: m.modelId } },
          select: { profileSource: true, qualityTierSource: true },
        })
      : null;

    const shouldWriteScores = !existingFull?.profileSource || existingFull.profileSource === "seed";
    // Don't overwrite admin-set tier on re-sync
    const shouldWriteTier = !existingFull?.qualityTierSource || existingFull.qualityTierSource !== "admin";

    const scoreFields = shouldWriteScores ? {
      reasoning: ds.reasoning,
      codegen: ds.codegen,
      toolFidelity: ds.toolFidelity,
      instructionFollowingScore: ds.instructionFollowing,
      structuredOutputScore: ds.structuredOutput,
      conversational: ds.conversational,
      contextRetention: ds.contextRetention,
      profileSource: "seed" as const,
      profileConfidence: card.metadataConfidence,
    } : {
      // Only update confidence from metadata, don't touch scores or source
      profileConfidence: card.metadataConfidence,
    };

    const tierFields = shouldWriteTier ? {
      qualityTier,
      qualityTierSource: "auto" as const,
    } : {};

    // Explicit modelStatus on CREATE — the Prisma default is "active", which
    // means a model discovered before the seed runs would become routable even
    // if the seed catalog marks it retired.  Use the adapter's card status so
    // deprecated models are never created as "active".
    // Note: TS narrows card.status after the early-return checks above, but the
    // adapter could still return unexpected values at runtime — cast to string.
    const cardStatus = card.status as string;
    const createStatus = cardStatus === "deprecated" || cardStatus === "retired"
      ? "retired" : "active";

    await prisma.modelProfile.upsert({
      where: { providerId_modelId: { providerId, modelId: m.modelId } },
      create: {
        providerId,
        modelId:       m.modelId,
        friendlyName,
        summary:       `${provider.name} model. Routing profile sourced from adapter registry.`,
        capabilityTier,
        costTier,
        bestFor:       ["general purpose tasks"],
        avoidFor:      [],
        modelStatus:   createStatus,
        retiredAt:     createStatus === "retired" ? new Date() : null,
        retiredReason: createStatus === "retired" ? "Deprecated by provider at discovery time" : null,
        ...metadataFields,
        qualityTier,
        qualityTierSource: "auto",
        // EP-INF-012b: Use card dimension scores (family baseline or known catalog)
        reasoning: ds.reasoning,
        codegen: ds.codegen,
        toolFidelity: ds.toolFidelity,
        instructionFollowingScore: ds.instructionFollowing,
        structuredOutputScore: ds.structuredOutput,
        conversational: ds.conversational,
        contextRetention: ds.contextRetention,
        profileSource: "seed",
        profileConfidence: card.metadataConfidence,
        generatedBy:          "system:metadata-sync",
      },
      update: {
        ...metadataFields,
        ...scoreFields,
        ...tierFields,
        capabilityTier,
        costTier,
        generatedBy:          "system:metadata-sync",
        generatedAt:          new Date(),
      },
    });
    profiled++;
  }

  return { profiled, failed: 0 };
}


/**
 * EP-INF-003: Backfill ModelCard fields for all existing ModelProfiles.
 * Reads all DiscoveredModel records and re-extracts ModelCard data using
 * the adapter registry, then writes the card fields to the corresponding
 * ModelProfile rows. Safe to run repeatedly — uses updateMany.
 */
export async function backfillModelCards(): Promise<number> {
  const discovered = await prisma.discoveredModel.findMany();
  let updated = 0;
  for (const dm of discovered) {
    const card = extractModelCardWithFallback(dm.providerId, dm.modelId, dm.rawMetadata as Record<string, unknown>);
    await prisma.modelProfile.updateMany({
      where: { providerId: dm.providerId, modelId: dm.modelId },
      data: {
        modelFamily: card.modelFamily,
        modelClass: card.modelClass,
        maxInputTokens: card.maxInputTokens,
        inputModalities: card.inputModalities as any,
        outputModalities: card.outputModalities as any,
        capabilities: (dm.providerId === "local" || dm.providerId === "ollama")
          ? { ...card.capabilities, streaming: true } as any
          : card.capabilities as any,
        pricing: card.pricing as any,
        supportedParameters: card.supportedParameters as any,
        metadataSource: card.metadataSource,
        metadataConfidence: card.metadataConfidence,
        lastMetadataRefresh: new Date(),
        rawMetadataHash: card.rawMetadataHash,
      },
    });
    updated++;
  }
  return updated;
}


/**
 * EP-INF-007: Seed execution recipes for all active/degraded model profiles.
 * Creates champion seed recipes for each contract family, skipping any that
 * already exist. Safe to run repeatedly — idempotent.
 */
export async function seedAllRecipes(): Promise<number> {
  const { buildSeedRecipe } = await import("../routing/recipe-seeder");
  const { inferContract } = await import("../routing/request-contract");

  const profiles = await prisma.modelProfile.findMany({
    where: { modelStatus: { in: ["active", "degraded"] } },
    include: { provider: true },
  });

  // Chat/reasoning contract families (for chat/reasoning/code model classes)
  const chatContractFamilies = [
    "sync.greeting", "sync.status-query", "sync.summarization",
    "sync.reasoning", "sync.data-extraction", "sync.code-gen",
    "sync.web-search", "sync.creative", "sync.tool-action",
  ];

  // EP-INF-009c: Non-chat contract families keyed by modelClass
  const nonChatContractFamilies: Record<string, string[]> = {
    image_gen: ["sync.image-gen"],
    embedding: ["sync.embedding"],
    audio: ["sync.transcription"],
  };

  let seeded = 0;
  for (const profile of profiles) {
    // Select contract families based on model class
    const modelClass = (profile.modelClass as string) ?? "chat";
    const contractFamilies = nonChatContractFamilies[modelClass] ?? chatContractFamilies;

    for (const family of contractFamilies) {
      // Check if recipe already exists
      const existing = await prisma.executionRecipe.findFirst({
        where: {
          providerId: profile.providerId,
          modelId: profile.modelId,
          contractFamily: family,
          status: "champion",
        },
      });
      if (existing) continue;

      // Create a minimal contract for seeding
      const taskType = family.split(".")[1] ?? "reasoning";
      const contract = await inferContract(
        taskType,
        [{ role: "user", content: "seed" }],
      );

      const modelCard = {
        capabilities: (profile.capabilities as unknown as import("../routing/model-card-types").ModelCardCapabilities) ?? {},
        maxOutputTokens: profile.maxOutputTokens,
        modelClass: (profile.modelClass as string) ?? "chat",
      };

      const recipe = buildSeedRecipe(
        profile.providerId,
        profile.modelId,
        family,
        modelCard,
        contract,
      );

      await prisma.executionRecipe.create({
        data: {
          providerId: profile.providerId,
          modelId: profile.modelId,
          contractFamily: family,
          version: 1,
          status: "champion",
          origin: "seed",
          executionAdapter: recipe.executionAdapter,
          providerSettings: recipe.providerSettings as object,
          toolPolicy: recipe.toolPolicy as object,
          responsePolicy: recipe.responsePolicy as object,
        },
      });
      seeded++;
    }
  }
  return seeded;
}

/**
 * Auto-discover and profile models for a provider after activation.
 * Called from OAuth callback and API key save flows.
 *
 * For all providers: tries discoverModelsInternal first (dynamic discovery).
 * For codex/chatgpt: discoverModelsInternal calls /backend-api/models via OAuth.
 * If dynamic discovery fails, falls back to KNOWN_PROVIDER_MODELS catalog.
 *
 * Errors are logged but never thrown (activation should succeed even if discovery fails).
 */
export async function autoDiscoverAndProfile(providerId: string): Promise<{
  discovered: number;
  profiled: number;
  error?: string;
}> {
  let result: { discovered: number; profiled: number; error?: string };

  try {
    // 1. Try dynamic discovery (works for all providers including codex/chatgpt)
    const discovery = await discoverModelsInternal(providerId);

    if (discovery.discovered > 0) {
      // Dynamic discovery succeeded — profile the discovered models
      const profiling = await profileModelsInternal(providerId);
      result = {
        discovered: discovery.discovered,
        profiled: profiling.profiled,
        error: profiling.error,
      };
    } else {
      // 2. Dynamic discovery returned 0 — fall back to known catalog if available
      const knownModels = KNOWN_PROVIDER_MODELS[providerId];
      if (knownModels) {
        console.log(
          `[auto-discover] Dynamic discovery returned 0 for ${providerId}` +
          (discovery.error ? ` (${discovery.error})` : "") +
          `. Falling back to known catalog (${knownModels.length} models).`,
        );
        result = await seedKnownModels(providerId, knownModels);
      } else {
        // 3. No catalog fallback — report the discovery error
        result = { discovered: 0, profiled: 0, error: discovery.error };
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[auto-discover] Failed for ${providerId}: ${message}`);
    result = { discovered: 0, profiled: 0, error: message };
  }

  // 4. Queue background evals for newly discovered/profiled models.
  // This ensures every provider activation path (OAuth, API key, first-boot,
  // startup revalidation) triggers live quality scoring without manual clicks.
  if (result.profiled > 0) {
    try {
      const { inngest } = await import("@/lib/queue/inngest-client");
      const models = await prisma.modelProfile.findMany({
        where: { providerId, modelStatus: "active" },
        select: { modelId: true, id: true },
      });
      for (const m of models) {
        await inngest.send({
          name: "ai/eval.run" as const,
          data: { endpointId: m.id, modelId: m.modelId, userId: "system" },
        });
      }
      console.log(`[auto-discover] Queued background evals for ${models.length} model(s) on ${providerId}`);
    } catch (err) {
      // Non-fatal — catalog scores are usable even without live eval
      console.warn(`[auto-discover] Failed to queue background evals for ${providerId}:`, err);
    }
  }

  return result;
}

/**
 * Seed DiscoveredModel + ModelProfile from the known-model catalog.
 * Used for providers that can't call /v1/models (subscription OAuth, agent providers).
 */
async function seedKnownModels(
  providerId: string,
  models: KnownModel[],
): Promise<{ discovered: number; profiled: number }> {
  let discovered = 0;
  let profiled = 0;

  for (const m of models) {
    await prisma.discoveredModel.upsert({
      where: { providerId_modelId: { providerId, modelId: m.modelId } },
      create: {
        providerId,
        modelId: m.modelId,
        rawMetadata: { id: m.modelId, source: "known_catalog" } as any,
        lastSeenAt: new Date(),
      },
      update: {
        rawMetadata: { id: m.modelId, source: "known_catalog" } as any,
        lastSeenAt: new Date(),
      },
    });
    discovered++;

    const existing = await prisma.modelProfile.findUnique({
      where: { providerId_modelId: { providerId, modelId: m.modelId } },
      select: { qualityTierSource: true, profileSource: true, supportsToolUse: true },
    });

    const shouldWriteScores = !existing?.profileSource || existing.profileSource === "seed";
    const isManuallySetCatalog = existing?.profileSource === "evaluated" || existing?.profileSource === "admin";
    const shouldWriteTier = !existing?.qualityTierSource || existing.qualityTierSource !== "admin";

    // Use per-model scores if provided, otherwise fall back to tier baselines
    const scores = m.scores ?? {
      reasoning: TIER_DIMENSION_BASELINES[m.qualityTier].reasoning,
      codegen: TIER_DIMENSION_BASELINES[m.qualityTier].codegen,
      toolFidelity: TIER_DIMENSION_BASELINES[m.qualityTier].toolFidelity,
      instructionFollowingScore: TIER_DIMENSION_BASELINES[m.qualityTier].instructionFollowing,
      structuredOutputScore: TIER_DIMENSION_BASELINES[m.qualityTier].structuredOutput,
      conversational: TIER_DIMENSION_BASELINES[m.qualityTier].conversational,
      contextRetention: TIER_DIMENSION_BASELINES[m.qualityTier].contextRetention,
    };

    const scoreFields = shouldWriteScores ? {
      ...scores,
      profileSource: "seed" as const,
      profileConfidence: "medium" as const,
    } : {};

    const tierFields = shouldWriteTier ? {
      qualityTier: m.qualityTier,
      qualityTierSource: "auto" as const,
    } : {};

    await prisma.modelProfile.upsert({
      where: { providerId_modelId: { providerId, modelId: m.modelId } },
      create: {
        providerId,
        modelId: m.modelId,
        friendlyName: m.friendlyName,
        summary: m.summary,
        capabilityTier: m.capabilityTier,
        costTier: m.costTier,
        bestFor: m.bestFor,
        avoidFor: m.avoidFor,
        modelClass: m.modelClass,
        modelFamily: m.modelFamily,
        modelStatus: m.defaultStatus,
        retiredAt: m.defaultStatus === "retired" ? new Date() : null,
        retiredReason: m.defaultStatus === "retired" || m.defaultStatus === "disabled"
          ? (m.retiredReason ?? null)
          : null,
        maxContextTokens: m.maxContextTokens,
        maxOutputTokens: m.maxOutputTokens,
        inputModalities: m.inputModalities,
        outputModalities: m.outputModalities,
        capabilities: m.capabilities as any,
        supportsToolUse: m.capabilities.toolUse ?? false,
        qualityTier: m.qualityTier,
        qualityTierSource: "auto",
        ...scores,
        profileSource: "seed",
        profileConfidence: "medium",
        generatedBy: "system:auto-discover",
      },
      update: {
        friendlyName: m.friendlyName,
        summary: m.summary,
        modelClass: m.modelClass,
        modelFamily: m.modelFamily,
        modelStatus: m.defaultStatus,
        retiredAt: m.defaultStatus === "retired" ? new Date() : null,
        retiredReason: m.defaultStatus === "retired" || m.defaultStatus === "disabled"
          ? (m.retiredReason ?? null)
          : null,
        maxContextTokens: m.maxContextTokens,
        maxOutputTokens: m.maxOutputTokens,
        inputModalities: m.inputModalities,
        outputModalities: m.outputModalities,
        capabilities: m.capabilities as any,
        supportsToolUse: isManuallySetCatalog
          ? (existing.supportsToolUse ?? m.capabilities.toolUse ?? false)
          : (m.capabilities.toolUse ?? false),
        ...scoreFields,
        ...tierFields,
        generatedBy: "system:auto-discover",
      },
    });
    profiled++;
  }

  console.log(`[auto-discover] Seeded ${discovered} known models for ${providerId}`);
  return { discovered, profiled };
}
