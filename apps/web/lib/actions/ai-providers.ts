"use server";

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  computeTokenCost,
  computeComputeCost,
  computeNextRunAt,
  type RegistryProviderEntry,
} from "@/lib/ai-provider-types";

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

const REGISTRY_URL =
  "https://raw.githubusercontent.com/markdbodman/opendigitalproductfactory/main/packages/db/data/providers-registry.json";

/**
 * Sync provider registry from GitHub. No auth guard — called from server component
 * on page load for any view_platform holder. Use triggerProviderSync() for the
 * admin button (which adds the manage_provider_connections check).
 */
export async function syncProviderRegistry(): Promise<{ added: number; updated: number; error?: string }> {
  const job = await prisma.scheduledJob.findUnique({ where: { jobId: "provider-registry-sync" } });
  let entries: RegistryProviderEntry[];

  try {
    const res = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    entries = (await res.json()) as RegistryProviderEntry[];
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
          authEndpoint:         entry.authEndpoint ?? null,
          authHeader:           entry.authHeader ?? null,
          costModel:            entry.costModel,
          ...(entry.inputPricePerMToken !== undefined  && { inputPricePerMToken:  entry.inputPricePerMToken }),
          ...(entry.outputPricePerMToken !== undefined && { outputPricePerMToken: entry.outputPricePerMToken }),
          ...(entry.computeWatts !== undefined         && { computeWatts:         entry.computeWatts }),
          ...(entry.electricityRateKwh !== undefined   && { electricityRateKwh:   entry.electricityRateKwh }),
          // status and enabledFamilies deliberately NOT updated — preserve admin config
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
          authEndpoint:         entry.authEndpoint ?? null,
          authHeader:           entry.authHeader ?? null,
          costModel:            entry.costModel,
          inputPricePerMToken:  entry.inputPricePerMToken ?? null,
          outputPricePerMToken: entry.outputPricePerMToken ?? null,
          computeWatts:         entry.computeWatts ?? null,
          electricityRateKwh:   entry.electricityRateKwh ?? null,
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
  secretRef?: string;
  endpoint?: string;
  computeWatts?: number;
  electricityRateKwh?: number;
}): Promise<{ error?: string }> {
  await requireManageProviders();

  if (input.secretRef !== undefined) {
    await prisma.credentialEntry.upsert({
      where:  { providerId: input.providerId },
      create: { providerId: input.providerId, secretRef: input.secretRef, status: "pending" },
      update: { secretRef: input.secretRef, status: "pending" },
    });
  }

  await prisma.modelProvider.update({
    where: { providerId: input.providerId },
    data: {
      enabledFamilies: input.enabledFamilies,
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

  const credential = await prisma.credentialEntry.findUnique({ where: { providerId } });

  // Guard: keyed providers need a credential with a secretRef
  if (provider.authHeader !== null) {
    if (!credential || credential.secretRef === null) {
      return { ok: false, message: "No credential configured" };
    }
    if (process.env[credential.secretRef] === undefined) {
      return { ok: false, message: `Environment variable not set: ${credential.secretRef}` };
    }
  }

  // Guard: Azure OpenAI-style providers need a custom endpoint
  if (provider.authEndpoint === null && provider.endpoint === null) {
    return { ok: false, message: "Custom endpoint required" };
  }

  const authUrl = provider.endpoint
    ? `${provider.endpoint}/openai/models?api-version=2024-02-01`
    : (provider.authEndpoint as string);

  const headers: Record<string, string> = {};
  if (provider.authHeader !== null && credential?.secretRef) {
    const apiKey = process.env[credential.secretRef];
    if (apiKey !== undefined) {
      headers[provider.authHeader] = provider.authHeader === "Authorization"
        ? `Bearer ${apiKey}`
        : apiKey;
    }
  }

  try {
    const res = await fetch(authUrl, {
      headers,
      signal: AbortSignal.timeout(8_000),
    });

    if (res.ok) {
      await prisma.modelProvider.update({ where: { providerId }, data: { status: "active" } });
      if (credential) {
        await prisma.credentialEntry.update({ where: { providerId }, data: { status: "ok" } });
      }
      return { ok: true, message: `Connected — HTTP ${res.status}` };
    } else {
      if (credential) {
        await prisma.credentialEntry.update({ where: { providerId }, data: { status: "error" } });
      }
      return { ok: false, message: `HTTP ${res.status} — ${res.statusText}` };
    }
  } catch (err) {
    if (credential) {
      await prisma.credentialEntry.update({ where: { providerId }, data: { status: "error" } });
    }
    return { ok: false, message: err instanceof Error ? err.message : "Network error" };
  }
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

// ─── Token usage logging ──────────────────────────────────────────────────────

export async function logTokenUsage(input: {
  agentId: string;
  providerId: string;
  contextKey: string;
  inputTokens: number;
  outputTokens: number;
  inferenceMs?: number;
}): Promise<void> {
  await requireSession();

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
