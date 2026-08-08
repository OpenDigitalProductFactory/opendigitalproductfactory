// apps/web/lib/coworker-identity/cost-projection.ts
//
// EP-COWORKER-IDENTITY-360 (spec 2026-08-06) Phase 1 — the per-coworker COST
// facet the founder named ("the costs"). Per-coworker spend exists in the data
// (TokenUsage.costUsd / AgentBudgetEvent.amountUsd, keyed by the business
// agentId) but is surfaced only fleet-wide at /platform/ai/providers today; this
// projects it onto ONE coworker's identity: 30-day spend + trend vs the prior
// window, top cost drivers, and budget posture vs AgentExecutionConfig limits.
//
// Zero-schema: a read-projection over existing tables. The pure summarizer
// (summarizeCoworkerCost) is split from the prisma fetch so the arithmetic is
// unit-tested deterministically (cost-projection.test.ts) with a fixed `now`.
//
// Id seam (spec §4.4): TokenUsage.agentId and AgentBudgetEvent.agentId key on
// the BUSINESS agentId (AGT-*), NOT the Agent.id cuid — callers pass
// record.runtime.agentId.

import { prisma } from "@dpf/db";

import { coworkerIdentityForms } from "./identity-forms";

/** One row of per-inference metering, trimmed to what the summary needs. */
export type CostUsageRow = {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  contextKey: string;
  createdAt: Date;
};

/** A budget-pressure event (warning_95 | rejected | inference | …). */
export type CostBudgetEventRow = {
  eventKind: string;
  createdAt: Date;
};

export type CoworkerCostDriver = {
  /** Raw grouping key (the TokenUsage.contextKey). */
  key: string;
  /** Human-facing label derived from the key. */
  label: string;
  costUsd: number;
  tokens: number;
};

export type CoworkerCostSummary = {
  window: { since: Date; until: Date; days: number };
  totalUsd: number;
  tokens: number;
  /** Spend over the immediately-prior equal-length window, for the delta. */
  priorTotalUsd: number;
  /** Percentage change vs the prior window; null when there is no prior spend. */
  deltaPct: number | null;
  /** Ascending daily spend series (UTC days that had spend) for a sparkline. */
  dailyUsd: Array<{ day: string; usd: number }>;
  drivers: CoworkerCostDriver[];
  budget: {
    dailyTokenLimit: number | null;
    tokensToday: number;
    /** tokensToday / dailyTokenLimit * 100; null when no limit is configured. */
    usedPct: number | null;
    /** rejected budget events in the last 24h. */
    recentRejections: number;
  };
};

function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Turn a raw contextKey (e.g. "build.decompose" / "route:/build") into a label. */
export function humanizeCostDriver(key: string): string {
  const cleaned = (key ?? "").trim().replace(/^route:/, "").replace(/[/_.:-]+/g, " ").trim();
  if (!cleaned) return "Uncategorized";
  return cleaned
    .split(/\s+/)
    .map((tok) => tok.charAt(0).toUpperCase() + tok.slice(1))
    .join(" ");
}

export type SummarizeCoworkerCostInput = {
  usage: CostUsageRow[];
  budgetEvents: CostBudgetEventRow[];
  dailyTokenLimit: number | null;
  now: Date;
  windowDays?: number;
  maxDrivers?: number;
};

/**
 * Pure cost summarizer — deterministic given (rows, now). The prisma fetch lives
 * in loadCoworkerCostProjection; this is the unit-tested arithmetic.
 */
export function summarizeCoworkerCost(input: SummarizeCoworkerCostInput): CoworkerCostSummary {
  const windowDays = input.windowDays ?? 30;
  const maxDrivers = input.maxDrivers ?? 5;
  const until = input.now;
  const since = new Date(until.getTime() - windowDays * 86_400_000);
  const priorSince = new Date(until.getTime() - 2 * windowDays * 86_400_000);
  const startOfToday = new Date(Date.UTC(until.getUTCFullYear(), until.getUTCMonth(), until.getUTCDate()));

  let totalUsd = 0;
  let priorTotalUsd = 0;
  let tokens = 0;
  let tokensToday = 0;
  const byDay = new Map<string, number>();
  const byDriver = new Map<string, { costUsd: number; tokens: number }>();

  for (const row of input.usage) {
    const t = row.createdAt.getTime();
    const rowTokens = (row.inputTokens ?? 0) + (row.outputTokens ?? 0);
    if (t >= priorSince.getTime() && t < since.getTime()) {
      priorTotalUsd += row.costUsd;
      continue;
    }
    if (t < since.getTime() || t > until.getTime()) continue;
    // Current window.
    totalUsd += row.costUsd;
    tokens += rowTokens;
    const dayKey = utcDayKey(row.createdAt);
    byDay.set(dayKey, (byDay.get(dayKey) ?? 0) + row.costUsd);
    const driverKey = row.contextKey || "uncategorized";
    const acc = byDriver.get(driverKey) ?? { costUsd: 0, tokens: 0 };
    acc.costUsd += row.costUsd;
    acc.tokens += rowTokens;
    byDriver.set(driverKey, acc);
    if (t >= startOfToday.getTime()) tokensToday += rowTokens;
  }

  const dailyUsd = [...byDay.entries()]
    .map(([day, usd]) => ({ day, usd: round2(usd) }))
    .sort((a, b) => a.day.localeCompare(b.day));

  const drivers = [...byDriver.entries()]
    .map(([key, v]) => ({ key, label: humanizeCostDriver(key), costUsd: round2(v.costUsd), tokens: v.tokens }))
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, maxDrivers);

  const deltaPct =
    priorTotalUsd > 0 ? round2(((totalUsd - priorTotalUsd) / priorTotalUsd) * 100) : null;

  const dayAgo = until.getTime() - 86_400_000;
  const recentRejections = input.budgetEvents.filter(
    (e) => e.eventKind === "rejected" && e.createdAt.getTime() >= dayAgo,
  ).length;

  const usedPct =
    input.dailyTokenLimit && input.dailyTokenLimit > 0
      ? round2((tokensToday / input.dailyTokenLimit) * 100)
      : null;

  return {
    window: { since, until, days: windowDays },
    totalUsd: round2(totalUsd),
    tokens,
    priorTotalUsd: round2(priorTotalUsd),
    deltaPct,
    dailyUsd,
    drivers,
    budget: {
      dailyTokenLimit: input.dailyTokenLimit,
      tokensToday,
      usedPct,
      recentRejections,
    },
  };
}

/**
 * Fetch + summarize per-coworker cost. `agentId` is the BUSINESS id (AGT-*);
 * `slugId` is the loaded row's slug when present. Metering rows (TokenUsage,
 * AgentBudgetEvent) are keyed by the SLUG form for many coworkers, so we query
 * every id form the coworker's activity may be filed under (see
 * coworkerIdentityForms — the id seam). AgentExecutionConfig is a 1:1 config row
 * keyed by the loaded agentId, so it stays a single-id lookup.
 * Fail-open: a read hiccup returns a zeroed summary so the identity page renders
 * an empty-state facet rather than 500-ing (the record-page convention).
 */
export async function loadCoworkerCostProjection(
  agentId: string,
  opts?: { now?: Date; windowDays?: number; slugId?: string | null },
): Promise<CoworkerCostSummary> {
  const now = opts?.now ?? new Date();
  const windowDays = opts?.windowDays ?? 30;
  const priorSince = new Date(now.getTime() - 2 * windowDays * 86_400_000);
  const idForms = coworkerIdentityForms(agentId, opts?.slugId);

  try {
    const [usage, budgetEvents, executionConfig] = await Promise.all([
      prisma.tokenUsage.findMany({
        where: { agentId: { in: idForms }, createdAt: { gte: priorSince } },
        select: { costUsd: true, inputTokens: true, outputTokens: true, contextKey: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 5000,
      }),
      prisma.agentBudgetEvent.findMany({
        where: { agentId: { in: idForms }, createdAt: { gte: new Date(now.getTime() - 86_400_000) } },
        select: { eventKind: true, createdAt: true },
        take: 200,
      }),
      prisma.agentExecutionConfig.findUnique({
        where: { agentId },
        select: { dailyTokenLimit: true },
      }).catch(() => null),
    ]);

    return summarizeCoworkerCost({
      usage,
      budgetEvents,
      dailyTokenLimit: executionConfig?.dailyTokenLimit ?? null,
      now,
      windowDays,
    });
  } catch (err) {
    console.warn("[coworker-identity/cost] failed to load cost projection:", err);
    return summarizeCoworkerCost({ usage: [], budgetEvents: [], dailyTokenLimit: null, now, windowDays });
  }
}
