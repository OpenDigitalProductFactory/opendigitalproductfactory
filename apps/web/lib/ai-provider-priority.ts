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

export type TaskKey = "conversation" | "code_generation" | "analysis";

export type TaskAwarePriority = {
  conversation: ProviderPriorityEntry[];
  code_generation: ProviderPriorityEntry[];
  analysis?: ProviderPriorityEntry[];
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
      continue;
    }

    // Active provider with no discovered/profiled models in DB — still include
    // it as a fallback. Ollama and similar local providers can self-select a
    // model even if discovery hasn't run yet.
    entries.push({
      providerId: p.providerId,
      modelId: "",
      rank: i + 1,
      capabilityTier: "unknown",
    });
  }

  return entries;
}

// ─── Task-Aware Resolution ──────────────────────────────────────────────────

export function resolveTaskPriority(
  stored: ProviderPriorityEntry[] | TaskAwarePriority,
  task: string,
): ProviderPriorityEntry[] {
  if (Array.isArray(stored)) return stored;
  const key = task as keyof TaskAwarePriority;
  const entries = stored[key];
  if (Array.isArray(entries) && entries.length > 0) return entries;
  return stored.conversation ?? [];
}

// ─── Get Priority ────────────────────────────────────────────────────────────

export async function getProviderPriority(task: string = "conversation"): Promise<ProviderPriorityEntry[]> {
  const config = await prisma.platformConfig.findUnique({
    where: { key: "provider_priority" },
  });

  if (config) {
    const stored = config.value as ProviderPriorityEntry[] | TaskAwarePriority;
    const entries = resolveTaskPriority(stored, task);
    if (entries.length > 0) {
      // Filter out providers that are no longer active (disabled, quota-hit, etc.)
      const activeProviders = await prisma.modelProvider.findMany({
        where: { status: "active" },
        select: { providerId: true },
      });
      const activeIds = new Set(activeProviders.map((p) => p.providerId));
      const activeEntries = entries.filter((e) => activeIds.has(e.providerId));

      if (activeEntries.length > 0) {
        return activeEntries.sort((a, b) => a.rank - b.rank);
      }
      // All stored providers are inactive — fall through to bootstrap
    }
  }

  // No config or all stored providers inactive — bootstrap from active providers
  const bootstrapped = await buildBootstrapPriority();
  if (bootstrapped.length === 0) {
    const allActive = await prisma.modelProvider.findMany({ where: { status: "active" }, select: { providerId: true, name: true } });
    console.warn("[getProviderPriority] Bootstrap returned 0 entries. Active providers:", allActive.map((p) => `${p.providerId}(${p.name})`).join(", ") || "NONE");
  }
  return bootstrapped;
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

// ─── Model Requirement Filtering ─────────────────────────────────────────────

const CAPABILITY_RANK: Record<string, number> = {
  excellent: 3,
  adequate: 2,
  insufficient: 1,
};

const TIER_RANK: Record<string, number> = {
  "deep-thinker": 4,
  "fast-worker": 3,
  specialist: 2,
  budget: 1,
  embedding: 0,
  unknown: 0,
};

async function filterByModelRequirements(
  entries: ProviderPriorityEntry[],
  req: ModelRequirements,
): Promise<ProviderPriorityEntry[]> {
  if (!req.minCapabilityTier && !req.instructionFollowing && !req.codingCapability) return entries;

  const profiles = await prisma.modelProfile.findMany({
    where: {
      OR: entries.map((e) => ({ providerId: e.providerId, modelId: e.modelId })),
    },
    select: {
      providerId: true,
      modelId: true,
      capabilityTier: true,
      instructionFollowing: true,
      codingCapability: true,
    },
  });

  const profileMap = new Map(profiles.map((p) => [`${p.providerId}:${p.modelId}`, p]));

  return entries.filter((entry) => {
    const profile = profileMap.get(`${entry.providerId}:${entry.modelId}`);
    if (!profile) return true; // No profile = include as fallback (provider is active, let it try)

    if (req.minCapabilityTier) {
      const required = TIER_RANK[req.minCapabilityTier] ?? 0;
      const actual = TIER_RANK[profile.capabilityTier] ?? 0;
      if (actual < required) return false;
    }

    if (req.instructionFollowing) {
      const required = CAPABILITY_RANK[req.instructionFollowing] ?? 0;
      const actual = CAPABILITY_RANK[profile.instructionFollowing ?? "insufficient"] ?? 0;
      if (actual < required) return false;
    }

    if (req.codingCapability) {
      const required = CAPABILITY_RANK[req.codingCapability] ?? 0;
      const actual = CAPABILITY_RANK[profile.codingCapability ?? "insufficient"] ?? 0;
      if (actual < required) return false;
    }

    return true;
  });
}

// ─── Auto-Disable on Quota ────────────────────────────────────────────────────

const REENABLE_DELAY_MS = 60 * 60 * 1000; // 1 hour

async function autoDisableProvider(providerId: string, reason: string): Promise<Date> {
  await prisma.modelProvider.update({
    where: { providerId },
    data: { status: "inactive" },
  });

  // Schedule re-enablement
  const jobId = `provider-reenable-${providerId}`;
  const nextRunAt = new Date(Date.now() + REENABLE_DELAY_MS);

  await prisma.scheduledJob.upsert({
    where: { jobId },
    create: {
      jobId,
      name: `Re-enable ${providerId} after quota reset`,
      schedule: "once",
      nextRunAt,
      lastStatus: "scheduled",
      lastError: reason.slice(0, 500),
    },
    update: {
      nextRunAt,
      lastStatus: "scheduled",
      lastError: reason.slice(0, 500),
    },
  });

  console.warn(`[autoDisableProvider] ${providerId} disabled due to quota. Re-enable scheduled at ${nextRunAt.toISOString()}`);
  return nextRunAt;
}

function formatReenableTime(date: Date): string {
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 60) return `in ${diffMin} minute${diffMin !== 1 ? "s" : ""}`;
  const diffHr = Math.round(diffMin / 60);
  return `in about ${diffHr} hour${diffHr !== 1 ? "s" : ""}`;
}

// ─── Auto-Retire Deprecated Models ───────────────────────────────────────────

async function retireDeprecatedModel(providerId: string, modelId: string): Promise<void> {
  await prisma.discoveredModel.deleteMany({
    where: { providerId, modelId },
  });
  await prisma.modelProfile.deleteMany({
    where: { providerId, modelId },
  });
  console.warn(`[retireDeprecatedModel] Removed ${modelId} from ${providerId} — no longer available`);
}

// ─── Failover Engine ─────────────────────────────────────────────────────────

const MAX_CASCADE_DEPTH = 5;

export type ModelRequirements = {
  minCapabilityTier?: string;
  instructionFollowing?: "excellent" | "adequate";
  codingCapability?: "excellent" | "adequate";
  preferredProviderId?: string;
};

export async function callWithFailover(
  messages: ChatMessage[],
  systemPrompt: string,
  sensitivity: RouteSensitivity = "internal",
  options?: { tools?: Array<Record<string, unknown>>; task?: TaskKey; modelRequirements?: ModelRequirements },
): Promise<FailoverResult> {
  const priority = await getProviderPriority(options?.task ?? "conversation");
  if (priority.length === 0) {
    const allActive = await prisma.modelProvider.findMany({ where: { status: "active" }, select: { providerId: true } });
    console.warn("[callWithFailover] priority empty. Active providers in DB:", allActive.map((p) => p.providerId).join(", ") || "NONE");
    throw new NoProvidersAvailableError([]);
  }
  const providerPolicy = await getActiveProviderPolicyInfo();
  let filteredPriority = filterProviderPriorityBySensitivity(priority, providerPolicy, sensitivity);
  if (filteredPriority.length === 0) {
    throw new NoAllowedProvidersForSensitivityError(sensitivity);
  }

  // Prefer a specific provider if the agent requests one (e.g., Build Specialist -> Codex)
  if (options?.modelRequirements?.preferredProviderId) {
    const preferred = filteredPriority.filter((e) => e.providerId === options.modelRequirements!.preferredProviderId);
    if (preferred.length > 0) {
      // Put preferred first, keep others as fallback
      const rest = filteredPriority.filter((e) => e.providerId !== options.modelRequirements!.preferredProviderId);
      filteredPriority = [...preferred, ...rest];
    }
  }

  // Filter by model requirements if specified (e.g., Build Specialist needs excellent instruction-following)
  if (options?.modelRequirements) {
    const req = options.modelRequirements;
    const qualified = await filterByModelRequirements(filteredPriority, req);
    if (qualified.length > 0) {
      filteredPriority = qualified;
    }
    // If no models meet requirements, fall back to unfiltered list (graceful degradation)
  }

  const baselineTier = filteredPriority[0]!.capabilityTier;
  const attempts: Array<{ providerId: string; error: string }> = [];
  const limit = Math.min(filteredPriority.length, MAX_CASCADE_DEPTH);
  let quotaDisableMessage: string | null = null;

  for (let i = 0; i < limit; i++) {
    const entry = filteredPriority[i]!;
    try {
      const result = await callProvider(entry.providerId, entry.modelId, messages, systemPrompt, options?.tools);

      const downgraded = i > 0;

      // Build downgrade message — quota-specific or generic
      let downgradeMessage: string | null = quotaDisableMessage;
      if (!downgradeMessage && downgraded) {
        const failedName = filteredPriority[0]!.providerId;
        const usedProvider = await prisma.modelProvider.findUnique({
          where: { providerId: entry.providerId },
          select: { name: true },
        });
        downgradeMessage = `Switched to an alternative AI provider for this response.`;
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

      // Auto-disable provider on quota/rate-limit and schedule re-enablement
      if (e instanceof InferenceError && e.code === "rate_limit") {
        const reenableAt = await autoDisableProvider(entry.providerId, errMsg).catch((err) => {
          console.error("[callWithFailover] auto-disable failed:", err);
          return null;
        });
        const providerName = await prisma.modelProvider.findUnique({
          where: { providerId: entry.providerId },
          select: { name: true },
        });
        const name = providerName?.name ?? entry.providerId;
        const timeStr = reenableAt ? formatReenableTime(reenableAt) : "in about 1 hour";
        quotaDisableMessage = `The preferred AI provider hit its usage quota and has been temporarily paused. It will resume ${timeStr}. Using an alternative for now.`;
      }

      // Auto-retire deprecated/removed models (404) — delete from discovered + profile, try next
      if (e instanceof InferenceError && e.code === "model_not_found") {
        await retireDeprecatedModel(entry.providerId, entry.modelId).catch((err) =>
          console.error("[callWithFailover] retire model failed:", err),
        );
        if (!quotaDisableMessage) {
          quotaDisableMessage = `The previously used AI model is no longer available and has been removed. Switching to an alternative.`;
        }
      }
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
