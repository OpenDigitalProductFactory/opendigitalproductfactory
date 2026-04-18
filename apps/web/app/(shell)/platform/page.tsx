import { prisma } from "@dpf/db";
import { PlatformTabNav } from "@/components/platform/PlatformTabNav";
import { PlatformSummaryCard } from "@/components/platform/PlatformSummaryCard";
import { getProposalStats } from "@/lib/evaluate/proposal-data";
import { getToolExecutionStats } from "@/lib/tool-execution-data";

export default async function PlatformPage() {
  const now = new Date();
  const [
    agentCount,
    activeProviderCount,
    catalogCount,
    activeServiceCount,
    enabledToolCount,
    activeGrantCount,
    toolStats,
    proposalStats,
    userCount,
    roleCount,
    capabilityCount,
  ] = await Promise.all([
    prisma.agent.count(),
    prisma.modelProvider.count({ where: { status: "active" } }),
    prisma.mcpIntegration.count({ where: { status: "active" } }),
    prisma.mcpServer.count({ where: { status: "active" } }),
    prisma.mcpServerTool.count({ where: { isEnabled: true } }),
    prisma.delegationGrant.count({
      where: {
        status: "active",
        expiresAt: { gt: now },
      },
    }),
    getToolExecutionStats(),
    getProposalStats(),
    prisma.user.count(),
    prisma.platformRole.count(),
    prisma.platformCapability.count(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Platform</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          Keep the AI workforce, external services, governance evidence, and controlled admin surfaces manageable for a small human team.
        </p>
      </div>

      <PlatformTabNav />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <PlatformSummaryCard
          title="AI Operations"
          description="Supervise the AI workforce, routing, build studio, and escalation surfaces."
          href="/platform/ai"
          accent="var(--dpf-info)"
          metrics={[
            { label: "Agents", value: agentCount },
            { label: "Providers", value: activeProviderCount },
          ]}
        />
        <PlatformSummaryCard
          title="Tools & Services"
          description="Discover integrations, activate MCP services, and confirm available tools."
          href="/platform/tools"
          accent="var(--dpf-success)"
          metrics={[
            { label: "Catalog", value: catalogCount },
            { label: "Active services", value: activeServiceCount },
          ]}
        />
        <PlatformSummaryCard
          title="Governance & Audit"
          description="Review proposals, execution evidence, and temporary authority grants."
          href="/platform/audit"
          accent="var(--dpf-warning)"
          metrics={[
            { label: "Active grants", value: activeGrantCount },
            { label: "Executions", value: toolStats.total },
          ]}
        />
        <PlatformSummaryCard
          title="Core Admin"
          description="Reach the narrower admin surface for access, organization, and controlled configuration."
          href="/admin"
          accent="var(--dpf-accent)"
          metrics={[
            { label: "Users", value: userCount },
            { label: "Roles", value: roleCount },
          ]}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <div className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">Enabled tools</p>
          <p className="mt-2 text-2xl font-semibold text-[var(--dpf-text)]">{enabledToolCount}</p>
        </div>
        <div className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">Pending proposals</p>
          <p className="mt-2 text-2xl font-semibold text-[var(--dpf-text)]">{proposalStats.proposed}</p>
        </div>
        <div className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">Capabilities</p>
          <p className="mt-2 text-2xl font-semibold text-[var(--dpf-text)]">{capabilityCount}</p>
        </div>
        <div className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">Failed executions</p>
          <p className="mt-2 text-2xl font-semibold text-[var(--dpf-text)]">{toolStats.failed}</p>
        </div>
      </div>
    </div>
  );
}
