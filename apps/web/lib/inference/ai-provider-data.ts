// apps/web/lib/ai-provider-data.ts
// Server-only: uses React cache() to deduplicate Prisma calls within one request.
import { cache } from "react";
import { prisma } from "@dpf/db";
import type {
  ProviderWithCredential,
  ProviderRow,
  CredentialRow,
  SpendByProvider,
  SpendByAgent,
  ScheduledJobRow,
  DiscoveredModelRow,
  ModelProfileRow,
  ProviderModelSummary,
  RecipeGridRow,
  McpServerGridRow,
  AsyncOpRow,
  ToolInventoryItem,
} from "./ai-provider-types";

/** Mask a secret to `••••••1234` (last 4 chars visible). */
function maskSecret(value: string | null): string | null {
  if (!value) return null;
  // Encrypted values start with "enc:" — we can't show the last 4 meaningfully
  if (value.startsWith("enc:")) return "••••••••";
  if (value.length <= 4) return "••••";
  return "••••••" + value.slice(-4);
}

/** Strip secrets before sending credential data to the client. */
function maskCredential(cred: {
  providerId: string;
  secretRef: string | null;
  clientId: string | null;
  clientSecret: string | null;
  tokenEndpoint: string | null;
  scope: string | null;
  status: string;
  tokenExpiresAt?: Date | null;
  refreshToken?: string | null;
}): CredentialRow {
  return {
    providerId:       cred.providerId,
    secretHint:       maskSecret(cred.secretRef),
    clientId:         cred.clientId,
    clientSecretHint: maskSecret(cred.clientSecret),
    tokenEndpoint:    cred.tokenEndpoint,
    scope:            cred.scope,
    status:           cred.status,
    tokenExpiresAt:   cred.tokenExpiresAt?.toISOString() ?? null,
    hasRefreshToken:  cred.refreshToken != null && cred.refreshToken !== "",
  };
}

export const getProviders = cache(async (): Promise<ProviderWithCredential[]> => {
  const providers = await prisma.modelProvider.findMany({ orderBy: { name: "asc" } });
  const credentials = await prisma.credentialEntry.findMany({
    where: { providerId: { in: providers.map((p) => p.providerId) } },
  });
  const credMap = new Map(credentials.map((c) => [c.providerId, c]));
  return providers.map((p) => {
    const raw = credMap.get(p.providerId);
    return {
      provider: {
        ...p,
        families:             p.families as string[],
        enabledFamilies:      p.enabledFamilies as string[],
        supportedAuthMethods: p.supportedAuthMethods as string[],
        billingLabel:         p.billingLabel,
        costPerformanceNotes: p.costPerformanceNotes,
        endpointType:         p.endpointType,
        serviceKind:          p.serviceKind,
        sensitivityClearance: p.sensitivityClearance as string[],
        capabilityTier:       p.capabilityTier,
        costBand:             p.costBand,
        taskTags:             p.taskTags as string[],
        mcpTransport:         p.mcpTransport,
        maxConcurrency:       p.maxConcurrency,
        reasoning:            p.reasoning,
        codegen:              p.codegen,
        toolFidelity:         p.toolFidelity,
        instructionFollowing: p.instructionFollowing,
        structuredOutput:     p.structuredOutput,
        conversational:       p.conversational,
        contextRetention:     p.contextRetention,
        authorizeUrl:         p.authorizeUrl,
        tokenUrl:             p.tokenUrl,
        oauthClientId:        p.oauthClientId,
        oauthRedirectUri:     p.oauthRedirectUri,
      } satisfies ProviderRow,
      credential: raw ? maskCredential(raw) : null,
    };
  });
});

export const getProviderById = cache(async (providerId: string): Promise<ProviderWithCredential | null> => {
  const provider = await prisma.modelProvider.findUnique({ where: { providerId } });
  if (!provider) return null;
  const credential = await prisma.credentialEntry.findUnique({ where: { providerId } });
  return {
    provider: {
      ...provider,
      families:             provider.families as string[],
      enabledFamilies:      provider.enabledFamilies as string[],
      supportedAuthMethods: provider.supportedAuthMethods as string[],
      billingLabel:         provider.billingLabel,
      costPerformanceNotes: provider.costPerformanceNotes,
      endpointType:         provider.endpointType,
      serviceKind:          provider.serviceKind,
      sensitivityClearance: provider.sensitivityClearance as string[],
      capabilityTier:       provider.capabilityTier,
      costBand:             provider.costBand,
      taskTags:             provider.taskTags as string[],
      mcpTransport:         provider.mcpTransport,
      maxConcurrency:       provider.maxConcurrency,
      reasoning:            provider.reasoning,
      codegen:              provider.codegen,
      toolFidelity:         provider.toolFidelity,
      instructionFollowing: provider.instructionFollowing,
      structuredOutput:     provider.structuredOutput,
      conversational:       provider.conversational,
      contextRetention:     provider.contextRetention,
      authorizeUrl:         provider.authorizeUrl,
      tokenUrl:             provider.tokenUrl,
      oauthClientId:        provider.oauthClientId,
      oauthRedirectUri:     provider.oauthRedirectUri,
    } satisfies ProviderRow,
    credential: credential ? maskCredential(credential) : null,
  };
});

function monthRange(month: { year: number; month: number }): { gte: Date; lt: Date } {
  const gte = new Date(Date.UTC(month.year, month.month - 1, 1));
  const lt  = new Date(Date.UTC(month.year, month.month, 1));
  return { gte, lt };
}

export const getTokenSpendByProvider = cache(
  async (month: { year: number; month: number }): Promise<SpendByProvider[]> => {
    const range = monthRange(month);
    const rows = await prisma.tokenUsage.groupBy({
      by: ["providerId"],
      where: { createdAt: range },
      _sum: { inputTokens: true, outputTokens: true, costUsd: true },
    });
    return rows.map((r) => ({
      providerId:        r.providerId,
      totalInputTokens:  r._sum.inputTokens  ?? 0,
      totalOutputTokens: r._sum.outputTokens ?? 0,
      totalCostUsd:      r._sum.costUsd      ?? 0,
    }));
  }
);

export const getTokenSpendByAgent = cache(
  async (month: { year: number; month: number }): Promise<SpendByAgent[]> => {
    const range = monthRange(month);
    const rows = await prisma.tokenUsage.groupBy({
      by: ["agentId"],
      where: { createdAt: range },
      _sum: { inputTokens: true, outputTokens: true, costUsd: true },
      orderBy: { _sum: { costUsd: "desc" } },
    });
    const agentIds = rows.map((r) => r.agentId);
    const agents = await prisma.agent.findMany({ where: { agentId: { in: agentIds } } });
    const agentMap = new Map(agents.map((a) => [a.agentId, a.name]));
    return rows.map((r) => ({
      agentId:           r.agentId,
      agentName:         agentMap.get(r.agentId) ?? r.agentId,
      totalInputTokens:  r._sum.inputTokens  ?? 0,
      totalOutputTokens: r._sum.outputTokens ?? 0,
      totalCostUsd:      r._sum.costUsd      ?? 0,
    }));
  }
);

export const getScheduledJobs = cache(async (): Promise<ScheduledJobRow[]> => {
  return prisma.scheduledJob.findMany({ orderBy: { jobId: "asc" } });
});

export const getDiscoveredModels = cache(async (providerId: string): Promise<DiscoveredModelRow[]> => {
  const models = await prisma.discoveredModel.findMany({
    where: { providerId },
    orderBy: { modelId: "asc" },
  });
  return models.map((m) => ({
    ...m,
    rawMetadata: m.rawMetadata as Record<string, unknown>,
  }));
});

export const getModelProfiles = cache(async (providerId: string): Promise<ModelProfileRow[]> => {
  const profiles = await prisma.modelProfile.findMany({
    where: { providerId },
    orderBy: { modelId: "asc" },
  });
  return profiles.map((p) => ({
    ...p,
    bestFor: p.bestFor as string[],
    avoidFor: p.avoidFor as string[],
    // EP-INF-003: ModelCard fields
    modelClass: p.modelClass,
    modelFamily: p.modelFamily,
    maxInputTokens: p.maxInputTokens,
    maxOutputTokens: p.maxOutputTokens,
    capabilities: p.capabilities as Record<string, unknown>,
    pricing: p.pricing as Record<string, unknown>,
    metadataSource: p.metadataSource,
    metadataConfidence: p.metadataConfidence,
    inputModalities: p.inputModalities as string[],
    outputModalities: p.outputModalities as string[],
    // EP-INF-012: Quality tier
    qualityTier: p.qualityTier,
    qualityTierSource: p.qualityTierSource,
  }));
});

// ── EP-INF-010: Platform Services UX queries ────────────────────────────────

/** Aggregate model counts and non-chat capability classes per provider. */
export const getProviderModelSummaries = cache(
  async (): Promise<Map<string, ProviderModelSummary>> => {
    const profiles = await prisma.modelProfile.findMany({
      select: { providerId: true, modelClass: true, modelStatus: true },
    });
    const map = new Map<string, ProviderModelSummary>();
    for (const p of profiles) {
      const s = map.get(p.providerId) ?? { totalModels: 0, activeModels: 0, nonChatClasses: [] };
      s.totalModels++;
      if (p.modelStatus === "active") s.activeModels++;
      if (!["chat", "reasoning"].includes(p.modelClass) && !s.nonChatClasses.includes(p.modelClass)) {
        s.nonChatClasses.push(p.modelClass);
      }
      map.set(p.providerId, s);
    }
    return map;
  },
);

/** Execution recipes for a single provider (detail page). */
export const getRecipesForProvider = cache(
  async (providerId: string): Promise<RecipeGridRow[]> => {
    const rows = await prisma.executionRecipe.findMany({
      where: { providerId },
      orderBy: [{ contractFamily: "asc" }, { version: "desc" }],
    });
    return rows.map((r) => ({
      id: r.id,
      contractFamily: r.contractFamily,
      modelId: r.modelId,
      executionAdapter: r.executionAdapter,
      status: r.status,
      version: r.version,
      origin: r.origin,
    }));
  },
);

/** Model class distribution for a single provider (detail page capability summary). */
export const getModelClassCounts = cache(
  async (providerId: string): Promise<{ modelClass: string; count: number }[]> => {
    const groups = await prisma.modelProfile.groupBy({
      by: ["modelClass"],
      where: { providerId },
      _count: true,
    });
    return groups
      .map((g) => ({ modelClass: g.modelClass, count: g._count }))
      .sort((a, b) => b.count - a.count);
  },
);

/** Activated MCP servers with tool counts for the providers grid (section 1d). */
export const getActivatedMcpServers = cache(
  async (): Promise<McpServerGridRow[]> => {
    const servers = await prisma.mcpServer.findMany({
      where: { deactivatedAt: null },
      include: {
        integration: {
          select: { name: true, logoUrl: true, category: true },
        },
        tools: { select: { isEnabled: true } },
      },
      orderBy: { name: "asc" },
    });
    return servers.map((s) => ({
      id: s.id,
      serverId: s.serverId,
      name: s.integration?.name ?? s.name,
      status: s.status,
      transport: s.transport,
      healthStatus: s.healthStatus,
      lastHealthCheck: s.lastHealthCheck?.toISOString() ?? null,
      category: s.category,
      tags: s.tags as string[],
      activatedBy: s.activatedBy,
      activatedAt: s.activatedAt?.toISOString() ?? null,
      integrationName: s.integration?.name ?? null,
      integrationLogoUrl: s.integration?.logoUrl ?? null,
      integrationCategory: s.integration?.category ?? null,
      toolCount: s.tools.length,
      enabledToolCount: s.tools.filter((t) => t.isEnabled).length,
    }));
  },
);

/** Recent async inference operations (operations page). */
export const getAsyncOperations = cache(
  async (): Promise<AsyncOpRow[]> => {
    const ops = await prisma.asyncInferenceOp.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return ops.map((o) => ({
      id: o.id,
      providerId: o.providerId,
      modelId: o.modelId,
      contractFamily: o.contractFamily,
      status: o.status,
      progressPct: o.progressPct,
      progressMessage: o.progressMessage,
      errorMessage: o.errorMessage,
      createdAt: o.createdAt.toISOString(),
      startedAt: o.startedAt?.toISOString() ?? null,
      completedAt: o.completedAt?.toISOString() ?? null,
      expiresAt: o.expiresAt.toISOString(),
    }));
  },
);

/** Combined tool inventory: platform built-in tools + MCP server tools. */
export const getToolInventory = cache(
  async (): Promise<ToolInventoryItem[]> => {
    const { PLATFORM_TOOLS } = await import("@/lib/mcp-tools");
    const platformItems: ToolInventoryItem[] = PLATFORM_TOOLS.map((t) => ({
      name: t.name,
      source: "Platform",
      type: "platform" as const,
      enabled: true,
      gating: t.requiredCapability ?? null,
    }));

    const mcpTools = await prisma.mcpServerTool.findMany({
      where: {
        server: {
          deactivatedAt: null,
          healthStatus: "healthy",
        },
      },
      include: { server: { select: { name: true, serverId: true } } },
    });
    const mcpItems: ToolInventoryItem[] = mcpTools.map((t) => ({
      name: `${t.server.serverId}__${t.toolName}`,
      source: t.server.name,
      type: "mcp" as const,
      enabled: t.isEnabled,
      gating: null,
      originalName: t.toolName,
    }));

    return [...platformItems, ...mcpItems];
  },
);

export type ServiceGroup = {
  endpointType: string;
  category: string;
  displayName: string;
  providers: ProviderWithCredential[];
};

const CATEGORY_DISPLAY_NAMES: Record<string, string> = {
  local: "Local",
  direct: "Direct",
  agent: "Agent",
  router: "Routers & Gateways",
  "mcp-subscribed": "Subscribed",
  "mcp-internal": "Internal",
};

const CATEGORY_ORDER: Record<string, number> = {
  local: 0, direct: 1, agent: 2, router: 3,
  "mcp-internal": 0, "mcp-subscribed": 1,
};

export function groupByEndpointTypeAndCategory(
  providers: ProviderWithCredential[],
): ServiceGroup[] {
  const groups = new Map<string, ServiceGroup>();

  for (const pw of providers) {
    const type = pw.provider.endpointType || "llm";
    const cat = pw.provider.category;
    const key = `${type}:${cat}`;

    if (!groups.has(key)) {
      groups.set(key, {
        endpointType: type,
        category: cat,
        displayName: CATEGORY_DISPLAY_NAMES[cat] ?? cat,
        providers: [],
      });
    }
    groups.get(key)!.providers.push(pw);
  }

  return [...groups.values()].sort((a, b) => {
    if (a.endpointType !== b.endpointType) {
      return a.endpointType === "llm" ? -1 : 1;
    }
    return (CATEGORY_ORDER[a.category] ?? 99) - (CATEGORY_ORDER[b.category] ?? 99);
  });
}
