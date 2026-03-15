// apps/web/lib/ai-provider-priority.ts
// Provider priority management and failover engine.

import { prisma, type Prisma } from "@dpf/db";
import { callProvider, logTokenUsage, InferenceError } from "@/lib/ai-inference";
import type { ChatMessage, InferenceResult } from "@/lib/ai-inference";
import {
  filterProviderPriorityBySensitivity,
  type ProviderPolicyInfo,
  type RouteSensitivity,
} from "@/lib/agent-sensitivity";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ProviderPriorityEntry = {
  providerId: string;
  modelId: string;
  rank: number;
  capabilityTier: string;
};

export type FailoverResult = InferenceResult & {
  providerId: string;
  modelId: string;
  downgraded: boolean;
  downgradeMessage: string | null;
};

export class NoProvidersAvailableError extends Error {
  constructor(public readonly attempts: Array<{ providerId: string; error: string }>) {
    super(`All ${attempts.length} provider(s) failed`);
    this.name = "NoProvidersAvailableError";
  }
}

export class NoAllowedProvidersForSensitivityError extends Error {
  constructor(public readonly sensitivity: RouteSensitivity) {
    super(`No providers allowed for sensitivity ${sensitivity}`);
    this.name = "NoAllowedProvidersForSensitivityError";
  }
}

// ─── Skip patterns for non-chat models ───────────────────────────────────────

const NON_CHAT_PATTERN = /embed|whisper|tts|dall-e|moderation|babbage|davinci-00|text-search|text-similarity|audio|image/i;

// ─── Bootstrap Priority (no PlatformConfig yet) ─────────────────────────────

async function buildBootstrapPriority(): Promise<ProviderPriorityEntry[]> {
  const providers = await prisma.modelProvider.findMany({
    where: { status: "active" },
    orderBy: { outputPricePerMToken: "asc" },
    select: { providerId: true, name: true, outputPricePerMToken: true },
  });

  const entries: ProviderPriorityEntry[] = [];

  for (let i = 0; i < providers.length; i++) {
    const p = providers[i]!;

    // Try ModelProfile first (has capabilityTier)
    const profile = await prisma.modelProfile.findFirst({
      where: { providerId: p.providerId },
      orderBy: [{ capabilityTier: "desc" }, { costTier: "asc" }],
      select: { modelId: true, capabilityTier: true },
    });

    if (profile && !NON_CHAT_PATTERN.test(profile.modelId)) {
      entries.push({
        providerId: p.providerId,
        modelId: profile.modelId,
        rank: i + 1,
        capabilityTier: profile.capabilityTier ?? "unknown",
      });
      continue;
    }

    // Fall back to DiscoveredModel
    const discovered = await prisma.discoveredModel.findFirst({
      where: {
        providerId: p.providerId,
        NOT: { modelId: { contains: "embed" } }, // basic filter, NON_CHAT_PATTERN applied below
      },
      orderBy: { modelId: "asc" },
      select: { modelId: true },
    });

    if (discovered && !NON_CHAT_PATTERN.test(discovered.modelId)) {
      entries.push({
        providerId: p.providerId,
        modelId: discovered.modelId,
        rank: i + 1,
        capabilityTier: "unknown",
      });
    }
  }

  return entries;
}

// ─── Get Priority ────────────────────────────────────────────────────────────

export async function getProviderPriority(): Promise<ProviderPriorityEntry[]> {
  const config = await prisma.platformConfig.findUnique({
    where: { key: "provider_priority" },
  });

  if (config) {
    const entries = config.value as ProviderPriorityEntry[];
    if (Array.isArray(entries) && entries.length > 0) {
      return entries.sort((a, b) => a.rank - b.rank);
    }
  }

  // No config yet — bootstrap from active providers
  return buildBootstrapPriority();
}

async function getActiveProviderPolicyInfo(): Promise<ProviderPolicyInfo[]> {
  const providers = await prisma.modelProvider.findMany({
    where: { status: "active" },
    select: { providerId: true, costModel: true, category: true },
  });

  return providers.map((provider) => ({
    providerId: provider.providerId,
    costModel: provider.costModel,
    category: provider.category,
  }));
}

// ─── Failover Engine ─────────────────────────────────────────────────────────

const MAX_CASCADE_DEPTH = 5;

export async function callWithFailover(
  messages: ChatMessage[],
  systemPrompt: string,
  sensitivity: RouteSensitivity = "internal",
  options?: { tools?: Array<Record<string, unknown>> },
): Promise<FailoverResult> {
  const priority = await getProviderPriority();
  const providerPolicy = await getActiveProviderPolicyInfo();
  const filteredPriority = filterProviderPriorityBySensitivity(priority, providerPolicy, sensitivity);
  if (filteredPriority.length === 0) {
    throw new NoAllowedProvidersForSensitivityError(sensitivity);
  }

  const baselineTier = filteredPriority[0]!.capabilityTier;
  const attempts: Array<{ providerId: string; error: string }> = [];
  const limit = Math.min(filteredPriority.length, MAX_CASCADE_DEPTH);

  for (let i = 0; i < limit; i++) {
    const entry = filteredPriority[i]!;
    try {
      const result = await callProvider(entry.providerId, entry.modelId, messages, systemPrompt, options?.tools);

      const downgraded = entry.capabilityTier !== baselineTier && entry.capabilityTier !== "unknown" && baselineTier !== "unknown";

      // Look up provider name for the message
      let downgradeMessage: string | null = null;
      if (downgraded) {
        const failedName = filteredPriority[0]!.providerId;
        const usedProvider = await prisma.modelProvider.findUnique({
          where: { providerId: entry.providerId },
          select: { name: true },
        });
        downgradeMessage = `${failedName} is unavailable. Using ${usedProvider?.name ?? entry.providerId} (lower capability) — results may be less accurate.`;
      }

      return {
        ...result,
        providerId: entry.providerId,
        modelId: entry.modelId,
        downgraded,
        downgradeMessage,
      };
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      attempts.push({ providerId: entry.providerId, error: errMsg });
      console.warn(`[callWithFailover] ${entry.providerId} failed: ${errMsg}`);
    }
  }

  throw new NoProvidersAvailableError(attempts);
}

// ─── Weekly Optimization Agent ───────────────────────────────────────────────

export async function optimizeProviderPriority(): Promise<{ ranked: number }> {
  const providers = await prisma.modelProvider.findMany({
    where: { status: "active" },
    select: { providerId: true, name: true },
  });

  const entries: ProviderPriorityEntry[] = [];

  for (const p of providers) {
    // Best chat-capable model by capability (desc) then cost (asc)
    const profile = await prisma.modelProfile.findFirst({
      where: { providerId: p.providerId },
      orderBy: [{ capabilityTier: "desc" }, { costTier: "asc" }],
      select: { modelId: true, capabilityTier: true, costTier: true },
    });

    if (profile && !NON_CHAT_PATTERN.test(profile.modelId)) {
      entries.push({
        providerId: p.providerId,
        modelId: profile.modelId,
        rank: 0, // will be set after sorting
        capabilityTier: profile.capabilityTier ?? "unknown",
      });
      continue;
    }

    // Fallback: first chat-capable discovered model
    const discovered = await prisma.discoveredModel.findFirst({
      where: { providerId: p.providerId },
      orderBy: { modelId: "asc" },
      select: { modelId: true },
    });

    if (discovered && !NON_CHAT_PATTERN.test(discovered.modelId)) {
      entries.push({
        providerId: p.providerId,
        modelId: discovered.modelId,
        rank: 0,
        capabilityTier: "unknown",
      });
    }
  }

  // Sort: capability tier desc, then cost tier asc (deep-thinker > fast-worker > specialist > budget)
  const TIER_ORDER: Record<string, number> = {
    "deep-thinker": 4,
    "fast-worker": 3,
    "specialist": 2,
    "budget": 1,
    "embedding": 0,
    "unknown": 0,
  };

  entries.sort((a, b) => {
    const aTier = TIER_ORDER[a.capabilityTier] ?? 0;
    const bTier = TIER_ORDER[b.capabilityTier] ?? 0;
    return bTier - aTier; // descending by capability
  });

  // Assign ranks
  for (let i = 0; i < entries.length; i++) {
    entries[i]!.rank = i + 1;
  }

  // Persist priority list
  await prisma.platformConfig.upsert({
    where: { key: "provider_priority" },
    update: { value: entries as unknown as Prisma.InputJsonValue },
    create: { key: "provider_priority", value: entries as unknown as Prisma.InputJsonValue },
  });

  // Update ScheduledJob record
  const nextRunAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // next week
  await prisma.scheduledJob.updateMany({
    where: { jobId: "provider-priority-optimizer" },
    data: { lastRunAt: new Date(), lastStatus: "ok", nextRunAt },
  });

  return { ranked: entries.length };
}
