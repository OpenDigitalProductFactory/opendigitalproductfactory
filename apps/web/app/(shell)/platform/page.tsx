import { prisma } from "@dpf/db";
import { PlatformTabNav } from "@/components/platform/PlatformTabNav";
import { PlatformSummaryCard } from "@/components/platform/PlatformSummaryCard";
import { PlatformReadinessMatrix } from "@/components/workspace/PlatformReadinessMatrix";
import { getProposalStats } from "@/lib/evaluate/proposal-data";
import { getToolExecutionStats } from "@/lib/tool-execution-data";
import { buildAuthoritySummaryMetrics, getPlatformAuthoritySummary } from "@/lib/platform-authority-summary";
import { loadWorkspaceCommandCenter } from "@/lib/workspace/command-center";

export default async function PlatformPage() {
  const [
    agentCount,
    activeProviderCount,
    catalogCount,
    activeServiceCount,
    enabledToolCount,
    authoritySummary,
    toolStats,
    proposalStats,
    userCount,
    roleCount,
    capabilityCount,
    commandCenter,
  ] = await Promise.all([
    prisma.agent.count(),
    prisma.modelProvider.count({ where: { status: "active" } }),
    prisma.mcpIntegration.count({ where: { status: "active" } }),
    prisma.mcpServer.count({ where: { status: "active" } }),
    prisma.mcpServerTool.count({ where: { isEnabled: true } }),
    getPlatformAuthoritySummary(),
    getToolExecutionStats(),
    getProposalStats(),
    prisma.user.count(),
    prisma.platformRole.count(),
    prisma.platformCapability.count(),
    loadWorkspaceCommandCenter(prisma),
  ]);
  const authorityMetrics = buildAuthoritySummaryMetrics(authoritySummary);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Platform</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          Keep AI operations, connection lifecycle management, governance evidence, and controlled admin surfaces understandable for a small employee team.
        </p>
      </div>

      <PlatformTabNav />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <PlatformSummaryCard
          title="AI Operations"
          description="Supervise coworkers, assignments, skills, providers and routing, and the build runtime."
          href="/platform/ai/overview"
          accent="var(--dpf-info)"
          metrics={[
            { label: "AI coworkers", value: agentCount },
            { label: "Providers", value: activeProviderCount },
          ]}
        />
        <PlatformSummaryCard
          title="Tools & Services"
          description="Research connections, operate MCP services, manage native integrations, and verify runtime capability availability."
          href="/platform/tools"
          accent="var(--dpf-success)"
          metrics={[
            { label: "Catalog", value: catalogCount },
            { label: "Active services", value: activeServiceCount },
          ]}
        />
        <PlatformSummaryCard
          title="Governance & Audit"
          description="Review proposals, execution evidence, temporary delegations, and standing tool grants."
          href="/platform/audit"
          accent="var(--dpf-warning)"
          metrics={[
            authorityMetrics[0],
            authorityMetrics[1],
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

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Operations</h2>
        <a
          href="/platform/schedule"
          className="inline-flex items-center rounded-md border border-[var(--dpf-border)] px-3 py-2 text-sm font-medium text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)]"
        >
          Platform schedule →
        </a>
      </div>

      <PlatformReadinessMatrix readiness={commandCenter.commandCenter.readiness} />
    </div>
  );
}
