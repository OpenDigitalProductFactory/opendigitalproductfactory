// Agent-proposal source — AgentActionProposal rows awaiting a human decision.
// Today these are reachable only through /api/v1/governance/approvals (no UI);
// the inbox is their first human surface. Spec §1 (queue #8), §4.1.

import type { prisma } from "@dpf/db";
import { projectActionProposalPresentation } from "@/lib/governance/action-proposal-presentation";
import type { AttentionItem } from "../types";

type Db = typeof prisma;

export type AgentActionProposalRow = {
  proposalId: string;
  actionType: string;
  parameters: unknown;
  proposedAt: Date;
};

/** Pure projection of one proposed agent action into an attention item. */
export function agentProposalToAttentionItem(row: AgentActionProposalRow): AttentionItem {
  const presentation = projectActionProposalPresentation(row);
  const isActivityRoutingAction = row.actionType === "activity_harness_confidence_override";

  return {
    id: `agent-proposal:${row.proposalId}`,
    source: "agent-proposal",
    title: `Approve: ${presentation.title}`,
    context: isActivityRoutingAction
      ? presentation.summary
      : "A coworker proposed an action and is waiting on your approval.",
    decisionClass: { scorability: "unscorable" },
    riskClass: "bounded-write",
    triage: {
      timeToAct: "none",
      residueReason: "policy-approval",
      blastRadius: "a coworker waiting on approval",
      decideEffort: "review",
      irreversible: false,
    },
    createdAtIso: row.proposedAt.toISOString(),
    actions: [{
      kind: "open-in-context",
      label: isActivityRoutingAction ? "Review routing workbench" : "Review in AI Workforce",
      href: isActivityRoutingAction ? "/platform/ai/operations-map" : "/platform/ai",
    }],
    deepLink: isActivityRoutingAction ? "/platform/ai/operations-map" : "/platform/ai",
    audience: { operator: true },
  };
}

export async function loadAgentProposalItems(db: Db): Promise<AttentionItem[]> {
  const rows = await db.agentActionProposal.findMany({
    where: { status: "proposed" },
    orderBy: { proposedAt: "desc" },
    take: 50,
    select: { proposalId: true, actionType: true, parameters: true, proposedAt: true },
  });
  return rows.map(agentProposalToAttentionItem);
}
