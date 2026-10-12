import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

// Runtime-bound: only the leased shared gate or cloud CI may execute this fixture.
const enabled = Boolean(process.env.DATABASE_URL && (process.env.DPF_NONPROD_LEASE_ID || process.env.CI));
const schema = `provider_accounts_${randomUUID().replaceAll("-", "")}`;
let db: pg.Client;

describe.runIf(enabled)("provider account credential migration on PostgreSQL", () => {
  beforeAll(async () => {
    db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    await db.query("BEGIN");
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.query(`SET LOCAL search_path TO "${schema}"`);
    await db.query(`
      CREATE TABLE "CredentialEntry" (id TEXT PRIMARY KEY, "providerId" TEXT NOT NULL UNIQUE);
      CREATE TABLE "AiProviderConnection" (id TEXT PRIMARY KEY, "connectionId" TEXT UNIQUE NOT NULL, "credentialEntryId" TEXT UNIQUE REFERENCES "CredentialEntry"(id));
      CREATE TABLE "OAuthPendingFlow" (id TEXT PRIMARY KEY, state TEXT UNIQUE NOT NULL, "providerId" TEXT NOT NULL);
      INSERT INTO "CredentialEntry" VALUES ('credential-a', 'a'), ('credential-b', 'b'), ('credential-c', 'c'), ('orphan', 'orphan');
      INSERT INTO "AiProviderConnection" VALUES ('default-a', 'provider-default-a', NULL), ('default-b', 'provider-default-b', 'credential-b'), ('default-c', 'provider-default-c', NULL), ('owner-c', 'other-c', 'credential-c');
    `);
    await db.query(readFileSync(resolve(__dirname, "../prisma/migrations/20261008040000_provider_account_credentials/migration.sql"), "utf8"));
  });
  afterAll(async () => {
    await db?.query("ROLLBACK");
    await db?.end();
  });

  it("attaches legacy defaults without overwriting existing ownership or inventing orphan accounts", async () => {
    const { rows } = await db.query('SELECT "connectionId", "credentialEntryId" FROM "AiProviderConnection" ORDER BY "connectionId"');
    expect(rows).toEqual([
      { connectionId: "other-c", credentialEntryId: "credential-c" },
      { connectionId: "provider-default-a", credentialEntryId: "credential-a" },
      { connectionId: "provider-default-b", credentialEntryId: "credential-b" },
      { connectionId: "provider-default-c", credentialEntryId: null },
    ]);
    expect((await db.query('SELECT COUNT(*)::int AS n FROM "CredentialEntry"')).rows[0].n).toBe(4);
  });

  it("allows additional isolated credentials while preserving provider-default uniqueness", async () => {
    await db.query(`INSERT INTO "CredentialEntry" VALUES ('extra-a', NULL), ('extra-b', NULL)`);
    await db.query("SAVEPOINT duplicate_default");
    await expect(db.query(`INSERT INTO "CredentialEntry" VALUES ('duplicate', 'a')`)).rejects.toMatchObject({ code: "23505" });
    await db.query("ROLLBACK TO SAVEPOINT duplicate_default");
    expect((await db.query('SELECT COUNT(*)::int AS n FROM "CredentialEntry" WHERE "providerId" IS NULL')).rows[0].n).toBe(2);
  });

  it("binds OAuth state to an account and removes only its pending flows on deletion", async () => {
    await db.query(`INSERT INTO "OAuthPendingFlow" (id, state, "providerId", "connectionId") VALUES ('flow-a', 'state-a', 'a', 'provider-default-a'), ('flow-b', 'state-b', 'b', NULL)`);
    await db.query(`DELETE FROM "AiProviderConnection" WHERE "connectionId" = 'provider-default-a'`);
    expect((await db.query('SELECT state FROM "OAuthPendingFlow"')).rows).toEqual([{ state: "state-b" }]);
    expect((await db.query('SELECT id FROM "CredentialEntry" WHERE id = $1', ["credential-a"])).rows).toHaveLength(1);
  });
});
