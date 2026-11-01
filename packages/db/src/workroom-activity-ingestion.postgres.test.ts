import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, type Prisma } from "../generated/client/client";
import { createIngestionPostgresFixture } from "./workroom-ingestion-postgres-fixture";

// Explicit opt-in prevents the root dotenv URL from selecting a live install.
// Set only for the database assigned by an admitted shared verification lease.
const databaseUrl = process.env.DPF_INGESTION_TEST_DATABASE_URL;
const database = databaseUrl ? describe : describe.skip;
let roomId: string;
let db: PrismaClient;

function barrier<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

async function expectLockWait(pid: number) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const [activity] = await db.$queryRaw<Array<{waiting: boolean}>>`
      SELECT "wait_event_type" = 'Lock' AS waiting FROM pg_stat_activity WHERE pid = ${pid}`;
    if (activity?.waiting === true) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("The competing transaction did not reach the expected database lock");
}

async function positions(client: Prisma.TransactionClient = db) {
  return client.$queryRaw<Array<{ id: string; position: string | null }>>`
    SELECT a.id, to_jsonb(a)->>'sequence' AS position
    FROM "WorkCapsuleActivity" a WHERE a."workCapsuleId" = ${roomId}
    ORDER BY (to_jsonb(a)->>'sequence')::bigint, a.id`;
}

async function highWater(client: Prisma.TransactionClient = db) {
  const [room] = await client.$queryRaw<Array<{ position: string | null }>>`
    SELECT to_jsonb(r)->>'activitySequence' AS position
    FROM "WorkCapsule" r WHERE r.id = ${roomId}`;
  expect(room?.position, "the database must expose the committed room high-water mark").not.toBeNull();
  expect(room?.position).toBeDefined();
  return BigInt(room!.position!);
}

database("database-owned Workroom activity ingestion", () => {
  beforeEach(async () => {
    roomId = `ingestion-test-${randomUUID()}`;
    db = createIngestionPostgresFixture();
    await db.$connect();
    await db.workroom.create({ data: {
      id: roomId, capsuleId: `WC-TEST-${randomUUID()}`, title: "Ingestion qualification",
      objective: "Synthetic governed database test", source: "external-adoption",
    } });
  });

  afterEach(async () => {
    if (!db) return;
    try {
      // Exact generated fixture identity only; activity FK cascades with it.
      await db.workroom.deleteMany({ where: { id: roomId } });
    } finally {
      await db.$disconnect();
    }
  });

  it("orders old-timestamp arrivals by database ingestion and keeps duplicate replay singular", async () => {
    const firstId = `${roomId}-first`;
    const lateId = `${roomId}-late`;
    await db.workroomActivity.create({ data: {
      id: firstId, workCapsuleId: roomId, kind: "test", summary: "First arrival",
      recordedAt: new Date("2026-10-12T12:00:00Z"),
    } });
    await db.workroomActivity.createMany({ data: [{
      id: lateId, workCapsuleId: roomId, kind: "test", summary: "Older event arrives later",
      recordedAt: new Date("2026-10-11T12:00:00Z"),
    }], skipDuplicates: true });
    await db.workroomActivity.createMany({ data: [{
      id: lateId, workCapsuleId: roomId, kind: "test", summary: "Replay must not replace original",
    }], skipDuplicates: true });
    const rows = await positions();
    expect(rows).toHaveLength(2);
    expect(rows.every(row => row.position !== null), "every direct/bulk insert needs a database ingestion position").toBe(true);
    expect(rows.map(row => row.id)).toEqual([firstId, lateId]);
    expect(BigInt(rows[1]!.position!)).toBeGreaterThan(BigInt(rows[0]!.position!));
    const replayed = await db.workroomActivity.findUniqueOrThrow({ where: { id: lateId } });
    expect(replayed.summary).toBe("Older event arrives later");
    expect(await highWater()).toBeGreaterThanOrEqual(BigInt(rows[1]!.position!));
    // Allocation gaps are allowed; skipDuplicates must not create new evidence.
  });

  it("rolls back a caller's activity without leaving a visible event", async () => {
    const activityId = `${roomId}-rollback`;
    const before = await positions();
    const beforeHighWater = await highWater();
    await expect(db.$transaction(async tx => {
      await tx.workroomActivity.create({ data: {
        id: activityId, workCapsuleId: roomId, kind: "test", summary: "Caller will roll back",
      } });
      throw new Error("intentional caller rollback");
    })).rejects.toThrow("intentional caller rollback");
    expect(await positions()).toEqual(before);
    expect(await highWater()).toBe(beforeHighWater);
    expect(await db.workroomActivity.findUnique({ where: { id: activityId } })).toBeNull();
  });

  it("refuses a caller-supplied sequence without advancing the room counter", async () => {
    await expect(db.workroomActivity.create({data: {workCapsuleId: roomId, kind: "test",
      summary: "Caller cannot choose arrival order", sequence: 99}})).rejects.toThrow();
    expect(await positions()).toEqual([]);
    expect(await highWater()).toBe(0n);
  });

  it("keeps database-owned positions immutable without changing ordinary JSON projections", async () => {
    const activity = await db.workroomActivity.create({ data: {
      workCapsuleId: roomId, kind: "test", summary: "Immutable position",
    } });
    const room = await db.workroom.findUniqueOrThrow({ where: { id: roomId } });
    expect(() => JSON.stringify({ room, activity })).not.toThrow();
    expect(typeof room.activitySequence).toBe("number");
    expect(typeof activity.sequence).toBe("number");
    const before = await positions();
    await expect(db.$executeRaw`
      UPDATE "WorkCapsuleActivity" SET "sequence" = 99
      WHERE id = ${activity.id}`).rejects.toThrow();
    expect(await positions()).toEqual(before);
    expect(await highWater()).toBe(BigInt(before[0]!.position!));
  });

  it("keeps a frozen snapshot stable when an older event commits after the read", async () => {
    await db.workroomActivity.create({ data: {
      workCapsuleId: roomId, kind: "test", summary: "Committed before snapshot",
    } });
    const activityId = `${roomId}-delayed-commit`;
    let inserted!: () => void;
    let insertFailed!: (error: unknown) => void;
    const insertReady = new Promise<void>((resolve, reject) => {
      inserted = resolve;
      insertFailed = reject;
    });
    let releaseWriter!: () => void;
    const commitAllowed = new Promise<void>(resolve => { releaseWriter = resolve; });
    const writer = db.$transaction(async tx => {
      await tx.workroomActivity.create({ data: {
        id: activityId, workCapsuleId: roomId, kind: "test", summary: "Delayed commit",
        recordedAt: new Date("2026-10-10T12:00:00Z"),
      } });
      inserted();
      await commitAllowed;
    }, { timeout: 15_000 });
    // Propagate an insert error rather than leaving the reader at the barrier.
    void writer.catch(insertFailed);
    let frozen: Awaited<ReturnType<typeof positions>> = [];
    let frozenHighWater = 0n;
    try {
      await insertReady;
      await db.$transaction(async reader => {
        frozenHighWater = await highWater(reader);
        frozen = await positions(reader);
        expect(frozen.some(row => row.id === activityId)).toBe(false);
        releaseWriter();
        await writer;
        expect(await positions(reader)).toEqual(frozen);
        expect(await highWater(reader)).toBe(frozenHighWater);
      }, { isolationLevel: "RepeatableRead", timeout: 15_000 });
      const current = await positions();
      const committed = current.find(row => row.id === activityId);
      expect(committed?.position).toBeTruthy();
      expect(frozen.length).toBeGreaterThan(0);
      expect(frozen.every(row => row.position !== null)).toBe(true);
      const highestVisible = frozen.reduce((highest, row) => {
        const position = BigInt(row.position!);
        return position > highest ? position : highest;
      }, 0n);
      expect(highestVisible).toBe(frozenHighWater);
      expect(BigInt(committed!.position!)).toBeGreaterThan(frozenHighWater);
      expect(current.filter(row => BigInt(row.position!) > frozenHighWater).map(row => row.id))
        .toEqual([activityId]);
    } finally {
      releaseWriter();
      await writer;
    }
  }, 30_000);

  it("serializes a second writer behind an uncommitted room counter", async () => {
    let inserted!: () => void;
    let failed!: (error: unknown) => void;
    const ready = new Promise<void>((resolve, reject) => {inserted = resolve; failed = reject;});
    let release!: () => void;
    const allowed = new Promise<void>(resolve => {release = resolve;});
    const first = db.$transaction(async tx => {
      await tx.workroomActivity.create({data: {id: `${roomId}-writer-one`, workCapsuleId: roomId,
        kind: "test", summary: "First writer holds parent until commit"}});
      inserted();
      await allowed;
    }, {timeout: 15000});
    void first.catch(failed);
    let second: Promise<unknown> | undefined;
    try {
      await ready;
      let started!: (pid: number) => void;
      let startFailed!: (error: unknown) => void;
      const secondReady = new Promise<number>((resolve, reject) => {started = resolve; startFailed = reject;});
      second = db.$transaction(async tx => {
        const [connection] = await tx.$queryRaw<Array<{pid: number}>>`SELECT pg_backend_pid() AS pid`;
        started(connection!.pid);
        await tx.workroomActivity.create({data: {id: `${roomId}-writer-two`, workCapsuleId: roomId,
          kind: "test", summary: "Second writer follows commit order"}});
      }, {timeout: 15000});
      void second.catch(startFailed);
      const pid = await secondReady;
      await expectLockWait(pid);
      expect(await highWater()).toBe(0n);
      expect(await positions()).toEqual([]);
      release();
      await Promise.all([first, second]);
      const rows = await positions();
      expect(rows.map(row => row.id)).toEqual([`${roomId}-writer-one`, `${roomId}-writer-two`]);
      expect(rows.map(row => row.position)).toEqual(["1", "2"]);
      expect(await highWater()).toBe(2n);
    } finally {
      release();
      await Promise.allSettled([first, ...(second ? [second] : [])]);
    }
  }, 30000);

  it("lets another room commit while the first room's counter is locked", async () => {
    const otherId = `${roomId}-independent`;
    await db.workroom.create({data: {id: otherId, capsuleId: `WC-TEST-${randomUUID()}`,
      title: "Independent room", objective: "Per-room serialization", source: "external-adoption"}});
    const ready = barrier();
    const release = barrier();
    const first = db.$transaction(async tx => {
      await tx.workroomActivity.create({data: {workCapsuleId: roomId, kind: "test", summary: "Held open"}});
      ready.resolve();
      await release.promise;
    }, {timeout: 15000});
    void first.catch(ready.reject);
    try {
      await ready.promise;
      await db.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`;
        await tx.workroomActivity.create({data: {workCapsuleId: otherId, kind: "test", summary: "Must not wait on another room"}});
      }, {timeout: 5000});
      const [other] = await db.$queryRaw<Array<{position: string}>>`
        SELECT "activitySequence"::text AS position FROM "WorkCapsule" WHERE id = ${otherId}`;
      expect(other?.position).toBe("1");
      expect(await highWater()).toBe(0n);
    } finally {
      release.resolve();
      await first;
      await db.workroom.deleteMany({where: {id: otherId}});
    }
  }, 30000);

  it("serializes parent-first participant repair with reassignment and retains one roster identity", async () => {
    const principalId = `${roomId}-principal`;
    await db.principal.create({data: {id: principalId, principalId, kind: "human", displayName: "Qualification fixture"}});
    const ready = barrier();
    const release = barrier();
    const secondReady = barrier<number>();
    const write = async (tx: Prisma.TransactionClient, label: string) => {
      await tx.$queryRaw`SELECT id FROM "WorkCapsule" WHERE id = ${roomId} FOR UPDATE`;
      await tx.workroomParticipant.upsert({where: {workroomId_principalId: {workroomId: roomId, principalId}},
        create: {workroomId: roomId, principalId, roles: ["contributor"], assignmentSource: "explicit"},
        update: {currentWorkSummary: label}});
      await tx.workroomActivity.create({data: {workCapsuleId: roomId, kind: "test", summary: label}});
    };
    const first = db.$transaction(async tx => {
      await write(tx, "First parent-first repair");
      ready.resolve();
      await release.promise;
    }, {timeout: 15000});
    void first.catch(ready.reject);
    let second: Promise<unknown> | undefined;
    try {
      await ready.promise;
      second = db.$transaction(async tx => {
        const [connection] = await tx.$queryRaw<Array<{pid: number}>>`SELECT pg_backend_pid() AS pid`;
        secondReady.resolve(connection!.pid);
        await write(tx, "Replacement after first commit");
      }, {timeout: 15000});
      void second.catch(secondReady.reject);
      await expectLockWait(await secondReady.promise);
      release.resolve();
      await Promise.all([first, second]);
      expect(await db.workroomParticipant.count({where: {workroomId: roomId, principalId}})).toBe(1);
      const participant = await db.workroomParticipant.findUniqueOrThrow({where: {workroomId_principalId: {workroomId: roomId, principalId}}});
      expect(participant.currentWorkSummary).toBe("Replacement after first commit");
      expect((await positions()).map(row => row.position)).toEqual(["1", "2"]);
    } finally {
      release.resolve();
      await Promise.allSettled([first, ...(second ? [second] : [])]);
      await db.workroomParticipant.deleteMany({where: {workroomId: roomId, principalId}});
      await db.principal.deleteMany({where: {id: principalId}});
    }
  }, 30000);
});
