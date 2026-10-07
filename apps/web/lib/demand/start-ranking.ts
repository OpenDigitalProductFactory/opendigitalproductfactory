// Pure start-ranking — no server imports. Safe in tests and client components.
//
// The single ordering for autonomous starts (BI-78540D2C): the daily governed
// tee-up and the capacity drain both call runGovernedBacklogTeeUp, which ranks
// its eligible candidates here. Demand score is the ordering signal, per the
// demand-management design §7 (docs/superpowers/specs/2026-07-10-demand-management-design.md):
//
//   1. Scored items before unscored items. An unscored item is never silently
//      ranked by age against scored work; its reason says it has no score.
//   2. When investment-bucket targets are set, within the leading tier an item
//      whose bucket is starved (more than the tolerance below its target in the
//      in-flight mix) goes first — SAFe-style capacity allocation applied ahead
//      of the value order. The mix is re-read after every pick.
//   3. Demand score, highest first.
//   4. Tie-breaks only: active epic first (finish what is started), then oldest,
//      then item id for a stable order.
//
// Reuses the bucket arithmetic in ./buckets and the size scale in ./scoring.

import type { InvestmentBucket } from "../explore/backlog";
import { bucketBalance, computeBucketMix, deriveBucket, type BucketWeightedItem } from "./buckets";
import { EFFORT_SIZE_TO_JOB_SIZE } from "./scoring";

const ACTIVE_EPIC_STATUSES = new Set(["open", "in-progress"]);

export type StartRankingCandidate = {
  itemId: string;
  createdAt: Date;
  demandScore?: number | null;
  demandScoreFramework?: string | null;
  investmentBucket?: string | null;
  workType?: string | null;
  effortSize?: string | null;
  epic?: { status: string } | null;
};

export type StartRankingContext = {
  /** Bucket targets (percent). Null or absent: buckets play no part in the order. */
  bucketTargets?: Partial<Record<InvestmentBucket, number>> | null;
  /** Work already in flight, effort-weighted, for the actual bucket mix. */
  inFlight?: BucketWeightedItem[];
};

export type RankedForStart<T extends StartRankingCandidate> = {
  item: T;
  /** 1-based position in this run's picks. */
  rank: number;
  scored: boolean;
  /** Plain-language reason, recorded on the started build. */
  reason: string;
};

function scoreOf(item: StartRankingCandidate): number | null {
  return typeof item.demandScore === "number" && Number.isFinite(item.demandScore) ? item.demandScore : null;
}

function bucketOf(item: StartRankingCandidate): InvestmentBucket | null {
  const explicit = item.investmentBucket;
  if (explicit === "run" || explicit === "grow" || explicit === "transform") return explicit;
  return deriveBucket(item.workType);
}

function weightOf(item: StartRankingCandidate): number {
  return EFFORT_SIZE_TO_JOB_SIZE[item.effortSize ?? ""] ?? 1;
}

function onActiveEpic(item: StartRankingCandidate): boolean {
  return ACTIVE_EPIC_STATUSES.has(item.epic?.status ?? "");
}

/** Score first (scored before unscored, highest first); age is only a tie-break. */
function compareForStart(left: StartRankingCandidate, right: StartRankingCandidate): number {
  const ls = scoreOf(left);
  const rs = scoreOf(right);
  if ((ls === null) !== (rs === null)) return ls === null ? 1 : -1;
  if (ls !== null && rs !== null && ls !== rs) return rs - ls;
  const epicDiff = Number(onActiveEpic(right)) - Number(onActiveEpic(left));
  if (epicDiff !== 0) return epicDiff;
  const ageDiff = left.createdAt.getTime() - right.createdAt.getTime();
  if (ageDiff !== 0) return ageDiff;
  return left.itemId.localeCompare(right.itemId);
}

function starvedBuckets(
  targets: Partial<Record<InvestmentBucket, number>>,
  mixItems: BucketWeightedItem[],
): Map<InvestmentBucket, { actualPct: number; targetPct: number }> {
  const starved = new Map<InvestmentBucket, { actualPct: number; targetPct: number }>();
  for (const row of bucketBalance(computeBucketMix(mixItems), targets)) {
    if (row.starved) starved.set(row.bucket, { actualPct: row.actualPct, targetPct: row.targetPct });
  }
  return starved;
}

/**
 * Rank eligible candidates for an autonomous start and return the top `limit`,
 * each with the reason it was chosen. The caller has already applied the
 * Definition-of-Ready filter; this decides only the order.
 */
export function rankForStart<T extends StartRankingCandidate>(
  items: readonly T[],
  limit: number,
  context: StartRankingContext = {},
): RankedForStart<T>[] {
  if (limit <= 0) return [];
  const remaining = [...items].sort(compareForStart);
  const total = remaining.length;
  const scoredTotal = remaining.filter((i) => scoreOf(i) !== null).length;
  const targets = context.bucketTargets ?? null;
  const mix: BucketWeightedItem[] = [...(context.inFlight ?? [])];
  const picks: RankedForStart<T>[] = [];

  while (picks.length < limit && remaining.length > 0) {
    const leadScored = scoreOf(remaining[0]!) !== null;
    let index = 0;
    let starvedNote: string | null = null;
    if (targets) {
      const starved = starvedBuckets(targets, mix);
      const found = remaining.findIndex((candidate) => {
        if ((scoreOf(candidate) !== null) !== leadScored) return false;
        const bucket = bucketOf(candidate);
        return bucket !== null && starved.has(bucket);
      });
      if (found > 0) {
        index = found;
        const bucket = bucketOf(remaining[found]!)!;
        const row = starved.get(bucket)!;
        starvedNote = `Chosen ahead of higher-ranked work because the ${bucket} bucket is below its target (${row.actualPct}% of work in flight against ${row.targetPct}%).`;
      }
    }
    const [item] = remaining.splice(index, 1) as [T];
    mix.push({ investmentBucket: bucketOf(item), workType: item.workType ?? null, weight: weightOf(item) });
    const rank = picks.length + 1;
    picks.push({ item, rank, scored: scoreOf(item) !== null, reason: reasonFor(item, rank, total, scoredTotal, starvedNote) });
  }
  return picks;
}

function reasonFor(
  item: StartRankingCandidate,
  rank: number,
  total: number,
  scoredTotal: number,
  starvedNote: string | null,
): string {
  const position = `Ranked ${rank} of ${total} eligible`;
  const tieBreak = "Ties break on active epic, then oldest first.";
  const score = scoreOf(item);
  const parts: string[] = [];
  if (score !== null) {
    const framework = item.demandScoreFramework ? ` (${item.demandScoreFramework})` : "";
    parts.push(`${position} by demand score ${score}${framework}.`);
  } else if (scoredTotal === 0) {
    parts.push(`${position}: no eligible item has a demand score, so the order falls back to active epic, then oldest first.`);
  } else {
    parts.push(`${position}: it has no demand score, so it ranks after ${scoredTotal} scored item${scoredTotal === 1 ? "" : "s"} and falls back to active epic, then oldest first.`);
  }
  if (starvedNote) parts.push(starvedNote);
  if (score !== null) parts.push(tieBreak);
  return parts.join(" ");
}
