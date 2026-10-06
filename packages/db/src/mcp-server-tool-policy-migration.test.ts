// BI-8B7B2FE9: McpServerTool gains a DPF-owned policy projection. The
// migration must apply against ANY data state (AGENTS.md §2) and fail closed:
// every existing row lands `quarantined`, except the release's bundled
// browser-use tools, which are approved by exact (server slug, tool name) match.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const migrationPath = new URL(
  "../prisma/migrations/20261006120000_mcp_server_tool_policy/migration.sql",
  import.meta.url,
);

const FIXTURE_TABLES = `
  CREATE TABLE "Principal" (id TEXT PRIMARY KEY);
  CREATE TABLE "McpServer" (id TEXT PRIMARY KEY, "serverId" TEXT NOT NULL UNIQUE);
  CREATE TABLE "McpServerTool" (
    id TEXT PRIMARY KEY,
    "serverId" TEXT NOT NULL REFERENCES "McpServer"(id) ON DELETE CASCADE,
    "toolName" TEXT NOT NULL,
    description TEXT,
    "inputSchema" JSONB NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE ("serverId", "toolName")
  );
`;

describe("McpServerTool policy migration shape", () => {
  it("defaults every row to quarantined and approves only the exact bundled mapping", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain(`CREATE TYPE "McpToolPolicyStatus" AS ENUM ('quarantined', 'approved', 'denied')`);
    expect(sql).toContain(`CREATE TYPE "McpToolEffect" AS ENUM ('read-only', 'side-effecting')`);
    expect(sql).toMatch(/"policyStatus" "McpToolPolicyStatus" NOT NULL DEFAULT 'quarantined'/);
    expect(sql).toContain(`s."serverId" = 'mcp-browser-use'`);
    expect(sql).not.toMatch(/"isEnabled"\s*=\s*true/);
    expect(sql).not.toMatch(/healthStatus/);
  });
});

async function withSchema(client: Client, prefix: string): Promise<string> {
  const schema = `${prefix}_${randomUUID().replaceAll("-", "")}`;
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}"`);
  await client.query(FIXTURE_TABLES);
  return schema;
}

describeDatabase("McpServerTool policy migration against live Postgres", () => {
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

  it("applies to an empty registry and refuses unknown states", async () => {
    schemas.push(await withSchema(client, "mcp_policy_empty"));
    await client.query(await readFile(migrationPath, "utf8"));
    await client.query(`INSERT INTO "McpServer" (id, "serverId") VALUES ('s1', 'acme')`);
    await expect(client.query(
      `INSERT INTO "McpServerTool" (id, "serverId", "toolName", "inputSchema", "policyStatus")
       VALUES ('t', 's1', 'x', '{}', 'trusted')`,
    )).rejects.toThrow(/invalid input value for enum/);
  });

  it("quarantines populated, disabled, renamed and annotation-bearing rows; approves only bundled; is re-runnable", async () => {
    schemas.push(await withSchema(client, "mcp_policy_rows"));
    await client.query(`
      INSERT INTO "McpServer" (id, "serverId") VALUES ('s1', 'acme'), ('s2', 'mcp-browser-use'), ('s3', 'browser-use-fork');
      INSERT INTO "McpServerTool" (id, "serverId", "toolName", description, "inputSchema", "isEnabled") VALUES
        ('acme-pay', 's1', 'create_payment', 'Pay', '{"type":"object"}', true),
        ('acme-off', 's1', 'refund', NULL, '{}', false),
        ('bundled-open', 's2', 'browse_open', 'Open', '{}', true),
        ('bundled-act-off', 's2', 'browse_act', 'Act', '{}', false),
        ('bundled-new', 's2', 'browse_new_thing', 'New', '{"annotations":{"readOnlyHint":true}}', true),
        ('fork-open', 's3', 'browse_open', 'Open', '{}', true);
    `);
    const sql = await readFile(migrationPath, "utf8");
    await client.query(sql);

    const rows = async () => (await client.query<{ id: string; status: string; enabled: boolean }>(
      `SELECT id, "policyStatus"::text AS status, "isEnabled" AS enabled FROM "McpServerTool" ORDER BY id`,
    )).rows;
    expect(await rows()).toEqual([
      { id: "acme-off", status: "quarantined", enabled: false },
      { id: "acme-pay", status: "quarantined", enabled: true },
      { id: "bundled-act-off", status: "approved", enabled: false },
      { id: "bundled-new", status: "quarantined", enabled: true },
      { id: "bundled-open", status: "approved", enabled: true },
      { id: "fork-open", status: "quarantined", enabled: true },
    ]);

    // An operator decision made after the first run survives a re-run.
    await client.query(`UPDATE "McpServerTool" SET "policyStatus" = 'denied' WHERE id = 'bundled-open'`);
    await client.query(sql);
    const after = await rows();
    expect(after.find((r) => r.id === "bundled-open")?.status).toBe("denied");
    expect(after.find((r) => r.id === "acme-pay")?.status).toBe("quarantined");
  });
});
