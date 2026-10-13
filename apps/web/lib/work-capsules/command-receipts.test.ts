import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CommandIdConflictError,
  ReplayedCommandRejection,
  commandAuthorityScopeKey,
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
    $queryRaw: vi.fn(async (..._args: unknown[]) => [{ id: "row-1" }]),
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
    const sql = db.$queryRaw.mock.calls.map((call) => (call[0] as unknown as TemplateStringsArray).join("?"));
    expect(sql[0]).toContain("pg_advisory_xact_lock");
    expect(sql[1]).toContain("FOR UPDATE");
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
