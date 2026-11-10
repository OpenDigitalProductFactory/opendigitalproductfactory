import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../../../packages/db/generated/client/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { claimAcceptanceSweep, finishAcceptanceSweep, renewAcceptanceSweep, wakeAcceptanceSweep } from "./acceptance-sweep-lease";
import { withAcceptanceSweepWrite } from "./acceptance-sweep-fence";
import { readSweepCheckpoint } from "./acceptance-sweep-checkpoint";
import { productionAcceptanceSweepPorts } from "./acceptance-sweep-task";

// External signal preparation is separately tested. This suite exercises the
// real production write ports and Prisma transactions, never Git/network IO.
vi.mock("./prepare-completion-signals", () => ({ prepareSweepCompletionSignals: async () => ({
  assertCurrent: async () => {}, dependencies: { resolveMergeDelivery: async () => "merged" },
}) }));

// Explicit governed target only. Unique schema shadows table definitions; no
// installed tasks, rooms, or backlog records are touched. Not a runtime PASS.
const url = process.env.DPF_SQL_TEST_DATABASE_URL;
const schema = `acceptance_fence_test_${randomUUID().replaceAll("-", "")}`;
const taskId = "acceptance-fence-test";
const schedule = "0 5 * * *";
const upgrade = (runId: string, day: number) => ({ runId, rowId: runId, completedAt: new Date(Date.UTC(2026, 9, day)).toISOString() });

describe.skipIf(!url)("acceptance lease transactions on PostgreSQL", () => {
  let admin: Pool;
  let pool: Pool;
  let db: PrismaClient;
  const checkpoint = async () => readSweepCheckpoint((await pool.query('SELECT "taskConfig" FROM "ScheduledAgentTask" WHERE "taskId"=$1', [taskId])).rows[0].taskConfig);
  const expire = async () => pool.query(`UPDATE "ScheduledAgentTask" SET "taskConfig"=jsonb_set("taskConfig",'{acceptanceSweep,owner,expiresAt}',to_jsonb(floor(extract(epoch FROM clock_timestamp())*1000)-1)), "nextRunAt"=clock_timestamp() WHERE "taskId"=$1`, [taskId]);
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString: url, options: `-c search_path=${schema},public -c statement_timeout=5000`, max: 4 });
    db = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
    await pool.query('CREATE TABLE "ScheduledAgentTask" (LIKE public."ScheduledAgentTask" INCLUDING ALL)');
    await pool.query('CREATE TABLE "ScheduledJob" (LIKE public."ScheduledJob" INCLUDING ALL)');
    for (const table of ["BacklogItem", "BacklogItemActivity", "WorkCapsule", "WorkCapsuleActivity"]) {
      await pool.query(`CREATE TABLE "${table}" (LIKE public."${table}" INCLUDING ALL)`);
    }
    // Prisma qualifies enum casts with the adapter schema. Keep the cloned
    // columns' actual enum types by exposing compatible schema-local domains.
    const enumDomains = await pool.query<{ ddl: string }>(`
      SELECT DISTINCT format('CREATE DOMAIN %I.%I AS %I.%I', $1::text, e.typname, en.nspname, e.typname) AS ddl
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_type t ON t.oid = a.atttypid
      JOIN pg_type e ON e.oid = CASE WHEN t.typtype = 'e' THEN t.oid ELSE t.typelem END
      JOIN pg_namespace en ON en.oid = e.typnamespace
      WHERE n.nspname = $1::text AND a.attnum > 0 AND NOT a.attisdropped AND e.typtype = 'e'
    `, [schema]);
    for (const { ddl } of enumDomains.rows) await pool.query(ddl);
    await pool.query('CREATE TABLE effects (port text NOT NULL)');
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE "ScheduledAgentTask", "ScheduledJob", "BacklogItem", "BacklogItemActivity", "WorkCapsule", "WorkCapsuleActivity", effects');
    await pool.query(`INSERT INTO "ScheduledAgentTask" (id,"taskId","agentId",title,prompt,"routeContext",schedule,"ownerUserId","taskConfig","nextRunAt","updatedAt") VALUES ($1,$1,'test-agent','test','test','test',$2,'test-owner','{"unrelated":"preserved"}',clock_timestamp(),clock_timestamp())`, [taskId, schedule]);
    await pool.query(`INSERT INTO "ScheduledJob" (id,"jobId",name,schedule,"updatedAt") VALUES ($1,$1,'test',$2,clock_timestamp())`, [taskId, schedule]);
  });
  afterAll(async () => {
    await db?.$disconnect();
    await pool?.end();
    // Only the namespace created by this suite is removable.
    if (admin && /^acceptance_fence_test_[a-f0-9]{32}$/.test(schema)) await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  it("admits exactly one concurrent owner", async () => {
    await wakeAcceptanceSweep(db, taskId, upgrade("upgrade-a", 1));
    const claims = await Promise.all([claimAcceptanceSweep(db, taskId), claimAcceptanceSweep(db, taskId)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
  });
  it("bounds repeated crash recovery rather than starting again on every dispatch", async () => {
    await wakeAcceptanceSweep(db,taskId,upgrade("upgrade-a",1));
    expect(await claimAcceptanceSweep(db,taskId)).not.toBeNull();
    await expire(); await wakeAcceptanceSweep(db,taskId,upgrade("upgrade-a",1));
    expect(await claimAcceptanceSweep(db,taskId)).not.toBeNull();
    await expire(); await wakeAcceptanceSweep(db,taskId,upgrade("upgrade-a",1));
    await wakeAcceptanceSweep(db,taskId,upgrade("upgrade-a",1));
    expect(await claimAcceptanceSweep(db,taskId)).toBeNull();
    expect((await checkpoint()).pending?.runId).toBe("upgrade-a");
    expect((await checkpoint()).acknowledgedRunId).toBeNull();
  });

  it("fences recovered A, preserves the successor wake, and resumes after B crashes", async () => {
    await wakeAcceptanceSweep(db, taskId, upgrade("upgrade-a", 1));
    const a = (await claimAcceptanceSweep(db, taskId))!;
    await expire();
    await wakeAcceptanceSweep(db, taskId, upgrade("upgrade-a", 1));
    const b = (await claimAcceptanceSweep(db, taskId))!;
    await wakeAcceptanceSweep(db, taskId, upgrade("upgrade-b", 2));
    for (const port of ["snapshot", "routing", "terminal", "cursor", "terminal-audit-retry"]) {
      await expect(withAcceptanceSweepWrite(db, taskId, a, tx => tx.$executeRawUnsafe('INSERT INTO effects(port) VALUES ($1)',port))).rejects.toThrow("ownership lost");
    }
    await expect(renewAcceptanceSweep(db, taskId, a)).rejects.toThrow("ownership lost");
    await expect(finishAcceptanceSweep(db, taskId, a, {startedAt:new Date(),schedule,error:"late A"})).rejects.toThrow("ownership lost");
    expect((await checkpoint()).owner?.token).toBe(b.token);
    expect((await pool.query('SELECT * FROM effects')).rows).toHaveLength(0);
    await expire(); // Simulate B terminating without acknowledgement.
    await wakeAcceptanceSweep(db, taskId, upgrade("upgrade-b", 2));
    const c = (await claimAcceptanceSweep(db, taskId))!;
    expect(c.runId).toBe("upgrade-b");
    await finishAcceptanceSweep(db, taskId, c, {startedAt:new Date(),schedule,error:null});
    expect(await checkpoint()).toMatchObject({pending:null,owner:null,acknowledgedRunId:"upgrade-b"});
    expect((await pool.query('SELECT "taskConfig" FROM "ScheduledAgentTask"')).rows[0].taskConfig.unrelated).toBe("preserved");
  });

  it("does not acknowledge an upgrade arriving during success or failure", async () => {
    for (const error of [null,"bounded failure"]) {
      await pool.query('UPDATE "ScheduledAgentTask" SET "taskConfig"=NULL,"nextRunAt"=clock_timestamp()');
      await wakeAcceptanceSweep(db, taskId, upgrade("upgrade-a",1));
      const a = (await claimAcceptanceSweep(db,taskId))!;
      await wakeAcceptanceSweep(db,taskId,upgrade("upgrade-b",2));
      await finishAcceptanceSweep(db,taskId,a,{startedAt:new Date(),schedule,error});
      expect((await checkpoint()).pending?.runId).toBe("upgrade-b");
      expect((await claimAcceptanceSweep(db,taskId))?.runId).toBe("upgrade-b");
    }
  });

  it("fences the actual snapshot, routing, cursor and terminal ports after takeover", async () => {
    const item = await db.backlogItem.create({ data: { itemId:"BI-FENCE-TEST",title:"Fence test",type:"product",status:"awaiting-acceptance" } });
    const a = (await claimAcceptanceSweep(db,taskId))!;
    const ports = productionAcceptanceSweepPorts(db as never,new Date(),"test-agent",taskId,a);
    const projection = {owed:[],owner:null,unroutable:[],closable:false};
    await ports.recordSnapshot(item,projection);
    expect(await db.backlogItemActivity.count()).toBe(1);
    await expire();
    const b = (await claimAcceptanceSweep(db,taskId))!;
    expect(b.token).not.toBe(a.token);
    await expect(ports.recordSnapshot(item,projection)).rejects.toThrow("ownership lost");
    await expect(ports.route([{item,ageDays:30,projection}],1)).rejects.toThrow("ownership lost");
    await expect(ports.recordRun({ranAt:new Date().toISOString(),headline:"stale",cursor:"stale"} as never)).rejects.toThrow("ownership lost");
    await expect(ports.close(item,{verdict:"allowed",satisfied:[]} as never,{
      state:"enabled",setByUserId:"test-user",setAt:new Date().toISOString(),agentGrant:"initiative_completion",reason:"test",limit:1,
    } as never)).rejects.toThrow("ownership lost");
    expect(await db.backlogItemActivity.count()).toBe(1);
    expect(await db.workroom.count()).toBe(0);
    expect((await db.backlogItem.findUniqueOrThrow({where:{id:item.id}})).status).toBe("awaiting-acceptance");
    const successor = productionAcceptanceSweepPorts(db as never,new Date(),"test-agent",taskId,b);
    await successor.recordRun({ranAt:new Date().toISOString(),headline:"current",cursor:"current"} as never);
    expect(await db.workroom.count()).toBe(1);
    expect((await db.workroomActivity.findFirstOrThrow()).payload).toMatchObject({cursor:"current"});
  });

  it("rolls back an expiring in-flight write before a waiting successor claims", async () => {
    const a = (await claimAcceptanceSweep(db,taskId))!;
    await pool.query(`UPDATE "ScheduledAgentTask" SET "taskConfig"=jsonb_set("taskConfig",'{acceptanceSweep,owner,expiresAt}',to_jsonb(floor(extract(epoch FROM clock_timestamp())*1000)+2000)), "nextRunAt"=clock_timestamp() WHERE "taskId"=$1`,[taskId]);
    let enter!: () => void;
    const entered = new Promise<void>(resolve => { enter=resolve; });
    const writing = withAcceptanceSweepWrite(db,taskId,a,async tx => {
      await tx.$executeRawUnsafe('INSERT INTO effects(port) VALUES ($1)',"must-roll-back");
      enter();
      await tx.$executeRawUnsafe("SELECT pg_sleep(2.2)");
    });
    const refused = expect(writing).rejects.toThrow("ownership lost");
    await entered;
    const successor = claimAcceptanceSweep(db,taskId);
    await refused;
    const next = await successor;
    expect(next).not.toBeNull();
    expect(next!.token).not.toBe(a.token);
    expect((await pool.query('SELECT * FROM effects')).rows).toHaveLength(0);
  }, 10_000);
});
