import { prisma } from "@dpf/db";
import type { DataSourceProvenance } from "@/lib/surface-data-provenance";

export type PlatformAuthoritySummary = {
  temporaryDelegationGrants: number;
  standingToolGrants: number;
  governedAgents: number;
};

export type AuthoritySummaryMetric = {
  label: string;
  value: number;
  note: string;
  provenance: DataSourceProvenance;
};

export async function getPlatformAuthoritySummary(now = new Date()): Promise<PlatformAuthoritySummary> {
  const [temporaryDelegationGrants, standingToolGrants, governedAgentRows] = await Promise.all([
    prisma.delegationGrant.count({
      where: {
        status: "active",
        expiresAt: { gt: now },
      },
    }),
    prisma.agentToolGrant.count(),
    prisma.agentToolGrant.findMany({
      distinct: ["agentId"],
      select: { agentId: true },
    }),
  ]);

  return {
    temporaryDelegationGrants,
    standingToolGrants,
    governedAgents: governedAgentRows.length,
  };
}

export function buildAuthoritySummaryMetrics(summary: PlatformAuthoritySummary): AuthoritySummaryMetric[] {
  return [
    {
      label: "Temporary delegation grants",
      value: summary.temporaryDelegationGrants,
      note: "0 is normal when no time-limited delegation is active.",
      provenance: {
        kind: "live-db",
        label: "DelegationGrant",
        sourceTable: "DelegationGrant",
        description: "Active, unexpired temporary delegation grants.",
      },
    },
    {
      label: "Standing tool grants",
      value: summary.standingToolGrants,
      note: `${summary.governedAgents} governed agent${summary.governedAgents === 1 ? "" : "s"} have standing tool grants.`,
      provenance: {
        kind: "live-db",
        label: "AgentToolGrant",
        sourceTable: "AgentToolGrant",
        description: "Standing tool grants configured for AI coworkers.",
      },
    },
  ];
}
