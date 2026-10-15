import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { quarterBounds } from "./investment-points";
import { loadInvestmentItems, summarizePortfolioInvestment } from "./investment-read-model";

// Explicit opt-in to a governed PostgreSQL target. Every statement is read-only.
const url = process.env.DPF_SQL_TEST_DATABASE_URL
  ?? (process.env.CI === "true" ? process.env.DATABASE_URL : undefined);
const databaseSuite = url ? describe : describe.skip;

databaseSuite("portfolio investment read model on PostgreSQL (BI-298A7202, BI-77313ADD)", () => {
  let client: Client;
  const now = new Date();
  const period = quarterBounds(now);
  const db = {
    $queryRaw: async <T,>(parts: TemplateStringsArray, ...values: unknown[]): Promise<T> => {
      const text = parts.reduce((sql, part, index) => sql + (index ? `$${index}` : "") + part, "");
      return (await client.query(text, values)).rows as T;
    },
  };

  beforeAll(async () => {
    client = new Client({ connectionString: url, options: "-c default_transaction_read_only=on -c statement_timeout=15000" });
    await client.connect();
  });
  afterAll(async () => { await client?.end(); });

  it("reconciles every row to the live-item and delivered-this-quarter counts (AC-2)", async () => {
    const summary = summarizePortfolioInvestment(await loadInvestmentItems(db, period, { now }), now);
    // The spend rule (BI-77313ADD): delivered = done or awaiting-acceptance with a
    // delivery date in the quarter; an earlier quarter's delivery is outside it.
    const { rows: [counts] } = await client.query<{ live: string; delivered: string }>(
      `WITH d AS (
         SELECT b.status, CASE
                  WHEN b.status = 'awaiting-acceptance' THEN COALESCE(t.at, b."updatedAt")
                  WHEN b.status = 'done' THEN COALESCE(t.at, b."completedAt")
                END AS delivered_at
           FROM "BacklogItem" b
           LEFT JOIN (SELECT "backlogItemId", MAX("recordedAt") AS at FROM "BacklogItemActivity"
                       WHERE kind = 'status_change' AND payload->>'to' = 'awaiting-acceptance'
                       GROUP BY 1) t ON t."backlogItemId" = b.id)
       SELECT count(*) FILTER (WHERE status NOT IN ('done', 'retired', 'awaiting-acceptance')) AS live,
              count(*) FILTER (WHERE status IN ('done', 'awaiting-acceptance') AND delivered_at >= $1 AND delivered_at < $2) AS delivered
         FROM d`,
      [period.start, period.end],
    );

    expect(summary.totals.liveItems).toBe(Number(counts!.live));
    expect(summary.totals.deliveredThisQuarterItems).toBe(Number(counts!.delivered));
    const counted = summary.rows.reduce((sum, row) => sum + row.items, 0);
    expect(counted).toBe(Number(counts!.live) + Number(counts!.delivered));
    const unsized = summary.rows.reduce((sum, row) => sum + row.unsizedItems, 0);
    expect(unsized).toBe(summary.totals.unsizedItems);
  });

  it("returns every item exactly once", async () => {
    const items = await loadInvestmentItems(db, period);
    expect(new Set(items.map((item) => item.itemId)).size).toBe(items.length);
  });
});
