// AI-capacity source (BI-24092DC9) — lost AI capacity, projected from the
// `ai_capacity_loss` PortfolioQualityIssue rows the AI-capacity watch maintains
// (lib/routing/ai-capacity-watch.ts, run by the alert-delivery-bridge cron).
//
// Read-only projection under the platform-health lane: the row's lifecycle is
// owned by the watch, which resolves it the cycle capacity comes back. The watch
// already wrote the plain-language title, explanation, action and page into the
// row, so this file only shapes it into an AttentionItem.
//
// One item per provider: a sign-in / no-credential row is dropped when the
// provider-credential lane already shows a reconnect item for the same provider,
// so the operator never sees "Reconnect X" and "Sign in to X again" together.
// The watch still pushed its notification when the row opened. Coverage is
// recorded on the row by the watch each cycle (details.credentialLaneCovers).

import type { prisma } from "@dpf/db";
import { AI_PROVIDER_CONNECTIONS_ROUTE } from "@/lib/ai-provider-routes";
import type { AttentionItem } from "../types";

type Db = typeof prisma;

export type OpenAiCapacityIssue = {
  issueKey: string;
  severity: string;
  summary: string;
  details: unknown;
  firstDetectedAt: Date;
};

type AiCapacityDetails = {
  kind?: "provider" | "platform";
  providerId?: string;
  name?: string;
  cause?: string;
  explanation?: string;
  actionLabel?: string;
  href?: string;
};

const CREDENTIAL_CAUSES = new Set(["sign-in", "no-credentials"]);

function detailsOf(raw: unknown): AiCapacityDetails {
  return raw && typeof raw === "object" ? (raw as AiCapacityDetails) : {};
}

/** Pure projection of one open AI-capacity row. */
export function aiCapacityToAttentionItem(issue: OpenAiCapacityIssue): AttentionItem {
  const details = detailsOf(issue.details);
  const href = details.href ?? AI_PROVIDER_CONNECTIONS_ROUTE;
  const credential = CREDENTIAL_CAUSES.has(details.cause ?? "");
  return {
    id: `platform-health:${issue.issueKey}`,
    source: "platform-health",
    title: issue.summary,
    context: details.explanation ?? issue.summary,
    // Lost capacity is an observed fact, not a scored judgment call.
    decisionClass: { scorability: "unscorable" },
    riskClass: details.kind === "platform" || issue.severity === "error" ? "high-risk" : "bounded-write",
    triage: {
      timeToAct: "none",
      residueReason: credential ? "needs-credential" : "no-self-heal",
      blastRadius: details.kind === "platform" ? "AI workforce" : details.name,
      decideEffort: credential ? "one-tap" : "review",
      irreversible: false,
    },
    createdAtIso: issue.firstDetectedAt.toISOString(),
    actions: [{ kind: "open-in-context", label: details.actionLabel ?? "Review AI providers", href }],
    deepLink: href,
    audience: { operator: true },
  };
}

/** Pure: project rows, dropping credential rows another lane already shows. */
export function selectAiCapacityItems(
  rows: ReadonlyArray<OpenAiCapacityIssue>,
  coveredByCredentialLane: ReadonlySet<string>,
): AttentionItem[] {
  return rows
    .filter((row) => {
      const details = detailsOf(row.details);
      return !(
        details.kind === "provider" &&
        details.providerId &&
        CREDENTIAL_CAUSES.has(details.cause ?? "") &&
        coveredByCredentialLane.has(details.providerId)
      );
    })
    .map(aiCapacityToAttentionItem);
}

/** Load open AI-capacity rows for the operator's own estate. */
export async function loadAiCapacityItems(db: Db): Promise<AttentionItem[]> {
  const rows = await db.portfolioQualityIssue.findMany({
    where: { issueType: "ai_capacity_loss", status: "open", customerAccountId: null },
    select: { issueKey: true, severity: true, summary: true, details: true, firstDetectedAt: true },
    orderBy: { firstDetectedAt: "asc" },
  });
  // The watch records, each cycle, which providers the credential lane already
  // shows (details.credentialLaneCovers) — computed there so this projection
  // stays a leaf and does not import the provider-credential source.
  const covered = new Set(
    rows.flatMap((row) => {
      const details = detailsOf(row.details) as AiCapacityDetails & { credentialLaneCovers?: boolean };
      return details.credentialLaneCovers && details.providerId ? [details.providerId] : [];
    }),
  );
  return selectAiCapacityItems(rows, covered);
}
