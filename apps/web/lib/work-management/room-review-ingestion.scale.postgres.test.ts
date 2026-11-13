import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

// Explicit, separately admitted qualification only. Ordinary CI and root dotenv
// must never turn this 10k-room workload on or select the consumer database.
const verification = vi.hoisted(() => ({
  enabled: process.env.DPF_INGESTION_SCALE_QUALIFICATION === "1"
    && Boolean(process.env.DPF_INGESTION_TEST_DATABASE_URL),
}));
vi.mock("@dpf/db", async () => {
  const { createIngestionPostgresFixture } = await import("../../../../packages/db/src/workroom-ingestion-postgres-fixture");
  const { Prisma } = await import("../../../../packages/db/generated/client/client");
  return { prisma: verification.enabled ? createIngestionPostgresFixture() : undefined, Prisma };
});
import { Prisma, prisma } from "@dpf/db";
import { freezeActivityWindows, readActivityWindowPage, type IngestedActivity } from "./room-activity-ingestion.server";
import { commitReviewBatch, continueReviewCheckpoint, createReviewCheckpoint, runReviewIngestionBatch,
  type ReviewCheckpoint, type ReviewCommitStore } from "./room-review-ingestion";
import { prismaReviewCommitStore, runPrismaReviewIngestionBatch } from "./room-review-ingestion-prisma.server";

const database = verification.enabled ? describe : describe.skip;
const ROOM_COUNT = 10_000;
const EVENT_COUNT = 100_000;
const QUALIFICATION_DEADLINE_MS = 30 * 60_000;

type SourceRow = { id: string; roomId: string; ingestionSequence: string };
type StoredBatch = { workItemId: string; messageId: string; structuredPayload: unknown };
type BatchBinding = { carrierId: string; batchId: string };

function verifyPersistedBatches(messages: StoredBatch[], parentId: string,
  expectedRows: Map<string, SourceRow>, bindings: Map<string, BatchBinding>) {
  expect(messages).toHaveLength(bindings.size);
  const seenMessages = new Set<string>();
  const seenRows = new Set<string>();
  for (const message of messages) {
    const binding = bindings.get(message.messageId);
    expect(binding).toBeDefined();
    expect(message.workItemId).toBe(parentId);
    expect(seenMessages.has(message.messageId)).toBe(false);
    seenMessages.add(message.messageId);
    const payload = message.structuredPayload as { kind: string; version: number; carrierId: string;
      batchId: string; fingerprint: string; coverage: string; output: { sourceRows: SourceRow[]; coverage: string } };
    expect(payload).toMatchObject({ kind: "workroom-review-batch", version: 1, ...binding,
      coverage: "retention-unverified", output: { coverage: "retention-unverified" } });
    expect(payload.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(message.messageId).toBe(`workroom-review:${JSON.stringify([parentId, payload.carrierId, payload.batchId])}`);
    expect(Array.isArray(payload.output.sourceRows)).toBe(true);
    expect(payload.output.sourceRows.length).toBeGreaterThan(0);
    expect(payload.output.sourceRows.length).toBeLessThanOrEqual(200);
    let previous = 0n;
    for (const row of payload.output.sourceRows) {
      expect(expectedRows.has(row.id)).toBe(true);
      expect(row).toEqual(expectedRows.get(row.id));
      expect(seenRows.has(row.id)).toBe(false);
      expect(row.roomId).toBe(payload.output.sourceRows[0].roomId);
      expect(BigInt(row.ingestionSequence)).toBeGreaterThan(previous);
      previous = BigInt(row.ingestionSequence);
      seenRows.add(row.id);
    }
  }
  // Expected rows come from the seeded SQL table, independently of analyze().
  expect(seenRows.size).toBe(expectedRows.size);
}

describe("persisted scale evidence auditor", () => {
  const parent = "qualification-parent";
  const rows: SourceRow[] = [
    { id: "event-a", roomId: "room-a", ingestionSequence: "1" },
    { id: "event-b", roomId: "room-b", ingestionSequence: "2" },
  ];
  function fixture() {
    const bindings = new Map<string, BatchBinding>();
    const messages = rows.map((row, index) => {
      const binding = { carrierId: "carrier", batchId: `revision:${index}` };
      const messageId = `workroom-review:${JSON.stringify([parent, binding.carrierId, binding.batchId])}`;
      bindings.set(messageId, binding);
      return { workItemId: parent, messageId, structuredPayload: { kind: "workroom-review-batch", version: 1,
        ...binding, fingerprint: "a".repeat(64), coverage: "retention-unverified",
        output: { sourceRows: [row], coverage: "retention-unverified" } } };
    });
    return { messages, bindings, expected: new Map(rows.map(row => [row.id, row])) };
  }
  it("accepts the exact persisted union", () => {
    const { messages, bindings, expected } = fixture();
    expect(() => verifyPersistedBatches(messages, parent, expected, bindings)).not.toThrow();
  });
  it.each(["dropped", "changed", "duplicated"])("rejects %s rows in a later persisted batch with unchanged message count", mutation => {
    const { messages, bindings, expected } = fixture();
    const later = messages[1].structuredPayload.output;
    later.sourceRows = mutation === "dropped" ? [] : mutation === "duplicated" ? [rows[0]]
      : [{ ...rows[1], ingestionSequence: "3" }];
    expect(() => verifyPersistedBatches(messages, parent, expected, bindings)).toThrow();
  });
});

database("admitted PostgreSQL ingestion scale qualification", () => {
  const prefix = `review-scale-${randomUUID()}`;
  const queueId = `${prefix}-queue`;
  const parentId = `${prefix}-parent`;
  const createdRooms: string[] = [];
  const createdItems: string[] = [];
  let createdQueue = false;
  let assertionsCompleted = false;

  afterAll(async () => {
    try {
      if (!assertionsCompleted) {
        // Preserve negative/uncertain evidence for the next governed readback.
        // The admitted runner must retain its log before closing the owned job.
        console.info("DPF_INGESTION_SCALE_RETAINED", JSON.stringify({ prefix, queueId, parentId,
          acknowledgedRooms: createdRooms.length, acknowledgedItems: createdItems.length,
          reason: "Qualification incomplete; no fixture cleanup attempted" }));
        return;
      }
      await prisma.$transaction(async tx => {
        if (createdRooms.length) await tx.$queryRaw(Prisma.sql`
          SELECT id FROM "WorkCapsule" WHERE id IN (${Prisma.join(createdRooms)}) ORDER BY id FOR UPDATE`);
        if (createdItems.includes(parentId)) await tx.$queryRaw(Prisma.sql`
          SELECT id FROM "WorkItem" WHERE id = ${parentId} FOR UPDATE`);
        const children = createdItems.filter(id => id !== parentId);
        if (children.length) await tx.$queryRaw(Prisma.sql`
          SELECT id FROM "WorkItem" WHERE id IN (${Prisma.join(children)}) ORDER BY id FOR UPDATE`);
        const items = await tx.workItem.findMany({ where: { id: { in: createdItems } },
          select: { a2aTaskId: true, assignedThreadId: true, assignedToAgentId: true, assignedToUserId: true } });
        const rooms = await tx.workroom.findMany({ where: { id: { in: createdRooms } },
          select: { taskRunId: true, executorRef: true, leaseHolderPrincipalId: true } });
        if (items.some(row => row.a2aTaskId || row.assignedThreadId || row.assignedToAgentId || row.assignedToUserId)
          || rooms.some(row => row.taskRunId || row.executorRef || row.leaseHolderPrincipalId)) {
          throw new Error(`Qualification acquired an executor binding; retain fixture ${prefix} for governed reconciliation`);
        }
        await tx.workItem.deleteMany({ where: { id: { in: createdItems.filter(id => id !== parentId) } } });
        if (createdItems.includes(parentId)) await tx.workItem.delete({ where: { id: parentId } });
        await tx.workroom.deleteMany({ where: { id: { in: createdRooms } } });
        if (createdQueue) await tx.workQueue.delete({ where: { id: queueId } });
      }, { timeout: 60_000 });
      console.info("DPF_INGESTION_SCALE_CLEANUP", JSON.stringify({ prefix, outcome: "owned-fixtures-removed" }));
    } finally { await prisma.$disconnect(); }
  }, 60_000);

  it("preserves bounded SQL pages, sparse turns and durable cursor/output effects at the declared load", async () => {
    const started = Date.now();
    console.info("DPF_INGESTION_SCALE_INTENT", JSON.stringify({ prefix, queueId, parentId,
      rooms: ROOM_COUNT, events: EVENT_COUNT, qualificationOnly: true,
      artifact: "Use the admitted runner's immutable source binding and durable log; no unbound credentials or bare unfenced run" }));
    await prisma.workQueue.create({ data: { id: queueId, name: "Governed scale qualification", queueType: "triage", routingPolicy: {} } });
    createdQueue = true;
    const work = { sourceType: "work-room", queueId, title: "Ingestion qualification fixture",
      description: "Database mechanics only; no native reviewer or provider dispatch", workerConstraint: {}, status: "awaiting-input" };
    await prisma.workItem.create({ data: { ...work, id: parentId } });
    createdItems.push(parentId);
    const roomIds = Array.from({ length: ROOM_COUNT }, (_, index) => `${prefix}-room-${index}`);
    for (let offset = 0; offset < roomIds.length; offset += 250) {
      const ids = roomIds.slice(offset, offset + 250);
      await prisma.workroom.createMany({ data: ids.map((id, index) => ({
        id, capsuleId: `WC-TEST-${prefix}-${offset + index}`, title: "Inert scale source",
        objective: "Retained log qualification", source: "external-adoption", status: "draft",
      })) });
      createdRooms.push(...ids);
    }
    // One noisy source and 9,999 sparse sources: 50,000 + 5*6 + 9,994*5.
    let pending: Array<{ id: string; workCapsuleId: string; kind: string; summary: string }> = [];
    for (let room = 0; room < roomIds.length; room++) {
      const count = room === 0 ? 50_000 : room <= 5 ? 6 : 5;
      for (let event = 0; event < count; event++) {
        pending.push({ id: `${roomIds[room]}-event-${event}`, workCapsuleId: roomIds[room], kind: "test", summary: "Scale evidence" });
        if (pending.length === 500) {
          await prisma.workroomActivity.createMany({ data: pending });
          pending = [];
        }
      }
    }
    expect(pending).toHaveLength(0);
    const windows = await freezeActivityWindows(prisma, roomIds);
    expect(windows).toHaveLength(ROOM_COUNT);
    expect(windows.reduce((sum, row) => sum + Number(row.highWater), 0)).toBe(EVENT_COUNT);
    const expectedRows = new Map<string, SourceRow>();
    const highWaters = new Map(windows.map(row => [row.roomId, BigInt(row.highWater)]));
    for (let offset = 0; offset < roomIds.length; offset += 250) {
      const rows = await prisma.$queryRaw<SourceRow[]>(Prisma.sql`
        SELECT id, "workCapsuleId" AS "roomId", "sequence"::text AS "ingestionSequence"
        FROM "WorkCapsuleActivity" WHERE "workCapsuleId" IN (${Prisma.join(roomIds.slice(offset, offset + 250))})`);
      for (const row of rows) {
        expect(expectedRows.has(row.id)).toBe(false);
        expect(row.ingestionSequence).toMatch(/^[1-9][0-9]*$/);
        expect(BigInt(row.ingestionSequence)).toBeLessThanOrEqual(highWaters.get(row.roomId)!);
        expectedRows.set(row.id, row);
      }
    }
    expect(expectedRows.size).toBe(EVENT_COUNT);
    const seededMs = Date.now() - started;

    // A narrow id-only index probe; this is not the full production reader plan.
    const [explain] = await prisma.$queryRaw<Array<{ "QUERY PLAN": Array<{ Plan: unknown; "Execution Time": number }> }>>(Prisma.sql`
      EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT id FROM "WorkCapsuleActivity" WHERE "workCapsuleId" = ${roomIds[0]}
        AND "sequence" > 0::bigint AND "sequence" <= 50000::bigint ORDER BY "sequence" LIMIT 200`);
    const pagePlan = explain["QUERY PLAN"][0];
    expect(JSON.stringify(pagePlan.Plan)).toMatch(/Index/);

    let checkpoint = createReviewCheckpoint(windows);
    let cycleIndex = 0;
    let input!: Parameters<typeof prismaReviewCommitStore>[0];
    async function openCycle(initial: ReviewCheckpoint) {
      const id = `${prefix}-cycle-${cycleIndex}`;
      const carrierId = `${prefix}-carrier-${cycleIndex}`;
      await prisma.workItem.create({ data: { ...work, id, itemId: carrierId, parentItemId: parentId,
        evidence: { qualificationOnly: true, workroomCycle: { kind: "work-room-cycle", version: 1,
          cycleKey: carrierId, trigger: "review", objective: "Source-window scale qualification",
          accountablePrincipalRef: "agent:qualification-fixture", expectedReviewAt: new Date(started + QUALIFICATION_DEADLINE_MS).toISOString(),
          measureSummary: "No duplicate committed source rows", stopConditions: [], contextRefs: [] } } } });
      createdItems.push(id);
      input = { roomWorkItemId: parentId, carrierId, actor: { type: "agent", id: "qualification-fixture" },
        initialCheckpoint: initial, authorize: async (_tx, cycleId) => {
          if (cycleId !== id) throw new Error("Qualification cycle binding changed");
        } };
      await prismaReviewCommitStore(input).withinCycleLock(tx => tx.loadCheckpoint());
    }
    await openCycle(checkpoint);
    async function savedCheckpoint() {
      const row = await prisma.workItem.findUniqueOrThrow({ where: { itemId: input.carrierId } });
      return (row.evidence as unknown as { workroomReviewIngestion: ReviewCheckpoint }).workroomReviewIngestion;
    }
    let analyzed: readonly IngestedActivity[] = [];
    const analyze = async (rows: readonly IngestedActivity[], coverage: "retention-unverified") => {
      expect(coverage).toBe("retention-unverified");
      expect(rows.length).toBeLessThanOrEqual(200);
      analyzed = rows;
      // This pure observation is NOT a production evaluator, candidate limiter
      // or evidence that the native 20-proposal/30-minute budget is enforced.
      return { qualificationOnly: true, visibleRows: rows.length };
    };
    const seen = new Set<string>();
    const firstTurn = new Map<string, number>();
    let turn = 0;
    let receipts = 0;
    const bindings = new Map<string, BatchBinding>();
    const receiptId = (carrierId: string, batchId: string) =>
      `workroom-review:${JSON.stringify([parentId, carrierId, batchId])}`;
    async function persistedBatches() {
      return prisma.workItemMessage.findMany({ where: { workItemId: parentId },
        select: { workItemId: true, messageId: true, structuredPayload: true } });
    }
    let noisyConsumedAtFirstSweep = 0;
    const lateId = `${prefix}-late`;
    await prisma.workroomActivity.create({ data: { id: lateId, workCapsuleId: roomIds[97], kind: "test",
      summary: "Late arrival with an older event timestamp", recordedAt: new Date(started - 86_400_000) } });

    while (seen.size < EVENT_COUNT) {
      if (Date.now() - started >= QUALIFICATION_DEADLINE_MS) throw new Error("Scale qualification exceeded its experimental deadline");
      if (checkpoint.cycleRows === 1000) {
        expect(await savedCheckpoint()).toEqual(checkpoint);
        console.info("DPF_INGESTION_SCALE_PROGRESS", JSON.stringify({ prefix, carrierId: input.carrierId,
          completedCycles: cycleIndex + 1, lastConfirmedRevision: checkpoint.revision,
          visibleRows: seen.size, elapsedMs: Date.now() - started, coverage: "retention-unverified" }));
        const count = await prisma.workItemMessage.count({ where: { workItemId: parentId } });
        const stopped = await runPrismaReviewIngestionBatch({ ...input, analyze });
        expect(stopped.kind).toBe("budget-exhausted");
        expect(await prisma.workItemMessage.count({ where: { workItemId: parentId } })).toBe(count);
        checkpoint = continueReviewCheckpoint(checkpoint, windows);
        cycleIndex++;
        await openCycle(checkpoint);
      }
      if (turn === 1234) {
        const before = await savedCheckpoint();
        const interruptedId = receiptId(input.carrierId, `revision:${before.revision}`);
        expect(await prisma.workItemMessage.findUnique({ where: { messageId: interruptedId } })).toBeNull();
        const count = await prisma.workItemMessage.count({ where: { workItemId: parentId } });
        const original = prismaReviewCommitStore(input);
        const interrupted: ReviewCommitStore = { withinCycleLock: callback => original.withinCycleLock(tx => callback({ ...tx,
          appendOutput: async output => { await tx.appendOutput(output); throw new Error("Controlled database-transaction interruption"); },
        })) };
        await expect(runReviewIngestionBatch({ store: interrupted,
          reader: page => readActivityWindowPage(prisma, page), analyze })).rejects.toThrow("Controlled database-transaction interruption");
        expect(await savedCheckpoint()).toEqual(before);
        expect(await prisma.workItemMessage.findUnique({ where: { messageId: interruptedId } })).toBeNull();
        expect(await prisma.workItemMessage.count({ where: { workItemId: parentId } })).toBe(count);
        // Reconstruct the store from durable identifiers; no native TaskRun or
        // uncertain provider call is resumed. Full independent restart is AC04.
        input = { ...input, initialCheckpoint: undefined };
        checkpoint = await savedCheckpoint();
      }
      const before = checkpoint;
      const result = await runPrismaReviewIngestionBatch({ ...input, analyze });
      expect(result.kind).toBe("recorded");
      if (result.kind !== "recorded") throw new Error("Source consumption stopped before the frozen window was read");
      expect(result.idempotent).toBe(false);
      const binding = { carrierId: input.carrierId, batchId: `revision:${before.revision}` };
      const expectedMessageId = receiptId(binding.carrierId, binding.batchId);
      expect(result.messageId).toBe(expectedMessageId);
      bindings.set(expectedMessageId, binding);
      checkpoint = result.checkpoint;
      expect(checkpoint.cycleRows).toBeLessThanOrEqual(1000);
      expect(analyzed.length).toBeGreaterThan(0);
      for (const row of analyzed) {
        expect(row.id).not.toBe(lateId);
        expect(seen.has(row.id)).toBe(false);
        seen.add(row.id);
        if (!firstTurn.has(row.roomId)) firstTurn.set(row.roomId, turn);
      }
      receipts++;
      if (firstTurn.size === ROOM_COUNT && noisyConsumedAtFirstSweep === 0) {
        noisyConsumedAtFirstSweep = Number(checkpoint.rooms[0].consumed);
        expect(noisyConsumedAtFirstSweep).toBeLessThanOrEqual(200);
      }
      if (turn === 0) {
        const message = await prisma.workItemMessage.findUniqueOrThrow({ where: { messageId: result.messageId } });
        const payload = message.structuredPayload as Prisma.JsonObject;
        const replay = await commitReviewBatch({ store: prismaReviewCommitStore(input), batchId: `revision:${before.revision}`,
          expected: before, next: checkpoint, output: payload.output });
        expect(replay).toEqual({ messageId: result.messageId, idempotent: true });
        expect(await savedCheckpoint()).toEqual(checkpoint);
      }
      turn++;
    }
    expect(cycleIndex + 1).toBe(100);
    expect(firstTurn.size).toBe(ROOM_COUNT);
    expect(Math.max(...firstTurn.values())).toBeLessThan(ROOM_COUNT);
    expect(checkpoint.rooms.every(room => room.consumed === room.highWater)).toBe(true);
    expect(await savedCheckpoint()).toEqual(checkpoint);
    expect(await prisma.workItemMessage.count({ where: { workItemId: parentId } })).toBe(receipts);
    // Audit the actual stored output, not just what the analyzer observed.
    // The late event must not occur in ANY initial-cycle persisted payload.
    const storedBeforeLate = await persistedBatches();
    verifyPersistedBatches(storedBeforeLate, parentId, expectedRows, bindings);
    // Corrupt a LATER database-read payload copy. Counts/cursors remain intact;
    // this auditor must reject it without mutating stored evidence.
    const laterMessage = structuredClone(storedBeforeLate.find(row => row.messageId !== receiptId(`${prefix}-carrier-0`, "revision:0"))!);
    const laterPayload = laterMessage.structuredPayload as unknown as { output: { sourceRows: SourceRow[] } };
    laterPayload.output.sourceRows = [];
    expect(() => verifyPersistedBatches(storedBeforeLate.map(row => row.messageId === laterMessage.messageId ? laterMessage : row),
      parentId, expectedRows, bindings)).toThrow();
    const complete = await runPrismaReviewIngestionBatch({ ...input, analyze });
    expect(complete).toMatchObject({ kind: "complete", coverage: "retention-unverified" });

    const nextWindows = await freezeActivityWindows(prisma, roomIds);
    checkpoint = continueReviewCheckpoint(checkpoint, nextWindows);
    cycleIndex++;
    await openCycle(checkpoint);
    const beforeLate = checkpoint;
    const late = await runPrismaReviewIngestionBatch({ ...input, analyze });
    expect(late.kind).toBe("recorded");
    if (late.kind !== "recorded") throw new Error("Late event was not persisted");
    const lateBinding = { carrierId: input.carrierId, batchId: `revision:${beforeLate.revision}` };
    expect(late.messageId).toBe(receiptId(lateBinding.carrierId, lateBinding.batchId));
    bindings.set(late.messageId, lateBinding);
    expect(analyzed.map(row => row.id)).toEqual([lateId]);
    const done = await runPrismaReviewIngestionBatch({ ...input, analyze });
    expect(done).toMatchObject({ kind: "complete", coverage: "retention-unverified" });
    expect(await prisma.workItemMessage.count({ where: { workItemId: parentId } })).toBe(receipts + 1);
    expect(await savedCheckpoint()).toEqual(late.checkpoint);
    expectedRows.set(lateId, { id: lateId, roomId: roomIds[97],
      ingestionSequence: String(highWaters.get(roomIds[97])! + 1n) });
    verifyPersistedBatches(await persistedBatches(), parentId, expectedRows, bindings);
    assertionsCompleted = true;
    console.info("DPF_INGESTION_SCALE_OBSERVATION", JSON.stringify({ qualificationOnly: true,
      rooms: ROOM_COUNT, visibleEvents: seen.size, laterEvents: 1, cycles: 100, batches: receipts,
      noisyConsumedAtFirstSweep, maximumFirstTurn: Math.max(...firstTurn.values()), seededMs,
      elapsedMs: Date.now() - started, idOnlyIndexedProbeMs: pagePlan["Execution Time"],
      coverage: "retention-unverified", productionCandidateBudget: "not-exercised", productionAnalysisBudget: "not-exercised",
      nativeScheduling: "not-exercised", independentExecutorReviewerReplacement: "not-exercised" }));
  }, QUALIFICATION_DEADLINE_MS);
});
