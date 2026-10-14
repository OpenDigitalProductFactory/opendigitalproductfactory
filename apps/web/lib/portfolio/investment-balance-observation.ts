import type { BalanceObservation } from "./investment-balance";
import type { FundingScope } from "./investment-balance-policy";

type ObservationDb = { $queryRaw<T>(parts: TemplateStringsArray, ...values: unknown[]): Promise<T> };
type Aggregate = { knownAttempts: bigint; unknownAttempts: bigint; refactorTokens: bigint; newTokens: bigint; unclassifiedTokens: bigint; latestAt: Date | null };
const count = (value: bigint | number): number => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new RangeError("Investment observation exceeds safe numeric bounds");
  return parsed;
};

/** One attempt ledger only. Match thread-cost-ledger: uncached input + cache creation/read + output. Reasoning is already in output. */
export async function loadInvestmentObservation(db: ObservationDb, input: {
  scope: FundingScope; installationRef: string; windowDays: number; now?: Date;
}): Promise<BalanceObservation> {
  if (!Number.isInteger(input.windowDays) || input.windowDays < 1 || input.windowDays > 180) throw new RangeError("Observation window must be 1–180 days");
  const end = input.now ?? new Date();
  if (!Number.isFinite(end.getTime())) throw new RangeError("Observation time must be valid");
  const start = new Date(end.getTime() - input.windowDays * 86_400_000);
  const purpose = input.scope.purpose === "shared-platform" ? "sharedPlatform" : "archetype";
  const rows = await db.$queryRaw<Aggregate[]>`
    WITH scoped AS (
      SELECT *, COALESCE("inputTokens" >= 0 AND "outputTokens" >= 0
        AND COALESCE("cacheCreationInputTokens", 0) >= 0 AND COALESCE("cachedInputTokens", 0) >= 0, false) AS known
      FROM "AdapterRunTelemetry"
      WHERE "investmentPrincipalId" = ${input.scope.principalId}
        AND "investmentOrganizationId" = ${input.scope.organizationId}
        AND "investmentPurpose" = ${purpose}::"InvestmentWorkPurpose"
        AND "investmentInstallationRef" = ${input.installationRef}
        AND "investmentCapturedAt" IS NOT NULL
        AND "startedAt" >= ${start} AND "startedAt" < ${end}
    )
    SELECT
      COUNT(*) FILTER (WHERE known) AS "knownAttempts",
      COUNT(*) FILTER (WHERE NOT known) AS "unknownAttempts",
      COALESCE(SUM("inputTokens"::bigint + "outputTokens"::bigint + COALESCE("cacheCreationInputTokens", 0)::bigint + COALESCE("cachedInputTokens", 0)::bigint) FILTER (WHERE known AND "investmentClass" = 'refactor'), 0)::bigint AS "refactorTokens",
      COALESCE(SUM("inputTokens"::bigint + "outputTokens"::bigint + COALESCE("cacheCreationInputTokens", 0)::bigint + COALESCE("cachedInputTokens", 0)::bigint) FILTER (WHERE known AND "investmentClass" = 'new'), 0)::bigint AS "newTokens",
      COALESCE(SUM("inputTokens"::bigint + "outputTokens"::bigint + COALESCE("cacheCreationInputTokens", 0)::bigint + COALESCE("cachedInputTokens", 0)::bigint) FILTER (WHERE known AND "investmentClass" IS NULL), 0)::bigint AS "unclassifiedTokens",
      MAX("startedAt") FILTER (WHERE known) AS "latestAt"
    FROM scoped`;
  const row = rows[0];
  return {
    knownAttempts: count(row?.knownAttempts ?? 0), unknownAttempts: count(row?.unknownAttempts ?? 0),
    refactorTokens: count(row?.refactorTokens ?? 0), newTokens: count(row?.newTokens ?? 0), unclassifiedTokens: count(row?.unclassifiedTokens ?? 0),
    latestAt: row?.latestAt?.toISOString() ?? null,
  };
}

/** Installation-wide unknown attribution is a separate gap, never an owner's denominator. */
export async function loadUnassignedInvestmentAttempts(db: ObservationDb, windowDays = 42, now = new Date()): Promise<number> {
  if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 180) throw new RangeError("Observation window must be 1–180 days");
  if (!Number.isFinite(now.getTime())) throw new RangeError("Observation time must be valid");
  const start = new Date(now.getTime() - windowDays * 86_400_000);
  const rows = await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS "count" FROM "AdapterRunTelemetry"
    WHERE "startedAt" >= ${start} AND "startedAt" < ${now}
      AND ("investmentPrincipalId" IS NULL OR "investmentOrganizationId" IS NULL OR "investmentCapturedAt" IS NULL OR "investmentInstallationRef" IS NULL)`;
  return count(rows[0]?.count ?? 0);
}
