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
import { extractModelMetadata } from "@/lib/routing/metadata-extractor";
import { getBaselineForModel } from "@/lib/routing/family-baselines";

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
export function isAnthropicProvider(providerId: string): boolean {
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
  const isLocalProvider = providerId === "ollama";
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
          await prisma.modelProfile.updateMany({
            where: { providerId, modelId: known.modelId, modelStatus: "retired" },
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

  const whereClause = modelIds
    ? { providerId, modelId: { in: modelIds } }
    : { providerId };
  const models = await prisma.discoveredModel.findMany({ where: whereClause });
  if (models.length === 0) return { profiled: 0, failed: 0, error: "No models to profile" };

  let profiled = 0;
  for (const m of models) {
    const metadata = extractModelMetadata(providerId, m.rawMetadata as Record<string, unknown>);
    const baseline = getBaselineForModel(m.modelId);

    const scoreFields = baseline
      ? {
          reasoning:                 baseline.scores.reasoning,
          codegen:                   baseline.scores.codegen,
          toolFidelity:              baseline.scores.toolFidelity,
          instructionFollowingScore: baseline.scores.instructionFollowing,
          structuredOutputScore:     baseline.scores.structuredOutput,
          conversational:            baseline.scores.conversational,
          contextRetention:          baseline.scores.contextRetention,
          profileSource:             "seed",
          profileConfidence:         baseline.confidence,
        }
      : {
          reasoning:                 50,
          codegen:                   50,
          toolFidelity:              50,
          instructionFollowingScore: 50,
          structuredOutputScore:     50,
          conversational:            50,
          contextRetention:          50,
          profileSource:             "seed",
          profileConfidence:         "low",
        };

    // Derive legacy display fields from available data (no LLM needed)
    const friendlyName = m.modelId
      .replace(/[-_:]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
    const reasoning = scoreFields.reasoning;
    const capabilityTier = reasoning >= 85 ? "deep-thinker"
      : reasoning >= 70 ? "strong"
      : reasoning >= 50 ? "moderate"
      : "fast-cheap";
    const price = metadata.outputPricePerMToken;
    const costTier = price == null ? "$" : price < 5 ? "$" : price < 15 ? "$$" : "$$$";

    await prisma.modelProfile.upsert({
      where: { providerId_modelId: { providerId, modelId: m.modelId } },
      create: {
        providerId,
        modelId:       m.modelId,
        friendlyName,
        summary:       `${provider.name} model. Routing profile sourced from family baseline registry.`,
        capabilityTier,
        costTier,
        bestFor:       ["general purpose tasks"],
        avoidFor:      [],
        ...scoreFields,
        maxContextTokens:     metadata.maxContextTokens,
        maxOutputTokens:      metadata.maxOutputTokens,
        inputPricePerMToken:  metadata.inputPricePerMToken,
        outputPricePerMToken: metadata.outputPricePerMToken,
        supportsToolUse:      metadata.supportsToolUse ?? provider.supportsToolUse,
        generatedBy:          "system:metadata-sync",
      },
      update: {
        ...scoreFields,
        capabilityTier,
        costTier,
        maxContextTokens:     metadata.maxContextTokens,
        maxOutputTokens:      metadata.maxOutputTokens,
        inputPricePerMToken:  metadata.inputPricePerMToken,
        outputPricePerMToken: metadata.outputPricePerMToken,
        supportsToolUse:      metadata.supportsToolUse ?? provider.supportsToolUse,
        generatedBy:          "system:metadata-sync",
        generatedAt:          new Date(),
      },
    });
    profiled++;
  }

  return { profiled, failed: 0 };
}
