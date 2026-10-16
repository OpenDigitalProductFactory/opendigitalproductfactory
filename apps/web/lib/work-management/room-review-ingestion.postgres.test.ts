import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// This fork binds the real Prisma adapter only to an explicitly admitted test
// database. Root dotenv can never silently select the consumer installation.
const verification = vi.hoisted(() => {
  const url = process.env.DPF_INGESTION_TEST_DATABASE_URL;
  return {url};
});
vi.mock("@dpf/db", async () => {
  const {createIngestionPostgresFixture} = await import("../../../../packages/db/src/workroom-ingestion-postgres-fixture");
  const {Prisma} = await import("../../../../packages/db/generated/client/client");
  return {prisma: verification.url ? createIngestionPostgresFixture() : undefined, Prisma};
});
import { prisma } from "@dpf/db";
import { prismaReviewCommitStore } from "./room-review-ingestion-prisma.server";
import { freezeActivityWindows, readActivityWindowPage } from "./room-activity-ingestion.server";
import { commitReviewBatch, createReviewCheckpoint, type ReviewCheckpoint, type ReviewCommitStore } from "./room-review-ingestion";

const database = verification.url ? describe : describe.skip;

database("real PostgreSQL review-cycle transaction", () => {
  afterAll(async () => {await prisma.$disconnect();});
  let queueId: string;
  let parentId: string;
  let cycleId: string;
  let carrierId: string;
  let expected: ReviewCheckpoint;
  let next: ReviewCheckpoint;
  let store: ReviewCommitStore;

  beforeEach(async () => {
    const identity = `review-ingestion-${randomUUID()}`;
    queueId = `${identity}-queue`;
    parentId = `${identity}-parent`;
    cycleId = `${identity}-cycle`;
    carrierId = `${identity}-carrier`;
    await prisma.workQueue.create({data: {id: queueId, name: "Qualification fixture", queueType: "triage", routingPolicy: {}}});
    const common = {sourceType: "work-room", title: "Review transaction fixture", description: "Governed PostgreSQL qualification",
      queueId, workerConstraint: {}};
    await prisma.workItem.create({data: {...common, id: parentId}});
    await prisma.workItem.create({data: {...common, id: cycleId, itemId: carrierId, parentItemId: parentId,
      evidence: {otherEvidence: {keep: true}, workroomCycle: {kind: "work-room-cycle", version: 1,
        cycleKey: identity, trigger: "review", objective: "Atomic continuity", accountablePrincipalRef: "agent:fixture",
        expectedReviewAt: "2026-10-14T00:00:00Z", measureSummary: "Exact replay", stopConditions: [], contextRefs: []}}}});
    expected = createReviewCheckpoint([{roomId: identity, highWater: "2"}]);
    next = {...expected, revision: 1, cycleRows: 1, rooms: [{...expected.rooms[0], consumed: "1"}]};
    store = prismaReviewCommitStore({roomWorkItemId: parentId, carrierId, actor: {type: "agent", id: "qualification-fixture"},
      initialCheckpoint: expected, authorize: async (_tx, id) => {
        if (id !== cycleId) throw new Error("Unexpected cycle binding");
      }});
    await store.withinCycleLock(tx => tx.loadCheckpoint());
  });

  afterEach(async () => {
    // Delete only this test's generated graph, children before parent.
    if (parentId) await prisma.workItemMessage.deleteMany({where: {workItemId: parentId}});
    if (cycleId) await prisma.workItem.deleteMany({where: {id: cycleId}});
    if (parentId) await prisma.workItem.deleteMany({where: {id: parentId}});
    if (queueId) await prisma.workQueue.deleteMany({where: {id: queueId}});
  });

  async function readback() {
    const cycle = await prisma.workItem.findUniqueOrThrow({where: {id: cycleId}});
    expect(cycle.evidence).toHaveProperty("workroomReviewIngestion");
    return {evidence: cycle.evidence as unknown as {otherEvidence: unknown; workroomReviewIngestion: ReviewCheckpoint},
      messages: await prisma.workItemMessage.findMany({where: {workItemId: parentId}})};
  }

  it("hardens the existing sequence without renumbering history or overflowing a legacy room", async () => {
    const schema = `review_migration_${randomUUID().replaceAll("-", "")}`;
    const client = new Client({connectionString: verification.url});
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}, public`);
      await client.query(`CREATE TABLE "WorkCapsule" (id text PRIMARY KEY, "activitySequence" integer NOT NULL DEFAULT 0)`);
      await client.query(`CREATE TABLE "WorkCapsuleActivity" (id text PRIMARY KEY, "workCapsuleId" text NOT NULL
        REFERENCES "WorkCapsule"(id), "sequence" integer, "recordedAt" timestamp NOT NULL DEFAULT now())`);
      await client.query(`INSERT INTO "WorkCapsule" VALUES ('normal',6),('full',2147483647)`);
      await client.query(`INSERT INTO "WorkCapsuleActivity" VALUES
        ('assigned-five','normal',5,'2026-10-10'),('assigned-nine','normal',9,'2026-10-11'),
        ('legacy-later','normal',NULL,'2026-10-02'),('legacy-earlier','normal',NULL,'2026-10-01'),
        ('legacy-full','full',NULL,'2026-10-01')`);
      await client.query(readFileSync(new URL("../../../../packages/db/prisma/migrations/20261013180000_workroom_activity_sequence/migration.sql", import.meta.url), "utf8"));
      // The old trigger permits both behaviors; record the regression boundary
      // without retaining either artificial mutation in the migration fixture.
      await client.query("BEGIN");
      await client.query(`INSERT INTO "WorkCapsuleActivity" VALUES ('injected','normal',99,now())`);
      await client.query(`UPDATE "WorkCapsuleActivity" SET "sequence"=7 WHERE id='assigned-five'`);
      await client.query("ROLLBACK");
      await client.query(readFileSync(new URL("../../../../packages/db/prisma/migrations/20261014012000_workroom_activity_ingestion_hardening/migration.sql", import.meta.url), "utf8"));
      const rows = (await client.query(`SELECT id,"sequence" FROM "WorkCapsuleActivity" ORDER BY id`)).rows;
      expect(rows).toEqual([
        {id: "assigned-five", sequence: 5}, {id: "assigned-nine", sequence: 9},
        {id: "legacy-earlier", sequence: 10}, {id: "legacy-full", sequence: null}, {id: "legacy-later", sequence: 11},
      ]);
      expect((await client.query(`SELECT "activitySequence" FROM "WorkCapsule" WHERE id='normal'`)).rows[0].activitySequence).toBe(11);
      await expect(client.query(`INSERT INTO "WorkCapsuleActivity" VALUES ('injected','normal',99,now())`))
        .rejects.toMatchObject({code: "23514"});
      await expect(client.query(`UPDATE "WorkCapsuleActivity" SET "sequence"=7 WHERE id='assigned-five'`))
        .rejects.toMatchObject({code: "23514"});
      await client.query(`INSERT INTO "WorkCapsuleActivity" (id,"workCapsuleId") VALUES ('after','normal')`);
      expect((await client.query(`SELECT "sequence" FROM "WorkCapsuleActivity" WHERE id='after'`)).rows[0].sequence).toBe(12);
    } finally {
      await client.query("ROLLBACK");
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await client.end();
    }
  });

  it("rolls back output and consumed positions when execution stops after output insertion", async () => {
    const interrupted: ReviewCommitStore = {withinCycleLock: callback => store.withinCycleLock(tx => callback({...tx,
      appendOutput: async input => {
        await tx.appendOutput(input);
        throw new Error("Reviewer stopped after output insert");
      }}))};
    await expect(commitReviewBatch({store: interrupted, expected, next, batchId: "batch", output: {finding: "one"}}))
      .rejects.toThrow("Reviewer stopped");
    const saved = await readback();
    expect(saved.evidence.workroomReviewIngestion).toEqual(expected);
    expect(saved.evidence.otherEvidence).toEqual({keep: true});
    expect(saved.messages).toEqual([]);
    await commitReviewBatch({store, expected, next, batchId: "batch", output: {finding: "one"}});
    expect((await readback()).messages).toHaveLength(1);
  });

  it("pages actual database positions numerically across the decimal digit boundary", async () => {
    const roomId = `${parentId}-source`;
    await prisma.workroom.create({data: {id: roomId, capsuleId: `WC-TEST-${randomUUID()}`,
      title: "Numeric cursor fixture", objective: "Exact arrival order", source: "external-adoption"}});
    try {
      await prisma.workroomActivity.createMany({data: Array.from({length: 12}, (_, index) => ({
        id: `${roomId}-${index}`, workCapsuleId: roomId, kind: "test", summary: "Numeric page",
      }))});
      const [window] = await freezeActivityWindows(prisma, [roomId]);
      expect(window.highWater).toBe("12");
      const first = await readActivityWindowPage(prisma, {roomId, after: "0", highWater: window.highWater, take: 5});
      expect(first.rows.map(row => row.ingestionSequence)).toEqual(["1", "2", "3", "4", "5"]);
      const rest = await readActivityWindowPage(prisma, {roomId, after: "5", highWater: window.highWater, take: 200});
      expect(rest.rows.map(row => row.ingestionSequence)).toEqual(["6", "7", "8", "9", "10", "11", "12"]);
    } finally {
      await prisma.workroom.deleteMany({where: {id: roomId}});
    }
  });

  it("returns one durable output for simultaneous exact replacement replay", async () => {
    const input = {store, expected, next, batchId: "batch", output: {finding: "one"}};
    const results = await Promise.all([commitReviewBatch(input), commitReviewBatch(input)]);
    expect(new Set(results.map(result => result.messageId)).size).toBe(1);
    expect(results.map(result => result.idempotent).sort()).toEqual([false, true]);
    const saved = await readback();
    expect(saved.messages).toHaveLength(1);
    expect(saved.evidence.workroomReviewIngestion).toEqual(next);
  });

  it("refuses a competing replacement with changed output without consuming twice", async () => {
    const results = await Promise.allSettled(["one", "two"].map(finding =>
      commitReviewBatch({store, expected, next, batchId: "batch", output: {finding}})));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    const saved = await readback();
    expect(saved.messages).toHaveLength(1);
    expect(saved.evidence.workroomReviewIngestion).toEqual(next);
  });

  it("refuses the caller's denied scope before cursor or output writes", async () => {
    const denied = prismaReviewCommitStore({roomWorkItemId: parentId, carrierId,
      actor: {type: "agent", id: "qualification-fixture"}, authorize: async () => {throw new Error("Scope denied");}});
    await expect(commitReviewBatch({store: denied, expected, next, batchId: "denied", output: {finding: "one"}}))
      .rejects.toThrow("Scope denied");
    const saved = await readback();
    expect(saved.evidence.workroomReviewIngestion).toEqual(expected);
    expect(saved.messages).toEqual([]);
  });
});
