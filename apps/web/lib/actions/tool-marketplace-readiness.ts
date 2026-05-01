"use server";

import { prisma } from "@dpf/db";
import { getBuiltInToolsOverview } from "@/lib/actions/built-in-tools";
import { getAgentToolGrantsAsync, getToolGrantMapping } from "@/lib/tak/agent-grants";
import {
  NATIVE_INTEGRATIONS,
  getNativeIntegrationIds,
  type NativeIntegrationDescriptor,
  type NativeIntegrationId,
} from "@/lib/tools/native-integration-catalog";

export type ToolMarketplaceKind = "mcp" | "native" | "built_in" | "model_requirement";

export type ToolMarketplaceReadiness =
  | "ready"
  | "available"
  | "needs_setup"
  | "needs_grant"
  | "blocked";

export type ToolMarketplaceEntry = {
  id: string;
  kind: ToolMarketplaceKind;
  name: string;
  description: string | null;
  category: string;
  readiness: ToolMarketplaceReadiness;
  readinessLabel: string;
  guidance: string;
  href: string | null;
  enables: string[];
  missingSetup: string[];
  missingGrants: string[];
  relevantAgentIds: string[];
};

export type ToolMarketplaceSummary = {
  total: number;
  ready: number;
  available: number;
  needsSetup: number;
  needsGrant: number;
  blocked: number;
};

export type ToolMarketplaceReadinessResult = {
  entries: ToolMarketplaceEntry[];
  summary: ToolMarketplaceSummary;
};

type ToolMarketplaceReadinessParams = {
  query?: string;
  agentId?: string;
  includeKinds?: ToolMarketplaceKind[];
  limit?: number;
};

const DEFAULT_LIMIT = 80;

function matchesQuery(
  entry: Pick<ToolMarketplaceEntry, "name" | "description" | "category" | "enables">,
  query: string | undefined,
) {
  const normalized = query?.trim().toLowerCase();
  if (!normalized) return true;

  return [
    entry.name,
    entry.description ?? "",
    entry.category,
    ...entry.enables,
  ]
    .join(" ")
    .toLowerCase()
    .includes(normalized);
}

function summarize(entries: ToolMarketplaceEntry[]): ToolMarketplaceSummary {
  return {
    total: entries.length,
    ready: entries.filter((entry) => entry.readiness === "ready").length,
    available: entries.filter((entry) => entry.readiness === "available").length,
    needsSetup: entries.filter((entry) => entry.readiness === "needs_setup").length,
    needsGrant: entries.filter((entry) => entry.readiness === "needs_grant").length,
    blocked: entries.filter((entry) => entry.readiness === "blocked").length,
  };
}

function resolveGrantState(requiredGrantKeys: string[], agentGrantKeys: string[]) {
  if (requiredGrantKeys.length === 0) return [];
  return requiredGrantKeys.filter((grantKey) => !agentGrantKeys.includes(grantKey));
}

function nativeReadinessEntry(
  integration: NativeIntegrationDescriptor,
  status: { configured: boolean; hasError: boolean },
  agentGrantKeys: string[],
): ToolMarketplaceEntry {
  const missingGrants = resolveGrantState(integration.requiredGrantKeys, agentGrantKeys);
  const missingSetup = status.configured ? [] : [`Configure ${integration.name}`];

  if (status.hasError) {
    return {
      id: integration.id,
      kind: "native",
      name: integration.name,
      description: integration.description,
      category: integration.category,
      readiness: "needs_setup",
      readinessLabel: "Needs attention",
      guidance: `${integration.name} is known to DPF, but its current credential needs attention before coworkers can rely on it.`,
      href: integration.href,
      enables: integration.enables,
      missingSetup,
      missingGrants,
      relevantAgentIds: integration.relevantAgentIds,
    };
  }

  if (!status.configured) {
    return {
      id: integration.id,
      kind: "native",
      name: integration.name,
      description: integration.description,
      category: integration.category,
      readiness: "needs_setup",
      readinessLabel: "Needs setup",
      guidance: `${integration.name} is an available native integration target. Configure it before granting coworkers access.`,
      href: integration.href,
      enables: integration.enables,
      missingSetup,
      missingGrants,
      relevantAgentIds: integration.relevantAgentIds,
    };
  }

  if (missingGrants.length > 0) {
    return {
      id: integration.id,
      kind: "native",
      name: integration.name,
      description: integration.description,
      category: integration.category,
      readiness: "needs_grant",
      readinessLabel: "Needs grant",
      guidance: `${integration.name} is configured, but this coworker still needs the required grant before using it.`,
      href: integration.href,
      enables: integration.enables,
      missingSetup: [],
      missingGrants,
      relevantAgentIds: integration.relevantAgentIds,
    };
  }

  return {
    id: integration.id,
    kind: "native",
    name: integration.name,
    description: integration.description,
    category: integration.category,
    readiness: "ready",
    readinessLabel: "Ready",
    guidance: `${integration.name} is configured and grant-ready for this coworker.`,
    href: integration.href,
    enables: integration.enables,
    missingSetup: [],
    missingGrants: [],
    relevantAgentIds: integration.relevantAgentIds,
  };
}

async function getNativeEntries(agentGrantKeys: string[]) {
  const credentials = await prisma.integrationCredential.findMany({
    where: { provider: { in: getNativeIntegrationIds() } },
    select: { provider: true, status: true },
  });
  const statusByProvider = new Map<NativeIntegrationId, { configured: boolean; hasError: boolean }>();

  for (const integration of NATIVE_INTEGRATIONS) {
    statusByProvider.set(integration.id, { configured: false, hasError: false });
  }

  for (const credential of credentials) {
    const provider = credential.provider as NativeIntegrationId;
    const current = statusByProvider.get(provider);
    if (!current) continue;
    current.configured ||= credential.status === "connected";
    current.hasError ||= credential.status === "error";
  }

  return NATIVE_INTEGRATIONS.map((integration) =>
    nativeReadinessEntry(
      integration,
      statusByProvider.get(integration.id) ?? { configured: false, hasError: false },
      agentGrantKeys,
    ),
  );
}

async function getMcpEntries(limit: number) {
  const integrations = await prisma.mcpIntegration.findMany({
    where: { status: "active" },
    select: {
      id: true,
      name: true,
      shortDescription: true,
      category: true,
      documentationUrl: true,
      mcpServers: {
        where: { status: "active" },
        select: {
          id: true,
          tools: {
            where: { isEnabled: true },
            select: { toolName: true },
          },
        },
      },
    },
    orderBy: [{ isVerified: "desc" }, { name: "asc" }],
    take: limit,
  });

  return integrations.map<ToolMarketplaceEntry>((integration) => {
    const activeServer = integration.mcpServers[0];
    const toolNames = activeServer?.tools.map((tool) => tool.toolName) ?? [];

    if (!activeServer) {
      return {
        id: integration.id,
        kind: "mcp",
        name: integration.name,
        description: integration.shortDescription,
        category: integration.category,
        readiness: "available",
        readinessLabel: "Available",
        guidance: `${integration.name} is in the MCP catalog. Activate an MCP service before coworkers can use its tools.`,
        href: integration.documentationUrl,
        enables: [],
        missingSetup: ["Activate MCP service"],
        missingGrants: [],
        relevantAgentIds: [],
      };
    }

    return {
      id: integration.id,
      kind: "mcp",
      name: integration.name,
      description: integration.shortDescription,
      category: integration.category,
      readiness: "ready",
      readinessLabel: "Ready",
      guidance: toolNames.length > 0
        ? `${integration.name} has an active MCP service with ${toolNames.length} enabled tool${toolNames.length === 1 ? "" : "s"}.`
        : `${integration.name} has an active MCP service. Run discovery if tool inventory is empty.`,
      href: integration.documentationUrl,
      enables: toolNames,
      missingSetup: toolNames.length > 0 ? [] : ["Discover MCP tools"],
      missingGrants: [],
      relevantAgentIds: [],
    };
  });
}

async function getBuiltInEntries(agentGrantKeys: string[]) {
  const overview = await getBuiltInToolsOverview();
  const mapping = getToolGrantMapping();

  return overview.tools.map<ToolMarketplaceEntry>((tool) => {
    const requiredGrantKeys = mapping[tool.capability] ?? [];
    const missingGrants = resolveGrantState(requiredGrantKeys, agentGrantKeys);
    const missingSetup = tool.configKey && !tool.configured ? [`Configure ${tool.configKey}`] : [];
    const readiness: ToolMarketplaceReadiness =
      missingSetup.length > 0 ? "needs_setup" : missingGrants.length > 0 ? "needs_grant" : "ready";

    return {
      id: tool.id,
      kind: "built_in",
      name: tool.name,
      description: tool.description,
      category: "built-in",
      readiness,
      readinessLabel:
        readiness === "ready" ? "Ready" : readiness === "needs_setup" ? "Needs setup" : "Needs grant",
      guidance:
        readiness === "ready"
          ? `${tool.name} is ready for this coworker.`
          : readiness === "needs_setup"
            ? `${tool.name} is built into DPF, but it needs platform configuration before use.`
            : `${tool.name} is configured, but this coworker needs a matching tool grant.`,
      href: "/platform/tools/built-ins",
      enables: [tool.capability],
      missingSetup,
      missingGrants,
      relevantAgentIds: [],
    };
  });
}

async function getBuildStudioModelRequirementEntry() {
  const [codeGenRequirement, toolActionRequirement, frontierToolProviders] = await Promise.all([
    prisma.taskRequirement.findUnique({
      where: { taskType: "code-gen" },
      select: { taskType: true, description: true },
    }),
    prisma.taskRequirement.findUnique({
      where: { taskType: "tool-action" },
      select: { taskType: true, description: true },
    }),
    prisma.modelProvider.findMany({
      where: {
        status: "active",
        OR: [
          { supportsToolUse: true, capabilityTier: "frontier" },
          {
            modelProfiles: {
              some: {
                modelStatus: "active",
                retiredAt: null,
                supportsToolUse: true,
                qualityTier: "frontier",
              },
            },
          },
        ],
      },
      select: {
        providerId: true,
        name: true,
        modelProfiles: {
          where: {
            modelStatus: "active",
            retiredAt: null,
            supportsToolUse: true,
            qualityTier: "frontier",
          },
          select: { modelId: true, friendlyName: true },
          take: 3,
        },
      },
      take: 5,
    }),
  ]);

  const hasEligibleModel = frontierToolProviders.length > 0;
  const providerNames = frontierToolProviders.map((provider) => provider.name);

  return {
    id: "build-studio-frontier-tool-model",
    kind: "model_requirement",
    name: "Build Studio Frontier Tool Model",
    description:
      codeGenRequirement?.description ??
      toolActionRequirement?.description ??
      "Model requirement for Build Studio implementation and tool-action work.",
    category: "model-routing",
    readiness: hasEligibleModel ? "ready" : "blocked",
    readinessLabel: hasEligibleModel ? "Ready" : "Blocked",
    guidance: hasEligibleModel
      ? `Build Studio has at least one active frontier, tool-capable model provider: ${providerNames.join(", ")}.`
      : "Build Studio implementation needs an active frontier, tool-capable model. Configure or activate a provider before starting code-generation work.",
    href: "/platform/ai/providers",
    enables: ["Build Studio implementation", "Code generation", "Tool-action workflows"],
    missingSetup: hasEligibleModel ? [] : ["Activate a frontier, tool-capable model provider"],
    missingGrants: [],
    relevantAgentIds: ["build-specialist", "coo"],
  } satisfies ToolMarketplaceEntry;
}

export async function getToolMarketplaceReadiness(
  params: ToolMarketplaceReadinessParams = {},
): Promise<ToolMarketplaceReadinessResult> {
  const includeKinds = new Set<ToolMarketplaceKind>(
    params.includeKinds ?? ["mcp", "native", "built_in", "model_requirement"],
  );
  const agentGrantKeys = params.agentId ? await getAgentToolGrantsAsync(params.agentId) : [];
  const limit = params.limit ?? DEFAULT_LIMIT;

  const [mcpEntries, nativeEntries, builtInEntries, modelRequirementEntry] = await Promise.all([
    includeKinds.has("mcp") ? getMcpEntries(limit) : Promise.resolve([]),
    includeKinds.has("native") ? getNativeEntries(agentGrantKeys) : Promise.resolve([]),
    includeKinds.has("built_in") ? getBuiltInEntries(agentGrantKeys) : Promise.resolve([]),
    includeKinds.has("model_requirement") ? getBuildStudioModelRequirementEntry() : Promise.resolve(null),
  ]);

  const entries = [
    ...mcpEntries,
    ...nativeEntries,
    ...builtInEntries,
    ...(modelRequirementEntry ? [modelRequirementEntry] : []),
  ]
    .filter((entry) => matchesQuery(entry, params.query))
    .slice(0, limit);

  return {
    entries,
    summary: summarize(entries),
  };
}
