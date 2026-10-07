import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import pg from "pg";
import { COWORKER_SLUG_TO_CANONICAL_AGENT_ID } from "./agent-identity";
import registry from "../data/agent_registry.json";
import { seedCanonicalAgentToolGrants, type CanonicalGrantSeedDb } from "./seed-agent-tool-grants";

const sql = readFileSync(new URL("../prisma/migrations/20261005010000_retire_duplicate_grant_authority/migration.sql", import.meta.url), "utf8");
let client: pg.Client | undefined;
afterEach(async () => { if (client) { await client.query("ROLLBACK").catch(() => {}); await client.end(); client = undefined; } });

describe("duplicate permission authority migration", () => {
  it("covers the existing identity map without inventing aliases", () => {
    const map = JSON.parse(sql.match(/identities jsonb := '(.*?)'::jsonb/)![1]);
    expect(map).toEqual(COWORKER_SLUG_TO_CANONICAL_AGENT_ID);
  });
  it("executes safely and idempotently against duplicate/conflicting/missing-owner states", async (ctx) => {
    // Runtime-bound proof runs in the leased shared CI database. No default
    // live-install URL: absent database configuration is explicitly unrun.
    if (!process.env.DATABASE_URL) { ctx.skip(); return; }
    client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query("BEGIN");
    // Session-local tables shadow the platform tables; rollback removes all
    // fixtures and audit rows. Never mutate any installation record.
    await client.query(`
      CREATE TEMP TABLE "Agent" (id text PRIMARY KEY, "agentId" text UNIQUE) ON COMMIT DROP;
      CREATE TEMP TABLE "AgentToolGrant" (id text PRIMARY KEY, "agentId" text REFERENCES "Agent"(id), "grantKey" text,
        "grantedBy" text, "grantedAt" timestamptz DEFAULT now(), UNIQUE("agentId", "grantKey")) ON COMMIT DROP;
      CREATE TEMP TABLE "AgentToolGrantRevocation" (id text PRIMARY KEY, "agentId" text REFERENCES "Agent"(id), "grantKey" text,
        "revokedBy" text, "revokedAt" timestamptz DEFAULT now(), UNIQUE("agentId", "grantKey")) ON COMMIT DROP;
      CREATE TEMP TABLE "ToolExecution" (id text PRIMARY KEY, "threadId" text, "agentId" text, "userId" text, "toolName" text,
        parameters jsonb, result jsonb, success boolean, "executionMode" text, "auditClass" text, "routeContext" text, summary text) ON COMMIT DROP;
      INSERT INTO "Agent" VALUES ('c','AGT-EXT-CODEX'),('a','external-codex'),('cc','AGT-EXT-CLAUDE'),('aa','external-claude-code'),
        ('cg','AGT-EXT-GROK'),('ag','external-grok'),('orphan','onboarding-coo');
      INSERT INTO "AgentToolGrant" (id,"agentId","grantKey","grantedBy") VALUES
        ('g1','c','registry_read','current-admin'),('g2','a','registry_read','original-admin'),
        ('g3','cc','backlog_read','current-admin'),('g4','aa','backlog_write','previous-admin'),
        ('g5','ag','release_plan_read','previous-admin'),('g6','orphan','registry_write','original-admin');
      INSERT INTO "AgentToolGrantRevocation" (id,"agentId","grantKey","revokedBy","revokedAt") VALUES
        ('r1','a','inventory_read','original-admin','2026-01-01'),
        ('r2','cg','release_plan_read','current-admin','2026-01-02');
    `);
    const beforeGrants = (await client.query('SELECT * FROM "AgentToolGrant" WHERE "agentId" IN (\'c\',\'cc\',\'cg\') ORDER BY id')).rows;
    await client.query(sql);
    expect((await client.query('SELECT * FROM "AgentToolGrant" WHERE "agentId" IN (\'c\',\'cc\',\'cg\') ORDER BY id')).rows).toEqual(beforeGrants);
    expect((await client.query('SELECT "agentId", "grantKey" FROM "AgentToolGrant" ORDER BY id')).rows).toEqual([
      { agentId: "c", grantKey: "registry_read" }, { agentId: "cc", grantKey: "backlog_read" },
      { agentId: "aa", grantKey: "backlog_write" }, { agentId: "ag", grantKey: "release_plan_read" },
      { agentId: "orphan", grantKey: "registry_write" },
    ]);
    const removal = (await client.query('SELECT * FROM "AgentToolGrantRevocation" WHERE id=\'r1\'')).rows[0];
    expect(removal).toMatchObject({ agentId: "c", revokedBy: "original-admin" });
    expect(removal.revokedAt.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    const audit = (await client.query('SELECT * FROM "ToolExecution" ORDER BY id')).rows;
    expect(audit).toHaveLength(2);
    expect(audit.find((a) => a.parameters.grantKey === "registry_read").result.alias.grant.grantedBy).toBe("original-admin");
    expect((await client.query('SELECT count(*)::int n FROM "Agent"')).rows[0].n).toBe(7);
    await client.query(sql);
    expect((await client.query('SELECT * FROM "ToolExecution" ORDER BY id')).rows).toEqual(audit);

    // Exercise the actual registry seed helper on the migrated PostgreSQL
    // fixture. Deliberate removals survive; unresolved identities stay pending.
    const dbClient = client;
    const db: CanonicalGrantSeedDb = {
      agent: { async findUnique({ where }) {
        const result = await dbClient.query(`SELECT
          (SELECT count(*)::int FROM "AgentToolGrant" g WHERE g."agentId"=a.id) AS grants,
          (SELECT count(*)::int FROM "AgentToolGrantRevocation" r WHERE r."agentId"=a.id) AS removals
          FROM "Agent" a WHERE a."agentId"=$1`, [where.agentId]);
        return result.rows[0] ? { _count: { toolGrants: result.rows[0].grants, toolGrantRevocations: result.rows[0].removals } } : null;
      } },
      agentToolGrant: { async upsert({ create }) {
        return dbClient.query(`INSERT INTO "AgentToolGrant" (id,"agentId","grantKey") VALUES ($1,$2,$3)
          ON CONFLICT ("agentId","grantKey") DO NOTHING`, [`seed:${create.agentId}:${create.grantKey}`, create.agentId, create.grantKey]);
      } },
    };
    await dbClient.query(`INSERT INTO "AgentToolGrantRevocation" (id,"agentId","grantKey","revokedBy","revokedAt")
      VALUES ('r3','c','coworker_engagement_write','operator-choice','2026-01-03')`);
    const removals = (await dbClient.query('SELECT * FROM "AgentToolGrantRevocation" ORDER BY id')).rows;
    const revoked = new Set<string>(removals.map(row => `${row.agentId}:${row.grantKey}`));
    const profiles = [{ id: "c", agentId: "AGT-EXT-CODEX" }, { id: "cc", agentId: "AGT-EXT-CLAUDE" }, { id: "cg", agentId: "AGT-EXT-GROK" }];
    const seed = async () => { for (const agent of profiles) {
      const grants = registry.agents.find(row => row.agent_id === agent.agentId)!.config_profile.tool_grants;
      await seedCanonicalAgentToolGrants(db, agent, grants, revoked);
    } };
    await seed();
    const seeded = (await dbClient.query('SELECT * FROM "AgentToolGrant" ORDER BY id')).rows;
    expect(seeded).toContainEqual(expect.objectContaining({ agentId: "c", grantKey: "coworker_catalog_read" }));
    expect(seeded.some(row => row.agentId === "c" && row.grantKey === "coworker_engagement_write")).toBe(false);
    expect(seeded.filter(row => ["cc", "cg"].includes(row.agentId))).toEqual(beforeGrants.filter(row => ["cc", "cg"].includes(row.agentId)));
    expect(seeded.find(row => row.id === "g1")).toEqual(beforeGrants.find(row => row.id === "g1"));
    expect(seeded.some(row => row.agentId === "a")).toBe(false);
    await seed();
    expect((await dbClient.query('SELECT * FROM "AgentToolGrant" ORDER BY id')).rows).toEqual(seeded);
    expect((await dbClient.query('SELECT * FROM "AgentToolGrantRevocation" ORDER BY id')).rows).toEqual(removals);
    expect((await dbClient.query('SELECT * FROM "ToolExecution" ORDER BY id')).rows).toEqual(audit);
  });
});
