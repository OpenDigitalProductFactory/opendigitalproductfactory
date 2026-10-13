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
  result?: unknown;
  rejection?: CommandRejection;
};

export type ReceiptDb = {
  workroomActivity: {
    findFirst?(args: unknown): Promise<ReceiptRow | null>;
    create(args: unknown): Promise<unknown>;
  };
  $queryRaw?(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
  $transaction?<T>(fn: (tx: ReceiptDb) => Promise<T>, options?: { timeout?: number; maxWait?: number }): Promise<T>;
};

// A receipted command runs its tool's whole write inside this transaction, so it
// gets more than Prisma's 5 s default; the room's row lock bounds the wait.
const TRANSACTION_OPTIONS = { timeout: 30_000, maxWait: 10_000 };

export const COMMAND_ACCEPTED = "command-accepted";
export const COMMAND_REJECTED = "command-rejected";

async function inTransaction<T>(db: ReceiptDb, fn: (tx: ReceiptDb) => Promise<T>): Promise<T> {
  return db.$transaction ? db.$transaction(fn, TRANSACTION_OPTIONS) : fn(db);
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

function replay<T>(row: ReceiptRow, commandId: string, commandType: string, target: CommandTarget): T {
  const recorded = row.payload as ReceiptPayload;
  if (recorded.commandType !== commandType || recorded.target?.kind !== target.kind || recorded.target?.id !== target.id) {
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

/**
 * Run `run` once per (authorityScopeKey, commandId) on one Workroom. The receipt
 * is a row in that room's own log (WorkroomActivity), not a parallel ledger.
 *
 * - accepted: the result is stored in the command's own transaction, so the
 *   effect and its receipt commit or roll back together;
 * - refused: when `rejectionOf` names the error a refusal, it is stored in a
 *   short transaction of its own (the command's was rolled back) and rethrown;
 *   any other error leaves no receipt, so a retry runs again;
 * - the room's row is locked first, so concurrent commands on one room
 *   serialise; a command-id advisory lock queues two attempts of one command.
 */
export async function runReceiptedCommand<T>(args: {
  db: ReceiptDb;
  authorityScopeKey: string;
  commandId: string;
  commandType: string;
  target: CommandTarget;
  actor?: { userId: string | null; agentId: string | null };
  run: (tx: ReceiptDb) => Promise<T>;
  rejectionOf?: (error: unknown) => CommandRejection | null;
}): Promise<T> {
  const scope = args.authorityScopeKey;
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
  try {
    return await inTransaction(args.db, async (tx) => {
      if (tx.$queryRaw) {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`command:${scope}:${args.commandId}`}, 0))`;
      }
      roomRowId = await lockRoom(tx, args.target.id);
      const existing = await readReceipt(tx, scope, args.commandId);
      if (existing) return replay<T>(existing, args.commandId, args.commandType, args.target);
      const result = asStored(await args.run(tx));
      if (roomRowId) await write(tx, roomRowId, true, { commandType: args.commandType, target: args.target, result });
      return result;
    });
  } catch (error) {
    if (error instanceof CommandIdConflictError || error instanceof ReplayedCommandRejection) throw error;
    const rejection = args.rejectionOf?.(error) ?? null;
    if (!rejection || !roomRowId) throw error;
    const rowId = roomRowId;
    await inTransaction(args.db, async (tx) => {
      if (!(await readReceipt(tx, scope, args.commandId))) {
        await write(tx, rowId, false, { commandType: args.commandType, target: args.target, rejection: asStored(rejection) });
      }
    });
    throw error;
  }
}

/** One principal's command ids never collide with another's. */
export function commandAuthorityScopeKey(actor: { userId: string; agentId: string | null }): string {
  return `user:${actor.userId}|agent:${actor.agentId ?? "none"}`;
}
