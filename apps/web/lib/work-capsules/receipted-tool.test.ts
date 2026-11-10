import { beforeEach, describe, expect, it, vi } from "vitest";

// BI-763D6E01: a Workroom tool call with commandId runs once; without it, unchanged.

const { receiptRows, txClient, transaction, state, row } = vi.hoisted(() => {
  const receiptRows = new Map<string, Record<string, unknown>>();
  const row = { id: "row-1", capsuleId: "WC-1", status: "working", archivedAt: null, scopeClaims: [] as unknown[],
    updatedAt: new Date(), leaseHolderPrincipalId: "owner", leaseExpiresAt: new Date(Date.now() + 600_000) };
  const state = { observeScope: false, active: false, unknownCommit: false, unknownRollback: false, events: [] as string[] };
  const transaction = vi.fn();
  const txClient = {
    $queryRaw: async (strings: TemplateStringsArray) => {
      if (strings.join("?").includes("pg_advisory_xact_lock")) {
        throw new Error("Failed to deserialize column of type 'void'");
      }
      if (state.observeScope) state.events.push("room-lock");
      return [{ id: "row-1" }];
    },
    $executeRaw: async () => 1,
    workroom: { findUnique: async () => ({ ...row }), findMany: async () => [],
      update: async ({ data }: { data: Partial<typeof row> }) => Object.assign(row, data) },
    workroomActivity: {
      findFirst: async ({ where }: { where: { commandScopeKey: string; commandKey: string } }) =>
        receiptRows.get(`${where.commandScopeKey}#${where.commandKey}`) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (typeof data.commandKey === "string") receiptRows.set(`${data.commandScopeKey}#${data.commandKey}`, { id: "receipt-" + receiptRows.size, workCapsuleId: data.workCapsuleId, kind: data.kind, payload: data.payload });
        return data;
      },
    },
  };
  return { receiptRows, txClient, transaction, state, row };
});

vi.mock("@dpf/db", () => ({
  prisma: { ...txClient, $transaction: transaction },
}));

vi.mock("./handler-actor", () => ({ workCapsuleActor: async () => ({ userId: "user-1", agentId: "AGT-1", principalId: "owner" }) }));
vi.mock("@/lib/portal-context/invalidation", () => ({ revalidatePortalContext: vi.fn() }));
vi.mock("./activity-events", () => ({ publishRecordedWorkCapsuleActivity: vi.fn() }));
vi.mock("./change-impact-contract", () => ({ planCapsuleChangeImpact: async () => ({ contract: {} }) }));
vi.mock("./scope-epoch-enrollment.server", async original => ({
  ...await original<typeof import("./scope-epoch-enrollment.server")>(),
  assertScopeEpochEnrollmentReady: async () => {
    if (state.active) throw new Error("Qualification must run before opening the receipt transaction");
    state.events.push("qualified");
    return { assertCurrent: async () => { state.events.push("admission"); } };
  },
}));
import { prepareScopeClaim, claimWorkCapsuleScope } from "./scope-claim-store";

import { commandDb, hasBoundCommandTransaction, receiptedWorkroomTool } from "./receipted-tool";
import type { CapsuleDb } from "./work-capsule-store-types";

beforeEach(() => {
  receiptRows.clear(); row.scopeClaims = []; row.leaseExpiresAt = new Date(Date.now() + 600_000); state.observeScope = false; state.active = false; state.unknownCommit = false; state.unknownRollback = false; state.events = [];
  transaction.mockImplementation(async (fn: (tx: typeof txClient) => Promise<unknown>) => {
    const prior = new Map(receiptRows); state.active = true; state.events.push("begin");
    let result: unknown;
    try { result = await fn(txClient); }
    catch (error) {
      state.active = false; receiptRows.clear(); for (const [key, row] of prior) receiptRows.set(key, row); state.events.push("rollback");
      if (state.unknownRollback) throw new Error("Rollback outcome unknown");
      throw error;
    }
    state.active = false;
    if (state.unknownCommit) throw new Error("Commit outcome unknown");
    state.events.push("commit"); return result;
  });
});

describe("receiptedWorkroomTool", () => {
  it("passes a call without commandId straight through", async () => {
    const handler = vi.fn(async () => ({ success: true, message: "ok" }));
    const tool = receiptedWorkroomTool("heartbeat", handler);
    await tool({ capsuleId: "WC-1" }, "user-1", { agentId: "AGT-1" });
    await tool({ capsuleId: "WC-1" }, "user-1", { agentId: "AGT-1" });
    expect(handler).toHaveBeenCalledTimes(2);
    expect(receiptRows.size).toBe(0);
  });

  it("runs a command once and returns the first result to a retry", async () => {
    const handler = vi.fn(async () => ({ success: true, message: "renewed", data: { n: 1 } }));
    const tool = receiptedWorkroomTool("heartbeat", handler);
    const first = await tool({ capsuleId: "WC-1", commandId: "c-1" }, "user-1", { agentId: "AGT-1" });
    const second = await tool({ capsuleId: "WC-1", commandId: "c-1" }, "user-1", { agentId: "AGT-1" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("hands the handler the receipt transaction through commandDb()", async () => {
    let seen: unknown;
    const tool = receiptedWorkroomTool("heartbeat", async () => {
      seen = commandDb();
      return { success: true, message: "ok" };
    });
    await tool({ capsuleId: "WC-1", commandId: "c-tx" }, "user-1", undefined);
    expect(seen).toBe(txClient);
  });

  it("stores a refusal and returns the same refusal on retry without running again", async () => {
    const refusal = { success: false, error: "lease_held_by_other", message: "held", data: { holderPrincipalId: "p-2" } };
    const handler = vi.fn(async () => refusal);
    const tool = receiptedWorkroomTool("heartbeat", handler);
    await expect(tool({ capsuleId: "WC-1", commandId: "c-2" }, "user-1", undefined)).resolves.toEqual(refusal);
    await expect(tool({ capsuleId: "WC-1", commandId: "c-2" }, "user-1", undefined)).resolves.toEqual(refusal);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("refuses a command id reused on another room", async () => {
    const tool = receiptedWorkroomTool("heartbeat", async () => ({ success: true, message: "ok" }));
    await tool({ capsuleId: "WC-1", commandId: "c-3" }, "user-1", undefined);
    await expect(tool({ capsuleId: "WC-2", commandId: "c-3" }, "user-1", undefined))
      .resolves.toMatchObject({ success: false, error: "command_id_conflict" });
  });

  it("refuses an oversized command id", async () => {
    const tool = receiptedWorkroomTool("heartbeat", async () => ({ success: true, message: "ok" }));
    await expect(tool({ capsuleId: "WC-1", commandId: "x".repeat(201) }, "user-1", undefined))
      .resolves.toMatchObject({ success: false, error: "invalid_input" });
  });
});


describe("bound Workroom tool preparation", () => {
  const binding = { version: 1 as const, digest: "a".repeat(64) };
  const params = { capsuleId: "WC-1", commandId: "bound", phase: "request" };
  it("validates before returning a cached receipt", async () => {
    const handler = vi.fn(async () => ({ success: true, message: "ok" }));
    const prepare = vi.fn(() => ({ params, payloadBinding: binding }));
    const tool = receiptedWorkroomTool("reassign", handler, { prepare });
    await tool(params, "user-1", undefined);
    prepare.mockReturnValue({ refusal: { success: false, error: "invalid_input", message: "unknown field" } } as never);
    await expect(tool({ ...params, unsupported: true }, "user-1", undefined))
      .resolves.toMatchObject({ error: "invalid_input" });
    expect(handler).toHaveBeenCalledTimes(1);
  });
  it("requires commandId for a prepared bound call", async () => {
    const handler = vi.fn(async () => ({ success: true, message: "ok" }));
    const tool = receiptedWorkroomTool("reassign", handler, { prepare: () => ({ params: { capsuleId: "WC-1" }, payloadBinding: binding }) });
    await expect(tool({ capsuleId: "WC-1" }, "user-1", undefined)).resolves.toMatchObject({ error: "invalid_input" });
    expect(handler).not.toHaveBeenCalled();
  });
  it("passes normalized parameters and exposes only the active bound transaction", async () => {
    const normalized = { ...params, reason: "normalized" };
    let seen: unknown;
    let bounded = false;
    const beforeRoomLock = vi.fn(async () => undefined);
    const tool = receiptedWorkroomTool("reassign", async (input) => {
      seen = input; bounded = hasBoundCommandTransaction(commandDb());
      return { success: true, message: "ok" };
    }, { prepare: () => ({ params: normalized, payloadBinding: binding, beforeRoomLock }) });
    await tool(params, "user-1", undefined);
    expect(seen).toEqual(normalized);
    expect(bounded).toBe(true);
    expect(hasBoundCommandTransaction(commandDb())).toBe(false);
    expect(beforeRoomLock).toHaveBeenCalledWith(txClient);
  });
  it("refuses its exact active client when the real wrapper has no prepared payload binding", async () => {
    const tool = receiptedWorkroomTool("reassign", async () => {
      const active = commandDb();
      expect(active).toBe(txClient);
      expect(hasBoundCommandTransaction(active)).toBe(false);
      return { success: true, message: "legacy command remains unbound" };
    });
    await expect(tool(params, "user-1", undefined)).resolves.toMatchObject({ success: true });
  });
  it("binds only the exact active receipt client even when it exposes nested transactions", async () => {
    const nested = vi.fn(async () => { throw new Error("The identity check must not start a nested transaction"); });
    const savepointClient = { ...txClient, $transaction: nested };
    transaction.mockImplementationOnce(async (fn: (tx: typeof savepointClient) => Promise<unknown>) => fn(savepointClient));
    let active: CapsuleDb | undefined;
    const outside = commandDb();
    const tool = receiptedWorkroomTool("reassign", async () => {
      active = commandDb();
      expect(active).toBe(savepointClient);
      expect(hasBoundCommandTransaction(active)).toBe(true);
      expect(hasBoundCommandTransaction(outside)).toBe(false);
      expect(hasBoundCommandTransaction({ ...active })).toBe(false);
      return { success: true, message: "pending" };
    }, { prepare: () => ({ params, payloadBinding: binding }) });
    await expect(tool(params, "user-1", undefined)).resolves.toMatchObject({ success: true });
    expect(active).toBeDefined();
    expect(hasBoundCommandTransaction(active!)).toBe(false);
    expect(nested).not.toHaveBeenCalled();
  });
});


describe("bound command post-commit notification", () => {
  const params = { capsuleId: "WC-1", commandId: "notify", phase: "request" };
  const payloadBinding = { version: 1 as const, digest: "a".repeat(64) };
  it("publishes the canonical accepted receipt only after commit and reuses it on retry", async () => {
    const afterCommit = vi.fn(async () => { expect(state.active).toBe(false); state.events.push("notify"); });
    const handler = vi.fn(async () => ({ success: true, message: "pending" }));
    const tool = receiptedWorkroomTool("reassign", handler, { prepare: () => ({ params, payloadBinding, afterCommit }) });
    await expect(tool(params, "user-1", undefined)).resolves.toMatchObject({ success: true });
    expect(state.events).toEqual(["begin", "commit", "notify"]);
    expect(afterCommit).toHaveBeenCalledWith({ id: "receipt-0", workCapsuleId: "row-1" }, { success: true, message: "pending" });
    await tool(params, "user-1", undefined);
    expect(afterCommit).toHaveBeenCalledTimes(2); expect(handler).toHaveBeenCalledTimes(1); expect(receiptRows.size).toBe(1);
  });
  it("publishes only the durable rejection after the effect transaction rolls back", async () => {
    const afterCommit = vi.fn(async () => { expect(state.active).toBe(false); state.events.push("notify"); });
    const tool = receiptedWorkroomTool("reassign", async () => ({ success: false, error: "stale", message: "changed" }), { prepare: () => ({ params, payloadBinding, afterCommit }) });
    await expect(tool(params, "user-1", undefined)).resolves.toMatchObject({ error: "stale" });
    expect(state.events).toEqual(["begin", "rollback", "begin", "commit", "notify"]);
    expect(afterCommit).toHaveBeenCalledWith({ id: "receipt-0", workCapsuleId: "row-1" }, expect.objectContaining({ success: false }));
    expect([...receiptRows.values()][0].kind).toBe("command-rejected");
  });
  it.each(["commit", "rollback"])("never publishes an unknown %s outcome", async (failure) => {
    state.unknownCommit = failure === "commit"; state.unknownRollback = failure === "rollback";
    const afterCommit = vi.fn(); const handler = vi.fn(async () => ({ success: failure === "commit", message: "attempt" }));
    const tool = receiptedWorkroomTool("reassign", handler, { prepare: () => ({ params, payloadBinding, afterCommit }) });
    await expect(tool(params, "user-1", undefined)).rejects.toThrow(/outcome unknown/); expect(afterCommit).not.toHaveBeenCalled();
    if (failure === "commit") { state.unknownCommit = false; await tool(params, "user-1", undefined); expect(handler).toHaveBeenCalledTimes(1); expect(afterCommit).toHaveBeenCalledTimes(1); }
  });
  it("does not notify for an unreceipted handler failure", async () => {
    const afterCommit = vi.fn(); const handler = vi.fn(async () => { throw new Error("connection lost"); });
    const tool = receiptedWorkroomTool("reassign", handler, { prepare: () => ({ params, payloadBinding, afterCommit }) });
    await expect(tool(params, "user-1", undefined)).rejects.toThrow("connection lost"); expect(afterCommit).not.toHaveBeenCalled();
  });
  it("keeps committed success when the wake-up transport fails", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const afterCommit = vi.fn(async () => { throw new Error("notification unavailable"); });
    const tool = receiptedWorkroomTool("reassign", async () => ({ success: true, message: "done" }), { prepare: () => ({ params, payloadBinding, afterCommit }) });
    try { await expect(tool(params, "user-1", undefined)).resolves.toMatchObject({ success: true }); expect(afterCommit).toHaveBeenCalledTimes(1); expect(warning).toHaveBeenCalled(); }
    finally { warning.mockRestore(); }
  });

  it("does not notify an identity conflict or invalid preparation", async () => {
    const afterCommit = vi.fn(); let binding = payloadBinding;
    const handler = vi.fn(async () => ({ success: true, message: "done" }));
    const tool = receiptedWorkroomTool("reassign", handler, { prepare: () => ({ params, payloadBinding: binding, afterCommit }) });
    await tool(params, "user-1", undefined); afterCommit.mockClear(); binding = { ...payloadBinding, digest: "b".repeat(64) };
    expect(await tool(params, "user-1", undefined)).toMatchObject({ error: "command_id_conflict" }); expect(afterCommit).not.toHaveBeenCalled(); expect(handler).toHaveBeenCalledTimes(1);
    const invalid = receiptedWorkroomTool("reassign", handler, { prepare: () => ({ refusal: { success: false, error: "invalid_input", message: "unknown phase field" } }) });
    expect(await invalid(params, "user-1", undefined)).toMatchObject({ error: "invalid_input" }); expect(afterCommit).not.toHaveBeenCalled();
  });
  it("keeps durable success without notification if the post-commit receipt cannot be read", async () => {
    const read = txClient.workroomActivity.findFirst;
    const spy = vi.spyOn(txClient.workroomActivity, "findFirst").mockImplementation(async (args) => { if (!state.active) throw new Error("read unavailable"); return read(args); });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const afterCommit = vi.fn();
    const tool = receiptedWorkroomTool("reassign", async () => ({ success: true, message: "done" }), { prepare: () => ({ params, payloadBinding, afterCommit }) });
    try { expect(await tool(params, "user-1", undefined)).toMatchObject({ success: true }); expect(afterCommit).not.toHaveBeenCalled(); expect(receiptRows.size).toBe(1); }
    finally { spy.mockRestore(); warning.mockRestore(); }
  });
});


it("qualifies a keyed acquisition before its receipt transaction and publishes one committed epoch", async () => {
  state.observeScope = true;
  const handler = vi.fn(async (params: Record<string, unknown>) => {
    expect(hasBoundCommandTransaction(commandDb())).toBe(true);
    const result = await claimWorkCapsuleScope({ db: commandDb(), capsuleId: params.capsuleId as string,
      claims: params.claims as Array<{ kind: "path"; value: string; intent: "edit" }>,
      actor: { userId: "user-1", agentId: "AGT-1", principalId: "owner" } });
    return { success: true, message: "Scope acquired.", data: { capsule: result } };
  });
  const tool = receiptedWorkroomTool("claim-scope", handler, { prepareAsync: prepareScopeClaim });
  const params = { capsuleId: "WC-1", claims: [{ kind: "path", value: "a.ts", intent: "edit" }], commandId: "acquisition" };
  const first = await tool(params, "user-1", { agentId: "AGT-1" });
  const second = await tool(params, "user-1", { agentId: "AGT-1" });
  expect(first.success).toBe(true); expect(second).toEqual(first); expect(handler).toHaveBeenCalledOnce();
  expect(row.scopeClaims).toHaveLength(1);
  expect(row.scopeClaims[0]).toHaveProperty("releaseEpoch", expect.stringMatching(/^[a-f0-9-]{36}$/));
  expect(state.events.indexOf("qualified")).toBeLessThan(state.events.indexOf("begin"));
  expect(state.events.indexOf("admission")).toBeLessThan(state.events.indexOf("room-lock"));
  expect(receiptRows.size).toBe(1);
});
