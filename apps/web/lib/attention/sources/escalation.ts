// Escalation source — build-stall escalations RE-HOMED off /ops into the inbox.
// Reuses the #2315 escalation-attention reader verbatim (single-source-of-truth);
// this adapter only PROJECTS OpenEscalation → AttentionItem. Spec §4.1, §6.4.

import {
  getOpenEscalations,
  escalationBlockerSummary,
  type OpenEscalation,
} from "@/lib/quality/escalation-attention";
import type { AttentionItem, AttentionRiskClass } from "../types";

function riskFromSeverity(severity: string): AttentionRiskClass {
  const s = severity.toLowerCase();
  if (s === "high" || s === "critical") return "high-risk";
  if (s === "low") return "read";
  return "bounded-write";
}

/** Pure projection of one held escalation into an attention item. */
export function escalationToAttentionItem(e: OpenEscalation): AttentionItem {
  const blocker = escalationBlockerSummary(e.description);
  return {
    id: `escalation:${e.reportId}`,
    source: "escalation",
    title: e.title,
    context: blocker ?? "Build Studio could not self-repair this build.",
    decisionClass: { scorability: "unscorable" }, // resume/defer ops call — honest facts, no ledger (#2315)
    riskClass: riskFromSeverity(e.severity),
    triage: {
      timeToAct: "none", // build-stall escalations carry no hard deadline; age + risk order them
      residueReason: "self-fix-exhausted",
      blastRadius: e.backlogItemId ?? undefined,
      decideEffort: "judgment",
      irreversible: false,
    },
    createdAtIso: e.createdAt,
    actions: e.buildId
      ? [{ kind: "open-in-context", label: "View build", href: `/build?buildId=${encodeURIComponent(e.buildId)}` }]
      : [{ kind: "open-in-context", label: "Evidence trail", href: "/admin/issue-reports" }],
    deepLink: e.buildId ? `/build?buildId=${encodeURIComponent(e.buildId)}` : "/admin/issue-reports",
    audience: { operator: true },
    technical: {
      backlogItemId: e.backlogItemId ?? undefined,
      featureBuildId: e.buildId ?? undefined,
      detectedBy: "Build Studio",
    },
  };
}

/** Load + project all held escalations. Reads through the existing #2315 query. */
export async function loadEscalationItems(): Promise<AttentionItem[]> {
  const rows = await getOpenEscalations();
  return rows.map(escalationToAttentionItem);
}
