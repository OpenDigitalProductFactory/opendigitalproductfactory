import { describe, expect, it, vi } from "vitest";
import * as receipts from "./command-receipts";

type Lookup = (args: Record<string, unknown>) => Promise<unknown>;
const lookup = (args: Record<string, unknown>) => {
  const fn = (receipts as unknown as { lookupReceiptedCommand?: Lookup }).lookupReceiptedCommand;
  expect(fn, "a lookup-only receipt API must exist without invoking a handler").toBeTypeOf("function");
  return fn!(args);
};
const binding = { version: 1, digest: "0".repeat(64) };
const target = { kind: "workroom", id: "WC-LOOKUP" };
const result = { success: true, message: "Original release completed." };
const payload = { commandType: "release-scope", target, payloadBinding: binding, result };

function fixture(row: unknown = { kind: receipts.COMMAND_ACCEPTED, payload }, rowId = "original-room-row") {
  const create = vi.fn();
  const read = vi.fn(async () => row);
  const tx = { $executeRaw: vi.fn(async () => 0), $queryRaw: vi.fn(async () => [{ id: rowId }]),
    workroomActivity: { findFirst: read, create } };
  const db = { ...tx, $transaction: async <T>(run: (client: unknown) => Promise<T>) => run(tx) };
  const args = { db, authorityScopeKey: "user:operator|agent:assistant", commandId: "original-release",
    commandType: "release-scope", target, expectedRoomRowId: "original-room-row", payloadBinding: binding };
  return { args, db, tx, read, create };
}

describe("bound command outcome lookup has no mutation callback", () => {
  it("returns the original accepted result without creating a receipt", async () => {
    const f = fixture();
    await expect(lookup(f.args)).resolves.toEqual({ kind: "settled", result });
    expect(f.create).not.toHaveBeenCalled();
  });
  it("reports a proved miss without reserving or fabricating an outcome", async () => {
    const f = fixture(null);
    await expect(lookup(f.args)).resolves.toEqual({ kind: "absent" });
    expect(f.tx.$queryRaw).toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
  });
  it("refuses a command reused with different original payload", async () => {
    const f = fixture();
    await expect(lookup({ ...f.args, payloadBinding: { ...binding, digest: "1".repeat(64) } }))
      .rejects.toBeInstanceOf(receipts.CommandIdConflictError);
    expect(f.create).not.toHaveBeenCalled();
  });
  it("does not upgrade a historical unbound receipt", async () => {
    const { payloadBinding: _ignored, ...legacy } = payload;
    const f = fixture({ kind: receipts.COMMAND_ACCEPTED, payload: legacy });
    await expect(lookup(f.args)).rejects.toBeInstanceOf(receipts.CommandIdConflictError);
    expect(f.create).not.toHaveBeenCalled();
  });
  it("does not read original outcomes through a restored persistent row", async () => {
    const f = fixture(undefined, "restored-room-row");
    await expect(lookup(f.args)).rejects.toBeInstanceOf(receipts.CommandReceiptUnavailableError);
    expect(f.read).not.toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
  });
  it("returns the original rejection as a rejection, never a successful no-op", async () => {
    const rejection = { code: "scope-target-stale", message: "Original target ended." };
    const f = fixture({ kind: receipts.COMMAND_REJECTED, payload: { ...payload, result: undefined, rejection } });
    await expect(lookup(f.args)).rejects.toMatchObject({ code: "scope-target-stale", message: rejection.message });
    expect(f.create).not.toHaveBeenCalled();
  });
  it("refuses an untransactional lookup rather than treating unknown as absence", async () => {
    const f = fixture();
    const { $transaction: _ignored, ...untransactional } = f.db;
    await expect(lookup({ ...f.args, db: untransactional })).rejects.toBeInstanceOf(receipts.CommandReceiptUnavailableError);
    expect(f.read).not.toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
  });
});

describe("lifecycle reconciliation shares the real lookup transaction", () => {
  const withLookup = (args: Record<string, unknown>, inspect: (tx: unknown) => Promise<unknown>) => {
    const fn = (receipts as unknown as { withLockedCommandAbsence?:
      (args: Record<string, unknown>, inspect: (tx: unknown) => Promise<unknown>) => Promise<unknown> }).withLockedCommandAbsence;
    expect(fn).toBeTypeOf("function");
    return fn!(args, inspect);
  };
  it("passes the actual already-locked client without another transaction or receipt", async () => {
    const f = fixture(null);
    const transaction = vi.spyOn(f.db, "$transaction");
    const inspect = vi.fn(async tx => {
      expect(tx).toBe(f.tx);
      expect(f.tx.$executeRaw).toHaveBeenCalled();
      expect(f.tx.$queryRaw).toHaveBeenCalled();
      return "lifecycle-checked";
    });
    await expect(withLookup(f.args, inspect)).resolves.toEqual({ kind: "absent", result: "lifecycle-checked" });
    expect(transaction).toHaveBeenCalledOnce();
    expect(f.create).not.toHaveBeenCalled();
  });
  it("blocks maintenance without loading or disclosing the original private outcome", async () => {
    const f = fixture({ kind: receipts.COMMAND_ACCEPTED, get payload() { throw Error("private outcome must not be read"); } });
    const inspect = vi.fn();
    await expect(withLookup(f.args, inspect)).resolves.toEqual({ kind: "recorded" });
    expect(f.read).toHaveBeenCalledWith(expect.objectContaining({ select: { kind: true } }));
    expect(inspect).not.toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
  });
  it("never admits lifecycle reconciliation for any conflicting or unclassified record", async () => {
    for (const row of [{ kind: "unknown", payload }, { kind: receipts.COMMAND_ACCEPTED, payload: { ...payload, payloadBinding: null } }]) {
      const f = fixture(row);
      const inspect = vi.fn();
      await expect(withLookup(f.args, inspect)).resolves.toEqual({ kind: "recorded" });
      expect(inspect).not.toHaveBeenCalled();
      expect(f.create).not.toHaveBeenCalled();
    }
  });
});
