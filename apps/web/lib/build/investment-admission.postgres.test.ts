import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { blocksStart, evaluateItemAdmission } from "./investment-admission";

// Explicit opt-in to a governed PostgreSQL target. Everything runs in one
// transaction that always rolls back; the budget migration is applied inside it
// when the target does not have it yet.
const url = process.env.DPF_SQL_TEST_DATABASE_URL
  ?? (process.env.CI === "true" ? process.env.DATABASE_URL : undefined);
const databaseSuite = url ? describe : describe.skip;
const MIGRATIONS = resolve(__dirname, "../../../../packages/db/prisma/migrations");
const MIGRATION = resolve(MIGRATIONS, "20260925190000_portfolio_budget_period/migration.sql");
const MODE_MIGRATION = resolve(MIGRATIONS, "20260925210000_wip_admission_mode/migration.sql");

databaseSuite("admission by points in flight on PostgreSQL (BI-3430B3A4)", () => {
  let client: Client;
  const db = {
    $queryRaw: async <T,>(parts: TemplateStringsArray, ...values: unknown[]): Promise<T> =>
      (await client.query(parts.reduce((sql, part, i) => sql + (i ? `$${i}` : "") + part, ""), values)).rows as T,
  };
  const item = (itemId: string, status: string, effortSize: string) => client.query(
    `INSERT INTO "BacklogItem" ("id","itemId","title","status","type","effortSize","portfolioId","updatedAt")
     VALUES ($1,$1,'admission test',$2,'product',$3,'p-admission-test',now())`, [itemId, status, effortSize]);

  beforeAll(async () => {
    client = new Client({ connectionString: url, options: "-c statement_timeout=15000" });
    await client.connect();
    await client.query("BEGIN");
    const { rows: [present] } = await client.query(`SELECT to_regclass('"PortfolioBudgetPeriod"') IS NOT NULL AS ok`);
    if (!present.ok) await client.query(readFileSync(MIGRATION, "utf8"));
    const { rows: [mode] } = await client.query(`SELECT to_regtype('"WipAdmissionMode"') IS NOT NULL AS ok`);
    if (!mode.ok) await client.query(readFileSync(MODE_MIGRATION, "utf8"));
    await client.query(`INSERT INTO "PlatformDevConfig" ("id") VALUES ('singleton') ON CONFLICT ("id") DO NOTHING`);
    await client.query(`INSERT INTO "Portfolio" ("id","slug","name","updatedAt") VALUES ('p-admission-test','admission-test','Admission test',now())`);
  });
  afterAll(async () => {
    await client?.query("ROLLBACK");
    await client?.end();
  });

  it("counts in-flight points from real rows and applies the one-large-item floor", async () => {
    await item("BI-ADM-FLIGHT-1", "in-progress", "medium");   // 3 in flight
    await item("BI-ADM-FLIGHT-2", "awaiting-acceptance", "small"); // 1 in flight
    await item("BI-ADM-SMALL", "open", "small");   // 4 + 1 = 5 <= 8: admit
    await item("BI-ADM-LARGE", "open", "large");   // 4 + 8 = 12 > 8: refuse autonomously

    const small = await evaluateItemAdmission(db, { itemId: "BI-ADM-SMALL", startKind: "autonomous" });
    expect(small).toMatchObject({ verdict: "admit", portfolioId: "p-admission-test", inFlightPoints: 4, itemPoints: 1, allowance: 8, allowanceSource: "floor" });

    const large = await evaluateItemAdmission(db, { itemId: "BI-ADM-LARGE", startKind: "autonomous" });
    expect(large).toMatchObject({ verdict: "refuse", inFlightPoints: 4, itemPoints: 8 });
    expect(large.reason).toContain("12 of 8 points");

    const person = await evaluateItemAdmission(db, { itemId: "BI-ADM-LARGE", startKind: "human" });
    expect(person.verdict).toBe("warn");

    const inFlight = await evaluateItemAdmission(db, { itemId: "BI-ADM-FLIGHT-1", startKind: "autonomous" });
    expect(inFlight.verdict).toBe("admit");
  });

  it("reads the admission mode from PlatformDevConfig: shadow by default, enforce once switched (DI-D83D9C13686B)", async () => {
    await client.query(`UPDATE "PlatformDevConfig" SET "wipAdmissionMode" = 'shadow' WHERE "id" = 'singleton'`);
    const shadow = await evaluateItemAdmission(db, { itemId: "BI-ADM-LARGE", startKind: "autonomous" });
    expect(shadow).toMatchObject({ verdict: "refuse", mode: "shadow" });
    expect(blocksStart(shadow)).toBe(false);
    await client.query(`UPDATE "PlatformDevConfig" SET "wipAdmissionMode" = 'enforce' WHERE "id" = 'singleton'`);
    const enforced = await evaluateItemAdmission(db, { itemId: "BI-ADM-LARGE", startKind: "autonomous" });
    expect(blocksStart(enforced)).toBe(true);
  });
});
