import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const packageDir = dirname(fileURLToPath(import.meta.url));
const migrationPath = join(
  packageDir,
  "../prisma/migrations/20261110063000_normalize_legacy_blocked_backlog/migration.sql",
);
const outcomeBackfill = readFileSync(join(packageDir, "../../../apps/web/lib/backlog/outcome-backfill.ts"), "utf8");

describe("legacy blocked backlog contract", () => {
  it("removes blocked from the application status set", () => {
    expect(outcomeBackfill).not.toMatch(/OUTCOME_BACKFILL_STATUSES\s*=.*[\"']blocked[\"']/);
  });
});

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const schema = `normalize_blocked_${randomUUID().replaceAll("-", "")}`;
let client: Client;

const schemaTablesSql = `
  CREATE TYPE "BacklogItemStatus" AS ENUM (
    'triaging', 'open', 'in-progress', 'awaiting-acceptance', 'done', 'deferred', 'retired'
  );
  CREATE TABLE "Principal" (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    "displayName" TEXT NOT NULL
  );
  CREATE TABLE "User" (
    id TEXT PRIMARY KEY,
    "isActive" BOOLEAN NOT NULL,
    "isSuperuser" BOOLEAN NOT NULL,
    "workHandedOverAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL
  );
  CREATE TABLE "PrincipalAlias" (
    id TEXT PRIMARY KEY,
    "principalId" TEXT NOT NULL,
    "aliasType" TEXT NOT NULL,
    "aliasValue" TEXT NOT NULL,
    issuer TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE "Portfolio" (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL,
    "accountablePrincipalId" TEXT
  );
  CREATE TABLE "Organization" (
    id TEXT PRIMARY KEY,
    "topAccountablePrincipalId" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL
  );
  CREATE TABLE "BacklogItem" (
    id TEXT PRIMARY KEY,
    "itemId" TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    "submittedById" TEXT,
    "deferReason" TEXT,
    "deferTrigger" TEXT,
    "deferReviewAt" TIMESTAMPTZ,
    "deferOwnerPrincipalId" TEXT,
    "deferredAt" TIMESTAMPTZ,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "BacklogItem_status_closed_set"
      CHECK (status IN ('triaging', 'open', 'in-progress', 'awaiting-acceptance', 'done', 'deferred', 'retired', 'blocked'))
  );
  CREATE TABLE "BacklogItemActivity" (
    id TEXT PRIMARY KEY,
    "backlogItemId" TEXT NOT NULL,
    kind TEXT NOT NULL,
    summary TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    "recordedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`;

async function scenarioClient(seedSql: string) {
  const scenario = `normalize_blocked_case_${randomUUID().replaceAll("-", "")}`;
  const scenarioDb = new Client({ connectionString: databaseUrl });
  await scenarioDb.connect();
  await scenarioDb.query(`CREATE SCHEMA "${scenario}"`);
  await scenarioDb.query(`SET search_path TO "${scenario}"`);
  await scenarioDb.query(schemaTablesSql);
  await scenarioDb.query(seedSql);
  return { scenario, scenarioDb };
}

describeDatabase("normalize legacy blocked backlog migration (BI-22CDF13B)", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(schemaTablesSql);
    await client.query(`
      INSERT INTO "Principal" (id, kind, status, "displayName") VALUES
        ('principal-submitter', 'human', 'active', 'Submitter'),
        ('principal-foundational', 'human', 'active', 'Foundational Owner');
      INSERT INTO "User" (id, "isActive", "isSuperuser", "workHandedOverAt", "createdAt") VALUES
        ('user-submitter', true, false, NULL, '2026-01-01T00:00:00Z'),
        ('user-foundational', true, true, NULL, '2026-01-02T00:00:00Z');
      INSERT INTO "PrincipalAlias" (id, "principalId", "aliasType", "aliasValue") VALUES
        ('alias-submitter', 'principal-submitter', 'user', 'user-submitter'),
        ('alias-foundational', 'principal-foundational', 'user', 'user-foundational');
      INSERT INTO "Portfolio" (id, slug, "accountablePrincipalId") VALUES
        ('portfolio-foundational', 'foundational', 'principal-foundational');

      INSERT INTO "BacklogItem" (id, "itemId", title, status, "submittedById", "deferReason") VALUES
        ('blocked-submitter', 'BI-BLOCKED-1', 'Submitted legacy item', 'blocked', 'user-submitter', NULL),
        ('blocked-fallback', 'BI-BLOCKED-2', 'Fallback legacy item', 'blocked', NULL, NULL),
        ('open-item', 'BI-OPEN', 'Open item', 'open', NULL, NULL),
        ('existing-deferral', 'BI-DEFERRED', 'Existing deferral', 'deferred', NULL, 'Existing reason');
    `);
    await client.query(readFileSync(migrationPath, "utf8"));
  });

  afterAll(async () => {
    if (client) {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await client.end();
    }
  });

  it("normalizes every legacy row with complete governed deferral metadata", async () => {
    const rows = await client.query<{
      itemId: string;
      status: string;
      reason: string;
      trigger: string;
      reviewAt: Date;
      ownerId: string;
      deferredAt: Date;
    }>(`
      SELECT "itemId", status, "deferReason" AS reason, "deferTrigger" AS trigger,
             "deferReviewAt" AS "reviewAt", "deferOwnerPrincipalId" AS "ownerId",
             "deferredAt"
      FROM "BacklogItem"
      WHERE "itemId" LIKE 'BI-BLOCKED-%'
      ORDER BY "itemId"
    `);
    expect(rows.rows.map((row) => ({ itemId: row.itemId, status: row.status, ownerId: row.ownerId }))).toEqual([
      { itemId: "BI-BLOCKED-1", status: "deferred", ownerId: "principal-submitter" },
      { itemId: "BI-BLOCKED-2", status: "deferred", ownerId: "principal-foundational" },
    ]);
    for (const row of rows.rows) {
      expect(row.reason).toContain("legacy blocked status");
      expect(row.trigger.length).toBeGreaterThan(20);
      expect(row.reviewAt.getTime()).toBeGreaterThan(Date.now());
      expect(row.deferredAt).toBeInstanceOf(Date);
    }
  });

  it("records one auditable transition per normalized row", async () => {
    const rows = await client.query<{ itemId: string; from: string; to: string; owner: string }>(`
      SELECT bi."itemId", a.payload->>'from' AS "from", a.payload->>'to' AS "to",
             a.payload->'deferral'->>'ownerPrincipalId' AS owner
      FROM "BacklogItemActivity" a
      JOIN "BacklogItem" bi ON bi.id = a."backlogItemId"
      ORDER BY bi."itemId"
    `);
    expect(rows.rows).toEqual([
      { itemId: "BI-BLOCKED-1", from: "blocked", to: "deferred", owner: "principal-submitter" },
      { itemId: "BI-BLOCKED-2", from: "blocked", to: "deferred", owner: "principal-foundational" },
    ]);
  });

  it("uses the organization accountable-owner fallback", async () => {
    const { scenario, scenarioDb } = await scenarioClient(`
      INSERT INTO "Principal" (id, kind, status, "displayName") VALUES ('principal-org', 'human', 'active', 'Organization Owner');
      INSERT INTO "User" (id, "isActive", "isSuperuser", "workHandedOverAt", "createdAt") VALUES ('user-org', true, false, NULL, now());
      INSERT INTO "PrincipalAlias" (id, "principalId", "aliasType", "aliasValue") VALUES ('alias-org', 'principal-org', 'user', 'user-org');
      INSERT INTO "Organization" (id, "topAccountablePrincipalId", "createdAt") VALUES ('org', 'principal-org', now());
      INSERT INTO "BacklogItem" (id, "itemId", title, status) VALUES ('blocked-org', 'BI-ORG', 'Organization fallback', 'blocked');
    `);
    try {
      await scenarioDb.query(readFileSync(migrationPath, "utf8"));
      const row = await scenarioDb.query(`
        SELECT "deferOwnerPrincipalId" AS owner
        FROM "BacklogItem"
        WHERE id = 'blocked-org'
      `);
      expect(row.rows).toEqual([{ owner: "principal-org" }]);
    } finally {
      await scenarioDb.query(`DROP SCHEMA IF EXISTS "${scenario}" CASCADE`);
      await scenarioDb.end();
    }
  });

  it("uses the active-superuser last-resort fallback", async () => {
    const { scenario, scenarioDb } = await scenarioClient(`
      INSERT INTO "Principal" (id, kind, status, "displayName") VALUES ('principal-super', 'human', 'active', 'Superuser Owner');
      INSERT INTO "User" (id, "isActive", "isSuperuser", "workHandedOverAt", "createdAt") VALUES ('user-super', true, true, NULL, now());
      INSERT INTO "PrincipalAlias" (id, "principalId", "aliasType", "aliasValue") VALUES ('alias-super', 'principal-super', 'user', 'user-super');
      INSERT INTO "BacklogItem" (id, "itemId", title, status) VALUES ('blocked-super', 'BI-SUPER', 'Superuser fallback', 'blocked');
    `);
    try {
      await scenarioDb.query(readFileSync(migrationPath, "utf8"));
      const row = await scenarioDb.query(`
        SELECT "deferOwnerPrincipalId" AS owner
        FROM "BacklogItem"
        WHERE id = 'blocked-super'
      `);
      expect(row.rows).toEqual([{ owner: "principal-super" }]);
    } finally {
      await scenarioDb.query(`DROP SCHEMA IF EXISTS "${scenario}" CASCADE`);
      await scenarioDb.end();
    }
  });

  it("bounds lock acquisition when a concurrent backlog writer holds the table", async () => {
    const { scenario, scenarioDb } = await scenarioClient(`
      INSERT INTO "Principal" (id, kind, status, "displayName") VALUES ('principal-lock', 'human', 'active', 'Lock Test Owner');
      INSERT INTO "User" (id, "isActive", "isSuperuser", "workHandedOverAt", "createdAt") VALUES ('user-lock', true, true, NULL, now());
      INSERT INTO "PrincipalAlias" (id, "principalId", "aliasType", "aliasValue") VALUES ('alias-lock', 'principal-lock', 'user', 'user-lock');
      INSERT INTO "BacklogItem" (id, "itemId", title, status) VALUES ('blocked-lock', 'BI-LOCK', 'Lock timeout case', 'blocked');
    `);
    const blocker = new Client({ connectionString: databaseUrl });
    try {
      await blocker.connect();
      await blocker.query(`SET search_path TO "${scenario}"`);
      await blocker.query("BEGIN");
      await blocker.query('LOCK TABLE "BacklogItem" IN ROW EXCLUSIVE MODE');

      const startedAt = Date.now();
      await expect(scenarioDb.query(readFileSync(migrationPath, "utf8"))).rejects.toThrow(
        "canceling statement due to lock timeout",
      );
      const elapsedMs = Date.now() - startedAt;
      expect(elapsedMs).toBeGreaterThanOrEqual(4_500);
      expect(elapsedMs).toBeLessThan(10_000);
      await scenarioDb.query("ROLLBACK");
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      await blocker.end().catch(() => undefined);
      await scenarioDb.query(`DROP SCHEMA IF EXISTS "${scenario}" CASCADE`);
      await scenarioDb.end();
    }
  }, 15_000);

  it("aborts and rolls back when no active human owner can be resolved", async () => {
    const { scenario, scenarioDb } = await scenarioClient(`
      INSERT INTO "BacklogItem" (id, "itemId", title, status) VALUES ('blocked-unowned', 'BI-UNOWNED', 'Unowned legacy item', 'blocked');
    `);
    try {
      await expect(scenarioDb.query(readFileSync(migrationPath, "utf8"))).rejects.toThrow(
        "Cannot normalize legacy blocked backlog: no active human deferral owner is available",
      );
      await scenarioDb.query("ROLLBACK");
      const item = await scenarioDb.query(`SELECT status FROM "BacklogItem" WHERE id = 'blocked-unowned'`);
      const activity = await scenarioDb.query(`SELECT count(*)::int AS count FROM "BacklogItemActivity"`);
      expect(item.rows).toEqual([{ status: "blocked" }]);
      expect(activity.rows).toEqual([{ count: 0 }]);
    } finally {
      await scenarioDb.query(`DROP SCHEMA IF EXISTS "${scenario}" CASCADE`);
      await scenarioDb.end();
    }
  });

  it("leaves non-target rows unchanged", async () => {
    const rows = await client.query<{ itemId: string; status: string; reason: string | null }>(`
      SELECT "itemId", status, "deferReason" AS reason
      FROM "BacklogItem"
      WHERE "itemId" IN ('BI-OPEN', 'BI-DEFERRED')
      ORDER BY "itemId"
    `);
    expect(rows.rows).toEqual([
      { itemId: "BI-DEFERRED", status: "deferred", reason: "Existing reason" },
      { itemId: "BI-OPEN", status: "open", reason: null },
    ]);
  });

  it("contracts and validates the storage CHECK so blocked can no longer be written", async () => {
    const constraint = await client.query<{ validated: boolean; definition: string }>(`
      SELECT convalidated AS validated, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = '"BacklogItem"'::regclass
        AND conname = 'BacklogItem_status_closed_set'
    `);
    expect(constraint.rows).toHaveLength(1);
    expect(constraint.rows[0]).toMatchObject({ validated: true });
    expect(constraint.rows[0]!.definition).not.toContain("blocked");
    await expect(client.query(`UPDATE "BacklogItem" SET status='blocked' WHERE id='open-item'`)).rejects.toThrow();
  });
});
