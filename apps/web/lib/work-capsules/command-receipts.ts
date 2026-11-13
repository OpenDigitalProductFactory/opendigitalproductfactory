// Workroom command receipts (BI-763D6E01, design
// docs/superpowers/specs/2026-10-07-durable-delegation-ledger-design.md §4.3).
//
// A command carries an id. The first time it runs, its result (or its typed
// refusal) is stored against (authorityScopeKey, commandId); a retry with the
// same id gets the stored answer and changes nothing. Reusing an id for a
// different command or target is refused. Modelled on T3 Code Orchestration
// V2's CommandReceiptStore and on Stripe idempotent requests, on DPF's own
// substrate: the receipt is a row in the room's WorkroomActivity log, committed
// in the same transaction as the command under the room's row lock, so two
// commands on one room run one after the other.

import { createHash } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";

export type CommandPayloadBinding = { version: 1; digest: string };

/** Bind an already validated, complete normalized command, before receipt lookup. */
export function commandPayloadBinding(payload: unknown): CommandPayloadBinding {
  return { version: 1, digest: createHash("sha256").update(canonicalJson(payload)).digest("hex") };
}

export class CommandReceiptUnavailableError extends Error {
  readonly code = "command_receipt_unavailable";
}

export type CommandTarget = { kind: string; id: string };

export type CommandRejection = { code: string; message: string; data?: Record<string, unknown> };

/** A command id was reused for a different command or target. */
export class CommandIdConflictError extends Error {
  readonly code = "command_id_conflict";
  constructor(readonly commandId: string, readonly recorded: { commandType: string; target: CommandTarget }) {
    super(
      `Command id ${commandId} was already used for ${recorded.commandType} on ${recorded.target.kind} ${recorded.target.id}. `
        + "Use a new command id for a different command.",
    );
    this.name = "CommandIdConflictError";
  }
}

/** The stored refusal of an earlier attempt with the same command id. */
export class ReplayedCommandRejection extends Error {
  constructor(readonly rejection: CommandRejection) {
    super(rejection.message);
    this.name = "ReplayedCommandRejection";
  }
  get code(): string {
    return this.rejection.code;
  }
}

type ReceiptRow = { kind: string; payload: unknown };

type ReceiptPayload = {
  commandType: string;
  target: CommandTarget;
  payloadBinding?: CommandPayloadBinding;
  result?: unknown;
  rejection?: CommandRejection;
};

export type ReceiptDb = {
  workroomActivity: {
    findFirst?(args: unknown): Promise<ReceiptRow | null>;
    create(args: unknown): Promise<unknown>;
  };
  $queryRaw?(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
  $executeRaw?(strings: TemplateStringsArray, ...values: unknown[]): Promise<number>;
  $transaction?<T>(fn: (tx: ReceiptDb) => Promise<T>, options?: { timeout?: number; maxWait?: number; isolationLevel?: "ReadCommitted" }): Promise<T>;
};

// A receipted command runs its tool's whole write inside this transaction, so it
// gets more than Prisma's 5 s default; the room's row lock bounds the wait.
const TRANSACTION_OPTIONS = { timeout: 30_000, maxWait: 10_000 };

export const COMMAND_ACCEPTED = "command-accepted";
export const COMMAND_REJECTED = "command-rejected";

async function inTransaction<T>(db: ReceiptDb, fn: (tx: ReceiptDb) => Promise<T>, bound = false): Promise<T> {
  if (bound && !db.$transaction) throw new CommandReceiptUnavailableError("Bound commands require a real receipt transaction.");
  return db.$transaction ? db.$transaction(fn, bound
    ? { ...TRANSACTION_OPTIONS, isolationLevel: "ReadCommitted" } : TRANSACTION_OPTIONS) : fn(db);
}

/** Results are stored as JSON, so both the first caller and a retry get the JSON form. */
function asStored<T>(value: T): T {
  return value === undefined ? (null as T) : (JSON.parse(JSON.stringify(value)) as T);
}

async function readReceipt(tx: ReceiptDb, commandScopeKey: string, commandId: string): Promise<ReceiptRow | null> {
  return (await tx.workroomActivity.findFirst?.({
    where: { commandScopeKey, commandKey: commandId },
    select: { kind: true, payload: true },
  })) ?? null;
}

function replay<T>(row: ReceiptRow, commandId: string, commandType: string, target: CommandTarget, binding?: CommandPayloadBinding): T {
  const recorded = row.payload as ReceiptPayload;
  if (recorded.commandType !== commandType || recorded.target?.kind !== target.kind || recorded.target?.id !== target.id
    || (binding ? (recorded.payloadBinding?.version !== binding.version || recorded.payloadBinding.digest !== binding.digest) : recorded.payloadBinding !== undefined)) {
    throw new CommandIdConflictError(commandId, { commandType: recorded.commandType, target: recorded.target });
  }
  if (row.kind === COMMAND_REJECTED) throw new ReplayedCommandRejection(recorded.rejection as CommandRejection);
  return recorded.result as T;
}

/**
 * Lock the room's row for the transaction and return its row id, or null when
 * no such room exists (the command then runs unreceipted and reports that
 * itself). Isolated tests pass a db without `$queryRaw`.
 */
async function lockRoom(tx: ReceiptDb, capsuleId: string): Promise<string | null> {
  if (!tx.$queryRaw) return `row:${capsuleId}`;
  const rows = (await tx.$queryRaw`SELECT "id" FROM "WorkCapsule" WHERE "capsuleId" = ${capsuleId} FOR UPDATE`) as Array<{ id: string }>;
  return rows[0]?.id ?? null;
}

type CommandReceiptIdentity = {
  authorityScopeKey: string; commandId: string; commandType: string; target: CommandTarget;
  payloadBinding?: CommandPayloadBinding; expectedRoomRowId?: string;
  beforeRoomLock?: (tx: ReceiptDb) => Promise<void>;
};

/** Shared serialization for lookup, effect and rejected-outcome publication. */
async function lockCommandPrefix(tx: ReceiptDb, args: CommandReceiptIdentity, bound: boolean): Promise<string | null> {
    if (bound && (!tx.$queryRaw || !tx.$executeRaw || !tx.workroomActivity.findFirst)) {
      throw new CommandReceiptUnavailableError("Bound commands require command and room locks and receipt reads.");
    }
    if (tx.$queryRaw) {
      if (!tx.$executeRaw) throw new Error("Command receipt locking requires $executeRaw");
      // Bound waits and statements must stop within the transaction budget.
      if (bound) await tx.$executeRaw`SELECT set_config('lock_timeout', '10000ms', true), set_config('statement_timeout', '30000ms', true)`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`command:${args.authorityScopeKey}:${args.commandId}`}, 0))`;
    }
    await args.beforeRoomLock?.(tx);
    const rowId = await lockRoom(tx, args.target.id);
    if (bound && !rowId) throw new CommandReceiptUnavailableError("The bound command's Workroom could not be locked.");
    if (args.expectedRoomRowId !== undefined && rowId !== args.expectedRoomRowId) {
      throw new CommandReceiptUnavailableError("The original persistent Workroom no longer matches this command.");
    }
    return rowId;
}

/**
 * Run `run` once per (authorityScopeKey, commandId) on one Workroom. The receipt
 * is a row in that room's own log (WorkroomActivity), not a parallel ledger.
 *
 * - accepted: the result is stored in the command's own transaction, so the
 *   effect and its receipt commit or roll back together;
 * - refused: when `rejectionOf` names the error a refusal, it is stored in a
 *   short transaction of its own (the command's was rolled back) and rethrown;
 *   any other error leaves no receipt, so a retry runs again;
 * - command identity, optional server dependency locks, then the room row serialize
 *   the attempt; bound rejection publication uses that same prefix after rollback.
 */
export async function runReceiptedCommand<T>(args: {
  db: ReceiptDb;
  authorityScopeKey: string;
  commandId: string;
  commandType: string;
  target: CommandTarget;
  actor?: { userId: string | null; agentId: string | null };
  payloadBinding?: CommandPayloadBinding;
  /** Supplied by an exact original-target command, never inferred from current state. */
  expectedRoomRowId?: string;
  /** Server-owned DB-only dependency locks, before the Workroom row. */
  beforeRoomLock?: (tx: ReceiptDb) => Promise<void>;
  run: (tx: ReceiptDb) => Promise<T>;
  rejectionOf?: (error: unknown) => CommandRejection | null;
}): Promise<T> {
  const scope = args.authorityScopeKey;
  const binding = args.payloadBinding;
  const bound = binding !== undefined;
  if (binding && (binding.version !== 1 || !/^[a-f0-9]{64}$/.test(binding.digest))) {
    throw new CommandReceiptUnavailableError("Invalid versioned command payload binding.");
  }
  const payload = (fields: Pick<ReceiptPayload, "result" | "rejection">): ReceiptPayload => ({
    commandType: args.commandType, target: args.target, ...(binding ? { payloadBinding: binding } : {}), ...fields,
  });
  const lockPrefix = (tx: ReceiptDb) => lockCommandPrefix(tx, args, bound);
  const write = (tx: ReceiptDb, workCapsuleId: string, accepted: boolean, payload: ReceiptPayload) =>
    tx.workroomActivity.create({
      data: {
        workCapsuleId,
        kind: accepted ? COMMAND_ACCEPTED : COMMAND_REJECTED,
        summary: `${args.commandType} ${accepted ? "accepted" : "refused"} (command ${args.commandId})`,
        payload: payload as never,
        commandScopeKey: scope,
        commandKey: args.commandId,
        recordedById: args.actor?.userId ?? null,
        recordedByAgentId: args.actor?.agentId ?? null,
      },
    });
  let roomRowId: string | null = null;
  let attemptedRefusal: { error: unknown; rejection: CommandRejection } | undefined;
  try {
    return await inTransaction(args.db, async (tx) => {
      roomRowId = await lockPrefix(tx);
      const existing = await readReceipt(tx, scope, args.commandId);
      if (existing) return replay<T>(existing, args.commandId, args.commandType, args.target, binding);
      let result: T;
      try { result = asStored(await args.run(tx)); }
      catch (error) {
        if (bound) {
          const rejection = args.rejectionOf?.(error);
          if (rejection) attemptedRefusal = { error, rejection };
        }
        throw error;
      }
      if (roomRowId) await write(tx, roomRowId, true, payload({ result }));
      return result;
    }, bound);
  } catch (error) {
    if (error instanceof CommandIdConflictError || error instanceof ReplayedCommandRejection) throw error;
    // Only the original typed handler refusal proves this attempt rolled back.
    // A replacement transport/commit error is an unknown outcome, not a refusal.
    const rejection = bound
      ? (attemptedRefusal && attemptedRefusal.error === error ? attemptedRefusal.rejection : null)
      : args.rejectionOf?.(error) ?? null;
    if (!rejection || !roomRowId) throw error;
    const rowId = roomRowId;
    if (bound) {
      const outcome = await inTransaction(args.db, async (tx) => {
        const lockedRowId = await lockPrefix(tx);
        const winner = await readReceipt(tx, scope, args.commandId);
        if (winner) return { replayed: true as const,
          result: replay<T>(winner, args.commandId, args.commandType, args.target, binding) };
        await write(tx, lockedRowId!, false, payload({ rejection: asStored(rejection) }));
        return { replayed: false as const };
      }, true);
      if (outcome.replayed) return outcome.result;
    } else {
      // Preserve legacy command replay semantics for callers that do not opt in.
      await inTransaction(args.db, async (tx) => {
        if (!(await readReceipt(tx, scope, args.commandId))) {
          await write(tx, rowId, false, payload({ rejection: asStored(rejection) }));
        }
      });
    }
    throw error;
  }
}

type BoundCommandLookupArgs = Omit<CommandReceiptIdentity, "beforeRoomLock" | "expectedRoomRowId"> & {
  db: ReceiptDb; payloadBinding: CommandPayloadBinding; expectedRoomRowId: string;
};

function boundLookupIdentity(args: BoundCommandLookupArgs): CommandReceiptIdentity {
  if (!args.expectedRoomRowId || args.payloadBinding.version !== 1 || !/^[a-f0-9]{64}$/.test(args.payloadBinding.digest)) {
    throw new CommandReceiptUnavailableError("Lookup requires the exact original row and versioned payload binding.");
  }
  return { authorityScopeKey: args.authorityScopeKey, commandId: args.commandId,
    commandType: args.commandType, target: args.target, payloadBinding: args.payloadBinding,
    expectedRoomRowId: args.expectedRoomRowId };
}

/** Lookup-only recovery. Call only after current result-access authority passed.
 * No handler, receipt insertion, lease renewal or approval is accepted. */
export async function lookupReceiptedCommand<T>(args: BoundCommandLookupArgs): Promise<{ kind: "settled"; result: T } | { kind: "absent" }> {
  const identity = boundLookupIdentity(args);
  return inTransaction(args.db, async tx => {
    await lockCommandPrefix(tx, identity, true);
    const existing = await readReceipt(tx, args.authorityScopeKey, args.commandId);
    if (!existing) return { kind: "absent" };
    if (existing.kind !== COMMAND_ACCEPTED && existing.kind !== COMMAND_REJECTED) {
      throw new CommandReceiptUnavailableError("The command's recorded outcome cannot be classified.");
    }
    const result = replay<T>(existing, args.commandId, args.commandType, args.target, args.payloadBinding);
    return { kind: "settled", result };
  }, true);
}

/** Lifecycle-only absence proof under the SAME real command→room transaction.
 * Any record blocks maintenance, including conflicting, legacy or unknown ones.
 * Read metadata only: this is never authority to load a private original outcome.
 * No command handler or receipt publication is accepted. */
export async function withLockedCommandAbsence<R>(args: BoundCommandLookupArgs,
  inspect: (tx: ReceiptDb) => Promise<R>): Promise<{ kind: "recorded" } | { kind: "absent"; result: R }> {
  const identity = boundLookupIdentity(args);
  return inTransaction(args.db, async tx => {
    await lockCommandPrefix(tx, identity, true);
    const exists = await tx.workroomActivity.findFirst!({
      where: { commandScopeKey: args.authorityScopeKey, commandKey: args.commandId }, select: { kind: true },
    });
    if (exists) return { kind: "recorded" };
    return { kind: "absent", result: await inspect(tx) };
  }, true);
}

/** One principal's command ids never collide with another's. */
export function commandAuthorityScopeKey(actor: { userId: string; agentId: string | null }): string {
  return `user:${actor.userId}|agent:${actor.agentId ?? "none"}`;
}
