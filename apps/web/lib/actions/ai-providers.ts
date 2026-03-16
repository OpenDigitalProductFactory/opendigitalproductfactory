"use server";

import { readFileSync } from "fs";
import { join } from "path";
import { revalidatePath } from "next/cache";
import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  computeNextRunAt,
  getTestUrl,
  type RegistryProviderEntry,
} from "@/lib/ai-provider-types";
import { encryptSecret } from "@/lib/credential-crypto";
import {
  discoverModelsInternal,
  profileModelsInternal,
  getDecryptedCredential,
  getProviderExtraHeaders,
  getProviderBearerToken,
} from "@/lib/ai-provider-internals";

// ─── Auth helpers ─────────────────────────────────────────────────────────────

async function requireManageProviders(): Promise<void> {
  const session = await auth();
  const user = session?.user;
  if (!user || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_provider_connections")) {
    throw new Error("Unauthorized");
  }
}

async function requireSession(): Promise<void> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
}

// ─── Registry sync ────────────────────────────────────────────────────────────

const REGISTRY_PATH = join(process.cwd(), "..", "..", "packages", "db", "data", "providers-registry.json");

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
    const raw = readFileSync(REGISTRY_PATH, "utf-8");
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
  const hasOAuthField = input.clientId !== undefined || input.clientSecret !== undefined || input.tokenEndpoint !== undefined;
  if (hasOAuthField && (!input.clientId || !input.clientSecret || !input.tokenEndpoint)) {
    return { error: "OAuth requires Client ID, Client Secret, and Token Endpoint" };
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

  await prisma.modelProvider.update({
    where: { providerId: input.providerId },
    data: {
      enabledFamilies: input.enabledFamilies,
      ...(input.authMethod !== undefined         && { authMethod:         input.authMethod }),
      ...(input.endpoint !== undefined           && { endpoint:           input.endpoint }),
      ...(input.computeWatts !== undefined       && { computeWatts:       input.computeWatts }),
      ...(input.electricityRateKwh !== undefined && { electricityRateKwh: input.electricityRateKwh }),
    },
  });

  return {};
}

// ─── Test provider auth ───────────────────────────────────────────────────────

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
  }
  // authMethod === "none" → no headers needed

  try {
    const res = await fetch(testUrl, { headers, signal: AbortSignal.timeout(8_000) });
    if (res.ok) {
      await prisma.modelProvider.update({ where: { providerId }, data: { status: "active" } });
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
): Promise<{ status: string }> {
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

  return { status: newStatus };
}

// ─── Model discovery ─────────────────────────────────────────────────────────

export async function discoverModels(
  providerId: string,
): Promise<{ discovered: number; newCount: number; error?: string }> {
  await requireManageProviders();
  const result = await discoverModelsInternal(providerId);
  revalidatePath(`/platform/ai/providers/${providerId}`);
  return result;
}

// ─── Scheduled jobs ───────────────────────────────────────────────────────────

export async function updateScheduledJob(input: { jobId: string; schedule: string }): Promise<void> {
  await requireManageProviders();
  const nextRunAt = computeNextRunAt(input.schedule, new Date());
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
  console.warn(`runScheduledJobNow: unknown jobId "${jobId}"`);
}

// ─── Model profiling ──────────────────────────────────────────────────────────

export async function profileModels(
  providerId: string,
  modelIds?: string[],
): Promise<{ profiled: number; failed: number; error?: string }> {
  await requireManageProviders();
  const result = await profileModelsInternal(providerId, modelIds);
  revalidatePath(`/platform/ai/providers/${providerId}`);
  return result;
}

// ─── Platform API Keys (admin-configurable) ──────────────────────────────────

export async function savePlatformApiKey(
  key: string,
  value: string,
): Promise<{ ok: true }> {
  await requireManageProviders();

  const allowedKeys = ["brave_search_api_key", "upload_storage_path"];
  if (!allowedKeys.includes(key)) throw new Error(`Unknown platform key: ${key}`);

  await prisma.platformConfig.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });

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
