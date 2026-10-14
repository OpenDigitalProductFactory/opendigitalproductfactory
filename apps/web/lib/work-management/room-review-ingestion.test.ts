import { describe, expect, it, vi } from "vitest";
const database = vi.hoisted(() => ({$transaction: vi.fn()}));
vi.mock("@dpf/db", () => ({prisma: database, Prisma: {sql: vi.fn()}}));
import { prismaReviewCommitStore } from "./room-review-ingestion-prisma.server";
import { commitReviewBatch, continueReviewCheckpoint, createReviewCheckpoint, readReviewBatch, runReviewIngestionBatch, type ReviewCheckpoint, type ReviewCommitStore } from "./room-review-ingestion";

function storeFixture(failOutput = false) {
  let checkpoint = createReviewCheckpoint([{roomId: "a", highWater: "10"}]);
  const receipts = new Map<string, {fingerprint: string; messageId: string}>();
  const store: ReviewCommitStore = {withinCycleLock: async callback => {
    let staged = structuredClone(checkpoint);
    const pending = new Map(receipts);
    const result = await callback({loadCheckpoint: async () => staged,
      findReceipt: async id => pending.get(id) ?? null,
      saveCheckpoint: async next => {staged = next;},
      appendOutput: async input => {
        if (failOutput) throw new Error("output failed");
        pending.set(input.batchId, {fingerprint: input.fingerprint, messageId: "message"});
        return "message";
      }});
    checkpoint = staged;
    pending.forEach((value, key) => receipts.set(key, value));
    return result;
  }};
  const expected = structuredClone(checkpoint);
  const next: ReviewCheckpoint = {...expected, revision: 1, rooms: [{...expected.rooms[0], consumed: "1"}]};
  return {store, expected, next, checkpoint: () => checkpoint, receipts};
}

describe("existing cycle transaction adapter", () => {
  function fixture(parentExists = true) {
    const evidence = {otherEvidence: {keep: true}, workroomCycle: {kind: "work-room-cycle", version: 1,
      cycleKey: "cycle", trigger: "review", objective: "review", accountablePrincipalRef: "agent:reviewer",
      expectedReviewAt: "2026-10-13T00:00:00Z", measureSummary: "coverage", stopConditions: [], contextRefs: []}};
    const tx = {$queryRaw: vi.fn(async () => parentExists ? [{id: "parent"}] : []),
      workItem: {findFirst: vi.fn(async () => ({id: "cycle-id", evidence})), update: vi.fn(async (_input: {data: {evidence: {otherEvidence?: unknown}}}) => {})},
      workItemMessage: {findUnique: vi.fn(async () => null), create: vi.fn(async (_input: {data: {workItemId: string}}) => ({messageId: "message"}))}};
    database.$transaction.mockImplementation(async callback => callback(tx));
    const authorize = vi.fn(async () => {});
    const checkpoint = createReviewCheckpoint([{roomId: "a", highWater: "1"}]);
    const store = prismaReviewCommitStore({roomWorkItemId: "parent", carrierId: "carrier",
      actor: {type: "agent", id: "reviewer"}, initialCheckpoint: checkpoint, authorize});
    return {tx, store, authorize, checkpoint};
  }
  it("locks the existing parent before authorization and preserves unrelated cycle evidence", async () => {
    const f = fixture();
    await f.store.withinCycleLock(async tx => {
      expect(await tx.loadCheckpoint()).toEqual(f.checkpoint);
      await tx.saveCheckpoint(f.checkpoint);
      await tx.appendOutput({batchId: "batch", fingerprint: "fingerprint", output: {finding: "one"}});
    });
    expect(f.tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(f.authorize.mock.invocationCallOrder[0]);
    expect(f.tx.workItem.update.mock.calls[0][0].data.evidence.otherEvidence).toEqual({keep: true});
    expect(f.tx.workItemMessage.create.mock.calls[0][0].data.workItemId).toBe("parent");
  });
  it("refuses missing durable parent binding before writes", async () => {
    const f = fixture(false);
    await expect(f.store.withinCycleLock(async tx => tx.saveCheckpoint(f.checkpoint))).rejects.toThrow("binding");
    expect(f.tx.workItem.update).not.toHaveBeenCalled();
    expect(f.authorize).not.toHaveBeenCalled();
  });
  it("honors the calling handler's authorization refusal", async () => {
    const f = fixture();
    f.authorize.mockRejectedValue(new Error("policy denied"));
    await expect(f.store.withinCycleLock(async tx => tx.saveCheckpoint(f.checkpoint))).rejects.toThrow("policy denied");
    expect(f.tx.workItem.update).not.toHaveBeenCalled();
    expect(f.tx.workItemMessage.create).not.toHaveBeenCalled();
  });
});

describe("atomic review output and checkpoint", () => {
  it("persists the fingerprinted request when caller objects change while awaiting the parent lock", async () => {
    const f = storeFixture();
    const output = {finding: "Original result"};
    let recorded: unknown;
    const store: ReviewCommitStore = {withinCycleLock: callback => {
      output.finding = "Changed while waiting";
      f.next.rooms[0].consumed = "2";
      return f.store.withinCycleLock(tx => callback({...tx, appendOutput: async input => {
        recorded = structuredClone(input.output);
        return tx.appendOutput(input);
      }}));
    }};
    await commitReviewBatch({...f, store, batchId: "batch", output});
    expect(recorded).toEqual({finding: "Original result"});
    expect(f.checkpoint().rooms[0].consumed).toBe("1");
  });

  it("does not analyze or publish again after every frozen input was consumed", async () => {
    const expected = createReviewCheckpoint([{roomId: "a", highWater: "0"}]);
    const findReceipt = vi.fn();
    const saveCheckpoint = vi.fn();
    const appendOutput = vi.fn();
    const store: ReviewCommitStore = {withinCycleLock: callback => callback({
      loadCheckpoint: async () => expected, findReceipt, saveCheckpoint, appendOutput,
    })};
    const reader = vi.fn();
    const analyze = vi.fn(async () => ({finding: "Must not fabricate another batch"}));
    const result = await runReviewIngestionBatch({store, reader, analyze});
    expect(result.kind).toBe("complete");
    expect(analyze).not.toHaveBeenCalled();
    expect(reader).not.toHaveBeenCalled();
    expect(saveCheckpoint).not.toHaveBeenCalled();
    expect(appendOutput).not.toHaveBeenCalled();
  });

  it("requires offloaded references for oversized evidence instead of copying it inline", async () => {
    const f = storeFixture();
    await expect(commitReviewBatch({...f, batchId: "large", output: {log: "x".repeat(65537)}})).rejects.toThrow("offloaded");
    expect(f.checkpoint()).toEqual(f.expected);
    expect(f.receipts.size).toBe(0);
  });
  it("accepts the same persisted JSON checkpoint when PostgreSQL reorders object keys", async () => {
    const f = storeFixture();
    const reordered = {rooms: f.expected.rooms.map(room => ({consumed: room.consumed, highWater: room.highWater, roomId: room.roomId})),
      cycleRows: 0, nextRoom: 0, revision: 0, version: 1 as const};
    const store: ReviewCommitStore = {withinCycleLock: callback => f.store.withinCycleLock(tx => callback({...tx, loadCheckpoint: async () => reordered}))};
    const result = await commitReviewBatch({...f, store, batchId: "batch", output: {finding: "one"}});
    expect(result.messageId).toBe("message");
  });
  it("reads and analyzes between checkpoint initialization and atomic output commit", async () => {
    const f = storeFixture();
    const reader = vi.fn(async () => ({rows: [{id: "event", roomId: "a", ingestionSequence: "1"}], coverage: "retention-unverified" as const}));
    const analyze = vi.fn(async () => ({finding: "one"}));
    const result = await runReviewIngestionBatch({store: f.store, reader, analyze});
    expect(result.kind).toBe("recorded");
    expect(f.checkpoint().rooms[0].consumed).toBe("1");
    expect(f.receipts.size).toBe(1);
    expect(analyze).toHaveBeenCalledWith([{id: "event", roomId: "a", ingestionSequence: "1"}], "retention-unverified");
  });
  it("preserves progress when analysis fails before publication", async () => {
    const f = storeFixture();
    await expect(runReviewIngestionBatch({store: f.store,
      reader: async () => ({rows: [{id: "event", roomId: "a", ingestionSequence: "1"}], coverage: "retention-unverified"}),
      analyze: async () => {throw new Error("reviewer stopped");}})).rejects.toThrow("reviewer stopped");
    expect(f.checkpoint()).toEqual(f.expected);
    expect(f.receipts.size).toBe(0);
  });
  it("does not advance progress when output fails", async () => {
    const f = storeFixture(true);
    await expect(commitReviewBatch({...f, batchId: "batch", output: {finding: "one"}})).rejects.toThrow("output failed");
    expect(f.checkpoint()).toEqual(f.expected);
    expect(f.receipts.size).toBe(0);
  });
  it("returns the original output identity on exact replay", async () => {
    const f = storeFixture();
    const input = {...f, batchId: "batch", output: {finding: "one"}};
    const first = await commitReviewBatch(input);
    const replay = await commitReviewBatch(input);
    expect(first.messageId).toBe(replay.messageId);
    expect(replay.idempotent).toBe(true);
    expect(f.checkpoint().revision).toBe(1);
    expect(f.receipts.size).toBe(1);
    await expect(commitReviewBatch({...input, output: {finding: "changed"}})).rejects.toThrow("identity");
  });
  it("refuses stale replacement revisions and changed frozen boundaries", async () => {
    const f = storeFixture();
    await commitReviewBatch({...f, batchId: "first", output: {}});
    await expect(commitReviewBatch({...f, batchId: "stale", output: {}})).rejects.toThrow("revision");
    const g = storeFixture();
    const changed = {...g.next, rooms: [{...g.next.rooms[0], highWater: "11"}]};
    await expect(commitReviewBatch({...g, next: changed, batchId: "changed", output: {}})).rejects.toThrow("boundary");
  });
});

describe("review ingestion continuation", () => {
  it("resumes synthetic 10000-room/100000-event input across bounded cycles without duplicate consumption", async () => {
    const windows = Array.from({length: 10000}, (_, i) => ({roomId: `room-${i}`, highWater: "10"}));
    let checkpoint = createReviewCheckpoint(windows);
    let events = 0;
    let cycles = 1;
    const seen = new Set<string>();
    const reader = async ({roomId, after, take}: {roomId: string; after: string; take: number}) => ({
      rows: Array.from({length: Math.min(take, 10 - Number(after))}, (_, i) => ({
        id: `${roomId}:${Number(after) + i + 1}`, roomId, ingestionSequence: String(Number(after) + i + 1),
      })), coverage: "retention-unverified" as const,
    });
    for (let turn = 0; turn < 10000; turn++) {
      if (checkpoint.cycleRows === 1000) {checkpoint = continueReviewCheckpoint(checkpoint, windows); cycles++;}
      const batch = await readReviewBatch(checkpoint, reader);
      for (const row of batch.rows) {
        expect(seen.has(row.id)).toBe(false);
        seen.add(row.id);
      }
      events += batch.rows.length;
      checkpoint = batch.checkpoint;
      // Simulate replacement from durable JSON at each cycle boundary.
      if (checkpoint.cycleRows === 1000) checkpoint = JSON.parse(JSON.stringify(checkpoint));
    }
    expect(events).toBe(100000);
    expect(seen.size).toBe(100000);
    expect(cycles).toBe(100);
    expect(checkpoint.rooms.every(room => room.consumed === "10")).toBe(true);
  }, 60000);
  it("carries consumed positions and rotation into a later cycle with newer highwater", () => {
    const checkpoint = createReviewCheckpoint([{roomId: "a", highWater: "20"}, {roomId: "b", highWater: "10"}]);
    checkpoint.rooms[0].consumed = "5";
    checkpoint.nextRoom = 1;
    checkpoint.cycleRows = 1000;
    const next = continueReviewCheckpoint(checkpoint, [{roomId: "a", highWater: "25"}, {roomId: "b", highWater: "10"}]);
    expect(next.rooms[0]).toEqual({roomId: "a", highWater: "25", consumed: "5"});
    expect(next.nextRoom).toBe(1);
    expect(next.cycleRows).toBe(0);
    expect(() => continueReviewCheckpoint(checkpoint, [{roomId: "a", highWater: "25"}])).toThrow("boundary");
  });
  it("stops at 1000 cycle rows and leaves unseen positions available", async () => {
    const checkpoint = createReviewCheckpoint([{roomId: "a", highWater: "100000"}]);
    checkpoint.cycleRows = 995;
    const reader = vi.fn(async ({roomId, after, take}) => ({rows: Array.from({length: take}, (_, i) => ({id: String(i), roomId, ingestionSequence: String(BigInt(after) + BigInt(i + 1))})), coverage: "retention-unverified" as const}));
    const result = await readReviewBatch(checkpoint, reader);
    expect(result.rows).toHaveLength(5);
    expect(result.budgetExhausted).toBe(true);
    expect(result.checkpoint.rooms[0].consumed).toBe("5");
    const stopped = await readReviewBatch(result.checkpoint, reader);
    expect(reader).toHaveBeenCalledTimes(1);
    expect(stopped.checkpoint).toEqual(result.checkpoint);
    expect(stopped.remaining).toBe(true);
  });
  it("freezes exact positions without exposing BigInt in JSON", () => {
    const checkpoint = createReviewCheckpoint([{ roomId: "a", highWater: "9007199254740993" }]);
    expect(checkpoint.rooms[0]).toEqual({ roomId: "a", highWater: "9007199254740993", consumed: "0" });
    expect(() => JSON.stringify(checkpoint)).not.toThrow();
  });
  it("gives a sparse room its turn after a noisy room", async () => {
    const checkpoint = createReviewCheckpoint([{ roomId: "a", highWater: "1000" }, { roomId: "b", highWater: "1" }]);
    const reader = vi.fn(async ({roomId, after, take}) => ({ rows: Array.from({length: roomId === "a" ? take : 1}, (_, i) => ({id: `${roomId}-${i}`, roomId, ingestionSequence: String(BigInt(after) + BigInt(i + 1))})), coverage: "retention-unverified" as const }));
    const first = await readReviewBatch(checkpoint, reader);
    expect(first.rows).toHaveLength(200);
    expect(first.checkpoint.nextRoom).toBe(1);
    expect(checkpoint.rooms[0].consumed).toBe("0");
    const second = await readReviewBatch(first.checkpoint, reader);
    expect(second.rows[0].roomId).toBe("b");
    expect(second.checkpoint.rooms[1].consumed).toBe("1");
  });
  it("retains the boundary and marks an empty retained page as unknown coverage", async () => {
    const checkpoint = createReviewCheckpoint([{roomId: "a", highWater: "10"}]);
    const result = await readReviewBatch(checkpoint, async () => ({rows: [], coverage: "retention-unverified"}));
    expect(result.coverage).toBe("retention-unverified");
    expect(result.checkpoint.rooms[0]).toEqual({roomId: "a", highWater: "10", consumed: "0"});
    expect(result.remaining).toBe(true);
  });
  it("rejects source rows outside their room or frozen boundary", async () => {
    const checkpoint = createReviewCheckpoint([{roomId: "a", highWater: "10"}]);
    await expect(readReviewBatch(checkpoint, async () => ({rows: [{id: "bad", roomId: "b", ingestionSequence: "11"}], coverage: "retention-unverified"}))).rejects.toThrow("page");
  });
  it("bounds a 10000-room continuation to one page and preserves unseen rooms", async () => {
    const checkpoint = createReviewCheckpoint(Array.from({length: 10000}, (_, i) => ({roomId: `room-${i}`, highWater: "10"})));
    const reader = vi.fn(async ({roomId}) => ({rows: [{id: "one", roomId, ingestionSequence: "1"}], coverage: "retention-unverified" as const}));
    const result = await readReviewBatch(checkpoint, reader);
    expect(reader).toHaveBeenCalledTimes(1);
    expect(result.checkpoint.rooms[9999].consumed).toBe("0");
    expect(result.checkpoint.nextRoom).toBe(1);
  });
  it.each(["01", "-1", "9223372036854775808"])("rejects malformed frozen position %s", highWater => {
    expect(() => createReviewCheckpoint([{roomId: "a", highWater}])).toThrow();
  });
});
