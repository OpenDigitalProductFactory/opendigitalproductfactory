// Reads what the shared start ranking needs beyond the candidates themselves
// (BI-78540D2C). Bucket targets count only when an operator set them
// (PlatformDevConfig.demandBucketTargets); only then is the in-flight mix read,
// so a starved investment bucket can go first. No targets: score order alone.

import { resolveDemandPolicy } from "./policy";
import { EFFORT_SIZE_TO_JOB_SIZE } from "./scoring";
import type { StartRankingContext } from "./start-ranking";

type InFlightRow = { investmentBucket: string | null; workType: string | null; effortSize: string | null };

export async function loadStartRankingContext(
  db: { backlogItem: { findMany(args: unknown): Promise<unknown> } },
  config: { demandBucketTargets?: unknown } | null,
  itemIds: readonly string[] = [],
): Promise<StartRankingContext> {
  const investmentByItem = itemIds.length
    ? await (await import("../portfolio/investment-balance-server")).loadInvestmentStartPreferences(db as never, itemIds)
    : undefined;
  if (config?.demandBucketTargets == null) return { investmentByItem };
  const inFlight = (await db.backlogItem.findMany({
    where: { activeBuildId: { not: null }, status: { in: ["open", "in-progress"] } },
    select: { investmentBucket: true, workType: true, effortSize: true },
  })) as InFlightRow[];
  return {
    investmentByItem,
    bucketTargets: resolveDemandPolicy({ demandBucketTargets: config.demandBucketTargets }).bucketTargets,
    inFlight: inFlight.map((row) => ({
      investmentBucket: row.investmentBucket,
      workType: row.workType,
      weight: EFFORT_SIZE_TO_JOB_SIZE[row.effortSize ?? ""] ?? 1,
    })),
  };
}
