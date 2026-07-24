// apps/web/lib/coworker-record/corpus-signals.ts
// WSID Phase 3 — operator view of profession-corpus RUNTIME signals.
//
// Coverage (coverage.ts) answers "is corpus seeded?". This answers the harder
// question the goal insists on: "is the corpus actually USED, and where is it
// MISSING?" — by rolling up the ProfessionCorpusUsageStat counters and the
// open ProfessionCorpusGap growth-backlog the prompt path writes at runtime.
//
// Server-side, direct-Prisma (same pattern as coverage.ts / roster.ts). All
// reads are fail-open (.catch → empty) so the AI Workforce page renders even if
// the runtime tables are empty on a cold install.

import { prisma } from "@dpf/db";
import { PROFESSION_REGISTRY } from "@/lib/decision-perspective/resolve-profession-profile";

export type CorpusUsageRollup = {
  professionKey: string;
  label: string;
  injected: number;
  missed: number;
  total: number;
  /** injected / total as a 0–100 percent, or null when there is no usage yet. */
  injectionRatePct: number | null;
};

export type CorpusGapRow = {
  id: string;
  professionKey: string;
  label: string;
  /** unmapped | empty-corpus | low-relevance | deferred */
  reason: string;
  missingTopic: string;
  occurrences: number;
  routeContext: string | null;
  suggestedSource: string | null;
  /** Preformatted YYYY-MM-DD (kept server-side so the client panel stays dumb). */
  lastSeen: string;
};

export type ProfessionCorpusSignals = {
  usage: CorpusUsageRollup[];
  gaps: CorpusGapRow[];
  totals: {
    injected: number;
    missed: number;
    openGaps: number;
    injectionRatePct: number | null;
  };
};

/**
 * How the runtime-signal tiles should read (BI-579210DD).
 *
 * The founder-reported defect: a coworker that had never run rendered green and
 * told the operator "every coworker turn has been grounded in its profession
 * corpus". That is vacuously true over an empty set and indistinguishable from
 * a corpus that genuinely works — the silent-empty pattern this platform
 * outlaws (`structural-verification-is-not-functional`, applied to a signal
 * panel). This panel's own subtitle even warns that coverage is not usage.
 *
 * The rollup already knows the difference (injectionRatePct is null with no
 * usage); only the presentation collapsed it. This lives here rather than in
 * the component for the reason stated above: the client panel stays dumb, and a
 * pure decision is testable without a DOM.
 */
export type CorpusSignalPresentation = {
  /** False when nothing ran — the tiles are empty, not healthy. */
  hasUsage: boolean;
  injectionsIntent: "success" | "neutral";
  missesIntent: "warning" | "neutral";
  gapsIntent: "warning" | "success" | "neutral";
  /** Banner shown only when there is no usage at all; null otherwise. */
  noUsageNotice: string | null;
  /** Copy for the empty gap table — never claims grounding that did not happen. */
  emptyGapsCopy: string;
};

export function presentCorpusSignals(
  totals: ProfessionCorpusSignals["totals"],
): CorpusSignalPresentation {
  const hasUsage = totals.injected + totals.missed > 0;
  return {
    hasUsage,
    injectionsIntent: totals.injected > 0 ? "success" : "neutral",
    missesIntent: totals.missed > 0 ? "warning" : "neutral",
    // Zero gaps only means something once turns have happened. With no usage
    // nothing has had the chance to go wrong, so this must not read as success.
    gapsIntent: totals.openGaps > 0 ? "warning" : hasUsage ? "success" : "neutral",
    noUsageNotice: hasUsage
      ? null
      : "No coworker turns recorded in the last 30 days, so there is nothing to judge this corpus by yet. The figures below are empty, not healthy — seeded coverage says the pages exist, not that they have ever been used.",
    emptyGapsCopy: hasUsage
      ? "No corpus gaps recorded yet — every coworker turn has been grounded in its profession corpus."
      : "No corpus gaps recorded — but no coworker turns happened either, so this is an absence of evidence, not evidence of health.",
  };
}

function labelFor(professionKey: string): string {
  return (
    PROFESSION_REGISTRY.families.find((f) => f.professionKey === professionKey)?.label ??
    professionKey
  );
}

function cutoffDay(windowDays: number): string {
  // Day buckets are YYYY-MM-DD strings → lexicographically comparable.
  return new Date(Date.now() - windowDays * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Run a Prisma read and fall back on ANY failure — including a synchronous
 * throw when the model is missing on a partial test mock or a pre-migration
 * client. A server-component render must never crash on the runtime-signal
 * tables (fail-open, same posture as the rest of this surface).
 */
async function safeRead<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

type UsageGroup = {
  professionKey: string;
  _sum: { injectedCount: number | null; missedCount: number | null };
};

type GapRecord = {
  id: string;
  professionKey: string;
  reason: string;
  missingTopic: string;
  occurrences: number;
  routeContext: string | null;
  suggestedSource: string | null;
  lastSeenAt: Date;
};

function toUsageRollup(group: UsageGroup): CorpusUsageRollup {
  const injected = group._sum.injectedCount ?? 0;
  const missed = group._sum.missedCount ?? 0;
  const total = injected + missed;
  return {
    professionKey: group.professionKey,
    label: labelFor(group.professionKey),
    injected,
    missed,
    total,
    injectionRatePct: total > 0 ? Math.round((injected / total) * 100) : null,
  };
}

function toGapRow(gap: GapRecord): CorpusGapRow {
  return {
    id: gap.id,
    professionKey: gap.professionKey,
    label: labelFor(gap.professionKey),
    reason: gap.reason,
    missingTopic: gap.missingTopic,
    occurrences: gap.occurrences,
    routeContext: gap.routeContext,
    suggestedSource: gap.suggestedSource,
    lastSeen: gap.lastSeenAt.toISOString().slice(0, 10),
  };
}

/** Roll up corpus usage + open growth gaps across all professions. */
export async function loadProfessionCorpusSignals(
  windowDays = 30,
): Promise<ProfessionCorpusSignals> {
  const cutoff = cutoffDay(windowDays);

  const [usageRows, gapRows] = await Promise.all([
    safeRead<UsageGroup[]>(async () => {
      const rows = await prisma.professionCorpusUsageStat.groupBy({
        by: ["professionKey"],
        where: { day: { gte: cutoff } },
        _sum: { injectedCount: true, missedCount: true },
      });
      return rows as unknown as UsageGroup[];
    }, []),
    safeRead<GapRecord[]>(async () => {
      const rows = await prisma.professionCorpusGap.findMany({
        where: { status: "open" },
        orderBy: [{ occurrences: "desc" }, { lastSeenAt: "desc" }],
        take: 100,
      });
      return rows as unknown as GapRecord[];
    }, []),
  ]);

  const usage = usageRows.map(toUsageRollup).sort((a, b) => b.total - a.total);
  const gaps = gapRows.map(toGapRow);

  const injected = usage.reduce((sum, u) => sum + u.injected, 0);
  const missed = usage.reduce((sum, u) => sum + u.missed, 0);
  const total = injected + missed;

  return {
    usage,
    gaps,
    totals: {
      injected,
      missed,
      openGaps: gaps.length,
      injectionRatePct: total > 0 ? Math.round((injected / total) * 100) : null,
    },
  };
}

/** Per-family corpus signals for the coworker-record Profession tab. */
export async function loadFamilyCorpusSignals(
  professionKey: string,
  windowDays = 30,
): Promise<{ usage: CorpusUsageRollup; gaps: CorpusGapRow[] }> {
  const cutoff = cutoffDay(windowDays);

  const [usageRows, gapRows] = await Promise.all([
    safeRead<UsageGroup[]>(async () => {
      const rows = await prisma.professionCorpusUsageStat.groupBy({
        by: ["professionKey"],
        where: { professionKey, day: { gte: cutoff } },
        _sum: { injectedCount: true, missedCount: true },
      });
      return rows as unknown as UsageGroup[];
    }, []),
    safeRead<GapRecord[]>(async () => {
      const rows = await prisma.professionCorpusGap.findMany({
        where: { professionKey, status: "open" },
        orderBy: [{ occurrences: "desc" }, { lastSeenAt: "desc" }],
        take: 25,
      });
      return rows as unknown as GapRecord[];
    }, []),
  ]);

  const usage = usageRows[0]
    ? toUsageRollup(usageRows[0])
    : {
        professionKey,
        label: labelFor(professionKey),
        injected: 0,
        missed: 0,
        total: 0,
        injectionRatePct: null,
      };

  return { usage, gaps: gapRows.map(toGapRow) };
}
