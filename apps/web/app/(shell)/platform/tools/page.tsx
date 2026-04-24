import { prisma } from "@dpf/db";
import { PlatformSummaryCard } from "@/components/platform/PlatformSummaryCard";

export default async function ToolsHubPage() {
  const [
    catalogCount,
    activeServices,
    unconfiguredServices,
    enabledTools,
    nativeIntegrations,
    integrationErrors,
    activeDiscoveryConnections,
    needsReviewCount,
  ] = await Promise.all([
    prisma.mcpIntegration.count({ where: { status: "active" } }),
    prisma.mcpServer.count({ where: { status: "active" } }),
    prisma.mcpServer.count({ where: { status: "unconfigured" } }),
    prisma.mcpServerTool.count({ where: { isEnabled: true } }),
    prisma.integrationCredential.count({
      where: { provider: { in: ["adp", "quickbooks", "stripe", "microsoft365"] }, status: "connected" },
    }),
    prisma.integrationCredential.count({
      where: { provider: { in: ["adp", "quickbooks", "stripe", "microsoft365"] }, status: "error" },
    }),
    prisma.discoveryConnection.count({ where: { status: { in: ["active", "ok"] } } }),
    prisma.inventoryEntity.count({ where: { attributionStatus: "needs_review" } }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Tools &amp; Services</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          Discover integrations, run discovery operations, activate MCP services, and confirm what
          tools are really available to agents.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <PlatformSummaryCard
          title="Catalog"
          description="Browse the integration registry and decide what is worth activating."
          href="/platform/tools/catalog"
          accent="var(--dpf-info)"
          metrics={[
            { label: "Available", value: catalogCount },
            { label: "Pending setup", value: unconfiguredServices },
          ]}
        />
        <PlatformSummaryCard
          title="Discovery Operations"
          description="Turn raw network findings into purpose-aware estate evidence with attribution and dependency review."
          href="/platform/tools/discovery"
          accent="var(--dpf-warning)"
          metrics={[
            { label: "Active connections", value: activeDiscoveryConnections },
            { label: "Needs review", value: needsReviewCount },
          ]}
        />
        <PlatformSummaryCard
          title="Services"
          description="Register and maintain the MCP services the platform depends on."
          href="/platform/tools/services"
          accent="var(--dpf-success)"
          metrics={[
            { label: "Active", value: activeServices },
            { label: "Enabled tools", value: enabledTools },
          ]}
        />
        <PlatformSummaryCard
          title="Enterprise Integrations"
          description="Configure native business-system anchors that run on the shared credential and governance substrate."
          href="/platform/tools/integrations"
          accent="var(--dpf-accent)"
          metrics={[
            { label: "Configured", value: nativeIntegrations },
            { label: "Errors", value: integrationErrors },
          ]}
        />
        <PlatformSummaryCard
          title="Capability Inventory"
          description="See the merged inventory of built-in tools, MCP tools, and provider-facing capabilities."
          href="/platform/tools/inventory"
          accent="var(--dpf-info)"
          metrics={[
            { label: "Inventory source", value: "Unified" },
            { label: "Primary use", value: "Agent tooling" },
          ]}
        />
      </div>

      <div className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
        <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">
          Recommended Flow
        </p>
        <p className="mt-2 text-sm text-[var(--dpf-text)]">
          Start in the catalog when you are researching options, move to discovery operations when
          you need to understand what was found and why it matters, then use services and capability
          inventory to manage the platform tooling the AI workforce relies on.
        </p>
      </div>
    </div>
  );
}
