import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadInvestmentObservation, loadUnassignedInvestmentAttempts } from "./investment-balance-observation";
import { resolveRoomFunding } from "./investment-balance-binding";

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
    await client.query('INSERT INTO "Organization" (id,"orgId",name,slug,"updatedAt") VALUES ($1,$1,\'Other test\',$1,now())', [`${scope.organizationId}:other`]);
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
    for (const organizationId of [scope.organizationId, `${scope.organizationId}:other`]) {
      await client.query(`INSERT INTO "AdapterRunTelemetry" (id,"adapterKind","adapterVersion","providerId","modelId","executionMode","startedAt",status,"capabilitiesUsed","investmentOrganizationId")
        VALUES ($1,'test','1','test','test','single','2099-02-01','success','{}',$2)`, [randomUUID(), organizationId]);
    }
    expect(await loadUnassignedInvestmentAttempts(db, 42, now)).toBe(2);
    expect(await loadUnassignedInvestmentAttempts(db, 42, now, scope.organizationId)).toBe(1);
    expect(await loadInvestmentObservation(db, input)).toEqual({ knownAttempts: 4, unknownAttempts: 2,
      refactorTokens: 500, newTokens: 150, unclassifiedTokens: 100, latestAt: "2099-02-01T00:00:00.000Z" });
    expect(await loadInvestmentObservation(db, { ...input, scope: { ...scope, principalId: "other-owner" } })).toMatchObject({ knownAttempts: 0 });
    expect(await loadInvestmentObservation(db, { ...input, scope: { ...scope, organizationId: "other-org" } })).toMatchObject({ knownAttempts: 0 });
  });
  it("resolves funding across 10,000 Workrooms and measures one million attempts within the response budget", async () => {
    await client.query("SET LOCAL statement_timeout = '180s'");
    await client.query(`INSERT INTO "WorkCapsule" (id,"capsuleId",title,objective,source,status,"updatedAt")
      SELECT $1 || ':room:' || n, $1 || ':room:' || n, 'Scale fixture', 'Funding resolution', 'manual', 'ready', now()
      FROM generate_series(1,10000) n`, [scope.principalId]);
    await client.query(`INSERT INTO "WorkCapsuleRelation" (id,"fromWorkroomId","toWorkroomId",relation)
      SELECT $1 || ':link:' || n, $1 || ':room:10000', $1 || ':room:' || n, 'contains'
      FROM generate_series(1,9999) n`, [scope.principalId]);
    const funding = { investmentBalanceV1: { bindings: { "*": { version: 1, scope, installationRef: input.installationRef, boundAt: now.toISOString(), actorPrincipalId: scope.principalId, reason: "Scale fixture funding" } } } };
    await client.query('UPDATE "WorkCapsule" SET "promotionPolicy"=$2::jsonb WHERE id=$1', [`${scope.principalId}:room:10000`, JSON.stringify(funding)]);
    await client.query('ANALYZE "WorkCapsule"');
    await client.query('ANALYZE "WorkCapsuleRelation"');
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
    const roomId = `${scope.principalId}:room:42`;
    const roomPlan = await client.query('EXPLAIN (ANALYZE, FORMAT JSON) SELECT id,"promotionPolicy" FROM "WorkCapsule" WHERE id=$1', [roomId]);
    expect(JSON.stringify(roomPlan.rows)).toContain("WorkCapsule_pkey");
    const started = performance.now();
    const reads: string[] = [];
    const resolved = await resolveRoomFunding(roomId, "BI-scale-fixture", async (id) => {
      reads.push(id);
      const row = (await client.query('SELECT id,"promotionPolicy" FROM "WorkCapsule" WHERE id=$1', [id])).rows[0];
      if (!row) return null;
      const parents = await client.query('SELECT "fromWorkroomId" FROM "WorkCapsuleRelation" WHERE "toWorkroomId"=$1 AND relation=\'contains\' LIMIT 65', [id]);
      return { ...row, parentIds: parents.rows.map((parent) => parent.fromWorkroomId) };
    }, input.installationRef);
    expect(resolved).toMatchObject({ ok: true, data: { scope, sourceRoomId: `${scope.principalId}:room:10000` } });
    expect(reads).toHaveLength(2);
    const observed = await loadInvestmentObservation(db, { ...input, scope: { ...scope, purpose: "archetype" } });
    expect(observed.knownAttempts).toBe(1000001);
    expect(observed.newTokens).toBe(200002048);
    const elapsedMs = performance.now() - started;
    expect(elapsedMs).toBeLessThan(5000);
    console.info("Investment scale fixture", { workrooms: 10000, attempts: 1000000, responseBudgetMs: 5000, elapsedMs, plan: plan.rows, roomPlan: roomPlan.rows });
  }, 240000);
});
