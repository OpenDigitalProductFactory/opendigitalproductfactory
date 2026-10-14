import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadInvestmentObservation } from "./investment-balance-observation";

const now = new Date("2099-02-12T00:00:00Z");
const scope = { principalId: `investment-${randomUUID()}`, organizationId: `investment-${randomUUID()}`, purpose: "shared-platform" as const };
const input = { scope, installationRef: "investment-test-install", windowDays: 42, now };

describe("investment observation bounds", () => {
  it("rejects invalid time before issuing a query", async () => {
    const db = { $queryRaw: vi.fn() };
    await expect(loadInvestmentObservation(db as never, { ...input, now: new Date(NaN) })).rejects.toThrow(RangeError);
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
  it("does not silently round database totals", async () => {
    const db = { $queryRaw: vi.fn(async () => [{ refactorTokens: BigInt(Number.MAX_SAFE_INTEGER) + 1n }]) };
    await expect(loadInvestmentObservation(db as never, input)).rejects.toThrow(RangeError);
  });
});

// Only the governed SQL fixture database; never fall back to a local install DB.
const url = process.env.DPF_SQL_TEST_DATABASE_URL ?? ((process.env.CI === "true" || Boolean(process.env.DPF_LOCAL_CI_METADATA_FILE)) ? process.env.DATABASE_URL : undefined);
(url ? describe : describe.skip)("investment attempt ledger on PostgreSQL", () => {
  let client: Client;
  const db = { $queryRaw: async <T,>(parts: TemplateStringsArray, ...values: unknown[]): Promise<T> =>
    (await client.query(parts.reduce((sql, part, i) => sql + (i ? `$${i}` : "") + part, ""), values)).rows as T };
  beforeAll(async () => {
    client = new Client({ connectionString: url, options: "-c statement_timeout=15000" });
    await client.connect();
    await client.query("BEGIN");
    await client.query('INSERT INTO "Principal" (id,"principalId",kind,"displayName","updatedAt") VALUES ($1,$1,\'human\',\'Investment test\',now())', [scope.principalId]);
    await client.query('INSERT INTO "Organization" (id,"orgId",name,slug,"updatedAt") VALUES ($1,$1,\'Investment test\',$1,now())', [scope.organizationId]);
  });
  afterAll(async () => { await client?.query("ROLLBACK"); await client?.end(); });

  it("counts retries, caches and unknown usage while excluding other scopes and window edges", async () => {
    const add = async (kind: string | null, tokens: number | null, options: { status?: string; install?: string; purpose?: string; at?: Date; cache?: number } = {}) => {
      await client.query(`INSERT INTO "AdapterRunTelemetry"
        (id,"traceId","adapterKind","adapterVersion","providerId","modelId","executionMode","startedAt",status,"capabilitiesUsed",
        "inputTokens","outputTokens","cachedInputTokens","cacheCreationInputTokens","reasoningTokens",
        "investmentPrincipalId","investmentOrganizationId","investmentPurpose","investmentClass","investmentInstallationRef","investmentCapturedAt")
        VALUES ($1,'same-retried-trace','test','1','test','test','single',$2,$3,'{}',$4,$4,$5,20,50,$6,$7,$8::"InvestmentWorkPurpose",$9::"InvestmentWorkClass",$10,$2)`,
      [randomUUID(), options.at ?? new Date("2099-02-01"), options.status ?? "success", tokens, options.cache ?? 30,
        scope.principalId, scope.organizationId, options.purpose ?? "sharedPlatform", kind, options.install ?? input.installationRef]);
    };
    await add("refactor", 100);
    await add("refactor", 100, { status: "error" }); // A consumed retry is a separate attempt.
    await add("new", 50);
    await add(null, 25);
    await add("new", null);
    await add("new", 100, { cache: -1 }); // Invalid usage stays unknown, never subtracts tokens.
    await add("new", 999, { install: "other-install" });
    await add("new", 999, { purpose: "archetype" });
    await add("new", 999, { at: now }); // Exclusive upper boundary.
    await add("new", 999, { at: new Date("2098-12-31") });
    expect(await loadInvestmentObservation(db, input)).toEqual({ knownAttempts: 4, unknownAttempts: 2,
      refactorTokens: 500, newTokens: 150, unclassifiedTokens: 100, latestAt: "2099-02-01T00:00:00.000Z" });
    expect(await loadInvestmentObservation(db, { ...input, scope: { ...scope, principalId: "other-owner" } })).toMatchObject({ knownAttempts: 0 });
    expect(await loadInvestmentObservation(db, { ...input, scope: { ...scope, organizationId: "other-org" } })).toMatchObject({ knownAttempts: 0 });
  });
  it("uses the scoped index with one million measured attempts on the install", async () => {
    await client.query("SET LOCAL statement_timeout = '180s'");
    await client.query(`INSERT INTO "AdapterRunTelemetry"
      (id,"adapterKind","adapterVersion","providerId","modelId","executionMode","startedAt",status,"capabilitiesUsed",
       "inputTokens","outputTokens","investmentPrincipalId","investmentOrganizationId","investmentPurpose","investmentClass","investmentInstallationRef","investmentCapturedAt")
      SELECT $1 || ':' || n, 'test','1','test','test','single','2099-02-01','success','{}',100,100,$1,$2,'archetype','new',$3,'2099-02-01'
      FROM generate_series(1,1000000) n`, [scope.principalId, scope.organizationId, input.installationRef]);
    await client.query('ANALYZE "AdapterRunTelemetry"');
    const plan = await client.query(`EXPLAIN (ANALYZE, FORMAT JSON) SELECT SUM("inputTokens"::bigint + "outputTokens"::bigint)
      FROM "AdapterRunTelemetry" WHERE "investmentPrincipalId"=$1 AND "investmentOrganizationId"=$2
      AND "investmentPurpose"='sharedPlatform' AND "investmentInstallationRef"=$3
      AND "startedAt">='2099-01-01' AND "startedAt"<'2099-02-12'`, [scope.principalId, scope.organizationId, input.installationRef]);
    expect(JSON.stringify(plan.rows)).toContain("AdapterRunTelemetry_investment_scope_startedAt_idx");
    const started = performance.now();
    const observed = await loadInvestmentObservation(db, { ...input, scope: { ...scope, purpose: "archetype" } });
    expect(observed.knownAttempts).toBe(1000001);
    expect(observed.newTokens).toBe(200002048);
    console.info("Investment million-attempt observation", { elapsedMs: performance.now() - started, plan: plan.rows });
  }, 240000);
});
