// Skill-proposal source — ImprovementProposal rows (category "skill") awaiting a
// human decision.
//
// BI-2F9EE2E9: a pending skill proposal had NO surface outside the skill's own
// detail page, and that page is reachable only by hand-typing
// `?skill=<skillId>` — nothing in the UI produces the link. The catalog lists
// 146 skills with no indication that one of them has a decision waiting, so a
// proposal could sit `proposed` indefinitely with nobody told. The attention
// layer already turns AgentActionProposal and ResearchProposal into inbox
// items; this category simply was not wired to it.
//
// The deep link carries `?skill=` deliberately: the bare catalog route cannot
// reach the pending proposal, so linking there would put the reader back where
// they started.

import type { prisma } from "@dpf/db";

import { attentionAuthorForAgent } from "../attribution";
import type { AttentionItem } from "../types";

type Db = typeof prisma;

export type SkillProposalRow = {
  proposalId: string;
  title: string;
  targetSkillId: string | null;
  severity: string | null;
  createdAt: Date;
  agentId: string | null;
};

/** Where a pending proposal is actually actionable. */
export function skillProposalHref(skillId: string): string {
  return `/platform/ai/skills?skill=${encodeURIComponent(skillId)}`;
}

/** Pure projection of one pending skill proposal into an attention item. */
export function skillProposalToAttentionItem(row: SkillProposalRow): AttentionItem {
  const skillId = row.targetSkillId ?? "an unnamed skill";
  const href = skillProposalHref(skillId);

  return {
    id: `skill-proposal:${row.proposalId}`,
    source: "skill-proposal",
    // Lead with the skill and the decision. The IP-SKL-* identifier is an
    // implementation detail and stays out of the headline.
    title: `Review a change to ${skillId}`,
    context: row.title,
    decisionClass: { scorability: "unscorable" },
    riskClass: "bounded-write",
    triage: {
      timeToAct: "none",
      residueReason: "policy-approval",
      blastRadius: `every coworker and agent that loads ${skillId}`,
      decideEffort: "review",
      irreversible: false,
    },
    createdAtIso: row.createdAt.toISOString(),
    actions: [{ kind: "open-in-context", label: "Review the change", href }],
    deepLink: href,
    audience: { operator: true },
    technical: { detectedBy: row.agentId ?? "AI workforce" },
    author: attentionAuthorForAgent(row.agentId ?? "AI workforce", { trustLevel: "propose" }),
  };
}

export async function loadSkillProposalItems(db: Db): Promise<AttentionItem[]> {
  const rows = await db.improvementProposal.findMany({
    // A proposal is only actionable while `proposed`; `reviewed` is terminal.
    // targetSkillId must be present or there is nothing to link to.
    where: { status: "proposed", category: "skill", targetSkillId: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      proposalId: true,
      title: true,
      targetSkillId: true,
      severity: true,
      createdAt: true,
      agentId: true,
    },
  });
  return rows.map(skillProposalToAttentionItem);
}
