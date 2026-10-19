// GPP Phase 2 PR-D (BI-69415B68): the verdict-widening migration must apply
// against ANY data state (AGENTS.md §2): after PR-C on live rows, and on a
// partially applied install. It only adds enum members.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const prcPath = new URL("../prisma/migrations/20261001180000_gpp_shadow_permits/migration.sql", import.meta.url);
const migrationPath = new URL("../prisma/migrations/20261001200000_gpp_permit_mac_verdicts/migration.sql", import.meta.url);

const ADDED = ["mac_invalid", "param_mismatch", "lineage_unsealed", "lineage_missing", "unsigned"];

describe("GPP permit MAC verdict migration shape", () => {
  it("is exactly one guarded ADD VALUE per new verdict and nothing else", async () => {
    const statements = (await readFile(migrationPath, "utf8"))
      .replace(/^--.*$/gm, "")
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean);
    expect(statements).toEqual(
      ADDED.map((value) => `ALTER TYPE "GppPermitVerdict" ADD VALUE IF NOT EXISTS '${value}'`),
    );
  });
});

describeDatabase("GPP permit MAC verdict migration against live Postgres", () => {
  let client: Client;
  const schemas: string[] = [];

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
  });

  afterAll(async () => {
    if (!client) return;
    for (const schema of schemas) await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  });

  it("widens the enum over existing verdict rows, leaves them untouched, and is harmless to re-run", async () => {
    const schema = `gpp_permit_mac_${randomUUID().replaceAll("-", "")}`;
    schemas.push(schema);
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(`CREATE TYPE "DecisionScope" AS ENUM ('wwmd', 'wwwd', 'wsid')`);
    await client.query(`CREATE TABLE "CoworkerActionEnvelope" (id TEXT PRIMARY KEY)`);
    await client.query(`CREATE TABLE "ToolExecution" (id TEXT PRIMARY KEY, "toolName" TEXT NOT NULL)`);
    await client.query(await readFile(prcPath, "utf8"));
    await client.query(
      `INSERT INTO "GppPermitObservation" (id, "toolName", verdict, path) VALUES ('o1', 'create_portal_pr', 'valid', 'monitor')`,
    );

    const sql = await readFile(migrationPath, "utf8");
    await client.query(sql);
    await client.query(sql);

    const values = await client.query(`SELECT unnest(enum_range(NULL::"GppPermitVerdict"))::text AS v`);
    expect(values.rows.map((row) => row.v)).toEqual(expect.arrayContaining(ADDED));
    await client.query(
      `INSERT INTO "GppPermitObservation" (id, "toolName", verdict, path) VALUES ('o2', 'create_portal_pr', 'mac_invalid', 'monitor')`,
    );
    const rows = await client.query(`SELECT id, verdict::text FROM "GppPermitObservation" ORDER BY id`);
    expect(rows.rows).toEqual([{ id: "o1", verdict: "valid" }, { id: "o2", verdict: "mac_invalid" }]);
  });
});
