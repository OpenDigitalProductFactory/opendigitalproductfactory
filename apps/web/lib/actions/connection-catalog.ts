"use server";

import { prisma } from "@dpf/db";
import { getBuiltInToolsOverview } from "@/lib/actions/built-in-tools";
import { queryMcpIntegrations } from "@/lib/actions/mcp-catalog";

type CatalogSearchParams = {
  query: string;
  category?: string;
  archetypeId?: string;
  pricingModel?: string;
  limit?: number;
};

type NativeIntegrationId = "adp" | "quickbooks";

type NativeIntegrationDescriptor = {
  id: NativeIntegrationId;
  name: string;
  description: string;
  href: string;
  category: string;
  pricingModel: "paid";
  model: "native";
};

const NATIVE_INTEGRATIONS: NativeIntegrationDescriptor[] = [
  {
    id: "adp",
    name: "ADP Workforce Now",
    description: "Payroll and workforce anchor using the dedicated ADP runtime and enterprise credential custody.",
    href: "/platform/tools/integrations/adp",
    category: "hr",
    pricingModel: "paid",
    model: "native",
  },
  {
    id: "quickbooks",
    name: "QuickBooks Online",
    description: "Finance anchor for company, customer, and invoice context on the native integration substrate.",
    href: "/platform/tools/integrations/quickbooks",
    category: "finance",
    pricingModel: "paid",
    model: "native",
  },
];

type ConnectionCatalogBase = {
  id: string;
  kind: "mcp" | "native" | "built_in";
  name: string;
  description: string | null;
  category: string;
  pricingModel: string | null;
};

export type McpConnectionCatalogEntry = ConnectionCatalogBase & {
  kind: "mcp";
  vendor: string | null;
  documentationUrl: string | null;
  logoUrl: string | null;
  rating: { toNumber(): number } | number | null;
  ratingCount: number | null;
  isVerified: boolean;
  activeServerId: string | null;
};

export type NativeConnectionCatalogEntry = ConnectionCatalogBase & {
  kind: "native";
  href: string;
  configured: boolean;
  statusLabel: "Configured" | "Needs attention" | "Available";
  provider: NativeIntegrationId;
  model: "native";
};

export type BuiltInConnectionCatalogEntry = ConnectionCatalogBase & {
  kind: "built_in";
  href: string;
  configured: boolean;
  statusLabel: "Configured" | "Needs setup" | "Available";
  configKey: string | null;
  capability: string;
  model: "built-in";
};

export type ConnectionCatalogEntry =
  | McpConnectionCatalogEntry
  | NativeConnectionCatalogEntry
  | BuiltInConnectionCatalogEntry;

export type ConnectionCatalogSection = {
  kind: ConnectionCatalogEntry["kind"];
  title: string;
  description: string;
  entries: ConnectionCatalogEntry[];
};

function matchesQuery(entry: { name: string; description: string | null; category: string }, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [entry.name, entry.description ?? "", entry.category]
    .join(" ")
    .toLowerCase()
    .includes(normalized);
}

export async function getConnectionCatalog(params: CatalogSearchParams): Promise<{
  totalCount: number;
  counts: { mcp: number; native: number; builtIn: number };
  sections: ConnectionCatalogSection[];
}> {
  const { query, category, pricingModel, archetypeId, limit = 60 } = params;

  const [integrations, activeLinks, builtInsOverview, nativeCredentials] = await Promise.all([
    queryMcpIntegrations({
      query,
      ...(category ? { category } : {}),
      ...(pricingModel ? { pricingModel } : {}),
      ...(archetypeId ? { archetypeId } : {}),
      limit,
    }),
    prisma.mcpServer.findMany({
      where: { integrationId: { not: null }, status: "active" },
      select: { integrationId: true, id: true },
    }),
    getBuiltInToolsOverview(),
    prisma.integrationCredential.findMany({
      where: { provider: { in: NATIVE_INTEGRATIONS.map((integration) => integration.id) } },
      select: { provider: true, status: true },
    }),
  ]);

  const activeMap = new Map(activeLinks.map((server) => [server.integrationId, server.id]));
  const nativeStatusMap = new Map<NativeIntegrationId, { configured: boolean; hasError: boolean }>();

  for (const descriptor of NATIVE_INTEGRATIONS) {
    nativeStatusMap.set(descriptor.id, { configured: false, hasError: false });
  }

  for (const credential of nativeCredentials) {
    const provider = credential.provider as NativeIntegrationId;
    const current = nativeStatusMap.get(provider);
    if (!current) continue;

    current.configured ||= credential.status === "connected";
    current.hasError ||= credential.status === "error";
  }

  const mcpEntries: McpConnectionCatalogEntry[] = integrations.map((integration) => ({
    id: integration.id,
    kind: "mcp",
    name: integration.name,
    description: integration.shortDescription,
    category: integration.category,
    pricingModel: integration.pricingModel,
    vendor: integration.vendor,
    documentationUrl: integration.documentationUrl,
    logoUrl: integration.logoUrl,
    rating: integration.rating,
    ratingCount: integration.ratingCount,
    isVerified: integration.isVerified,
    activeServerId: activeMap.get(integration.id) ?? null,
  }));

  const nativeEntries: NativeConnectionCatalogEntry[] = NATIVE_INTEGRATIONS
    .map((integration) => {
      const status = nativeStatusMap.get(integration.id) ?? { configured: false, hasError: false };
      const statusLabel: NativeConnectionCatalogEntry["statusLabel"] = status.configured
        ? "Configured"
        : status.hasError
          ? "Needs attention"
          : "Available";
      return {
        id: integration.id,
        kind: "native" as const,
        name: integration.name,
        description: integration.description,
        category: integration.category,
        pricingModel: integration.pricingModel,
        href: integration.href,
        configured: status.configured,
        statusLabel,
        provider: integration.id,
        model: integration.model,
      };
    })
    .filter((entry) => matchesQuery(entry, query));

  const builtInEntries: BuiltInConnectionCatalogEntry[] = builtInsOverview.tools
    .map((tool) => {
      const statusLabel: BuiltInConnectionCatalogEntry["statusLabel"] = tool.configKey
        ? (tool.configured ? "Configured" : "Needs setup")
        : "Available";

      return {
        id: tool.id,
        kind: "built_in" as const,
        name: tool.name,
        description: tool.description,
        category: "built-in",
        pricingModel: "free",
        href: "/platform/tools/built-ins",
        configured: tool.configured,
        statusLabel,
        configKey: tool.configKey,
        capability: tool.capability,
        model: tool.model,
      };
    })
    .filter((entry) => matchesQuery(entry, query));

  const sections: ConnectionCatalogSection[] = [
    {
      kind: "mcp",
      title: "MCP Catalog",
      description: "Registry-backed MCP integrations you can evaluate before activating as MCP Services.",
      entries: mcpEntries,
    },
    {
      kind: "native",
      title: "Native Integrations",
      description: "First-class DPF-owned enterprise anchors with dedicated auth, approval, and governance flows.",
      entries: nativeEntries,
    },
    {
      kind: "built_in",
      title: "Built-in Tools",
      description: "Platform-native tools that ship with DPF and may require local operator configuration.",
      entries: builtInEntries,
    },
  ];

  return {
    totalCount: mcpEntries.length + nativeEntries.length + builtInEntries.length,
    counts: {
      mcp: mcpEntries.length,
      native: nativeEntries.length,
      builtIn: builtInEntries.length,
    },
    sections,
  };
}
