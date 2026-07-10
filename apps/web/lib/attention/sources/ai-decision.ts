// AI-decision source — the residue the governed scopes could not resolve.
// DecisionInteraction rows with outcomeType escalate/defer and humanOutcome null
// (exactly what /platform/ai/founder-review reads). These came FROM the kernel
// cascade, so they are unscorable residue — show the honest reason, never a
// verdict. Spec §3.1, §4.1; founder-review becomes a lens of this source (BI-AS-6).

import { Prisma } from "@dpf/db";
import type { prisma } from "@dpf/db";
import type { AttentionItem, AttentionRiskClass, ResidueReason } from "../types";

type Db = typeof prisma;

export type DecisionInteractionRow = {
  interactionId: string;
  question: string;
  outcomeType: string;
  riskTier: string;
  principleConflict: boolean;
  rationale: string | null;
  buildId: string | null;
  taskRunId: string | null;
  createdAt: Date;
};

function clip(s: string, max = 120): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

function riskFromTier(tier: string): AttentionRiskClass {
  switch (tier) {
    case "low":
      return "read";
    case "medium":
      return "bounded-write";
    case "high":
    case "critical":
      return "high-risk";
    default:
      return "unknown";
  }
}

function residueFor(row: DecisionInteractionRow): ResidueReason {
  if (row.principleConflict) return "principle-conflict";
  if (row.outcomeType === "defer") return "coverage-gap";
  return "high-risk-gate"; // escalate: the cascade escalated on risk/low-confidence
}

// Some escalated/deferred decisions reach founder-review with an empty
// `question` (the cascade recorded the residue but not a prose prompt). Without
// a fallback the attention row renders with a BLANK title — an un-triageable
// "high risk · Open →" the operator cannot act on (BI-D35DE119, F1). Derive a
// short, honest title from the residue reason + blast radius so every row says
// what it is and where it came from.
function titleFor(row: DecisionInteractionRow): string {
  const q = row.question?.trim();
  if (q) return clip(q);
  const reasonLabel =
    residueFor(row) === "principle-conflict"
      ? "a principle conflict"
      : row.outcomeType === "defer"
        ? "a coverage gap"
        : "a high-risk gate";
  const where = row.buildId
    ? ` on build ${row.buildId}`
    : row.taskRunId
      ? " on a coworker task"
      : "";
  return `AI decision needs your review — ${reasonLabel}${where}`;
}

/** Pure projection of one unresolved decision into an attention item. */
export function aiDecisionToAttentionItem(row: DecisionInteractionRow): AttentionItem {
  const blast = row.buildId ? `build ${row.buildId}` : row.taskRunId ? "a coworker task" : undefined;
  return {
    id: `ai-decision:${row.interactionId}`,
    source: "ai-decision",
    title: titleFor(row),
    context: row.rationale ?? "The governed scopes could not resolve this decision.",
    decisionClass: { scorability: "unscorable" },
    riskClass: riskFromTier(row.riskTier),
    triage: {
      timeToAct: "none",
      residueReason: residueFor(row),
      blastRadius: blast,
      decideEffort: "judgment",
      irreversible: false,
    },
    createdAtIso: row.createdAt.toISOString(),
    actions: [
      { kind: "open-in-context", label: "Review decision", href: "/platform/ai/founder-review" },
    ],
    deepLink: "/platform/ai/founder-review",
    audience: { operator: true },
  };
}

export async function loadAiDecisionItems(db: Db): Promise<AttentionItem[]> {
  const rows = await db.decisionInteraction.findMany({
    // humanOutcome IS NULL == still unresolved residue (Json? → DB NULL).
    where: { outcomeType: { in: ["escalate", "defer"] }, humanOutcome: { equals: Prisma.DbNull } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      interactionId: true,
      question: true,
      outcomeType: true,
      riskTier: true,
      principleConflict: true,
      rationale: true,
      buildId: true,
      taskRunId: true,
      createdAt: true,
    },
  });
  return rows.map(aiDecisionToAttentionItem);
}
