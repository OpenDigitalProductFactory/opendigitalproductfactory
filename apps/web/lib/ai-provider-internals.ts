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
import { extractModelCardWithFallback } from "@/lib/routing/adapter-registry";

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
        capabilities: card.capabilities as any,
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
        supportsToolUse: card.capabilities.toolUse ?? false,
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
      select: { rawMetadataHash: true },
    });
    if (existingProfile?.rawMetadataHash && existingProfile.rawMetadataHash !== card.rawMetadataHash) {
      console.log(
        `[drift] Provider metadata changed for ${providerId}/${m.modelId} — hash ${existingProfile.rawMetadataHash.slice(0, 8)}→${card.rawMetadataHash.slice(0, 8)}`
      );
    }

    // EP-INF-003: ModelCard metadata fields — always safe to overwrite on re-sync
    const metadataFields = {
      modelFamily: card.modelFamily,
      modelClass: card.modelClass,
      maxInputTokens: card.maxInputTokens,
      inputModalities: card.inputModalities,
      outputModalities: card.outputModalities,
      capabilities: card.capabilities as any,
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
      // Backward compat
      maxContextTokens: card.maxInputTokens,
      inputPricePerMToken: card.pricing.inputPerMToken,
      outputPricePerMToken: card.pricing.outputPerMToken,
      supportsToolUse: card.capabilities.toolUse ?? false,
    };

    // Dimension scores — only write on CREATE or when profileSource is still "seed".
    // Never overwrite evaluated or production scores with family baselines.
    const existingSource = existingProfile
      ? (await prisma.modelProfile.findUnique({
          where: { providerId_modelId: { providerId, modelId: m.modelId } },
          select: { profileSource: true },
        }))?.profileSource
      : null;

    const shouldWriteScores = !existingSource || existingSource === "seed";

    const scoreFields = shouldWriteScores ? {
      reasoning: card.dimensionScores.reasoning,
      codegen: card.dimensionScores.codegen,
      toolFidelity: card.dimensionScores.toolFidelity,
      instructionFollowingScore: card.dimensionScores.instructionFollowing,
      structuredOutputScore: card.dimensionScores.structuredOutput,
      conversational: card.dimensionScores.conversational,
      contextRetention: card.dimensionScores.contextRetention,
      profileSource: "seed" as const,
      profileConfidence: card.metadataConfidence,
    } : {
      // Only update confidence from metadata, don't touch scores or source
      profileConfidence: card.metadataConfidence,
    };

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
        ...metadataFields,
        // Always write scores on create (first time)
        reasoning: card.dimensionScores.reasoning,
        codegen: card.dimensionScores.codegen,
        toolFidelity: card.dimensionScores.toolFidelity,
        instructionFollowingScore: card.dimensionScores.instructionFollowing,
        structuredOutputScore: card.dimensionScores.structuredOutput,
        conversational: card.dimensionScores.conversational,
        contextRetention: card.dimensionScores.contextRetention,
        profileSource: "seed",
        profileConfidence: card.metadataConfidence,
        generatedBy:          "system:metadata-sync",
      },
      update: {
        ...metadataFields,
        ...scoreFields,
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
        capabilities: card.capabilities as any,
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
  const { buildSeedRecipe } = await import("./routing/recipe-seeder");
  const { inferContract } = await import("./routing/request-contract");

  const profiles = await prisma.modelProfile.findMany({
    where: { modelStatus: { in: ["active", "degraded"] } },
    include: { provider: true },
  });

  const contractFamilies = [
    "sync.greeting", "sync.status-query", "sync.summarization",
    "sync.reasoning", "sync.data-extraction", "sync.code-gen",
    "sync.web-search", "sync.creative", "sync.tool-action",
  ];

  let seeded = 0;
  for (const profile of profiles) {
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
        capabilities: (profile.capabilities as import("./routing/model-card-types").ModelCardCapabilities) ?? {},
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
          providerSettings: recipe.providerSettings,
          toolPolicy: recipe.toolPolicy,
          responsePolicy: recipe.responsePolicy,
        },
      });
      seeded++;
    }
  }
  return seeded;
}
