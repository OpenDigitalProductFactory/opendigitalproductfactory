/** Real SQL projection checks, only on the governed disposable test database.
 * This fixture covers the queried activity columns, not full runtime acceptance. */
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createJobsPool } from "@/lib/jobs/postgres/pool";
import { readBoundedActivity } from "./bounded-activity-read";

const databaseUrl = process.env.DPF_JOBS_TEST_DATABASE_URL?.trim() ?? "";
describe.skipIf(!databaseUrl)("bounded activity SQL (disposable database)", () => {
  let pool: Pool;
  let client: PoolClient;
  const schema = `activity_read_${randomUUID().replaceAll("-", "")}`;
  const room = { id: "room-1", capsuleId: "WC-1", activitySequence: 251 };
  const reader = {
    room, canRead: async () => true,
    db: { async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const sql = strings.reduce((text, part, index) => text + (index ? `$${index}` : "") + part, "");
      return (await client.query(sql, values)).rows as unknown[];
    } },
    async hasLegacy() {
      return (await client.query('SELECT 1 FROM "WorkCapsuleActivity" WHERE "workCapsuleId" = $1 AND sequence IS NULL LIMIT 1', [room.id])).rowCount !== 0;
    },
  };
  beforeAll(async () => {
    pool = createJobsPool(databaseUrl, 1);
    client = await pool.connect();
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(`CREATE TABLE "WorkCapsuleActivity" (
      id TEXT PRIMARY KEY, "workCapsuleId" TEXT NOT NULL, sequence INTEGER,
      kind TEXT NOT NULL, summary TEXT NOT NULL, payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "recordedById" TEXT, "recordedByAgentId" TEXT, "toolExecutionId" TEXT,
      UNIQUE ("workCapsuleId", sequence))`);
    await client.query("SET statement_timeout = '4s'");
  });
  beforeEach(async () => {
    await client.query('TRUNCATE "WorkCapsuleActivity"');
    await client.query(`INSERT INTO "WorkCapsuleActivity" (id,"workCapsuleId",sequence,kind,summary,payload)
      SELECT 'activity-' || n, 'room-1', n, 'evidence-recorded', 'Evidence ' || n,
        jsonb_build_object('output', CASE WHEN n = 1 THEN repeat('x', 150000) ELSE 'bounded' END,
          'sourceBinding', jsonb_build_object('headSha', repeat('1', 40)),
          'nullable', NULL, 'hostile\"; --', 'bound') FROM generate_series(1,251) n`);
    await client.query(`INSERT INTO "WorkCapsuleActivity" (id,"workCapsuleId",sequence,kind,summary)
      VALUES ('foreign', 'room-2', 1, 'evidence-recorded', 'must-not-escape')`);
  });
  afterAll(async () => {
    if (client) {
      await client.query('SET search_path TO public');
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      client.release();
    }
    await pool?.end();
  });

  it("traverses 251 rows with an oversized first payload and an unchanged upper bound", async () => {
    // A later append does not enter the caller's explicitly bounded range.
    await client.query(`INSERT INTO "WorkCapsuleActivity" (id,"workCapsuleId",sequence,kind,summary)
      VALUES ('later', 'room-1', 252, 'evidence-recorded', 'later')`);
    const ids: string[] = [];
    let afterSequence = 0;
    for (let attempts = 0; attempts < 252; attempts++) {
      const result = await readBoundedActivity(reader, { afterSequence, throughSequence: 251, activityLimit: 20 });
      expect(result.success).toBe(true);
      expect(JSON.stringify(result).length).toBeLessThan(4000);
      const log = (result.data as { log: { activity: { id: string }[]; nextAfterSequence: number; hasMore: boolean } }).log;
      ids.push(...log.activity.map(row => row.id));
      if (!log.hasMore) break;
      expect(log.nextAfterSequence).toBeGreaterThan(afterSequence);
      afterSequence = log.nextAfterSequence;
    }
    expect(ids).toEqual(Array.from({ length: 251 }, (_, i) => `activity-${i + 1}`));
  });

  it("refuses the full oversized node but reads exact narrow structure, JSON null and hostile-looking keys", async () => {
    expect(await readBoundedActivity(reader, { activityId: "activity-1" })).toMatchObject({ success: false, error: "activity_value_budget_exceeded" });
    expect(await readBoundedActivity(reader, { activityId: "activity-1", payloadPath: ["sourceBinding"] })).toMatchObject({
      success: true, data: { detail: { value: { headSha: "1".repeat(40) }, selectedValueComplete: true } },
    });
    expect(await readBoundedActivity(reader, { activityId: "activity-1", payloadPath: ["output"] })).toMatchObject({
      success: false, error: "activity_value_budget_exceeded", message: expect.stringContaining("No bounded scalar reader"),
    });
    expect(await readBoundedActivity(reader, { activityId: "activity-1", payloadPath: ["nullable"] })).toMatchObject({ success: true, data: { detail: { value: null } } });
    expect(await readBoundedActivity(reader, { activityId: "activity-1", payloadPath: ["missing"] })).toMatchObject({ success: false, error: "activity_value_not_found" });
    expect(await readBoundedActivity(reader, { activityId: "activity-1", payloadPath: ['hostile"; --'] })).toMatchObject({ success: true, data: { detail: { value: "bound" } } });
    expect(await readBoundedActivity(reader, { activityId: "foreign" })).toMatchObject({ success: false, error: "activity_not_found" });
  });

  it("reports a deleted sequence and legacy rows as incomplete, with no manufactured advance", async () => {
    await client.query('DELETE FROM "WorkCapsuleActivity" WHERE id = $1', ["activity-1"]);
    await client.query(`INSERT INTO "WorkCapsuleActivity" (id,"workCapsuleId",kind,summary) VALUES ('legacy','room-1','note','legacy')`);
    expect(await readBoundedActivity(reader, { afterSequence: 0 })).toMatchObject({ success: true, data: { log: {
      nextAfterSequence: 0, incomplete: true, reason: "sequence-gap", legacyRowsPresent: true,
    } } });
  });
});
