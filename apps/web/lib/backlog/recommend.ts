export type RecommendCandidate = {
  itemId: string;
  title: string;
  status: string;
  priority: number | null;
  effortSize: string | null;
  triageOutcome: string | null;
  hasActiveBuild: boolean;
  claimedById: string | null;
  claimedByAgentId: string | null;
  epicId: string | null;
  epicStatus: string | null;
  hasSpec: boolean;
  hasPlan: boolean;
  updatedAt: Date;
};

export type RankedCandidate = {
  itemId: string;
  title: string;
  rationale: string;
  rank: number;
  score: number;
  signals: {
    hasSpec: boolean;
    hasPlan: boolean;
    hasActiveBuild: boolean;
    claimedByOther: boolean;
    effortSize: string | null;
    priority: number | null;
    epicStatus: string | null;
  };
};

export type RankOptions = {
  excludeItemIds?: readonly string[];
  forAgentId?: string | null;
  count?: number;
};

const DEFAULT_COUNT = 3;
const MAX_COUNT = 10;

function isPickable(item: RecommendCandidate, forAgentId: string | null | undefined): boolean {
  if (item.status !== "open" && item.status !== "triaging") return false;
  if (item.claimedById != null) return false;
  if (item.claimedByAgentId != null) {
    return forAgentId != null && item.claimedByAgentId === forAgentId;
  }
  return true;
}

function scoreCandidate(item: RecommendCandidate): { score: number; firedSignals: string[] } {
  let score = 0;
  const fired: string[] = [];

  if (item.hasSpec) {
    score += 5;
    fired.push("has-spec");
  }
  if (item.hasPlan) {
    score += 3;
    fired.push("has-plan");
  }
  if (item.priority != null) {
    // Flat bonus for being prioritised at all. Lower-priority-number-is-higher
    // ordering is handled by the explicit tie-break in the sort.
    score += 2;
    fired.push(`priority=${item.priority}`);
  }
  if (item.effortSize === "small" || item.effortSize === "medium") {
    score += 1;
    fired.push(`size=${item.effortSize}`);
  }
  if (item.triageOutcome === "build") {
    score += 1;
    fired.push("triaged-for-build");
  }
  if (item.hasActiveBuild) {
    score -= 2;
    fired.push("active-build (someone is on it)");
  }

  return { score, firedSignals: fired };
}

function buildRationale(firedSignals: string[]): string {
  if (firedSignals.length === 0) return "no strong signals; ranked by recency";
  return firedSignals.join(", ");
}

export function rankCandidates(
  items: readonly RecommendCandidate[],
  opts: RankOptions = {},
): RankedCandidate[] {
  const exclude = new Set(opts.excludeItemIds ?? []);
  const count = Math.max(1, Math.min(opts.count ?? DEFAULT_COUNT, MAX_COUNT));
  const forAgentId = opts.forAgentId ?? null;

  const eligible = items.filter(
    (item) => !exclude.has(item.itemId) && isPickable(item, forAgentId),
  );

  const scored = eligible.map((item) => {
    const { score, firedSignals } = scoreCandidate(item);
    return {
      item,
      score,
      firedSignals,
    };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ap = a.item.priority ?? Number.POSITIVE_INFINITY;
    const bp = b.item.priority ?? Number.POSITIVE_INFINITY;
    if (ap !== bp) return ap - bp;
    return b.item.updatedAt.getTime() - a.item.updatedAt.getTime();
  });

  return scored.slice(0, count).map((entry, idx) => ({
    itemId: entry.item.itemId,
    title: entry.item.title,
    rationale: buildRationale(entry.firedSignals),
    rank: idx + 1,
    score: Math.round(entry.score * 100) / 100,
    signals: {
      hasSpec: entry.item.hasSpec,
      hasPlan: entry.item.hasPlan,
      hasActiveBuild: entry.item.hasActiveBuild,
      claimedByOther:
        entry.item.claimedById != null ||
        (entry.item.claimedByAgentId != null && entry.item.claimedByAgentId !== forAgentId),
      effortSize: entry.item.effortSize,
      priority: entry.item.priority,
      epicStatus: entry.item.epicStatus,
    },
  }));
}
