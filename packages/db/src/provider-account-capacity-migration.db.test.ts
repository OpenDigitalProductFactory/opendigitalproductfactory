import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

// Never apply even this isolated rollback fixture outside a leased gate or CI.
const enabled = Boolean(process.env.DATABASE_URL && (process.env.DPF_NONPROD_LEASE_ID || process.env.CI));
const schema = `account_capacity_${randomUUID().replaceAll("-", "")}`;
let db: pg.Client;

describe.runIf(enabled)("provider account capacity migration on PostgreSQL", () => {
  beforeAll(async () => {
    db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    await db.query("BEGIN");
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.query(`SET LOCAL search_path TO "${schema}"`);
    await db.query(`
      CREATE TABLE "ModelProvider" ("providerId" TEXT PRIMARY KEY);
      CREATE TABLE "ProviderCapacityStatus" (id TEXT PRIMARY KEY, "providerId" TEXT NOT NULL UNIQUE REFERENCES "ModelProvider"("providerId"));
      CREATE TABLE "CliPoolStatus" (id TEXT PRIMARY KEY, "adapterType" TEXT NOT NULL UNIQUE);
      CREATE TABLE "AiProviderConnection" (id TEXT PRIMARY KEY, "capacityStatusId" TEXT UNIQUE REFERENCES "ProviderCapacityStatus"(id));
      CREATE TABLE "TokenUsage" (id TEXT PRIMARY KEY, "createdAt" TIMESTAMP NOT NULL, "providerId" TEXT NOT NULL);
      CREATE TABLE "RouteOutcome" (id TEXT PRIMARY KEY, "createdAt" TIMESTAMP NOT NULL, "providerId" TEXT NOT NULL);
      INSERT INTO "ModelProvider" VALUES ('codex');
      INSERT INTO "ProviderCapacityStatus" VALUES ('legacy-capacity', 'codex');
      INSERT INTO "CliPoolStatus" VALUES ('legacy-pool', 'codex-cli');
      INSERT INTO "AiProviderConnection" VALUES ('account-a', 'legacy-capacity'), ('account-b', NULL);
      INSERT INTO "TokenUsage" VALUES ('old-usage', NOW(), 'codex');
      INSERT INTO "RouteOutcome" VALUES ('old-outcome', NOW(), 'codex');
    `);
    await db.query(readFileSync(resolve(__dirname, "../prisma/migrations/20261014010000_provider_account_capacity_scopes/migration.sql"), "utf8"));
  });
  afterAll(async () => { await db?.query("ROLLBACK"); await db?.end(); });

  it("preserves legacy aliases and health ownership while admitting distinct scoped rows", async () => {
    expect((await db.query('SELECT "providerId", "scopeKey" FROM "ProviderCapacityStatus" WHERE id=$1', ["legacy-capacity"])).rows).toEqual([{ providerId: "codex", scopeKey: "provider:codex" }]);
    expect((await db.query('SELECT "adapterType", "adapterKind", "scopeKey" FROM "CliPoolStatus"')).rows).toEqual([{ adapterType: "codex-cli", adapterKind: "codex", scopeKey: "legacy-cli:codex-cli" }]);
    await db.query(`INSERT INTO "ProviderCapacityStatus" (id, "scopeKey") VALUES ('health-a', 'account:opaque-a'), ('health-b', 'account:opaque-b')`);
    await db.query(`INSERT INTO "CliPoolStatus" (id, "adapterKind", "scopeKey") VALUES ('scoped-pool', 'codex', 'cli:codex-cli:provider:codex')`);
    expect((await db.query('SELECT "capacityStatusId" FROM "AiProviderConnection" WHERE id=$1', ["account-a"])).rows[0].capacityStatusId).toBe("legacy-capacity");
  });

  it("shares quota ownership without sharing unique account health", async () => {
    await db.query(`UPDATE "AiProviderConnection" SET "quotaStatusId"='legacy-capacity'`);
    expect((await db.query('SELECT COUNT(*)::int AS n FROM "AiProviderConnection" WHERE "quotaStatusId"=$1', ["legacy-capacity"])).rows[0].n).toBe(2);
    await db.query("SAVEPOINT duplicate_health");
    await expect(db.query(`UPDATE "AiProviderConnection" SET "capacityStatusId"='legacy-capacity' WHERE id='account-b'`)).rejects.toMatchObject({ code: "23505" });
    await db.query("ROLLBACK TO SAVEPOINT duplicate_health");
  });

  it("retains unattributed history and immutable account attribution after account deletion", async () => {
    for (const table of ["TokenUsage", "RouteOutcome"]) {
      expect((await db.query(`SELECT "providerConnectionId", "quotaScopeKey" FROM "${table}"`)).rows).toEqual([{ providerConnectionId: null, quotaScopeKey: null }]);
      await db.query(`INSERT INTO "${table}" (id, "createdAt", "providerId", "providerConnectionId", "quotaScopeKey") VALUES ($1, NOW(), 'codex', 'account-a', 'provider:codex')`, [`new-${table}`]);
    }
    await db.query(`DELETE FROM "AiProviderConnection" WHERE id='account-a'`);
    for (const table of ["TokenUsage", "RouteOutcome"]) expect((await db.query(`SELECT "providerConnectionId" FROM "${table}" WHERE id=$1`, [`new-${table}`])).rows[0].providerConnectionId).toBe("account-a");
  });
});
