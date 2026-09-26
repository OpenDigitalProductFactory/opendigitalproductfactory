import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { quarterBounds } from "./investment-points";
import { loadReservationTotals, settleBudgetReservations } from "./budget-reservation";

// Explicit opt-in to a governed PostgreSQL target. Everything runs in one
// transaction that always rolls back; this branch's migrations are applied
// inside it when the target does not have them yet.
const url = process.env.DPF_SQL_TEST_DATABASE_URL
  ?? (process.env.CI === "true" ? process.env.DATABASE_URL : undefined);
const databaseSuite = url ? describe : describe.skip;

const MIGRATIONS = [
  "20260925190000_portfolio_budget_period",
  "20260925200000_budget_reservation",
].map((name) => resolve(__dirname, "../../../../packages/db/prisma/migrations", name, "migration.sql"));

databaseSuite("budget reservations on PostgreSQL (BI-EF265C9A)", () => {
  let client: Client;
  const db = {
    $queryRaw: async <T,>(parts: TemplateStringsArray, ...values: unknown[]): Promise<T> =>
      (await client.query(parts.reduce((sql, part, i) => sql + (i ? `$${i}` : "") + part, ""), values)).rows as T,
    $executeRaw: async (parts: TemplateStringsArray, ...values: unknown[]): Promise<number> =>
      (await client.query(parts.reduce((sql, part, i) => sql + (i ? `$${i}` : "") + part, ""), values)).rowCount ?? 0,
  };

  beforeAll(async () => {
    client = new Client({ connectionString: url, options: "-c statement_timeout=15000" });
    await client.connect();
    await client.query("BEGIN");
    const { rows: [present] } = await client.query(`SELECT to_regclass('"BudgetReservation"') IS NOT NULL AS ok`);
    if (!present.ok) for (const file of MIGRATIONS) await client.query(readFileSync(file, "utf8"));
  });
  afterAll(async () => {
    await client?.query("ROLLBACK");
    await client?.end();
  });

  it("moves a reservation through resize, consume and release, and the totals always equal the rows (AC-1, AC-3)", async () => {
    const period = quarterBounds(new Date("2099-02-01T00:00:00Z"));
    const { rows: [portfolio] } = await client.query<{ id: string }>(
      `INSERT INTO "Portfolio" ("id","slug","name","updatedAt") VALUES ('p-budget-test','budget-test','Budget test',now()) RETURNING "id"`);
    const item = async (itemId: string, effortSize: string) => {
      const { rows: [row] } = await client.query<{ id: string }>(
        `INSERT INTO "BacklogItem" ("id","itemId","title","status","type","effortSize","updatedAt")
         VALUES ($1,$1,'budget test','in-progress','product',$2,now()) RETURNING "id"`, [itemId, effortSize]);
      await client.query(
        `INSERT INTO "BudgetReservation" ("id","backlogItemId","portfolioId","periodStart","periodEnd","points")
         VALUES ($1,$2,$3,$4,$5,$6)`, [`r-${itemId}`, row!.id, portfolio!.id, period.start, period.end, effortSize === "large" ? 8 : 3]);
      return itemId;
    };
    const a = await item("BI-TEST-BUDGET-A", "large");
    const b = await item("BI-TEST-BUDGET-B", "medium");
    const c = await item("BI-TEST-BUDGET-C", "medium");
    const scope = [a, b, c];
    const totals = async () => (await loadReservationTotals(db, period)).find((t) => t.portfolioId === portfolio!.id)!;
    const rowSum = async (states: string[]) => Number((await client.query(
      `SELECT COALESCE(SUM("points"),0) AS s FROM "BudgetReservation" WHERE "portfolioId"=$1 AND "periodStart"=$2 AND "state"::text = ANY($3)`,
      [portfolio!.id, period.start, states])).rows[0].s);

    expect(await totals()).toMatchObject({ reserved: 14, consumed: 0, released: 0 });

    // A second open reservation for the same item is refused by the partial unique index.
    await client.query("SAVEPOINT dup");
    await expect(client.query(
      `INSERT INTO "BudgetReservation" ("id","backlogItemId","portfolioId","periodStart","periodEnd","points")
       SELECT 'r-dup', "backlogItemId", "portfolioId", "periodStart", "periodEnd", 1 FROM "BudgetReservation" WHERE "id"='r-${a}'`,
    )).rejects.toMatchObject({ code: "23505" });
    await client.query("ROLLBACK TO SAVEPOINT dup");

    await client.query(`UPDATE "BacklogItem" SET "effortSize"='xlarge' WHERE "itemId"=$1`, [b]);
    expect(await settleBudgetReservations(db, { itemIds: scope })).toMatchObject({ resized: 1, kept: 2 });
    const resize = await client.query(`SELECT "summary" FROM "BacklogItemActivity" WHERE "kind"='budget_reservation_resized' AND "payload"->>'reservationId'=$1`, [`r-${b}`]);
    expect(resize.rows[0].summary).toBe("Budget reservation re-sized from 3 to 20 points");

    await client.query(`UPDATE "BacklogItem" SET "status"='done' WHERE "itemId"=$1`, [a]);
    await client.query(`UPDATE "BacklogItem" SET "status"='retired' WHERE "itemId"=$1`, [c]);
    expect(await settleBudgetReservations(db, { itemIds: scope })).toMatchObject({ consumed: 1, released: 1, kept: 1 });
    expect(await settleBudgetReservations(db, { itemIds: scope })).toMatchObject({ consumed: 0, released: 0, resized: 0, kept: 1 });

    const t = await totals();
    expect(t).toMatchObject({ reserved: 20, consumed: 8, released: 3 });
    expect(t.reserved + t.consumed).toBe(await rowSum(["reserved", "consumed"]));
  });
});
