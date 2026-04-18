import { prisma } from "@dpf/db";
import { PlatformSummaryCard } from "@/components/platform/PlatformSummaryCard";

export default async function ToolsHubPage() {
  const [catalogCount, activeServices, unconfiguredServices, enabledTools] =
    await Promise.all([
      prisma.mcpIntegration.count({ where: { status: "active" } }),
      prisma.mcpServer.count({ where: { status: "active" } }),
      prisma.mcpServer.count({ where: { status: "unconfigured" } }),
      prisma.mcpServerTool.count({ where: { isEnabled: true } }),
    ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Tools &amp; Services</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          Discover integrations, activate MCP services, and confirm what tools are really available to agents.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
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
          title="Capability Inventory"
          description="See the merged inventory of built-in tools, MCP tools, and provider-facing capabilities."
          href="/platform/tools/inventory"
          accent="var(--dpf-warning)"
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
          Start in the catalog when you are researching options, move to services when you are activating and health-checking them,
          and use capability inventory when you need to confirm what the AI workforce can actually call.
        </p>
      </div>
    </div>
  );
}
