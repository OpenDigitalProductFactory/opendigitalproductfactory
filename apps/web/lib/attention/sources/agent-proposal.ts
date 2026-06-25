// Agent-proposal source — AgentActionProposal rows awaiting a human decision.
// Today these are reachable only through /api/v1/governance/approvals (no UI);
// the inbox is their first human surface. Spec §1 (queue #8), §4.1.

import type { prisma } from "@dpf/db";
import type { AttentionItem } from "../types";

type Db = typeof prisma;

export type AgentActionProposalRow = {
  proposalId: string;
  actionType: string;
  proposedAt: Date;
};

/** "create_invoice" → "Create invoice". Light humanization of the action slug. */
function humanizeActionType(actionType: string): string {
  const words = actionType.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "an action";
}

/** Pure projection of one proposed agent action into an attention item. */
export function agentProposalToAttentionItem(row: AgentActionProposalRow): AttentionItem {
  return {
    id: `agent-proposal:${row.proposalId}`,
    source: "agent-proposal",
    title: `Approve: ${humanizeActionType(row.actionType)}`,
    context: "A coworker proposed an action and is waiting on your approval.",
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
    actions: [{ kind: "open-in-context", label: "Review in AI Workforce", href: "/platform/ai" }],
    deepLink: "/platform/ai",
    audience: { operator: true },
  };
}

export async function loadAgentProposalItems(db: Db): Promise<AttentionItem[]> {
  const rows = await db.agentActionProposal.findMany({
    where: { status: "proposed" },
    orderBy: { proposedAt: "desc" },
    take: 50,
    select: { proposalId: true, actionType: true, proposedAt: true },
  });
  return rows.map(agentProposalToAttentionItem);
}
