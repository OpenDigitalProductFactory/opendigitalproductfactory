// Platform-continuity source (BI-3E2F87FA, BI-85DE8EBD) — the platform stopped
// serving, or lost its paired installation. Projected from the monitor rows the
// continuity watch (`platform_downtime`) and the work-sync watch
// (`work_sync_failure`) maintain.
//
// Both need the operator: a host that sleeps or does not restart on its own, or
// a paired computer that is switched off or re-paired, is fixed only by a
// person. owner-routing therefore sends these to Needs-you rather than to the
// digital team's count (isOperatorContinuityItem). Read-only: the watches own
// each row's lifecycle and wrote the plain-language title, explanation, steps
// and page into it.

import type { prisma } from "@dpf/db";
import type { AttentionItem } from "../types";

type Db = typeof prisma;

export const CONTINUITY_ISSUE_TYPES = ["platform_downtime", "work_sync_failure"] as const;

export type OpenContinuityIssue = {
  issueKey: string;
  issueType: string;
  severity: string;
  summary: string;
  details: unknown;
  firstDetectedAt: Date;
};

type ContinuityDetails = {
  explanation?: string;
  advice?: unknown;
  nextSteps?: unknown;
  peerLabel?: string;
  actionLabel?: string;
  href?: string;
};

function detailsOf(raw: unknown): ContinuityDetails {
  return raw && typeof raw === "object" ? (raw as ContinuityDetails) : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/** Pure projection of one open continuity row. */
export function continuityIssueToAttentionItem(issue: OpenContinuityIssue): AttentionItem {
  const details = detailsOf(issue.details);
  const downtime = issue.issueType === "platform_downtime";
  const href = details.href ?? (downtime ? "/ops/installation#host-posture" : "/ops/installation");
  const steps = [...strings(details.advice), ...strings(details.nextSteps)];
  return {
    id: `platform-health:${issue.issueKey}`,
    source: "platform-health",
    title: issue.summary,
    context: [details.explanation ?? issue.summary, ...steps].join(" "),
    // A stopped platform or an unreachable peer is an observed fact, not a scored call.
    decisionClass: { scorability: "unscorable" },
    riskClass: issue.severity === "error" ? "high-risk" : "bounded-write",
    triage: {
      timeToAct: "none",
      residueReason: "no-self-heal",
      blastRadius: downtime ? "the whole platform" : (details.peerLabel ?? "the paired installation"),
      decideEffort: "review",
      irreversible: false,
    },
    createdAtIso: issue.firstDetectedAt.toISOString(),
    actions: [{ kind: "open-in-context", label: details.actionLabel ?? (downtime ? "Check how this computer is set up" : "Review work sync"), href }],
    deepLink: href,
    audience: { operator: true },
  };
}

/** Load open continuity rows for the operator's own estate. */
export async function loadPlatformContinuityItems(db: Db): Promise<AttentionItem[]> {
  const rows = await db.portfolioQualityIssue.findMany({
    where: { issueType: { in: [...CONTINUITY_ISSUE_TYPES] }, status: "open", customerAccountId: null },
    select: { issueKey: true, issueType: true, severity: true, summary: true, details: true, firstDetectedAt: true },
    orderBy: { firstDetectedAt: "asc" },
  });
  return rows.map(continuityIssueToAttentionItem);
}
