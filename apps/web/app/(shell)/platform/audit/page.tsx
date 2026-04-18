import { prisma } from "@dpf/db";
import { PlatformSummaryCard } from "@/components/platform/PlatformSummaryCard";
import { getProposalStats } from "@/lib/evaluate/proposal-data";
import { getToolExecutionStats } from "@/lib/tool-execution-data";

export default async function AuditHubPage() {
  const now = new Date();
  const [proposalStats, toolStats, activeGrants] = await Promise.all([
    getProposalStats(),
    getToolExecutionStats(),
    prisma.delegationGrant.count({
      where: {
        status: "active",
        expiresAt: { gt: now },
      },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Governance &amp; Audit</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          Review decisions, tool execution evidence, and authority surfaces without bouncing across isolated pages.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <PlatformSummaryCard
          title="Action Ledger"
          description="Review proposals, outcomes, and execution state for side-effecting work."
          href="/platform/audit/ledger"
          accent="var(--dpf-accent)"
          metrics={[
            { label: "Total", value: proposalStats.total },
            { label: "Pending", value: proposalStats.proposed },
          ]}
        />
        <PlatformSummaryCard
          title="Capability Journal"
          description="Inspect tool execution history and understand what agents actually did."
          href="/platform/audit/journal"
          accent="var(--dpf-info)"
          metrics={[
            { label: "Executions", value: toolStats.total },
            { label: "Unique tools", value: toolStats.uniqueTools },
          ]}
        />
        <PlatformSummaryCard
          title="Authority"
          description="Trace role coverage, delegation chains, and effective permissions."
          href="/platform/audit/authority"
          accent="var(--dpf-warning)"
          metrics={[
            { label: "Active grants", value: activeGrants },
            { label: "Governed agents", value: toolStats.uniqueAgents },
          ]}
        />
        <PlatformSummaryCard
          title="Operational Metrics"
          description="See route, operation, and audit signals in one place."
          href="/platform/audit/metrics"
          accent="var(--dpf-success)"
          metrics={[
            { label: "Successful", value: toolStats.successful },
            { label: "Failed", value: toolStats.failed },
          ]}
        />
      </div>
    </div>
  );
}
