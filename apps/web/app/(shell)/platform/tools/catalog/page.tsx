// apps/web/app/(shell)/platform/tools/catalog/page.tsx
import { queryMcpIntegrations, runMcpCatalogSyncIfDue } from "@/lib/actions/mcp-catalog";
import { IntegrationCard } from "@/components/platform/IntegrationCard";
import { IntegrationCatalogFilters } from "@/components/platform/IntegrationCatalogFilters";
import { prisma } from "@dpf/db";

type SearchParams = Promise<{ q?: string; category?: string; pricing?: string; archetype?: string }>;

export default async function ToolsCatalogPage({ searchParams }: { searchParams: SearchParams }) {
  await runMcpCatalogSyncIfDue();

  const { q = "", category, pricing, archetype } = await searchParams;

  const integrations = await queryMcpIntegrations({
    query: q,
    ...(category ? { category } : {}),
    ...(pricing ? { pricingModel: pricing } : {}),
    ...(archetype ? { archetypeId: archetype } : {}),
    limit: 60,
  });

  // Fetch which integrations have active servers
  const activeLinks = await prisma.mcpServer.findMany({
    where: { integrationId: { not: null }, status: "active" },
    select: { id: true, integrationId: true },
  });
  const activeMap = new Map(activeLinks.map((s) => [s.integrationId, s.id]));

  const totalCount = await prisma.mcpIntegration.count({ where: { status: "active" } });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">MCP Catalog</h1>
          <p className="text-muted-foreground text-sm">
            {totalCount.toLocaleString()} MCP integrations available · updated weekly from the MCP Registry
          </p>
        </div>
        <a href="/platform/tools/catalog/sync" className="text-sm text-primary hover:underline">
          Manage sync →
        </a>
      </div>

      <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-sm text-[var(--dpf-muted)]">
        This catalog currently reflects MCP integrations only. For first-party platform utilities and DPF-owned enterprise anchors, use{" "}
        <a href="/platform/tools/built-ins" className="text-[var(--dpf-accent)] underline">
          Built-in Tools
        </a>{" "}
        and{" "}
        <a href="/platform/tools/integrations" className="text-[var(--dpf-accent)] underline">
          Native Integrations
        </a>.
      </div>

      <IntegrationCatalogFilters />

      {integrations.length === 0 ? (
        <p className="text-muted-foreground text-sm py-12 text-center">
          No integrations found. Try a different search or run a sync.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {integrations.map((integration) => (
            <IntegrationCard
                key={integration.id}
                integration={{
                  ...integration,
                  activeServerId: activeMap.get(integration.id) ?? null,
                }}
              />
          ))}
        </div>
      )}
    </div>
  );
}
