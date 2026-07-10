// Platform-health source (BI-2F778C13) — firing health alerts, projected from
// the PortfolioQualityIssue inbox rows the alert-delivery-bridge cron already
// maintains (issueType=health_alert, auto-resolved when the alert clears).
//
// This closes the "tell-don't-act" half of the proactivity gap: the blinking
// header dot told the user "ContainerDown" and stopped. Projecting the same
// rows into the attention read-model means the coworker's opening briefing
// (BI-DED493BA) names the outage in plain language the moment the panel opens,
// the Needs-you inbox lists it, and the deep link lands on System Health.
// Read-only projection — the row's lifecycle stays owned by the bridge cron.

import type { prisma } from "@dpf/db";
import { humanizeHealthAlert } from "@/components/monitoring/alert-humanize";
import type { AttentionItem } from "../types";

type Db = typeof prisma;

export type OpenHealthAlertIssue = {
  issueKey: string;
  severity: string;
  summary: string;
  details: unknown;
  firstDetectedAt: Date;
};

function labelsFromDetails(details: unknown): Record<string, string> {
  if (details && typeof details === "object" && "labels" in details) {
    const labels = (details as { labels?: unknown }).labels;
    if (labels && typeof labels === "object") {
      return labels as Record<string, string>;
    }
  }
  return {};
}

/** Pure projection of one open health-alert issue into an attention item. */
export function healthAlertToAttentionItem(issue: OpenHealthAlertIssue): AttentionItem {
  const labels = labelsFromDetails(issue.details);
  const humanized = humanizeHealthAlert({
    labels,
    annotations: { summary: issue.summary },
  });
  return {
    id: `platform-health:${issue.issueKey}`,
    source: "platform-health",
    title: humanized.title,
    context: humanized.explanation,
    decisionClass: { scorability: "unscorable" }, // an outage is a fact, not a scored call
    riskClass: issue.severity === "error" ? "high-risk" : "bounded-write",
    triage: {
      timeToAct: "none", // ordered by risk → age, same as the other keystone sources
      residueReason: "no-self-heal",
      blastRadius: humanized.serviceName ?? undefined,
      decideEffort: "review",
      irreversible: false,
    },
    createdAtIso: issue.firstDetectedAt.toISOString(),
    actions: [
      { kind: "open-in-context", label: "Open System Health", href: "/ops/health" },
    ],
    deepLink: "/ops/health",
    audience: { operator: true },
  };
}

/**
 * Load open self-monitoring health alerts. Customer-scoped rows (MSP
 * federation) are excluded — they route through the customer estate queue,
 * not the operator's own platform-health attention.
 */
export async function loadPlatformHealthItems(db: Db): Promise<AttentionItem[]> {
  const rows = await db.portfolioQualityIssue.findMany({
    where: { issueType: "health_alert", status: "open", customerAccountId: null },
    select: {
      issueKey: true,
      severity: true,
      summary: true,
      details: true,
      firstDetectedAt: true,
    },
    orderBy: { firstDetectedAt: "asc" },
  });
  return rows.map(healthAlertToAttentionItem);
}
