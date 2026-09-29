import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { quarterBounds } from "./investment-points";
import { loadInvestmentItems, summarizePortfolioInvestment } from "./investment-read-model";
import { loadPortfolioBudgets, previousQuarter, proposePortfolioBudgets } from "./portfolio-budget";

const MIGRATION = resolve(__dirname, "../../../../packages/db/prisma/migrations/20260925190000_portfolio_budget_period/migration.sql");

// Explicit opt-in to a governed PostgreSQL target. The proposal test is
// read-only; the chain test writes inside a transaction that always rolls back,
// and applies this branch's migration inside it when the target lacks it.
const url = process.env.DPF_SQL_TEST_DATABASE_URL
  ?? (process.env.CI === "true" ? process.env.DATABASE_URL : undefined);
const databaseSuite = url ? describe : describe.skip;

databaseSuite("portfolio budgets on PostgreSQL (BI-9EC60FE0)", () => {
  let client: Client;
  const db = {
    $queryRaw: async <T,>(parts: TemplateStringsArray, ...values: unknown[]): Promise<T> => {
      const text = parts.reduce((sql, part, index) => sql + (index ? `$${index}` : "") + part, "");
      return (await client.query(text, values)).rows as T;
    },
  };

  beforeAll(async () => {
    client = new Client({ connectionString: url, options: "-c statement_timeout=15000" });
    await client.connect();
  });
  afterAll(async () => { await client?.end(); });

  it("proposes this quarter from last quarter's delivered mix in the read model (AC-2)", async () => {
    const target = quarterBounds(new Date());
    const basis = previousQuarter(target);
    const proposal = await proposePortfolioBudgets(db, target);
    const summary = summarizePortfolioInvestment(await loadInvestmentItems(db, basis), basis.start);
    for (const row of proposal.rows) {
      const delivered = summary.rows.find((r) => r.portfolioId === row.id)?.deliveredPoints ?? 0;
      expect(row.proposedPoints, row.slug).toBe(delivered);
    }
    expect(proposal.unallocatedDeliveredPoints).toBe(summary.rows.find((r) => r.portfolioId === null)?.deliveredPoints ?? 0);
  });

  it("allows one chain per portfolio and period, and one successor per row (AC-1)", async () => {
    await client.query("BEGIN");
    try {
      const { rows: [present] } = await client.query(`SELECT to_regclass('"PortfolioBudgetPeriod"') IS NOT NULL AS ok`);
      if (!present.ok) await client.query(readFileSync(MIGRATION, "utf8"));
      const { rows: [portfolio] } = await client.query<{ id: string }>(
        `INSERT INTO "Portfolio" ("id","slug","name","updatedAt") VALUES ('p-budget-test','budget-test','Budget test',now()) RETURNING "id"`);
      const { rows: [user] } = await client.query<{ id: string }>(
        `INSERT INTO "User" ("id","email","passwordHash") VALUES ('u-budget-test','budget-test@example.invalid','x') RETURNING "id"`);
      const q = quarterBounds(new Date("2099-02-01T00:00:00Z"));
      const insert = (id: string, supersedesId: string | null) => client.query(
        `INSERT INTO "PortfolioBudgetPeriod" ("id","portfolioId","periodStart","periodEnd","allocatedPoints","setById","reason","supersedesId")
         VALUES ($1,$2,$3,$4,10,$5,'test',$6)`, [id, portfolio!.id, q.start, q.end, user!.id, supersedesId]);
      const expectRefused = async (run: () => Promise<unknown>) => {
        await client.query("SAVEPOINT s");
        await expect(run()).rejects.toMatchObject({ code: "23505" });
        await client.query("ROLLBACK TO SAVEPOINT s");
      };
      await insert("t-root", null);
      await expectRefused(() => insert("t-second-root", null));
      await insert("t-next", "t-root");
      await expectRefused(() => insert("t-fork", "t-root"));
      const budgets = await loadPortfolioBudgets(db, q);
      expect(budgets.find((b) => b.id === portfolio!.id)?.budget).toMatchObject({ id: "t-next", supersedesId: "t-root" });
    } finally {
      await client.query("ROLLBACK");
    }
  });
});
