import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CommandIdConflictError,
  ReplayedCommandRejection,
  commandAuthorityScopeKey,
  commandPayloadBinding,
  runReceiptedCommand,
  type ReceiptDb,
} from "./command-receipts";

// BI-763D6E01: one command id, one effect; refusals replay; reuse elsewhere is refused.

type Row = { kind: string; payload: unknown };

function fakeDb() {
  const rows = new Map<string, Row>();
  const db = {
    rows,
    workroomActivity: {
      findFirst: vi.fn(async ({ where }: { where: { commandScopeKey: string; commandKey: string } }) =>
        rows.get(`${where.commandScopeKey}#${where.commandKey}`) ?? null),
      create: vi.fn(async ({ data }: { data: Row & { commandScopeKey: string; commandKey: string } }) => {
        rows.set(`${data.commandScopeKey}#${data.commandKey}`, { kind: data.kind, payload: data.payload });
        return data;
      }),
    },
    $queryRaw: vi.fn(async (...args: unknown[]) => {
      if ((args[0] as TemplateStringsArray).join("?").includes("pg_advisory_xact_lock")) {
        throw new Error("Failed to deserialize column of type 'void'");
      }
      return [{ id: "row-1" }];
    }),
    $executeRaw: vi.fn(async (..._args: unknown[]) => 1),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ ...db, $transaction: undefined })),
  };
  return db;
}

const target = { kind: "workroom", id: "WC-1" };
const scope = commandAuthorityScopeKey({ userId: "user-1", agentId: "AGT-EXT-CLAUDE" });

class LeaseHeld extends Error {
  readonly code = "lease_held_by_other";
}
const rejectionOf = (error: unknown) =>
  error instanceof LeaseHeld ? { code: error.code, message: error.message } : null;

let db: ReturnType<typeof fakeDb>;
beforeEach(() => {
  db = fakeDb();
});

describe("runReceiptedCommand", () => {
  it("runs a command once and replays its stored result (AC-DDL-RECEIPT-ONCE)", async () => {
    const run = vi.fn(async () => ({ capsuleId: "WC-1", at: new Date("2026-10-07T00:00:00.000Z") }));
    const call = () => runReceiptedCommand({
      db: db as unknown as ReceiptDb, authorityScopeKey: scope, commandId: "cmd-1", commandType: "heartbeat", target, run,
    });

    const first = await call();
    const second = await call();

    expect(run).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(first).toEqual({ capsuleId: "WC-1", at: "2026-10-07T00:00:00.000Z" });
  });

  it("locks the command id and the room row before reading the receipt", async () => {
    await runReceiptedCommand({
      db: db as unknown as ReceiptDb, authorityScopeKey: scope, commandId: "cmd-1", commandType: "heartbeat", target, run: async () => 1,
    });
    expect((db.$executeRaw.mock.calls[0]![0] as TemplateStringsArray).join("?")).toContain("pg_advisory_xact_lock");
    expect(db.$executeRaw.mock.calls[0]!.slice(1)).toEqual([`command:${scope}:cmd-1`]);
    expect((db.$queryRaw.mock.calls[0]![0] as TemplateStringsArray).join("?")).toContain("FOR UPDATE");
    expect(db.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(db.$queryRaw.mock.invocationCallOrder[0]!);
    expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(db.workroomActivity.findFirst.mock.invocationCallOrder[0]!);
  });

  it("fails before the effect when a raw adapter cannot execute the command lock", async () => {
    const run = vi.fn(async () => "effect");
    await expect(runReceiptedCommand({
      db: { ...db, $transaction: undefined, $executeRaw: undefined } as unknown as ReceiptDb,
      authorityScopeKey: scope, commandId: "missing-execute", commandType: "heartbeat", target, run,
    })).rejects.toThrow("$executeRaw");
    expect(run).not.toHaveBeenCalled();
    expect(db.workroomActivity.create).not.toHaveBeenCalled();
  });

  it("writes the receipt as a command-accepted row in the room's own log", async () => {
    await runReceiptedCommand({
      db: db as unknown as ReceiptDb, authorityScopeKey: scope, commandId: "cmd-log", commandType: "heartbeat", target,
      actor: { userId: "user-1", agentId: "AGT-EXT-CLAUDE" }, run: async () => "ok",
    });
    expect(db.workroomActivity.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      workCapsuleId: "row-1",
      kind: "command-accepted",
      commandScopeKey: scope,
      commandKey: "cmd-log",
      recordedById: "user-1",
      payload: { commandType: "heartbeat", target, result: "ok" },
    }) });
  });

  it("stores a typed refusal and replays it without running again (AC-DDL-RECEIPT-REJECT)", async () => {
    const run = vi.fn(async () => {
      throw new LeaseHeld("held by someone else");
    });
    const call = () => runReceiptedCommand({
      db: db as unknown as ReceiptDb, authorityScopeKey: scope, commandId: "cmd-2", commandType: "heartbeat", target, run, rejectionOf,
    });

    await expect(call()).rejects.toBeInstanceOf(LeaseHeld);
    const replayed = await call().catch((error: unknown) => error);

    expect(run).toHaveBeenCalledTimes(1);
    expect(replayed).toBeInstanceOf(ReplayedCommandRejection);
    expect(replayed).toMatchObject({ code: "lease_held_by_other", message: "held by someone else" });
  });

  it("leaves no receipt for an error that is not a refusal, so a retry runs again", async () => {
    const run = vi.fn()
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce("ok");
    const call = () => runReceiptedCommand({
      db: db as unknown as ReceiptDb, authorityScopeKey: scope, commandId: "cmd-3", commandType: "status", target, run, rejectionOf,
    });

    await expect(call()).rejects.toThrow("connection reset");
    await expect(call()).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("refuses reuse of a command id for another target", async () => {
    await runReceiptedCommand({
      db: db as unknown as ReceiptDb, authorityScopeKey: scope, commandId: "cmd-4", commandType: "heartbeat", target, run: async () => 1,
    });
    const reuse = runReceiptedCommand({
      db: db as unknown as ReceiptDb, authorityScopeKey: scope, commandId: "cmd-4", commandType: "heartbeat",
      target: { kind: "workroom", id: "WC-2" }, run: async () => 2,
    });
    await expect(reuse).rejects.toBeInstanceOf(CommandIdConflictError);
    await expect(reuse).rejects.toMatchObject({ code: "command_id_conflict" });
  });

  it("keeps one principal's command ids apart from another's", async () => {
    const other = commandAuthorityScopeKey({ userId: "user-2", agentId: null });
    const run = vi.fn(async () => "done");
    await runReceiptedCommand({ db: db as unknown as ReceiptDb, authorityScopeKey: scope, commandId: "same", commandType: "heartbeat", target, run });
    await runReceiptedCommand({ db: db as unknown as ReceiptDb, authorityScopeKey: other, commandId: "same", commandType: "heartbeat", target, run });
    expect(run).toHaveBeenCalledTimes(2);
    expect(other).toBe("user:user-2|agent:none");
  });
});


// These are orchestration checks; the PostgreSQL suite proves lock serialization.
describe("bound command receipts", () => {
  const binding = { version: 1 as const, digest: "a".repeat(64) };
  const changed = { version: 1 as const, digest: "b".repeat(64) };
  const input = () => ({ db: db as unknown as ReceiptDb, authorityScopeKey: scope,
    commandId: "bound", commandType: "reassign", target, payloadBinding: binding });

  it.each(["accepted", "rejected"])("compares the payload before replaying a %s receipt", async (kind) => {
    const run = vi.fn(async () => {
      if (kind === "rejected") throw new LeaseHeld("held");
      return "winner";
    });
    await runReceiptedCommand({ ...input(), run, rejectionOf }).catch(() => undefined);
    await expect(runReceiptedCommand({ ...input(), payloadBinding: changed, run, rejectionOf }))
      .rejects.toBeInstanceOf(CommandIdConflictError);
    expect(run).toHaveBeenCalledTimes(1);
    expect(db.workroomActivity.create).toHaveBeenCalledTimes(1);
    expect(db.rows.get(`${scope}#bound`)?.payload).toMatchObject({ payloadBinding: binding });
  });

  it("does not accept a legacy unbound receipt for a new bound request", async () => {
    await runReceiptedCommand({ ...input(), payloadBinding: undefined, run: async () => "legacy" });
    const run = vi.fn(async () => "new");
    await expect(runReceiptedCommand({ ...input(), run })).rejects.toBeInstanceOf(CommandIdConflictError);
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses omission of the binding when the command was already bound", async () => {
    await runReceiptedCommand({ ...input(), run: async () => "bounded request" });
    const run = vi.fn(async () => "legacy reassignment");
    await expect(runReceiptedCommand({ ...input(), payloadBinding: undefined, run })).rejects.toBeInstanceOf(CommandIdConflictError);
    expect(run).not.toHaveBeenCalled();
  });

  it("replays equal binding and retains the original rejection", async () => {
    const run = vi.fn(async () => { throw new LeaseHeld("held"); });
    await expect(runReceiptedCommand({ ...input(), run, rejectionOf })).rejects.toBeInstanceOf(LeaseHeld);
    await expect(runReceiptedCommand({ ...input(), run, rejectionOf })).rejects.toBeInstanceOf(ReplayedCommandRejection);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it.each(["transaction", "room-lock", "command-lock"])("refuses bound effects without %s support", async (missing) => {
    const incomplete = { ...db };
    if (missing === "transaction") Object.assign(incomplete, { $transaction: undefined });
    else incomplete.$transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ ...db,
      [missing === "room-lock" ? "$queryRaw" : "$executeRaw"]: undefined }));
    const run = vi.fn(async () => "effect");
    await expect(runReceiptedCommand({ ...input(), db: incomplete as unknown as ReceiptDb, run }))
      .rejects.toMatchObject({ code: "command_receipt_unavailable" });
    expect(run).not.toHaveBeenCalled();
  });

  it("requires an existing locked room for bound effects", async () => {
    db.$queryRaw.mockResolvedValue([]);
    const run = vi.fn(async () => "effect");
    await expect(runReceiptedCommand({ ...input(), run })).rejects.toMatchObject({ code: "command_receipt_unavailable" });
    expect(run).not.toHaveBeenCalled();
  });

  it("uses the identical command/environment/room prefix after rollback", async () => {
    const events: string[] = [];
    db.$executeRaw.mockImplementation(async (...args) => {
      if ((args[0] as TemplateStringsArray).join("").includes("pg_advisory_xact_lock")) events.push("command");
      return 1;
    });
    db.$queryRaw.mockImplementation(async () => { events.push("room"); return [{ id: "row-1" }]; });
    const beforeRoomLock = vi.fn(async () => { events.push("environments"); });
    const refusal = new LeaseHeld("held");
    await expect(runReceiptedCommand({ ...input(), beforeRoomLock, run: async () => { throw refusal; }, rejectionOf }))
      .rejects.toBe(refusal);
    expect(events).toEqual(["command", "environments", "room", "command", "environments", "room"]);
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: "ReadCommitted" }));
  });

  it.each(["equal", "different", "rejected"])("returns the %s durable winner published after rollback", async (winner) => {
    let transactions = 0;
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      if (++transactions === 2) db.rows.set(`${scope}#bound`, { kind: winner === "rejected" ? "command-rejected" : "command-accepted",
        payload: { commandType: "reassign", target, payloadBinding: winner === "different" ? changed : binding,
          result: "concurrent success", rejection: { code: "winner-refusal", message: "original winner" } } });
      return fn({ ...db, $transaction: undefined });
    });
    const result = runReceiptedCommand({ ...input(), run: async () => { throw new LeaseHeld("losing refusal"); }, rejectionOf });
    if (winner === "equal") await expect(result).resolves.toBe("concurrent success");
    else if (winner === "different") await expect(result).rejects.toBeInstanceOf(CommandIdConflictError);
    else await expect(result).rejects.toMatchObject({ code: "winner-refusal" });
    expect(db.workroomActivity.create).not.toHaveBeenCalled();
  });

  it("does not publish a rejection when the transaction outcome is unknown", async () => {
    const unknown = new Error("connection lost while rolling back");
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      try { await fn({ ...db, $transaction: undefined }); } catch { throw unknown; }
    });
    await expect(runReceiptedCommand({ ...input(), run: async () => { throw new LeaseHeld("held"); }, rejectionOf }))
      .rejects.toBe(unknown);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.workroomActivity.create).not.toHaveBeenCalled();
  });
});


describe("canonical normalized payload binding", () => {
  it("ignores object key order but binds arrays and all optional accepted fields", () => {
    const original = { phase: "request", manifest: { paths: ["a", "b"] }, reason: "because" };
    expect(commandPayloadBinding(original)).toEqual(commandPayloadBinding({ reason: "because", manifest: { paths: ["a", "b"] }, phase: "request" }));
    expect(commandPayloadBinding(original)).not.toEqual(commandPayloadBinding({ ...original, reason: "different" }));
    expect(commandPayloadBinding(original)).not.toEqual(commandPayloadBinding({ ...original, manifest: { paths: ["b", "a"] } }));
    expect(commandPayloadBinding(original)).toMatchObject({ version: 1, digest: expect.stringMatching(/^[a-f0-9]{64}$/) });
  });
});
