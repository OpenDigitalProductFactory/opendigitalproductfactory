import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const schema = `human_principal_backfill_${randomUUID().replaceAll("-", "")}`;
let client: Client;

const collisionGuardPath = new URL(
  "../prisma/migrations/20260812105900_prepare_human_principal_backfill/migration.sql",
  import.meta.url,
);
const originalBackfillPath = new URL(
  "../prisma/migrations/20260812110000_backfill_missing_human_principals/migration.sql",
  import.meta.url,
);

describe("human principal backfill ordering", () => {
  it("places an identity-safe preparation before the immutable live migration", async () => {
    const collisionGuard = await readFile(collisionGuardPath, "utf8");

    expect(collisionGuardPath.pathname).toContain("20260812105900_");
    expect(collisionGuardPath.pathname.localeCompare(originalBackfillPath.pathname)).toBeLessThan(0);
    expect(collisionGuard).toContain("FOR missing_user IN");
    expect(collisionGuard).toContain("FOR missing_employee IN");
    expect(collisionGuard).not.toMatch(/JOIN\s+"User"\s+\w+\s+ON\s+\w+\.email\s*=/i);
    expect(collisionGuard).not.toMatch(/JOIN\s+"EmployeeProfile"\s+\w+\s+ON\s+\w+\."displayName"\s*=/i);
  });
});

describeDatabase("human principal backfill migration", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}", public`);
    await client.query(`
      CREATE TYPE "PrincipalSensitivity" AS ENUM ('public', 'internal', 'confidential', 'restricted');
      CREATE TABLE "User" (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        "isActive" BOOLEAN NOT NULL,
        "isSuperuser" BOOLEAN NOT NULL
      );
      CREATE TABLE "EmployeeProfile" (
        id TEXT PRIMARY KEY,
        "employeeId" TEXT NOT NULL,
        "displayName" TEXT NOT NULL,
        status TEXT NOT NULL,
        "userId" TEXT
      );
      CREATE TABLE "Principal" (
        id TEXT PRIMARY KEY,
        "principalId" TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        "displayName" TEXT NOT NULL,
        "sensitivityClearance" "PrincipalSensitivity"[] NOT NULL DEFAULT ARRAY['public']::"PrincipalSensitivity"[],
        "createdAt" TIMESTAMP NOT NULL,
        "updatedAt" TIMESTAMP NOT NULL
      );
      CREATE TABLE "PrincipalAlias" (
        id TEXT PRIMARY KEY,
        "principalId" TEXT NOT NULL REFERENCES "Principal"(id),
        "aliasType" TEXT NOT NULL,
        "aliasValue" TEXT NOT NULL,
        issuer TEXT NOT NULL,
        "createdAt" TIMESTAMP NOT NULL
      );
      CREATE UNIQUE INDEX "PrincipalAlias_aliasType_aliasValue_issuer_key"
        ON "PrincipalAlias"("aliasType", "aliasValue", issuer);

      INSERT INTO "User" VALUES
        ('user-a', 'shared@example.com', true, false),
        ('user-b', 'shared@example.com', true, true);
      INSERT INTO "EmployeeProfile" VALUES
        ('employee-row-a', 'EMP-A', 'Shared Name', 'active', NULL),
        ('employee-row-b', 'EMP-B', 'Shared Name', 'active', NULL);
    `);
  });

  afterAll(async () => {
    if (!client) return;
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  });

  it("prepares every duplicate-named source row before the immutable backfill runs", async () => {
    const collisionGuard = await readFile(collisionGuardPath, "utf8");
    const originalBackfill = await readFile(originalBackfillPath, "utf8");

    await client.query(collisionGuard);
    await client.query(originalBackfill);

    const aliases = await client.query<{
      aliasType: string;
      aliasValue: string;
      principalId: string;
    }>(`
      SELECT "aliasType", "aliasValue", "principalId"
      FROM "PrincipalAlias"
      ORDER BY "aliasType", "aliasValue"
    `);

    expect(aliases.rows).toHaveLength(4);
    expect(new Set(aliases.rows.map((row) => row.principalId)).size).toBe(4);
    expect(aliases.rows.map((row) => `${row.aliasType}:${row.aliasValue}`)).toEqual([
      "employee:EMP-A",
      "employee:EMP-B",
      "user:user-a",
      "user:user-b",
    ]);

    const superuserClearance = await client.query<{ sensitivityClearance: string[] }>(`
      SELECT principal."sensitivityClearance"
      FROM "Principal" principal
      JOIN "PrincipalAlias" alias ON alias."principalId" = principal.id
      WHERE alias."aliasType" = 'user' AND alias."aliasValue" = 'user-b'
    `);
    expect(superuserClearance.rows[0]?.sensitivityClearance).toEqual([
      "public",
      "internal",
      "confidential",
    ]);
  });
});
