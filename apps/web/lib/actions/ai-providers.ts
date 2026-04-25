"use server";

import { lazyFs, lazyPath, lazyFsPromises } from "@/lib/shared/lazy-node";
import { prisma, type Prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  computeNextRunAt,
  getTestUrl,
  type RegistryProviderEntry,
} from "@/lib/ai-provider-types";
import { encryptSecret } from "@/lib/credential-crypto";
import {
  autoDiscoverAndProfile,
  discoverModelsInternal,
  profileModelsInternal,
  getDecryptedCredential,
  getProviderExtraHeaders,
  getProviderBearerToken,
  isAnthropicProvider,
  ANTHROPIC_OAUTH_BETA_HEADERS,
  backfillModelCards,
  seedAllRecipes,
} from "@/lib/ai-provider-internals";
import { KNOWN_PROVIDER_MODELS } from "@/lib/routing/known-provider-models";
import {
  collectProviderCatalogSignals,
  summarizeCatalogSignal,
} from "@/lib/provider-catalog-reconciliation";
import { activateProvider } from "@/lib/govern/activate-provider";
import { seedAiProviderFinanceBridge } from "@/lib/finance/ai-provider-finance";

// ─── Auth helpers ─────────────────────────────────────────────────────────────

async function requireManageProviders(): Promise<string> {
  const session = await auth();
  const user = session?.user;
  if (!user || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_provider_connections")) {
    throw new Error("Unauthorized");
  }
  return user.id;
}

async function requireSession(): Promise<void> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
}

// ─── Registry sync ────────────────────────────────────────────────────────────

function getRegistryPath() { return lazyPath().join(process.cwd(), "..", "..", "packages", "db", "data", "providers-registry.json"); }

function inferServiceKindFromRegistryEntry(entry: RegistryProviderEntry): "mcp" | "built_in" | undefined {
  if (entry.endpointType !== "service") return undefined;
  if (entry.serviceKind) return entry.serviceKind;
  if (["brave-search", "public-fetch", "public-web-fetch", "branding-analyzer"].includes(entry.providerId)) {
    return "built_in";
  }
  return "mcp";
}

/**
 * Sync provider registry from local JSON file. No auth guard — called from
 * server component on page load for any view_platform holder. Use
 * triggerProviderSync() for the admin button (which adds the
 * manage_provider_connections check).
 */
export async function syncProviderRegistry(): Promise<{ added: number; updated: number; error?: string }> {
  const job = await prisma.scheduledJob.findUnique({ where: { jobId: "provider-registry-sync" } });
  let entries: RegistryProviderEntry[];

  try {
    const raw = lazyFs().readFileSync(getRegistryPath(), "utf-8");
    entries = JSON.parse(raw) as RegistryProviderEntry[];
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    if (job) {
      await prisma.scheduledJob.update({
        where: { jobId: "provider-registry-sync" },
        data: { lastRunAt: new Date(), lastStatus: "error", lastError: error },
      });
    }
    return { added: 0, updated: 0, error };
  }

  let added = 0;
  let updated = 0;

  for (const entry of entries) {
    const serviceKind = inferServiceKindFromRegistryEntry(entry);
    const existing = await prisma.modelProvider.findUnique({ where: { providerId: entry.providerId } });
    if (existing) {
      await prisma.modelProvider.update({
        where: { providerId: entry.providerId },
        data: {
          name:                 entry.name,
          families:             entry.families,
          authHeader:           entry.authHeader ?? null,
          costModel:            entry.costModel,
          category:             entry.category,
          baseUrl:              entry.baseUrl ?? null,
          supportedAuthMethods: entry.supportedAuthMethods,
          // authMethod, status, enabledFamilies, endpoint NOT overwritten — preserve admin config
          ...(entry.inputPricePerMToken !== undefined  && { inputPricePerMToken:  entry.inputPricePerMToken }),
          ...(entry.outputPricePerMToken !== undefined && { outputPricePerMToken: entry.outputPricePerMToken }),
          ...(entry.computeWatts !== undefined         && { computeWatts:         entry.computeWatts }),
          ...(entry.electricityRateKwh !== undefined   && { electricityRateKwh:   entry.electricityRateKwh }),
          docsUrl:              entry.docsUrl ?? null,
          consoleUrl:           entry.consoleUrl ?? null,
          ...((entry as Record<string, unknown>).billingLabel !== undefined && { billingLabel: (entry as Record<string, unknown>).billingLabel as string }),
          ...((entry as Record<string, unknown>).costPerformanceNotes !== undefined && { costPerformanceNotes: (entry as Record<string, unknown>).costPerformanceNotes as string }),
          ...(entry.modelRestrictions !== undefined && { modelRestrictions: entry.modelRestrictions }),
          ...(entry.catalogVisibility !== undefined && { catalogVisibility: entry.catalogVisibility }),
          ...(entry.endpointType !== undefined      && { endpointType:      entry.endpointType }),
          ...(serviceKind !== undefined             && { serviceKind }),
          ...(entry.catalogEntry !== undefined      && { catalogEntry:      entry.catalogEntry ?? undefined }),
          ...(entry.authorizeUrl !== undefined      && { authorizeUrl:      entry.authorizeUrl ?? null }),
          ...(entry.tokenUrl !== undefined          && { tokenUrl:          entry.tokenUrl ?? null }),
          ...(entry.oauthClientId !== undefined     && { oauthClientId:     entry.oauthClientId ?? null }),
          ...(entry.oauthRedirectUri !== undefined  && { oauthRedirectUri:  entry.oauthRedirectUri ?? null }),
        },
      });
      updated++;
    } else {
      await prisma.modelProvider.create({
        data: {
          providerId:           entry.providerId,
          name:                 entry.name,
          families:             entry.families,
          enabledFamilies:      [],
          status:               "unconfigured",
          category:             entry.category,
          baseUrl:              entry.baseUrl ?? null,
          authMethod:           entry.authMethod,
          supportedAuthMethods: entry.supportedAuthMethods,
          authHeader:           entry.authHeader ?? null,
          costModel:            entry.costModel,
          inputPricePerMToken:  entry.inputPricePerMToken ?? null,
          outputPricePerMToken: entry.outputPricePerMToken ?? null,
          computeWatts:         entry.computeWatts ?? null,
          electricityRateKwh:   entry.electricityRateKwh ?? null,
          docsUrl:              entry.docsUrl ?? null,
          consoleUrl:           entry.consoleUrl ?? null,
          billingLabel:         (entry as Record<string, unknown>).billingLabel as string ?? null,
          costPerformanceNotes: (entry as Record<string, unknown>).costPerformanceNotes as string ?? null,
          modelRestrictions:    entry.modelRestrictions ?? [],
          catalogVisibility:    entry.catalogVisibility ?? "visible",
          ...(entry.endpointType !== undefined && { endpointType: entry.endpointType }),
          ...(serviceKind !== undefined && { serviceKind }),
          ...(entry.catalogEntry !== undefined && entry.catalogEntry !== null && { catalogEntry: entry.catalogEntry }),
          authorizeUrl:         entry.authorizeUrl ?? null,
          tokenUrl:             entry.tokenUrl ?? null,
          oauthClientId:        entry.oauthClientId ?? null,
          oauthRedirectUri:     entry.oauthRedirectUri ?? null,
        },
      });
      added++;
    }
  }

  const now = new Date();
  if (job) {
    await prisma.scheduledJob.update({
      where: { jobId: "provider-registry-sync" },
      data: {
        lastRunAt:  now,
        lastStatus: "ok",
        lastError:  null,
        nextRunAt:  computeNextRunAt(job.schedule, now),
      },
    });
  }

  return { added, updated };
}

/** Admin button wrapper — requires manage_provider_connections. */
export async function triggerProviderSync(): Promise<{ added: number; updated: number; error?: string }> {
  await requireManageProviders();
  return syncProviderRegistry();
}

// ─── Configure provider ───────────────────────────────────────────────────────

export async function configureProvider(input: {
  providerId: string;
  enabledFamilies: string[];
  authMethod?: string;
  secretRef?: string;
  clientId?: string;
  clientSecret?: string;
  tokenEndpoint?: string;
  scope?: string;
  endpoint?: string;
  computeWatts?: number;
  electricityRateKwh?: number;
}): Promise<{ error?: string }> {
  await requireManageProviders();

  // Validate OAuth fields: if any OAuth field is provided, require the essential ones
  // (skip for oauth2_authorization_code — those fields are stored on the provider row, not credentials)
  if (input.authMethod !== "oauth2_authorization_code") {
    const hasOAuthField = input.clientId !== undefined || input.clientSecret !== undefined || input.tokenEndpoint !== undefined;
    if (hasOAuthField && (!input.clientId || !input.clientSecret || !input.tokenEndpoint)) {
      return { error: "OAuth requires Client ID, Client Secret, and Token Endpoint" };
    }
  }

  // Clear credential fields from previous auth method when switching
  if (input.authMethod) {
    const clearFields: Record<string, null> = {};
    if (input.authMethod === "api_key") {
      Object.assign(clearFields, { cachedToken: null, refreshToken: null, tokenExpiresAt: null, clientId: null, clientSecret: null, tokenEndpoint: null });
    } else if (input.authMethod === "oauth2_authorization_code") {
      Object.assign(clearFields, { secretRef: null, clientId: null, clientSecret: null, tokenEndpoint: null });
    } else if (input.authMethod === "oauth2_client_credentials") {
      Object.assign(clearFields, { secretRef: null, cachedToken: null, refreshToken: null, tokenExpiresAt: null });
    }
    if (Object.keys(clearFields).length > 0) {
      await prisma.credentialEntry.upsert({
        where: { providerId: input.providerId },
        create: { providerId: input.providerId, ...clearFields },
        update: clearFields,
      });
    }
  }

  // Upsert credential with whatever fields are provided
  const hasCredentialFields = input.secretRef !== undefined
    || input.clientId !== undefined
    || input.clientSecret !== undefined
    || input.tokenEndpoint !== undefined
    || input.scope !== undefined;

  if (hasCredentialFields) {
    const encSecretRef    = input.secretRef    !== undefined ? encryptSecret(input.secretRef)    : undefined;
    const encClientSecret = input.clientSecret !== undefined ? encryptSecret(input.clientSecret) : undefined;

    await prisma.credentialEntry.upsert({
      where: { providerId: input.providerId },
      create: {
        providerId: input.providerId,
        ...(encSecretRef !== undefined             && { secretRef: encSecretRef }),
        ...(input.clientId !== undefined           && { clientId: input.clientId }),
        ...(encClientSecret !== undefined          && { clientSecret: encClientSecret }),
        ...(input.tokenEndpoint !== undefined      && { tokenEndpoint: input.tokenEndpoint }),
        ...(input.scope !== undefined              && { scope: input.scope }),
        status: "pending",
      },
      update: {
        ...(encSecretRef !== undefined             && { secretRef: encSecretRef }),
        ...(input.clientId !== undefined           && { clientId: input.clientId }),
        ...(encClientSecret !== undefined          && { clientSecret: encClientSecret }),
        ...(input.tokenEndpoint !== undefined      && { tokenEndpoint: input.tokenEndpoint }),
        ...(input.scope !== undefined              && { scope: input.scope }),
        status: "pending",
      },
    });
  }

  // Save admin-supplied settings that are orthogonal to activation state.
  await prisma.modelProvider.update({
    where: { providerId: input.providerId },
    data: {
      enabledFamilies: input.enabledFamilies,
      ...(input.endpoint !== undefined           && { endpoint:           input.endpoint }),
      ...(input.computeWatts !== undefined       && { computeWatts:       input.computeWatts }),
      ...(input.electricityRateKwh !== undefined && { electricityRateKwh: input.electricityRateKwh }),
    },
  });

  // Activate the provider: set status → active, derive sensitivityClearance,
  // run model discovery + profiling.  Previously configureProvider left the
  // provider as "unconfigured" with null clearance, requiring a separate
  // Test Auth click — see PROVIDER-ACTIVATION-AUDIT.md F-01, F-03.
  await activateProvider(input.providerId, {
    trigger: "api_key_configure",
    authMethod: input.authMethod,
  });

  const providerForFinance = await prisma.modelProvider.findUnique({
    where: { providerId: input.providerId },
    select: {
      providerId: true,
      name: true,
      consoleUrl: true,
      docsUrl: true,
      inputPricePerMToken: true,
      outputPricePerMToken: true,
    },
  });

  if (providerForFinance) {
    seedAiProviderFinanceBridge({
      providerId: providerForFinance.providerId,
      providerName: providerForFinance.name,
      billingUrl: providerForFinance.consoleUrl ?? undefined,
      usageUrl: providerForFinance.consoleUrl ?? providerForFinance.docsUrl ?? undefined,
    }).catch((error) => {
      console.warn(
        `[ai-provider-finance] failed to seed finance bridge for ${input.providerId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  // Auto-configure Build Studio dispatch if no explicit config exists yet.
  // When a user configures a provider, the build system should automatically
  // pick it up without requiring manual Build Studio configuration.
  await autoConfigureBuildStudio(input.providerId);

  return {};
}

/**
 * If no Build Studio config exists, automatically set it based on the
 * newly configured provider. If config exists but the relevant engine's
 * providerId is empty, fill it in.
 */
async function autoConfigureBuildStudio(providerId: string): Promise<void> {
  const provider = await prisma.modelProvider.findUnique({
    where: { providerId },
    select: { cliEngine: true },
  });
  if (!provider?.cliEngine) return; // Not a CLI-dispatchable provider

  const cliEngine = provider.cliEngine as "claude" | "codex";
  const existing = await prisma.platformConfig.findUnique({
    where: { key: "build-studio-dispatch" },
  });

  if (!existing) {
    // No config at all — create one auto-selecting this engine
    const config = {
      provider: cliEngine,
      claudeProviderId: cliEngine === "claude" ? providerId : "",
      codexProviderId: cliEngine === "codex" ? providerId : "",
      claudeModel: "sonnet",
      codexModel: "",
    };
    await prisma.platformConfig.create({
      data: {
        key: "build-studio-dispatch",
        value: config as unknown as Prisma.InputJsonValue,
      },
    });
    return;
  }

  // Config exists — fill in the provider ID if it's empty for this engine
  if (existing.value && typeof existing.value === "object") {
    const config = existing.value as Record<string, unknown>;
    const claudeKey = "claudeProviderId";
    const codexKey = "codexProviderId";

    if (cliEngine === "claude" && !config[claudeKey]) {
      config[claudeKey] = providerId;
      // If currently set to agentic/codex with no codex provider, switch to claude
      if (config.provider === "agentic" || (config.provider === "codex" && !config[codexKey])) {
        config.provider = "claude";
      }
      await prisma.platformConfig.update({
        where: { key: "build-studio-dispatch" },
        data: { value: config as unknown as Prisma.InputJsonValue },
      });
    } else if (cliEngine === "codex" && !config[codexKey]) {
      config[codexKey] = providerId;
      if (config.provider === "agentic") {
        config.provider = "codex";
      }
      await prisma.platformConfig.update({
        where: { key: "build-studio-dispatch" },
        data: { value: config as unknown as Prisma.InputJsonValue },
      });
    }
  }
}

// ─── Test provider auth ───────────────────────────────────────────────────────

function buildResponsesProbeUrl(providerId: string, baseUrl: string): string {
  if (providerId === "chatgpt" || baseUrl.includes("chatgpt.com/backend-api")) {
    return `${baseUrl}/codex/responses`;
  }
  return baseUrl.endsWith("/v1") ? `${baseUrl}/responses` : `${baseUrl}/v1/responses`;
}

async function resolveResponsesProbeBaseUrl(provider: {
  providerId: string;
  authMethod: string;
  baseUrl: string | null;
  endpoint: string | null;
}): Promise<string> {
  if (provider.providerId === "codex" && provider.authMethod === "oauth2_authorization_code") {
    const chatgptProvider = await prisma.modelProvider.findUnique({
      where: { providerId: "chatgpt" },
      select: { baseUrl: true, endpoint: true },
    });
    return chatgptProvider?.baseUrl ?? chatgptProvider?.endpoint ?? "https://chatgpt.com/backend-api";
  }
  return provider.baseUrl ?? provider.endpoint ?? "";
}

function buildResponsesProbeBody(providerId: string): Record<string, unknown> {
  return {
    model: providerId === "chatgpt" ? "gpt-5.4" : "gpt-5.3-codex",
    input: [{ role: "user", content: "ping" }],
    store: false,
  };
}

function formatResponsesScopeError(body: string): string | null {
  if (!body.includes("api.responses.write")) return null;
  return "OAuth token is missing Responses API scope (api.responses.write) — disconnect and sign in again";
}

export async function testProviderAuth(providerId: string): Promise<{ ok: boolean; message: string }> {
  await requireManageProviders();

  const provider = await prisma.modelProvider.findUnique({ where: { providerId } });
  if (!provider) return { ok: false, message: "Provider not found" };

  const providerRow = {
    ...provider,
    families: provider.families as string[],
    enabledFamilies: provider.enabledFamilies as string[],
    supportedAuthMethods: provider.supportedAuthMethods as string[],
  };

  const testUrl = getTestUrl(providerRow);
  if (!testUrl) return { ok: false, message: "No base URL or custom endpoint configured" };

  const headers: Record<string, string> = {
    ...getProviderExtraHeaders(providerId),
  };

  if (provider.authMethod === "api_key") {
    const credential = await getDecryptedCredential(providerId);
    if (!credential?.secretRef) return { ok: false, message: "No API key configured" };

    if (provider.authHeader) {
      headers[provider.authHeader] = provider.authHeader === "Authorization"
        ? `Bearer ${credential.secretRef}`
        : credential.secretRef;
    }
  } else if (provider.authMethod === "oauth2_client_credentials") {
    const tokenResult = await getProviderBearerToken(providerId);
    if ("error" in tokenResult) return { ok: false, message: tokenResult.error };
    headers["Authorization"] = `Bearer ${tokenResult.token}`;
  } else if (provider.authMethod === "oauth2_authorization_code") {
    const tokenResult = await getProviderBearerToken(providerId);
    if ("error" in tokenResult) return { ok: false, message: tokenResult.error };
    headers["Authorization"] = `Bearer ${tokenResult.token}`;
    if (isAnthropicProvider(providerId)) {
      headers["anthropic-beta"] = ANTHROPIC_OAUTH_BETA_HEADERS;
    }
  }
  // authMethod === "none" → no headers needed

  try {
    let res: Response;

    // Agent providers (e.g. Codex) and ChatGPT subscription use the Responses
    // API, so verify the actual execution path instead of /models.
    if (provider.authMethod === "oauth2_authorization_code" &&
        (provider.category === "agent" || providerId === "chatgpt")) {
      const cred = await prisma.credentialEntry.findUnique({ where: { providerId } });
      if (!cred?.status || !cred.cachedToken) {
        return { ok: false, message: "OAuth token not found — sign in again" };
      }

      const baseUrl = await resolveResponsesProbeBaseUrl(provider);
      const responsesUrl = buildResponsesProbeUrl(providerId, baseUrl);
      headers["Content-Type"] = "application/json";
      res = await fetch(responsesUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(buildResponsesProbeBody(providerId)),
        signal: AbortSignal.timeout(15_000),
      });

      if (res.ok || res.status === 400) {
        await activateProvider(providerId, { trigger: "test_auth" });
        return { ok: true, message: "Connected via OAuth — Responses API verified" };
      }

      const body = await res.text().catch(() => "");
      const scopeError = formatResponsesScopeError(body);
      if (scopeError) {
        return { ok: false, message: scopeError };
      }
      return { ok: false, message: `HTTP ${res.status} — ${body.slice(0, 200)}` };
    }

    // Anthropic subscription tokens (OAuth) can't access /models — test with a minimal /messages call instead
    if (isAnthropicProvider(providerId) && provider.authMethod === "oauth2_authorization_code") {
      const baseUrl = provider.baseUrl ?? provider.endpoint ?? "";
      const messagesUrl = `${baseUrl}/messages`;
      headers["Content-Type"] = "application/json";
      res = await fetch(messagesUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1,
          messages: [{ role: "user", content: "hi" }],
        }),
        signal: AbortSignal.timeout(15_000),
      });
      // A 200 or even a 400 "max_tokens too low" means auth worked
      if (res.ok || res.status === 400) {
        await activateProvider(providerId, { trigger: "test_auth" });
        return { ok: true, message: `Connected via subscription token — auth verified` };
      }
      const body = await res.text().catch(() => "");
      return { ok: false, message: `HTTP ${res.status} — ${body.slice(0, 200)}` };
    }

    res = await fetch(testUrl, { headers, signal: AbortSignal.timeout(8_000) });
    if (res.ok) {
      // Clearance derived automatically: local/ollama → 4 levels, cloud → 3 levels
      await activateProvider(providerId, { trigger: "test_auth" });
      return { ok: true, message: `Connected — HTTP ${res.status}` };
    }
    return { ok: false, message: `HTTP ${res.status} — ${res.statusText}` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Network error" };
  }
}

// ─── Enable / Disable provider ───────────────────────────────────────────────

export async function toggleProviderStatus(
  providerId: string,
): Promise<{ status: string; warning: string | null }> {
  await requireManageProviders();

  const provider = await prisma.modelProvider.findUnique({
    where: { providerId },
    select: { status: true },
  });
  if (!provider) throw new Error("Provider not found");

  const newStatus = provider.status === "active" ? "inactive" : "active";
  await prisma.modelProvider.update({
    where: { providerId },
    data: { status: newStatus },
  });

  // EP-AGENT-CAP-002: Warn if activated provider has no models with active capabilities
  let warning: string | null = null;
  if (newStatus === "active") {
    const activeModels = await prisma.modelProfile.findMany({
      where: { providerId, modelStatus: { in: ["active", "degraded"] } },
      select: { capabilities: true },
    });

    const hasActiveCapability = activeModels.some((m) => {
      const caps = m.capabilities as Record<string, unknown> | null;
      return (
        caps?.toolUse === true ||
        caps?.imageInput === true ||
        caps?.pdfInput === true ||
        caps?.codeExecution === true
      );
    });

    if (!hasActiveCapability) {
      warning =
        "This provider's models have no active capabilities (toolUse, imageInput, pdfInput, codeExecution). " +
        "It will not be eligible for routing to any registered coworker. " +
        "It may still be used for passive chat workflows.";
    }
  }

  return { status: newStatus, warning };
}

// ─── Model discovery ─────────────────────────────────────────────────────────

export async function discoverModels(
  providerId: string,
): Promise<{ discovered: number; newCount: number; error?: string; warning?: string }> {
  await requireManageProviders();
  if (KNOWN_PROVIDER_MODELS[providerId]) {
    const signal = await collectProviderCatalogSignals(providerId);
    const seeded = await autoDiscoverAndProfile(providerId);
    return {
      discovered: seeded.discovered,
      newCount: seeded.discovered,
      error: seeded.error,
      warning: signal.warning,
    };
  }
  return discoverModelsInternal(providerId);
}

const PROVIDER_CATALOG_RECONCILIATION_JOB_ID = "provider-catalog-reconciliation";
const PROVIDER_CATALOG_RECONCILIATION_JOB_NAME = "Provider Catalog Reconciliation";

async function runProviderCatalogReconciliationInternal(): Promise<string[]> {
  const summaries: string[] = [];
  for (const providerId of Object.keys(KNOWN_PROVIDER_MODELS)) {
    const signal = await collectProviderCatalogSignals(providerId);
    const seeded = await autoDiscoverAndProfile(providerId);
    const baseSummary = summarizeCatalogSignal(signal);
    summaries.push(
      `${baseSummary} seeded=${seeded.discovered}/${seeded.profiled}${seeded.error ? ` seed_error=${seeded.error}` : ""}`,
    );
  }
  return summaries;
}

export async function runProviderCatalogReconciliationIfDue(): Promise<void> {
  const now = new Date();
  let job;
  try {
    job = await prisma.scheduledJob.upsert({
      where: { jobId: PROVIDER_CATALOG_RECONCILIATION_JOB_ID },
      create: {
        jobId: PROVIDER_CATALOG_RECONCILIATION_JOB_ID,
        name: PROVIDER_CATALOG_RECONCILIATION_JOB_NAME,
        schedule: "weekly",
        nextRunAt: now,
      },
      update: {},
    });
  } catch (err: unknown) {
    // Prisma upsert can race under concurrent requests (P2002).
    // Fall back to a plain read — the other request created the row.
    if ((err as { code?: string }).code === "P2002") {
      job = await prisma.scheduledJob.findUnique({
        where: { jobId: PROVIDER_CATALOG_RECONCILIATION_JOB_ID },
      });
      if (!job) return;
    } else {
      throw err;
    }
  }
  if (job.schedule === "disabled") return;

  const neverRun = !job.lastRunAt;
  const isDue = job.nextRunAt && job.nextRunAt <= now;
  if (!neverRun && !isDue) return;

  await prisma.scheduledJob.update({
    where: { jobId: PROVIDER_CATALOG_RECONCILIATION_JOB_ID },
    data: { lastRunAt: now, lastStatus: "running" },
  });

  try {
    const summaries = await runProviderCatalogReconciliationInternal();
    await prisma.scheduledJob.update({
      where: { jobId: PROVIDER_CATALOG_RECONCILIATION_JOB_ID },
      data: {
        lastStatus: "ok",
        lastError: summaries.join(" | ").slice(0, 1000),
        nextRunAt: computeNextRunAt(job.schedule, now),
      },
    });
  } catch (err) {
    await prisma.scheduledJob.update({
      where: { jobId: PROVIDER_CATALOG_RECONCILIATION_JOB_ID },
      data: {
        lastStatus: "error",
        lastError: err instanceof Error ? err.message.slice(0, 1000) : "Provider catalog reconciliation failed",
        nextRunAt: computeNextRunAt(job.schedule, now),
      },
    });
  }
}

// ─── Scheduled jobs ───────────────────────────────────────────────────────────

export async function updateScheduledJob(input: { jobId: string; schedule: string }): Promise<void> {
  await requireManageProviders();
  const nextRunAt = computeNextRunAt(input.schedule, new Date());
  // infra-ci-prune may not exist yet — upsert so the first schedule change creates it
  if (input.jobId === "infra-ci-prune" || input.jobId === PROVIDER_CATALOG_RECONCILIATION_JOB_ID) {
    const name = input.jobId === "infra-ci-prune"
      ? "Infrastructure CI Prune"
      : PROVIDER_CATALOG_RECONCILIATION_JOB_NAME;
    await prisma.scheduledJob.upsert({
      where:  { jobId: input.jobId },
      create: { jobId: input.jobId, name, schedule: input.schedule, nextRunAt },
      update: { schedule: input.schedule, nextRunAt },
    });
    return;
  }
  await prisma.scheduledJob.update({
    where: { jobId: input.jobId },
    data: { schedule: input.schedule, nextRunAt },
  });
}

export async function runScheduledJobNow(jobId: string): Promise<void> {
  await requireManageProviders();
  if (jobId === "provider-registry-sync") {
    await syncProviderRegistry();
    return;
  }
  if (jobId === "mcp-catalog-sync") {
    const { triggerMcpCatalogSync } = await import("@/lib/actions/mcp-catalog");
    await triggerMcpCatalogSync();
    return;
  }
  if (jobId === "infra-ci-prune") {
    const { runInfraPruneNow } = await import("@/lib/actions/infra-prune");
    await runInfraPruneNow();
    return;
  }
  if (jobId === PROVIDER_CATALOG_RECONCILIATION_JOB_ID) {
    await runProviderCatalogReconciliationIfDue();
    return;
  }
  console.warn(`runScheduledJobNow: unknown jobId "${jobId}"`);
}

// ─── Model profiling ──────────────────────────────────────────────────────────

export async function profileModels(
  providerId: string,
  modelIds?: string[],
): Promise<{ profiled: number; failed: number; error?: string }> {
  await requireManageProviders();
  return profileModelsInternal(providerId, modelIds);
}

// ─── Model Verification (post-profiling) ─────────────────────────────────────

export async function verifyProviderModels(
  providerId: string,
): Promise<{ verified: number; passed: number; failed: number; error?: string }> {
  const userId = await requireManageProviders();
  try {
    const { verifyModels } = await import("@/lib/endpoint-test-runner");
    return verifyModels(providerId, userId);
  } catch (err) {
    return { verified: 0, passed: 0, failed: 0, error: err instanceof Error ? err.message : "Verification failed" };
  }
}

// ─── Agent Provider Assignment ──────────────────────────────────────────────

/**
 * EP-AI-WORKFORCE-001: Pin agent to a specific provider via AgentModelConfig.
 * Replaces the deprecated Agent.preferredProviderId column.
 */
export async function updateAgentPreferredProvider(
  agentId: string,
  preferredProviderId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  await requireManageProviders();
  const agent = await prisma.agent.findUnique({
    where: { agentId },
    select: { slugId: true, agentId: true },
  });
  if (!agent) return { ok: false, error: "Agent not found" };

  const configKey = agent.slugId ?? agent.agentId;
  await prisma.agentModelConfig.upsert({
    where: { agentId: configKey },
    create: {
      agentId: configKey,
      minimumTier: "adequate",
      budgetClass: "balanced",
      pinnedProviderId: preferredProviderId,
    },
    update: {
      pinnedProviderId: preferredProviderId,
    },
  });
  return { ok: true };
}

// ─── Platform API Keys (admin-configurable) ──────────────────────────────────

export async function savePlatformApiKey(
  key: string,
  value: string,
): Promise<{ ok: true }> {
  await requireManageProviders();

  const allowedKeys = [
    "brave_search_api_key",
    "upload_storage_path",
    "google_client_id",
    "google_client_secret",
    "apple_client_id",
    "apple_client_secret",
    "apple_team_id",
    "apple_key_id",
  ];
  if (!allowedKeys.includes(key)) throw new Error(`Unknown platform key: ${key}`);

  await prisma.platformConfig.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });

  // If a social auth credential was saved, sync all credentials to process.env
  // so NextAuth picks them up without a server restart
  const socialKeys = ["google_client_id", "google_client_secret", "apple_client_id", "apple_client_secret", "apple_team_id", "apple_key_id"];
  if (socialKeys.includes(key)) {
    const { syncSocialAuthCredentials } = await import("@/lib/auth");
    await syncSocialAuthCredentials();
  }

  return { ok: true };
}

export async function getPlatformApiKeyStatus(
  key: string,
): Promise<{ configured: boolean }> {
  await requireManageProviders();

  const config = await prisma.platformConfig.findUnique({
    where: { key },
    select: { value: true },
  });

  return { configured: !!config && typeof config.value === "string" && config.value.length > 0 };
}

// ─── MCP Service Detection & Registration ────────────────────────────────────

export type DetectedMcpService = {
  serverId: string;
  name: string;
  source: "database" | "plugin";
  config: Record<string, unknown>;
};

export async function detectMcpServers(): Promise<DetectedMcpService[]> {
  const detected: DetectedMcpService[] = [];

  // Source 1: McpServer table
  const mcpServers = await prisma.mcpServer.findMany();
  for (const server of mcpServers) {
    const existing = await prisma.modelProvider.findUnique({
      where: { providerId: server.serverId },
    });
    if (!existing) {
      detected.push({
        serverId: server.serverId,
        name: server.name,
        source: "database",
        config: (server.config as Record<string, unknown>) ?? {},
      });
    }
  }

  // Source 2: Claude plugins (best-effort, file may not exist)
  try {
    const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
    const pluginsPath = lazyPath().join(home, ".claude", "plugins", "installed_plugins.json");
    const raw = await lazyFsPromises().readFile(pluginsPath, "utf-8");
    const plugins = JSON.parse(raw) as Array<{ package_name?: string; name?: string }>;

    for (const plugin of plugins) {
      const id = plugin.package_name ?? plugin.name;
      if (!id) continue;
      const existing = await prisma.modelProvider.findUnique({
        where: { providerId: id },
      });
      if (!existing && !detected.some((d) => d.serverId === id)) {
        detected.push({
          serverId: id,
          name: plugin.name ?? id,
          source: "plugin",
          config: {},
        });
      }
    }
  } catch {
    // Plugins file not found or not readable — skip silently
  }

  return detected;
}

export async function registerMcpService(input: {
  providerId: string;
  name: string;
  sensitivityClearance: string[];
  capabilityTier: string;
  costBand: string;
  taskTags: string[];
}): Promise<void> {
  await requireManageProviders();

  await prisma.modelProvider.upsert({
    where: { providerId: input.providerId },
    update: {
      name: input.name,
      endpointType: "service",
      serviceKind: "mcp",
      category: "mcp-subscribed",
      sensitivityClearance: input.sensitivityClearance,
      capabilityTier: input.capabilityTier,
      costBand: input.costBand,
      taskTags: input.taskTags,
      status: "active",
    },
    create: {
      providerId: input.providerId,
      name: input.name,
      endpointType: "service",
      serviceKind: "mcp",
      category: "mcp-subscribed",
      sensitivityClearance: input.sensitivityClearance,
      capabilityTier: input.capabilityTier,
      costBand: input.costBand,
      taskTags: input.taskTags,
      status: "active",
      families: [],
      enabledFamilies: [],
      costModel: "token",
      authMethod: "none",
      supportedAuthMethods: ["none"],
    },
  });
}

// ─── EP-INF-007: Routing backfill & recipe seeding ───────────────────────────

/**
 * Admin action: backfill ModelCard fields for all existing ModelProfiles,
 * then seed execution recipes for all active/degraded models.
 * Requires manage_provider_connections capability.
 */
export async function runRoutingBackfillAndSeed(): Promise<{
  backfilledCards: number;
  seededRecipes: number;
  error?: string;
}> {
  await requireManageProviders();

  try {
    const backfilledCards = await backfillModelCards();
    console.log(`[routing-backfill] Backfilled ${backfilledCards} model card(s)`);

    const seededRecipes = await seedAllRecipes();
    console.log(`[routing-backfill] Seeded ${seededRecipes} recipe(s)`);

    return { backfilledCards, seededRecipes };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[routing-backfill] Failed:", message);
    return { backfilledCards: 0, seededRecipes: 0, error: message };
  }
}
