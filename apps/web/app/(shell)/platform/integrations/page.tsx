// apps/web/app/(shell)/platform/integrations/page.tsx

import { Suspense } from "react";
import { queryMcpIntegrations, runMcpCatalogSyncIfDue } from "@/lib/actions/mcp-catalog";
import { IntegrationCard } from "@/components/platform/IntegrationCard";
import { IntegrationCatalogFilters } from "@/components/platform/IntegrationCatalogFilters";
import { prisma } from "@dpf/db";

type SearchParams = Promise<{ q?: string; category?: string; pricing?: string; archetype?: string }>;

export default async function IntegrationsPage({ searchParams }: { searchParams: SearchParams }) {
  await runMcpCatalogSyncIfDue();

  const { q = "", category, pricing, archetype } = await searchParams;

  const integrations = await queryMcpIntegrations({
    query: q,
    category,
    pricingModel: pricing,
    archetypeId: archetype,
    limit: 60,
  });

  const totalCount = await prisma.mcpIntegration.count({ where: { status: "active" } });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Integrations</h1>
          <p className="text-muted-foreground text-sm">
            {totalCount.toLocaleString()} available · updated weekly from the MCP Registry
          </p>
        </div>
        <a href="/platform/integrations/sync" className="text-sm text-primary hover:underline">
          Manage sync →
        </a>
      </div>

      <Suspense fallback={null}>
        <IntegrationCatalogFilters />
      </Suspense>

      {integrations.length === 0 ? (
        <p className="text-muted-foreground text-sm py-12 text-center">
          No integrations found. Try a different search or run a sync.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {integrations.map((integration) => (
            <IntegrationCard key={integration.id} integration={integration} />
          ))}
        </div>
      )}
    </div>
  );
}
