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
  ] =
    await Promise.all([
      prisma.mcpIntegration.count({ where: { status: "active" } }),
      prisma.mcpServer.count({ where: { status: "active" } }),
      prisma.mcpServer.count({ where: { status: "unconfigured" } }),
      prisma.mcpServerTool.count({ where: { isEnabled: true } }),
      prisma.integrationCredential.count({
        where: { provider: { in: ["adp", "quickbooks"] }, status: "connected" },
      }),
      prisma.integrationCredential.count({
        where: { provider: { in: ["adp", "quickbooks"] }, status: "error" },
      }),
      prisma.discoveryConnection.count({ where: { status: { in: ["active", "ok"] } } }),
      prisma.inventoryEntity.count({ where: { attributionStatus: "needs_review" } }),
    ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Tools &amp; Services</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          Research connection options, operate MCP services, manage native integrations, and confirm what agents can actually use at runtime.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <PlatformSummaryCard
          title="MCP Catalog"
          description="Browse the current MCP registry while the broader connection catalog is still being unified."
          href="/platform/tools/catalog"
          accent="var(--dpf-info)"
          metrics={[
            { label: "Available", value: catalogCount },
            { label: "Pending setup", value: unconfiguredServices },
          ]}
        />
        <PlatformSummaryCard
          title="Estate Discovery"
          description="Turn raw network findings into purpose-aware estate evidence with attribution and dependency review."
          href="/platform/tools/discovery"
          accent="var(--dpf-warning)"
          metrics={[
            { label: "Active connections", value: activeDiscoveryConnections },
            { label: "Needs review", value: needsReviewCount },
          ]}
        />
        <PlatformSummaryCard
          title="MCP Services"
          description="Register and maintain the MCP services the platform depends on."
          href="/platform/tools/services"
          accent="var(--dpf-success)"
          metrics={[
            { label: "Active", value: activeServices },
            { label: "Enabled tools", value: enabledTools },
          ]}
        />
        <PlatformSummaryCard
          title="Native Integrations"
          description="Configure native business-system anchors that run on the shared credential and governance substrate."
          href="/platform/tools/integrations"
          accent="var(--dpf-accent)"
          metrics={[
            { label: "Configured", value: nativeIntegrations },
            { label: "Errors", value: integrationErrors },
          ]}
        />
        <PlatformSummaryCard
          title="Built-in Tools"
          description="Configure first-party platform tools such as Brave Search and other shipped utilities."
          href="/platform/tools/built-ins"
          accent="var(--dpf-warning)"
          metrics={[
            { label: "Model", value: "Built-in" },
            { label: "Initial focus", value: "Brave Search" },
          ]}
        />
        <PlatformSummaryCard
          title="Capability Inventory"
          description="See the runtime inventory of tools and capabilities already available to agents, not the setup catalog."
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
          Start in the MCP catalog when you are researching options, move to estate discovery when you need to understand what was found and why it matters,
          then use MCP services, native integrations, built-in tools, and capability inventory to manage the tooling the AI workforce relies on.
        </p>
      </div>
    </div>
  );
}
