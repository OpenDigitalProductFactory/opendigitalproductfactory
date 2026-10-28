// The harness evolution loop's ranking step (BI-49BC21C1 slice 1; spec
// docs/superpowers/specs/2026-10-28-harness-evolution-loop-design.md).
//
// Pure: the same signals, seed queue and clock always give the same ranked
// list. It applies the Harness² editor rule "every edit traces to a named
// trajectory moment" before any spend, so a candidate with no recorded
// evidence never reaches a probe.

const MS_PER_DAY = 86_400_000;
/** Recency half-life-ish constant: a signal unseen for 14 days weighs 1/e. */
const RECENCY_DAYS = 14;
/** Tool executions kept per candidate; enough to replay, small enough to store. */
const MAX_TRAJECTORY_REFS = 5;
const TERMINAL_STATUSES = new Set(["done", "retired"]);

export type HarnessEvolutionBudget = {
  maxCandidates: number;
  maxProbeReplays: number;
  tokenCap: number;
  lookbackDays: number;
};

const BUDGET_BOUNDS: Record<keyof HarnessEvolutionBudget, { min: number; max: number; fallback: number }> = {
  maxCandidates: { min: 1, max: 25, fallback: 10 },
  maxProbeReplays: { min: 0, max: 200, fallback: 20 },
  tokenCap: { min: 0, max: 2_000_000, fallback: 200_000 },
  lookbackDays: { min: 1, max: 90, fallback: 30 },
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/** The run's caps from taskConfig, clamped so an operator cannot unbound a run. */
export function resolveHarnessEvolutionBudget(taskConfig: unknown): HarnessEvolutionBudget {
  const config = asRecord(taskConfig);
  const budget = {} as HarnessEvolutionBudget;
  for (const key of Object.keys(BUDGET_BOUNDS) as Array<keyof HarnessEvolutionBudget>) {
    const { min, max, fallback } = BUDGET_BOUNDS[key];
    const raw = config[key];
    const value = typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : fallback;
    budget[key] = Math.min(max, Math.max(min, value));
  }
  return budget;
}

/** The configured seed queue, in order, without blanks or repeats. */
export function resolveSeedItemIds(taskConfig: unknown): string[] {
  const raw = asRecord(taskConfig).seedItemIds;
  if (!Array.isArray(raw)) return [];
  const ids: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string") continue;
    const id = value.trim();
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export type SignalRow = {
  signalId: string;
  sourceType: string;
  title: string;
  recurrenceCount: number;
  lastSeenAt: Date;
  toolName: string | null;
  backlogItemId: string | null;
  evidence: unknown;
};

export type SeedItemRow = { itemId: string; title: string; status: string };

export type TrajectoryRef =
  | { kind: "tool-execution"; toolExecutionId: string }
  | { kind: "pattern-key"; patternKey: string }
  | { kind: "backlog-item"; itemId: string };

/** Harness² component priority: gate/hook/script > skill > sub-agent > prose. */
export type ComponentHint = "gate-hook-script" | "skill" | "unclassified";

export type HarnessCandidate = {
  candidateKey: string;
  rank: number;
  origin: "seed-queue" | "signal";
  title: string;
  /** Signal score; null for seed items, which rank by configured order. */
  score: number | null;
  signalId: string | null;
  sourceType: string | null;
  toolName: string | null;
  backlogItemId: string | null;
  recurrenceCount: number | null;
  lastSeenAt: string | null;
  componentHint: ComponentHint;
  trajectory: TrajectoryRef[];
};

export type CandidateRejection = {
  candidateKey: string;
  reason: "no-trajectory" | "seed-missing" | "seed-terminal";
  detail?: string;
};

export type RankHarnessCandidatesInput = {
  now: Date;
  maxCandidates: number;
  seedItemIds: readonly string[];
  seedItems: readonly SeedItemRow[];
  signals: readonly SignalRow[];
};

export type RankHarnessCandidatesResult = {
  ranked: HarnessCandidate[];
  rejected: CandidateRejection[];
  /** Eligible candidates past maxCandidates, left for a later run. */
  deferred: number;
};

function componentHintFor(sourceType: string): ComponentHint {
  if (sourceType === "mcp-call-efficiency" || sourceType === "work_pattern_observer") return "gate-hook-script";
  if (sourceType === "curator-finding") return "skill";
  return "unclassified";
}

function signalTrajectory(evidence: unknown): TrajectoryRef[] {
  const record = asRecord(evidence);
  const sampleIds = Array.isArray(record.sampleIds)
    ? record.sampleIds.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  if (sampleIds.length) {
    return sampleIds
      .slice(0, MAX_TRAJECTORY_REFS)
      .map((toolExecutionId) => ({ kind: "tool-execution" as const, toolExecutionId }));
  }
  if (typeof record.patternKey === "string" && record.patternKey) {
    return [{ kind: "pattern-key", patternKey: record.patternKey }];
  }
  return [];
}

function signalScore(row: SignalRow, now: Date): number {
  const severity = asRecord(row.evidence).severity === "critical" ? 2 : 1;
  const ageDays = Math.max(0, (now.getTime() - row.lastSeenAt.getTime()) / MS_PER_DAY);
  return row.recurrenceCount * severity * Math.exp(-ageDays / RECENCY_DAYS);
}

export function rankHarnessCandidates(input: RankHarnessCandidatesInput): RankHarnessCandidatesResult {
  const rejected: CandidateRejection[] = [];
  const eligible: Array<Omit<HarnessCandidate, "rank">> = [];

  const seedById = new Map(input.seedItems.map((item) => [item.itemId, item]));
  for (const itemId of input.seedItemIds) {
    const candidateKey = `seed:${itemId}`;
    const item = seedById.get(itemId);
    if (!item) {
      rejected.push({ candidateKey, reason: "seed-missing" });
      continue;
    }
    if (TERMINAL_STATUSES.has(item.status)) {
      rejected.push({ candidateKey, reason: "seed-terminal", detail: item.status });
      continue;
    }
    eligible.push({
      candidateKey,
      origin: "seed-queue",
      title: item.title,
      score: null,
      signalId: null,
      sourceType: null,
      toolName: null,
      backlogItemId: item.itemId,
      recurrenceCount: null,
      lastSeenAt: null,
      componentHint: "unclassified",
      trajectory: [{ kind: "backlog-item", itemId: item.itemId }],
    });
  }

  const scored = input.signals
    .map((row) => ({ row, score: signalScore(row, input.now) }))
    .sort(
      (a, b) =>
        b.score - a.score
        || b.row.lastSeenAt.getTime() - a.row.lastSeenAt.getTime()
        || a.row.signalId.localeCompare(b.row.signalId),
    );
  for (const { row, score } of scored) {
    const candidateKey = `signal:${row.signalId}`;
    const trajectory = signalTrajectory(row.evidence);
    if (!trajectory.length) {
      rejected.push({ candidateKey, reason: "no-trajectory" });
      continue;
    }
    eligible.push({
      candidateKey,
      origin: "signal",
      title: row.title,
      score,
      signalId: row.signalId,
      sourceType: row.sourceType,
      toolName: row.toolName,
      backlogItemId: row.backlogItemId,
      recurrenceCount: row.recurrenceCount,
      lastSeenAt: row.lastSeenAt.toISOString(),
      componentHint: componentHintFor(row.sourceType),
      trajectory,
    });
  }

  const ranked = eligible.slice(0, input.maxCandidates).map((candidate, index) => ({ ...candidate, rank: index + 1 }));
  return { ranked, rejected, deferred: Math.max(0, eligible.length - ranked.length) };
}
