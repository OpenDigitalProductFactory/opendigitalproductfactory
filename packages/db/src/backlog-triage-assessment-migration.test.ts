import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migration = new URL("../prisma/migrations/20261004202500_backlog_triage_assessment/migration.sql", import.meta.url);
const databaseUrl = process.env.DATABASE_URL;
const withDatabase = databaseUrl ? describe : describe.skip;

describe("triage assessment migration", () => {
  it("is additive and does not rewrite existing decisions", async () => {
    const sql = await readFile(migration, "utf8");
    expect(sql).not.toMatch(/^\s*(UPDATE|INSERT|DELETE|DROP)\b/im);
    expect(sql).toContain('"triageAssessmentAttempts" INTEGER NOT NULL DEFAULT 0');
    expect(sql).toContain('"triageAssessmentOutcome" "BacklogTriageAssessmentOutcome"');
  });
});

withDatabase("triage assessment migration on Postgres", () => {
  let client: Client;
  const schema = `triage_assessment_${randomUUID().replaceAll("-", "")}`;
  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl }); await client.connect();
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query('CREATE TABLE "BacklogItem" (id TEXT PRIMARY KEY, status TEXT NOT NULL); CREATE TABLE "ScheduledJob" (id TEXT PRIMARY KEY, "lastStatus" TEXT);');
    await client.query('INSERT INTO "BacklogItem" VALUES ($1, $2)', ["held", "triaging"]);
  });
  afterAll(async () => {
    if (!client) return;
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await client.end();
  });
  it("preserves rows, gives prior work no assessment, and permits a safe re-run", async () => {
    const sql = await readFile(migration, "utf8"); await client.query(sql); await client.query(sql);
    const result = await client.query('SELECT status, "triageAssessmentOutcome", "triageAssessmentAttempts", "triageAssessmentFingerprint" FROM "BacklogItem" WHERE id=$1', ["held"]);
    expect(result.rows).toEqual([{ status: "triaging", triageAssessmentOutcome: null, triageAssessmentAttempts: 0, triageAssessmentFingerprint: null }]);
    await expect(client.query('UPDATE "BacklogItem" SET "triageAssessmentOutcome"=$1 WHERE id=$2', ["invented", "held"])).rejects.toThrow();
  });
});
