import { createHash } from "node:crypto";
import { stableStringify } from "../governance/reconcile-keyed-findings";
import { hasOversizedString } from "../evidence/bounded-evidence-output";

export interface ReviewCheckpoint {
  version: 1;
  revision: number;
  nextRoom: number;
  cycleRows: number;
  rooms: Array<{ roomId: string; highWater: string; consumed: string }>;
}
export interface ReviewRow { id: string; roomId: string; ingestionSequence: string }
export type ReviewPageReader<T extends ReviewRow> = (input: {
  roomId: string; after: string; highWater: string; take: number;
}) => Promise<{rows: T[]; coverage: "retention-unverified"}>;

export interface ReviewCommitTx {
  loadCheckpoint(): Promise<ReviewCheckpoint>;
  findReceipt(batchId: string): Promise<{fingerprint: string; messageId: string} | null>;
  saveCheckpoint(checkpoint: ReviewCheckpoint): Promise<void>;
  appendOutput(input: {batchId: string; fingerprint: string; output: unknown}): Promise<string>;
}
export interface ReviewCommitStore {
  // The adapter resolves and authorizes the existing room/cycle binding inside
  // this transaction; it must roll back both writes when either one fails.
  withinCycleLock<T>(callback: (tx: ReviewCommitTx) => Promise<T>): Promise<T>;
}
export async function commitReviewBatch(input: {store: ReviewCommitStore; batchId: string;
  expected: ReviewCheckpoint; next: ReviewCheckpoint; output: unknown}) {
  validateReviewCheckpoint(input.expected);
  validateReviewCheckpoint(input.next);
  if (!input.batchId || input.batchId.length > 256) throw new Error("Invalid review batch identity");
  if (input.next.revision !== input.expected.revision + 1) throw new Error("Invalid review revision");
  if (input.next.cycleRows < input.expected.cycleRows) throw new Error("Review cycle budget moved backwards");
  if (input.expected.rooms.length !== input.next.rooms.length || input.expected.rooms.some((room, i) => {
    const next = input.next.rooms[i];
    return room.roomId !== next.roomId || room.highWater !== next.highWater || position(next.consumed) < position(room.consumed);
  })) throw new Error("Review frozen boundary changed");
  // Fingerprint the exact server-produced request. This is an idempotency
  // identity, not a semantic review receipt or an acceptance verdict.
  if (input.output === undefined) throw new Error("Review output is missing");
  if (hasOversizedString(input.output)) throw new Error("Review output must reference offloaded evidence");
  // Snapshot before awaiting the parent lock. Persist exactly the bytes whose
  // identity was computed, even if a caller reuses its objects while waiting.
  const request = JSON.parse(JSON.stringify({expected: input.expected, next: input.next,
    output: input.output})) as {expected: ReviewCheckpoint; next: ReviewCheckpoint; output: unknown};
  const batchId = input.batchId;
  const serialized = stableStringify(request);
  const fingerprint = createHash("sha256").update(serialized).digest("hex");
  return input.store.withinCycleLock(async tx => {
    const existing = await tx.findReceipt(batchId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new Error("Review batch identity was reused with changed output");
      return {messageId: existing.messageId, idempotent: true};
    }
    const current = await tx.loadCheckpoint();
    validateReviewCheckpoint(current);
    if (stableStringify(current) !== stableStringify(request.expected)) throw new Error("Stale review checkpoint revision");
    await tx.saveCheckpoint(request.next);
    const messageId = await tx.appendOutput({batchId, fingerprint, output: request.output});
    return {messageId, idempotent: false};
  });
}

function position(value: string): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,18})$/.test(value)
    || BigInt(value) > 9223372036854775807n) throw new Error("Invalid review position");
  return BigInt(value);
}

export function validateReviewCheckpoint(checkpoint: ReviewCheckpoint): void {
  if (checkpoint.version !== 1 || !Number.isSafeInteger(checkpoint.revision) || checkpoint.revision < 0
    || checkpoint.revision >= Number.MAX_SAFE_INTEGER || !Array.isArray(checkpoint.rooms)
    || checkpoint.rooms.length > 10000 || !Number.isSafeInteger(checkpoint.nextRoom)
    || !Number.isSafeInteger(checkpoint.cycleRows) || checkpoint.cycleRows < 0 || checkpoint.cycleRows > 1000
    || checkpoint.nextRoom < 0 || checkpoint.nextRoom >= Math.max(1, checkpoint.rooms.length)) {
    throw new Error("Invalid review checkpoint");
  }
  const seen = new Set<string>();
  for (const room of checkpoint.rooms) {
    if (typeof room.roomId !== "string" || !room.roomId || room.roomId.length > 256 || seen.has(room.roomId)) {
      throw new Error("Invalid review room");
    }
    seen.add(room.roomId);
    if (position(room.consumed) > position(room.highWater)) throw new Error("Review cursor exceeds boundary");
  }
}

export function createReviewCheckpoint(windows: Array<{roomId: string; highWater: string}>): ReviewCheckpoint {
  const checkpoint: ReviewCheckpoint = {version: 1, revision: 0, nextRoom: 0, cycleRows: 0,
    rooms: windows.map(room => ({...room, consumed: "0"}))};
  validateReviewCheckpoint(checkpoint);
  return checkpoint;
}

// A new, separately governed cycle inherits consumed positions, not the prior
// cycle's budget. Removed rooms require an explicit exclusion elsewhere; this
// helper refuses to silently discard their unresolved source progress.
export function continueReviewCheckpoint(previous: ReviewCheckpoint, windows: Array<{roomId: string; highWater: string}>): ReviewCheckpoint {
  validateReviewCheckpoint(previous);
  const next = createReviewCheckpoint(windows);
  const byId = new Map(next.rooms.map(room => [room.roomId, room]));
  for (const old of previous.rooms) {
    const room = byId.get(old.roomId);
    if (!room || position(room.highWater) < position(old.highWater)) throw new Error("Review continuation lost a source boundary");
    room.consumed = old.consumed;
  }
  const nextRoomId = previous.rooms[previous.nextRoom]?.roomId;
  next.nextRoom = Math.max(0, next.rooms.findIndex(room => room.roomId === nextRoomId));
  return next;
}

// One bounded page per turn keeps a noisy source from monopolizing the cycle.
// Rotation is persisted with output, so replacement continues the same turn.
// Empty retained pages leave their consumed position unchanged: deleted rows
// and allocation gaps cannot establish reviewed coverage.
export async function readReviewBatch<T extends ReviewRow>(checkpoint: ReviewCheckpoint, reader: ReviewPageReader<T>) {
  validateReviewCheckpoint(checkpoint);
  const next: ReviewCheckpoint = {...checkpoint, rooms: checkpoint.rooms.map(room => ({...room}))};
  let rows: T[] = [];
  if (next.cycleRows === 1000) return {rows, checkpoint: next, remaining: next.rooms.some(room => room.consumed !== room.highWater),
    coverage: "retention-unverified" as const, budgetExhausted: true};
  for (let offset = 0; offset < next.rooms.length; offset++) {
    const index = (checkpoint.nextRoom + offset) % next.rooms.length;
    const room = next.rooms[index];
    if (room.consumed === room.highWater) continue;
    const take = Math.min(200, 1000 - next.cycleRows);
    const page = await reader({roomId: room.roomId, after: room.consumed, highWater: room.highWater, take});
    if (page.rows.length > take) throw new Error("Invalid review page size");
    let previous = position(room.consumed);
    const ids = new Set<string>();
    for (const row of page.rows) {
      const current = position(row.ingestionSequence);
      if (!row.id || ids.has(row.id) || row.roomId !== room.roomId || current <= previous || current > position(room.highWater)) {
        throw new Error("Invalid review page boundary");
      }
      ids.add(row.id);
      previous = current;
    }
    rows = page.rows;
    next.cycleRows += rows.length;
    if (rows.length) room.consumed = rows[rows.length - 1].ingestionSequence;
    next.nextRoom = (index + 1) % next.rooms.length;
    break;
  }
  next.revision++;
  return {rows, checkpoint: next, remaining: next.rooms.some(room => room.consumed !== room.highWater),
    coverage: "retention-unverified" as const, budgetExhausted: next.cycleRows === 1000};
}

// Persist initialization before source reads or analysis. The reader runs
// outside the WorkItem lock; the second transaction fences a concurrent
// replacement and writes output plus consumed positions together.
export async function runReviewIngestionBatch<T extends ReviewRow>(input: {
  store: ReviewCommitStore; reader: ReviewPageReader<T>;
  analyze: (rows: readonly T[], coverage: "retention-unverified") => Promise<unknown>;
}) {
  const expected = await input.store.withinCycleLock(tx => tx.loadCheckpoint());
  validateReviewCheckpoint(expected);
  if (expected.rooms.every(room => room.consumed === room.highWater)) {
    return {kind: "complete" as const, checkpoint: expected, coverage: "retention-unverified" as const};
  }
  const batch = await readReviewBatch(expected, input.reader);
  if (batch.budgetExhausted && batch.rows.length === 0) return {kind: "budget-exhausted" as const, checkpoint: expected};
  const sourceRows = batch.rows.map(row => ({
    id: row.id, roomId: row.roomId, ingestionSequence: row.ingestionSequence,
  }));
  const output = await input.analyze(batch.rows, batch.coverage);
  const receipt = await commitReviewBatch({store: input.store, batchId: `revision:${expected.revision}`,
    expected, next: batch.checkpoint, output: {result: output, sourceRows,
      coverage: batch.coverage, remaining: batch.remaining}});
  return {kind: "recorded" as const, ...receipt, checkpoint: batch.checkpoint, remaining: batch.remaining};
}
