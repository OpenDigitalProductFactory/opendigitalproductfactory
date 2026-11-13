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

describeDatabase("normalize legacy blocked backlog migration (BI-22CDF13B)", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(`
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
