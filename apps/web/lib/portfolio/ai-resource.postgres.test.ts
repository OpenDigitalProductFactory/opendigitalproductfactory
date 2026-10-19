import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadAiUseByItem } from "./ai-resource";

// AC-BUDGET-7 reconciliation (BI-0CA5DA2B): per-item AI figures equal the sums
// of the underlying phase runs. The rows are seeded inside a transaction that
// always rolls back, so the test proves something on an empty database too.
const url = process.env.DPF_SQL_TEST_DATABASE_URL
  ?? (process.env.CI === "true" ? process.env.DATABASE_URL : undefined);
const databaseSuite = url ? describe : describe.skip;

databaseSuite("AI use per item on PostgreSQL (BI-0CA5DA2B)", () => {
  let client: Client;
  const period = { start: new Date("2099-01-01T00:00:00Z"), end: new Date("2099-04-01T00:00:00Z") };
  const inPeriod = new Date("2099-02-01T00:00:00Z");
  const db = {
    $queryRaw: async <T,>(parts: TemplateStringsArray, ...values: unknown[]): Promise<T> => {
      const text = parts.reduce((sql, part, index) => sql + (index ? `$${index}` : "") + part, "");
      return (await client.query(text, values)).rows as T;
    },
  };

  beforeAll(async () => {
    client = new Client({ connectionString: url, options: "-c statement_timeout=15000" });
    await client.connect();
    await client.query("BEGIN");
    await client.query(`INSERT INTO "User" ("id","email","passwordHash") VALUES ('u-ai-test','ai-test@example.invalid','x')`);
    await client.query(`INSERT INTO "BacklogItem" ("id","itemId","title","status","type","updatedAt") VALUES ('bi-ai-test','BI-AI-TEST','ai test','in-progress','product',now())`);
    await client.query(`INSERT INTO "ModelProvider" ("id","providerId","name","families","updatedAt") VALUES ('mp-ai-sub','prov-ai-sub','AI test subscription','[]'::jsonb,now())`);
    await client.query(`INSERT INTO "AiProviderFinanceProfile" ("id","providerId","valuationMethod","updatedAt") VALUES ('afp-ai-test','prov-ai-sub','commitment_first',now())`);
    await client.query(`INSERT INTO "FeatureBuild" ("id","buildId","title","createdById","originatingBacklogItemId","updatedAt") VALUES
      ('fb-ai-1','FB-AI-1','linked','u-ai-test','bi-ai-test',now()), ('fb-ai-2','FB-AI-2','unlinked','u-ai-test',NULL,now())`);
    await client.query(`INSERT INTO "BuildPhaseRun" ("id","buildId","phase","startedAt","durationMs","inputTokens","outputTokens","costUsd","providerId") VALUES
      ('bpr-ai-1','FB-AI-1','plan',$1,60000,100,50,NULL,'prov-ai-sub'),
      ('bpr-ai-2','FB-AI-1','build',$1,120000,1000,500,0.25,'prov-ai-paid'),
      ('bpr-ai-3','FB-AI-2','plan',$1,30000,10,5,NULL,NULL),
      ('bpr-ai-4','FB-AI-1','ship','2098-12-31T00:00:00Z',1,999,999,9,NULL)`, [inPeriod]);
  });
  afterAll(async () => {
    await client?.query("ROLLBACK");
    await client?.end();
  });

  it("reconciles per-item tokens, spend, subscription tokens and run time to the phase runs", async () => {
    const byItem = await loadAiUseByItem(db, period);
    expect(byItem.get("BI-AI-TEST")).toEqual({ runs: 2, tokens: 1650, recordedUsd: 0.25, subscriptionTokens: 150, durationMs: 180000 });
    // A build with no originating item is reported under null: not traced.
    expect(byItem.get(null)).toMatchObject({ runs: 1, tokens: 15, recordedUsd: null });
  });
});
