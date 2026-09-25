// AI as a resource class beside points (BI-0CA5DA2B, design §5.7). Tokens,
// recorded spend and run time per backlog item, from Build Studio phase runs
// through FeatureBuild.originatingBacklogItemId. These figures sit BESIDE
// investment points and are never converted into or out of them (2026-08-15
// methodology); this module deliberately exports no conversion.
//
// A subscription (valuationMethod commitment_first) records no per-call cost,
// so its use reads "subscription: $0 recorded, N tokens", never as zero cost.
// Runs that reach no backlog item are reported as not traced.

import type { Period } from "./portfolio-budget";

export type AiUse = {
  runs: number;
  tokens: number;
  /** Spend recorded on the runs; null when no run recorded a cost. */
  recordedUsd: number | null;
  /** Tokens used under a subscription, where no per-call cost is recorded. */
  subscriptionTokens: number;
  durationMs: number;
};

export const NO_AI_USE: AiUse = { runs: 0, tokens: 0, recordedUsd: null, subscriptionTokens: 0, durationMs: 0 };

export function addAiUse(a: AiUse, b: AiUse): AiUse {
  return {
    runs: a.runs + b.runs,
    tokens: a.tokens + b.tokens,
    recordedUsd: a.recordedUsd === null && b.recordedUsd === null ? null : (a.recordedUsd ?? 0) + (b.recordedUsd ?? 0),
    subscriptionTokens: a.subscriptionTokens + b.subscriptionTokens,
    durationMs: a.durationMs + b.durationMs,
  };
}

type ReadDb = { $queryRaw: <T>(query: TemplateStringsArray, ...values: unknown[]) => Promise<T> };

/** AI use per backlog item for a period; the null key holds runs that reach no item. */
export async function loadAiUseByItem(db: ReadDb, period: Period): Promise<Map<string | null, AiUse>> {
  const rows = await db.$queryRaw<Array<{ itemId: string | null; runs: number | string; tokens: number | string | null; usd: number | string | null; subTokens: number | string | null; ms: number | string | null }>>`
    SELECT b."itemId" AS "itemId",
           COUNT(*) AS "runs",
           SUM(r."inputTokens" + r."outputTokens") AS "tokens",
           SUM(r."costUsd") AS "usd",
           SUM(CASE WHEN f."valuationMethod" = 'commitment_first' THEN r."inputTokens" + r."outputTokens" ELSE 0 END) AS "subTokens",
           SUM(COALESCE(r."durationMs", 0)) AS "ms"
      FROM "BuildPhaseRun" r
      JOIN "FeatureBuild" fb ON fb."buildId" = r."buildId"
      LEFT JOIN "BacklogItem" b ON b."id" = fb."originatingBacklogItemId"
      LEFT JOIN "AiProviderFinanceProfile" f ON f."providerId" = r."providerId"
     WHERE r."startedAt" >= ${period.start} AND r."startedAt" < ${period.end}
     GROUP BY b."itemId"
  `;
  return new Map(rows.map((r) => [r.itemId, {
    runs: Number(r.runs),
    tokens: Number(r.tokens ?? 0),
    recordedUsd: r.usd === null ? null : Number(r.usd),
    subscriptionTokens: Number(r.subTokens ?? 0),
    durationMs: Number(r.ms ?? 0),
  }]));
}

const compact = (n: number) => (n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : n >= 1_000 ? `${Math.round(n / 100) / 10}k` : String(n));

/** How the spend reads: recorded dollars, and subscription use stated as such, never as $0 alone. */
export function aiSpendText(use: AiUse): string {
  if (use.runs === 0) return "No AI runs traced";
  const parts: string[] = [];
  if (use.recordedUsd !== null && use.recordedUsd > 0) parts.push(`$${use.recordedUsd.toFixed(2)} recorded`);
  if (use.subscriptionTokens > 0) parts.push(`subscription: $0 recorded, ${compact(use.subscriptionTokens)} tokens`);
  if (parts.length === 0) parts.push(`no cost recorded for ${compact(use.tokens)} tokens`);
  return parts.join("; ");
}

export function aiTokensText(use: AiUse): string {
  return use.runs === 0 ? "—" : `${compact(use.tokens)} tokens`;
}

/** Latency as average run time, from the phase runs' durations. */
export function aiLatencyText(use: AiUse): string {
  if (use.runs === 0 || use.durationMs === 0) return "—";
  const minutes = use.durationMs / use.runs / 60_000;
  return `${use.runs} run(s), ${minutes >= 10 ? Math.round(minutes) : Math.round(minutes * 10) / 10} min average`;
}
