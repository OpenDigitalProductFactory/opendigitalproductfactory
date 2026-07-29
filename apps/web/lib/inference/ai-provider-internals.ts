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
import { KNOWN_PROVIDER_MODELS } from "@/lib/routing/known-provider-models";
import {
  backgroundModelEvalSkipReason,
  canQueueBackgroundModelEvals,
} from "@/lib/routing/provider-eligibility";
import { seedKnownModels } from "@/lib/inference/known-model-seeding";

/**
 * Resolve the `supportsToolUse` value a metadata-sync should persist for a model,
 * given the provider floor, the freshly-extracted adapter value, and the existing
 * stored profile. Pure + exported for unit tests.
 *
 * Precedence (BI-B6DEBFFE — closes the "sticky false" trap that permanently pinned a
 * once-false local model, e.g. qwen3-coder, as non-tool-capable on every re-sync):
 *   1. provider-level false       — hard backend floor (no model can exceed it)
 *   2. admin field-level override — capabilityOverrides.toolUse is the ONLY durable
 *                                   manual pin, in either direction
 *   3. manual profile (evaluated/admin) — preserve the measured/decided value so a
 *      low-confidence re-discovery never clobbers a real eval
 *   4. fresh definitive extracted value — discovery-owned (seed/auto-discover)
 *      profiles HEAL a stale/incorrect stored `false` on re-sync
 *   5. existing stored value, else provider floor, else null (unknown — NOT false;
 *      never permanently disables tools on an undiscovered model)
 *
 * The old inline chain pinned ANY existing `false` (step 2 was `existing===false`),
 * so once a model was wrongly stored false it could never recover from discovery —
 * only an admin override or a successful eval could flip it. A deliberate non-tool
 * pin now lives in capabilityOverrides, not the raw column.
 */
export function resolveSyncedToolUse(input: {
  providerToolFloor: boolean | null | undefined;
  extractedToolUse: boolean | null | undefined;
  existing: {
    profileSource: string | null;
    supportsToolUse: boolean | null;
    capabilityOverrides: unknown;
  } | null;
}): boolean | null {
  const { providerToolFloor, extractedToolUse, existing } = input;

  // 1. Hard backend floor — a provider that cannot do tools floors every model.
  if (providerToolFloor === false) return false;

  // 2. Admin field-level override — authoritative manual pin in either direction.
  const overrides = existing?.capabilityOverrides as Record<string, unknown> | null | undefined;
  if (overrides && typeof overrides === "object" && "toolUse" in overrides) {
    return overrides.toolUse as boolean;
  }

  // 3. A measured/admin decision is authoritative — re-discovery must not clobber it.
  const isManuallySet =
    existing?.profileSource === "evaluated" || existing?.profileSource === "admin";
  if (isManuallySet) {
    return existing!.supportsToolUse ?? extractedToolUse ?? providerToolFloor ?? null;
  }

  // 4. Discovery-owned: a fresh, definitive extracted value wins, so a stale or
  //    incorrect stored `false` self-heals on the next sync.
  if (extractedToolUse !== null && extractedToolUse !== undefined) {
    return extractedToolUse;
  }

  // 5. No fresh signal: keep the existing value, else the provider floor, else unknown.
  return existing?.supportsToolUse ?? providerToolFloor ?? null;
}

// ─── Shared helpers (exported for use by ai-providers.ts server actions) ─────

const CREDENTIAL_PARENT_BY_PROVIDER_ID: Record<string, string> = {
  "zai-coding": "zai",
};

export function resolveCredentialProviderId(providerId: string): string {
  return CREDENTIAL_PARENT_BY_PROVIDER_ID[providerId] ?? providerId;
}

/** Decrypt the API key / client secret for a provider (server-only).
 *  Returns null when the credential row is missing OR when decryption fails
 *  (e.g. the encryption key was rotated after these credentials were stored). */
export async function getDecryptedCredential(providerId: string) {
  const credentialProviderId = resolveCredentialProviderId(providerId);
  const cred = await prisma.credentialEntry.findUnique({ where: { providerId: credentialProviderId } });
  if (!cred) {
    // CodeQL js/log-injection: providerId is user-influenced. JSON.stringify
    // is a CodeQL-recognised sanitiser — escapes CR/LF, quotes the value.
    console.warn(`[credentials] getDecryptedCredential(${JSON.stringify(providerId)}) → null: row not found`);
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
    // CodeQL js/log-injection: providerId is user-influenced. JSON.stringify
    // is a CodeQL-recognised sanitiser — escapes CR/LF, quotes the value.
    const safeProviderId = JSON.stringify(providerId);
    console.warn(`[credentials] All encrypted fields for ${safeProviderId} failed to decrypt — re-configure this provider.`);
    console.warn(`[credentials] Diagnostic for ${safeProviderId}: ` +
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
        // CodeQL #47 (js/tainted-format-string) + js/log-injection:
        // providerId is user-influenced. JSON.stringify is the recognised
        // sanitiser; the format string is constant so %s can't be hijacked.
        .catch((err) => console.warn("[credentials] Failed to mark %s as key_rotated: %s",
          JSON.stringify(providerId),
          err instanceof Error ? JSON.stringify(err.message) : JSON.stringify(String(err))));
    }
    return null;
  }
  return { ...cred, secretRef, clientSecret, cachedToken, refreshToken };
}

/**
 * Cheap pre-flight: does this provider have credential material adequate for
 * its auth method? Existence-only (no decrypt, no warning log) so it is safe to
 * call in hot loops such as the background eval scheduler. "none" / unset auth
 * (local Docker Model Runner, self-hosted speech) needs no credential and is
 * always eligible. Returns false when the provider needs a key but has none —
 * the caller should skip it rather than make a guaranteed-to-fail call that
 * floods the logs with "No credential configured".
 *
 * Intentionally NOT getDecryptedCredential: that decrypts every field and emits
 * diagnostic warnings on a missing/rotated row, which would itself become
 * per-call log noise when used as a filter.
 */
export async function providerHasConfiguredCredential(
  providerId: string,
  authMethod: string | null,
): Promise<boolean> {
  const method = (authMethod ?? "").toLowerCase();
  // No-auth endpoints (local model runner, self-hosted) need no credential.
  if (method === "none" || method === "") return true;

  const cred = await prisma.credentialEntry.findUnique({
    where: { providerId: resolveCredentialProviderId(providerId) },
    select: {
      secretRef: true,
      clientSecret: true,
      cachedToken: true,
      refreshToken: true,
    },
  });
  if (!cred) return false;

  if (method === "api_key") return Boolean(cred.secretRef);
  if (method === "oauth2_client_credentials") {
    return Boolean(cred.clientSecret || cred.cachedToken || cred.refreshToken);
  }
  // oauth2_authorization_code + unknown methods: usable only if SOME token or
  // secret material is present. (authorization_code is excluded from background
  // eval upstream, but keep this correct for other callers.)
  return Boolean(
    cred.secretRef || cred.clientSecret || cred.cachedToken || cred.refreshToken,
  );
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

export function buildAutoDiscoveryEvalEvents(
  providerId: string,
  models: Array<{ id?: string; modelId: string }>,
  userId = "system",
) {
  return models.map((model) => ({
    name: "ai/eval.run" as const,
    data: {
      endpointId: providerId,
      modelId: model.modelId,
      userId,
    },
  }));
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

    // CodeQL js/log-injection: providerId + modelId user-influenced.
    console.log(
      `[discovery] ChatGPT backend returned ${models.length} models for ${JSON.stringify(providerId)}: ` +
      `[${models.map(m => JSON.stringify(m.modelId)).join(", ")}]`,
    );

    return { models };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Fetch error";
    // CodeQL js/log-injection: providerId + msg user-influenced.
    console.warn(`[discovery] ChatGPT backend discovery failed for ${JSON.stringify(providerId)}: ${JSON.stringify(msg)}`);
    return { models: [], error: msg };
  }
}

// ─── Exported internal functions (no auth guard) ─────────────────────────────

/**
 * Persist a freshly-discovered set of models against DiscoveredModel, returning
 * the count of genuinely-new rows.
 *
 * Replaces the per-model findUnique→update/create N+1 (100s of rows for a large
 * catalog such as OpenRouter) with: ONE findMany to read the existing modelIds,
 * a createMany for the new ones, and one update per changed existing row
 * (Prisma has no single-statement bulk update with per-row values, so the
 * existing-row metadata refresh stays one update each — the win is collapsing
 * the read + the inserts). Behaviour is identical to the old loop:
 *   • existing rows have their rawMetadata overwritten with the fresh value;
 *   • new rows are inserted with { providerId, modelId, rawMetadata };
 *   • the returned newCount equals the number of distinct modelIds not already
 *     present (a modelId repeated within `models` counts once, exactly as the
 *     old loop did once its first occurrence was created).
 */
export async function upsertDiscoveredModels(
  providerId: string,
  models: Array<{ modelId: string; rawMetadata: Record<string, unknown> }>,
): Promise<number> {
  if (models.length === 0) return 0;

  const existingRows = await prisma.discoveredModel.findMany({
    where: { providerId, modelId: { in: models.map((m) => m.modelId) } },
    select: { modelId: true },
  });
  const existingIds = new Set(existingRows.map((r) => r.modelId));

  const newRowByModelId = new Map<string, { providerId: string; modelId: string; rawMetadata: Prisma.InputJsonValue }>();
  for (const m of models) {
    if (existingIds.has(m.modelId)) {
      // Refresh rawMetadata for the already-known model (was the update branch).
      await prisma.discoveredModel.update({
        where: { providerId_modelId: { providerId, modelId: m.modelId } },
        data: { rawMetadata: m.rawMetadata as unknown as Prisma.InputJsonValue },
      });
    } else {
      // Not-yet-stored model. If the same new modelId appears more than once in
      // this batch, last-write-wins on rawMetadata — exactly as the old loop did
      // (its first occurrence created the row, later occurrences updated it) —
      // and it is still created (and counted) once.
      newRowByModelId.set(m.modelId, {
        providerId,
        modelId: m.modelId,
        rawMetadata: m.rawMetadata as unknown as Prisma.InputJsonValue,
      });
    }
  }

  const newRows = [...newRowByModelId.values()];
  if (newRows.length > 0) {
    await prisma.discoveredModel.createMany({ data: newRows, skipDuplicates: true });
  }

  return newRows.length;
}

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

    const newCount = await upsertDiscoveredModels(providerId, result.models);

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

  const freshModelIds = new Set(models.map((m) => m.modelId));

  const newCount = await upsertDiscoveredModels(providerId, models);

  await reconcileDiscoveredModelPresence(providerId, freshModelIds);

  return { discovered: models.length, newCount };
}

/**
 * Retirement reasons that record the PROVIDER ITSELF confirming a model is
 * dead even though it may still appear in the provider's catalog listing —
 * Google keeps sunset aliases listed while rejecting calls. Cloud presence
 * reconciliation never auto-reactivates these. Local serving engines
 * (DMR/Ollama) are exempt: their /models list is the serving truth — a listed
 * model is loadable, so a model_not_found recorded during an engine outage
 * must heal once the model is listed again (BI-B6B8C1F9).
 */
export const PERMANENT_RETIRE_REASONS = [
  "model_not_found from provider",
  "Deprecated by provider at discovery time",
];

/**
 * EP-INF-002: Discovery reconciliation — heal returned models, detect gone ones.
 *
 * A retired ModelProfile is reactivated whenever the provider currently lists
 * the model. This deliberately does NOT depend on missedDiscoveryCount:
 * profiles retired by a runtime 404 during an outage or demoted by a
 * dedupe/retriage migration (BI-84792669 left reactivation as an unowned
 * "operational decision") carry a count of 0 and previously stayed retired
 * forever while discovery listed the model every day — the "no AI model
 * available" coworker outage (BI-B6B8C1F9).
 *
 * Missed-discovery counting and retirement stay cloud-only: a local list miss
 * is more likely an engine hiccup than a removal, and retiring the bundled
 * local fallback is exactly what stranded restricted-sensitivity routing.
 */
export async function reconcileDiscoveredModelPresence(
  providerId: string,
  freshModelIds: ReadonlySet<string>,
): Promise<void> {
  const isLocalProvider = providerId === "local" || providerId === "ollama";
  const allKnown = await prisma.discoveredModel.findMany({
    where: { providerId },
    select: { id: true, modelId: true, missedDiscoveryCount: true },
  });

  const present = allKnown.filter((known) => freshModelIds.has(known.modelId));

  const countersToReset = present.filter((known) => known.missedDiscoveryCount > 0);
  if (countersToReset.length > 0) {
    await prisma.discoveredModel.updateMany({
      where: { id: { in: countersToReset.map((known) => known.id) } },
      data: { missedDiscoveryCount: 0 },
    });
  }

  if (present.length > 0) {
    const reactivated = await prisma.modelProfile.updateMany({
      where: {
        providerId,
        modelId: { in: present.map((known) => known.modelId) },
        modelStatus: "retired",
        ...(isLocalProvider ? {} : { retiredReason: { notIn: PERMANENT_RETIRE_REASONS } }),
      },
      data: { modelStatus: "active", retiredAt: null, retiredReason: null },
    });
    if (reactivated.count > 0) {
      // CodeQL js/log-injection: providerId user-influenced.
      console.log(`[discovery] Reactivated ${reactivated.count} retired model profile(s) re-listed by ${JSON.stringify(providerId)}`);
    }
  }

  if (isLocalProvider) return;

  for (const known of allKnown) {
    if (freshModelIds.has(known.modelId)) continue;

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
      // CodeQL js/log-injection: modelId + providerId user-influenced.
      console.log(`[discovery] Retired model ${JSON.stringify(known.modelId)} from ${JSON.stringify(providerId)} (missed ${newMissedCount} discoveries)`);
    }
  }
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
          capabilityCategory: "restricted",
          costTier: "routine",  // restricted = inaccessible, treat as cheapest
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
      console.log(`[profiling] Retired restricted model ${JSON.stringify(m.modelId)} from ${JSON.stringify(providerId)}`);
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
          capabilityCategory: "deprecated", costTier: "deprecated",
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
      console.log(`[profiling] Auto-retired deprecated model ${JSON.stringify(m.modelId)} from ${JSON.stringify(providerId)}`);
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
          capabilityCategory: "deprecated", costTier: "deprecated",
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
      console.log(`[profiling] Auto-retired past-deprecation model ${JSON.stringify(m.modelId)} from ${JSON.stringify(providerId)}`);
      continue;
    }

    // Derive legacy display fields from available data (no LLM needed)
    const friendlyName = card.displayName !== m.modelId
      ? card.displayName
      : m.modelId
          .replace(/[-_:]/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase());
    const reasoning = card.dimensionScores.reasoning;
    const capabilityCategory = reasoning >= 85 ? "deep-thinker"
      : reasoning >= 70 ? "strong"
      : reasoning >= 50 ? "moderate"
      : "fast-cheap";
    const price = card.pricing.outputPerMToken;
    // EP-COST-001: use canonical tier vocabulary (routine | standard | critical).
    // When price is known, derive from output cost per MTok.
    // When price is null, fall back to capabilityCategory so we always have a
    // meaningful tier even for models where pricing data hasn't been fetched yet.
    const costTierFromPrice = price == null ? null
      : price < 5 ? "routine"
      : price < 20 ? "standard"
      : "critical";
    const costTierFromCategory = capabilityCategory === "deep-thinker" ? "critical"
      : capabilityCategory === "strong" ? "standard"
      : "routine";
    const costTier = costTierFromPrice ?? costTierFromCategory;

    // EP-INF-003: Drift detection — check if provider metadata changed
    const existingProfile = await prisma.modelProfile.findUnique({
      where: { providerId_modelId: { providerId, modelId: m.modelId } },
      select: { rawMetadataHash: true, profileSource: true, supportsToolUse: true, capabilityOverrides: true },
    });
    const driftDetected = existingProfile?.rawMetadataHash != null
      && existingProfile.rawMetadataHash !== card.rawMetadataHash;
    if (driftDetected) {
      console.log(
        `[drift] Provider metadata changed for ${JSON.stringify(providerId)}/${JSON.stringify(m.modelId)} — hash ${existingProfile.rawMetadataHash!.slice(0, 8)}→${card.rawMetadataHash.slice(0, 8)}`
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
        console.log(`[drift] ${JSON.stringify(providerId)}/${JSON.stringify(m.modelId)} has evaluated/admin profile — flagged for review`);
      }
    }

    // EP-INF-003: ModelCard metadata fields — always safe to overwrite on re-sync.
    // supportsToolUse precedence lives in the pure resolveSyncedToolUse helper so the
    // "sticky false" trap (BI-B6DEBFFE) is unit-tested and can never silently re-pin a
    // healed model. A deliberate non-tool pin lives in capabilityOverrides, not the raw
    // column, so a stale/incorrect discovery-owned `false` self-heals on re-sync.
    const resolvedToolUse = resolveSyncedToolUse({
      providerToolFloor: provider!.supportsToolUse,
      extractedToolUse: card.capabilities.toolUse as boolean | null | undefined,
      existing: existingProfile
        ? {
            profileSource: existingProfile.profileSource,
            supportsToolUse: existingProfile.supportsToolUse,
            capabilityOverrides: existingProfile.capabilityOverrides,
          }
        : null,
    });
    // Keep capabilities.toolUse consistent with the resolved boolean so the two
    // capability representations can never disagree (the original defect surfaced as a
    // row with capabilities.toolUse=false yet toolFidelity=100).
    const resolvedCapabilities = { ...card.capabilities, toolUse: resolvedToolUse };

    const metadataFields = {
      modelFamily: card.modelFamily,
      modelClass: card.modelClass,
      maxInputTokens: card.maxInputTokens,
      inputModalities: card.inputModalities,
      outputModalities: card.outputModalities,
      capabilities: (providerId === "local" || providerId === "ollama")
        ? { ...resolvedCapabilities, streaming: true } as any
        : resolvedCapabilities as any,
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
        capabilityCategory,
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
        capabilityCategory,
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
          `[auto-discover] Dynamic discovery returned 0 for ${JSON.stringify(providerId)}` +
          (discovery.error ? ` (${JSON.stringify(discovery.error)})` : "") +
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
    console.error(`[auto-discover] Failed for ${JSON.stringify(providerId)}: ${JSON.stringify(message)}`);
    result = { discovered: 0, profiled: 0, error: message };
  }

  // 4. Queue background evals for newly discovered/profiled models.
  // This ensures every provider activation path (OAuth, API key, first-boot,
  // startup revalidation) triggers live quality scoring without manual clicks.
  if (result.profiled > 0) {
    try {
      const provider = await prisma.modelProvider.findUnique({
        where: { providerId },
        select: {
          providerId: true,
          endpointType: true,
          category: true,
          serviceKind: true,
          authMethod: true,
          cliEngine: true,
        },
      });
      if (!canQueueBackgroundModelEvals(provider ?? {})) {
        console.log(
          `[auto-discover] Skipping background evals for ${JSON.stringify(providerId)}: ${JSON.stringify(backgroundModelEvalSkipReason(provider))}`,
        );
        return result;
      }
      const { inngest } = await import("@/lib/queue/inngest-client");
      const models = await prisma.modelProfile.findMany({
        where: { providerId, modelStatus: "active" },
        select: { modelId: true, id: true },
      });
      for (const event of buildAutoDiscoveryEvalEvents(providerId, models)) {
        await inngest.send(event);
      }
      console.log(`[auto-discover] Queued background evals for ${models.length} model(s) on ${JSON.stringify(providerId)}`);
    } catch (err) {
      // Non-fatal — catalog scores are usable even without live eval.
      // CodeQL #48 (js/tainted-format-string) + js/log-injection: constant
      // format string + JSON.stringify on each tainted positional arg.
      console.warn("[auto-discover] Failed to queue background evals for %s: %s",
        JSON.stringify(providerId),
        err instanceof Error ? JSON.stringify(err.message) : JSON.stringify(String(err)));
    }
  }

  return result;
}

/**
 * Queue deterministic dimension evals for any ACTIVE models on a provider whose
 * profiles are still un-calibrated seed priors (profileSource="seed",
 * evalCount=0). This is the catch-up path for the bundled local provider: its
 * models are seeded at install but, unlike user-configured providers, never went
 * through autoDiscoverAndProfile — so they were stuck on flat seed priors and
 * routing could not tell a strong tool-caller from a weak one.
 *
 * Safe to call repeatedly (e.g. on page-load health checks): once a model's
 * first eval completes (evalCount>=1, even if inconclusive) it no longer matches
 * the filter, so it stops re-queueing. No-op for providers ineligible for
 * background evals (OAuth-delegated, non-LLM endpoints). Returns the number of
 * models queued.
 */
export async function queueUncalibratedModelEvals(providerId: string): Promise<number> {
  const provider = await prisma.modelProvider.findUnique({
    where: { providerId },
    select: {
      providerId: true,
      endpointType: true,
      category: true,
      serviceKind: true,
      authMethod: true,
      cliEngine: true,
    },
  });
  if (!canQueueBackgroundModelEvals(provider ?? {})) {
    console.log(
      `[auto-eval] Skipping calibration evals for ${JSON.stringify(providerId)}: ${JSON.stringify(backgroundModelEvalSkipReason(provider))}`,
    );
    return 0;
  }

  const models = await prisma.modelProfile.findMany({
    where: { providerId, modelStatus: "active", profileSource: "seed", evalCount: 0 },
    select: { modelId: true, id: true },
  });
  if (models.length === 0) return 0;

  try {
    const { inngest } = await import("@/lib/queue/inngest-client");
    for (const event of buildAutoDiscoveryEvalEvents(providerId, models)) {
      await inngest.send(event);
    }
    console.log(`[auto-eval] Queued calibration evals for ${models.length} un-calibrated model(s) on ${JSON.stringify(providerId)}`);
  } catch (err) {
    // Non-fatal — seed priors remain usable until the eval runs.
    console.warn("[auto-eval] Failed to queue calibration evals for %s: %s",
      JSON.stringify(providerId),
      err instanceof Error ? JSON.stringify(err.message) : JSON.stringify(String(err)));
  }
  return models.length;
}
