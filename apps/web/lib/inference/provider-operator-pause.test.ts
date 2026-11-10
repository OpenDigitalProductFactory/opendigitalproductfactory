import { beforeEach, describe, expect, it, vi } from "vitest";
import { pauseLocalProvider, resumeLocalProvider, restoreOperatorProviderPause, reconcileOverdueProviderPauses, type PauseDatabase } from "./provider-operator-pause";

const restorationStance = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/install/instance-stance", () => ({ loadInstanceStance: restorationStance.read, prismaInstanceStanceStore: (db: unknown) => db }));
beforeEach(() => restorationStance.read.mockResolvedValue({ environmentClass: "development", primaryPurpose: "evolve-dpf" }));

type Job = { jobId: string; metadata: unknown; lastStatus: string; nextRunAt: Date | null; enabled: boolean };
function fixture(providerId = "local") {
  let state = {
    provider: { providerId, status: "active" },
    connection: { providerId, connectionId: `provider-default-${providerId}`, status: "active", authMethod: "local", executionChannel: "local-runtime", credentialEntryId: null, organizationId: null },
    job: null as Job | null,
    audit: [] as Array<{ userId: string; parameters: Record<string, unknown> }>,
  };
  const tx = {
    adminActivity: { create: vi.fn(async ({ data }: { data: { userId: string; parameters: Record<string, unknown> } }) => { state.audit.push(data); return data; }) },
    $queryRaw: vi.fn(async () => []),
    modelProvider: {
      findUnique: vi.fn(async () => state.provider),
      update: vi.fn(async ({ data }: { data: { status: string } }) => Object.assign(state.provider, data)),
    },
    aiProviderConnection: {
      findUnique: vi.fn(async () => state.connection),
      update: vi.fn(async ({ data }: { data: { status: string } }) => Object.assign(state.connection, data)),
      updateMany: vi.fn(async ({ where, data }: { where: { status: string }; data: { status: string } }) => {
        if (state.connection.status !== where.status) return { count: 0 };
        Object.assign(state.connection, data); return { count: 1 };
      }),
    },
    scheduledJob: {
      findUnique: vi.fn(async () => state.job),
      findMany: vi.fn(async () => state.job ? [state.job] : []),
      upsert: vi.fn(async ({ create, update }: { create: Job; update: Partial<Job> }) => {
        state.job = state.job ? Object.assign(state.job, update) : create;
        return state.job;
      }),
      update: vi.fn(async ({ data }: { data: Partial<Job> }) => Object.assign(state.job!, data)),
    },
  };
  const db = { ...tx, $transaction: vi.fn(async (run: (client: typeof tx) => Promise<unknown>) => {
    const prior = structuredClone(state);
    try { return await run(tx); } catch (error) { state = prior; throw error; }
  }) };
  let generation = 0;
  const send = vi.fn(async () => undefined);
  const probe = vi.fn(async () => true);
  const now = new Date("2026-10-12T02:00:00Z");
  const deps = { db: db as unknown as PauseDatabase, now, send, probe, newId: () => `pause-${++generation}` };
  return { get state() { return state; }, db, tx, deps, probe, send };
}

describe("durable operator provider pause", () => {
  it("preserves a cloud account's earlier routing disable after expiry", async () => {
    const f = fixture("chatgpt");
    f.state.connection.status = "inactive";
    const pause = await pauseLocalProvider({ providerId: "chatgpt", actorId: "operator", duration: { value: 1, unit: "hours" } }, f.deps);
    await resumeLocalProvider({ providerId: "chatgpt", operationId: pause.operationId, automatic: true }, { ...f.deps, now: new Date("2026-10-12T03:00:00Z") });
    expect(f.state.connection.status).toBe("inactive");
  });
  it.each(["chatgpt", "codex", "openai"])("pauses %s without rewriting automatic provider health", async (providerId) => {
    const f = fixture(providerId);
    f.state.provider.status = "disabled";
    const pause = await pauseLocalProvider({ providerId, actorId: "operator", duration: { value: 2, unit: "hours" } }, f.deps);
    expect(f.state.connection.status).toBe("paused");
    expect(f.state.provider.status).toBe("disabled");
    await resumeLocalProvider({ providerId, operationId: pause.operationId, automatic: true }, { ...f.deps, now: new Date("2026-10-12T04:00:00Z") });
    expect(f.state.connection.status).toBe("active");
    expect(f.state.provider.status).toBe("disabled");
    expect(f.probe).not.toHaveBeenCalled();
  });
  it("does not change cloud provider lifecycle when an operator pause expires", async () => {
    const f = fixture("chatgpt");
    const pause = await pauseLocalProvider({ providerId: "chatgpt", actorId: "operator", duration: { value: 1, unit: "hours" } }, f.deps);
    expect(f.state.provider.status).toBe("active");
    f.state.provider.status = "disabled";
    await resumeLocalProvider({ providerId: "chatgpt", operationId: pause.operationId, automatic: true }, { ...f.deps, now: new Date("2026-10-12T03:00:00Z") });
    expect(f.state.provider.status).toBe("disabled");
    expect(f.tx.modelProvider.update).not.toHaveBeenCalled();
  });
  it("retains pause changes and timer execution with distinct attribution", async () => {
    const f = fixture();
    await pauseLocalProvider({ providerId: "local", actorId: "operator" }, f.deps);
    const timed = await pauseLocalProvider({ providerId: "local", actorId: "other-operator", duration: { value: 1, unit: "hours" } }, f.deps);
    await resumeLocalProvider({ providerId: "local", operationId: timed.operationId, automatic: true }, { ...f.deps, now: new Date("2026-10-12T03:00:00Z") });
    expect(f.state.audit).toHaveLength(3);
    expect(f.state.audit.map(row => row.parameters.action)).toEqual(["pause", "change-pause", "expire"]);
    expect(f.state.audit[2]).toMatchObject({ userId: "other-operator", parameters: { executedBy: "timer", authorizingOperatorId: "other-operator" } });
  });
  it("rolls back a pause if its audit cannot be persisted", async () => {
    const f = fixture();
    f.tx.adminActivity.create.mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(pauseLocalProvider({ providerId: "local", actorId: "operator" }, f.deps)).rejects.toThrow("audit unavailable");
    expect(f.state.connection.status).toBe("active");
  });
  it.each(["local", "ollama"])("pauses %s immediately and persists its operator identity", async (providerId) => {
    const f = fixture(providerId);
    const result = await pauseLocalProvider({ providerId, actorId: "operator" }, f.deps);
    expect(f.state.provider.status).toBe("inactive");
    expect(f.state.connection.status).toBe("paused");
    expect(f.state.job?.metadata).toMatchObject({ operationId: result.operationId, actorId: "operator", resumeAt: null });
    expect(f.send).not.toHaveBeenCalled();
  });
  it("schedules the exact positive hours/days expiry", async () => {
    const f = fixture();
    const result = await pauseLocalProvider({ providerId: "local", actorId: "operator", duration: { value: 2, unit: "days" } }, f.deps);
    expect(result.resumeAt).toBe("2026-10-14T02:00:00.000Z");
    expect(f.send).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ operationId: result.operationId, resumeAt: result.resumeAt }) }));
  });
  it.each([0, -1, Infinity, NaN])("rejects invalid duration %s before changing routing", async (value) => {
    const f = fixture();
    await expect(pauseLocalProvider({ providerId: "local", actorId: "operator", duration: { value, unit: "hours" } }, f.deps)).rejects.toThrow(/duration/i);
    expect(f.db.$transaction).not.toHaveBeenCalled();
  });
  it("rolls back routing if durable pause storage fails", async () => {
    const f = fixture();
    f.tx.scheduledJob.upsert.mockRejectedValueOnce(new Error("storage unavailable"));
    await expect(pauseLocalProvider({ providerId: "local", actorId: "operator" }, f.deps)).rejects.toThrow("storage unavailable");
    expect(f.state.connection.status).toBe("active");
    expect(f.state.provider.status).toBe("active");
  });
  it("keeps the pause durable when event delivery fails", async () => {
    const f = fixture();
    f.send.mockRejectedValueOnce(new Error("queue unavailable"));
    const result = await pauseLocalProvider({ providerId: "local", actorId: "operator", duration: { value: 1, unit: "hours" } }, f.deps);
    expect(result.deliveryPending).toBe(true);
    expect(f.state.connection.status).toBe("paused");
    expect(f.state.job?.nextRunAt).toEqual(new Date("2026-10-12T03:00:00Z"));
  });
  it("cannot expire a newer or indefinite pause with an old timer", async () => {
    const f = fixture();
    const old = await pauseLocalProvider({ providerId: "local", actorId: "operator", duration: { value: 1, unit: "hours" } }, f.deps);
    await pauseLocalProvider({ providerId: "local", actorId: "operator" }, f.deps);
    expect(await resumeLocalProvider({ providerId: "local", automatic: true, operationId: old.operationId }, { ...f.deps, now: new Date("2026-10-13T00:00:00Z") })).toMatchObject({ outcome: "superseded" });
    expect(f.state.connection.status).toBe("paused");
    expect(f.probe).not.toHaveBeenCalled();
  });
  it("does not run a timer before its expiry", async () => {
    const f = fixture();
    const pause = await pauseLocalProvider({ providerId: "local", actorId: "operator", duration: { value: 1, unit: "hours" } }, f.deps);
    expect(await resumeLocalProvider({ providerId: "local", automatic: true, operationId: pause.operationId }, f.deps)).toMatchObject({ outcome: "not-due" });
    expect(f.probe).not.toHaveBeenCalled();
  });
  it("checks health while routing is still paused before early resume", async () => {
    const f = fixture();
    await pauseLocalProvider({ providerId: "local", actorId: "operator" }, f.deps);
    f.probe.mockImplementationOnce(async () => { expect(f.state.connection.status).toBe("paused"); return true; });
    expect(await resumeLocalProvider({ providerId: "local" }, f.deps)).toMatchObject({ outcome: "resumed", status: "active" });
    expect(f.state.connection.status).toBe("active");
  });
  it("rechecks generation after a health probe so a concurrent newer pause wins", async () => {
    const f = fixture();
    const old = await pauseLocalProvider({ providerId: "local", actorId: "operator" }, f.deps);
    f.probe.mockImplementationOnce(async () => { await pauseLocalProvider({ providerId: "local", actorId: "operator" }, f.deps); return true; });
    expect(await resumeLocalProvider({ providerId: "local", operationId: old.operationId }, f.deps)).toMatchObject({ outcome: "superseded" });
    expect(f.state.connection.status).toBe("paused");
  });
  it("removes only the pause and preserves a new independent provider restriction", async () => {
    const f = fixture();
    await pauseLocalProvider({ providerId: "local", actorId: "operator" }, f.deps);
    f.state.provider.status = "disabled";
    expect(await resumeLocalProvider({ providerId: "local" }, f.deps)).toMatchObject({ outcome: "resumed", status: "disabled" });
    expect(f.state.provider.status).toBe("disabled");
  });
  it("preserves an account restriction that changes after the pause read", async () => {
    const f = fixture();
    await pauseLocalProvider({ providerId: "local", actorId: "operator" }, f.deps);
    f.tx.modelProvider.findUnique.mockImplementationOnce(async () => {
      f.state.connection.status = "disabled";
      return f.state.provider;
    });
    expect(await resumeLocalProvider({ providerId: "local" }, f.deps)).toMatchObject({ outcome: "superseded" });
    expect(f.state.connection.status).toBe("disabled");
    expect(f.state.provider.status).toBe("inactive");
    expect(f.state.job?.lastStatus).toBe("paused");
    expect(f.state.audit).toHaveLength(1);
  });
  it("does not route to an unhealthy provider merely because the pause ended", async () => {
    const f = fixture();
    const pause = await pauseLocalProvider({ providerId: "local", actorId: "operator", duration: { value: 1, unit: "hours" } }, f.deps);
    f.probe.mockResolvedValueOnce(false);
    expect(await resumeLocalProvider({ providerId: "local", automatic: true, operationId: pause.operationId }, { ...f.deps, now: new Date("2026-10-12T03:00:00Z") })).toMatchObject({ outcome: "resumed", status: "inactive" });
    expect(f.state.provider.status).toBe("inactive");
  });
  it("recovers a durable overdue pause without its original event after restart", async () => {
    const f = fixture();
    f.send.mockRejectedValueOnce(new Error("event unavailable"));
    await pauseLocalProvider({ providerId: "local", actorId: "operator", duration: { value: 1, unit: "hours" } }, f.deps);
    expect(await reconcileOverdueProviderPauses({ ...f.deps, now: new Date("2026-10-12T04:00:00Z") })).toBe(1);
    expect(f.state.provider.status).toBe("active");
    expect(f.state.job?.nextRunAt).toBeNull();
    expect(await reconcileOverdueProviderPauses({ ...f.deps, now: new Date("2026-10-12T04:01:00Z") })).toBe(0);
  });
  it("fails closed for malformed or mismatched durable identity", async () => {
    const f = fixture();
    const pause = await pauseLocalProvider({ providerId: "local", actorId: "operator" }, f.deps);
    f.state.job!.metadata = { ...(f.state.job!.metadata as Record<string, unknown>), providerId: "ollama" };
    expect(await resumeLocalProvider({ providerId: "local", operationId: pause.operationId }, f.deps)).toMatchObject({ outcome: "superseded" });
    expect(f.state.connection.status).toBe("paused");
    expect(f.probe).not.toHaveBeenCalled();
  });
  it("does not activate a provider whose account had an independent restriction", async () => {
    const f = fixture();
    f.state.connection.status = "disabled";
    await pauseLocalProvider({ providerId: "local", actorId: "operator" }, f.deps);
    await resumeLocalProvider({ providerId: "local" }, f.deps);
    expect(f.state.connection.status).toBe("disabled");
    expect(f.state.provider.status).toBe("inactive");
  });
  it("retires an old timer after another account control superseded the pause", async () => {
    const f = fixture();
    const pause = await pauseLocalProvider({ providerId: "local", actorId: "operator", duration: { value: 1, unit: "hours" } }, f.deps);
    f.state.connection.status = "inactive";
    const result = await resumeLocalProvider({ providerId: "local", automatic: true, operationId: pause.operationId }, { ...f.deps, now: new Date("2026-10-12T04:00:00Z") });
    expect(result.outcome).toBe("superseded");
    expect(f.state.job?.lastStatus).toBe("superseded");
    expect(f.state.job?.nextRunAt).toBeNull();
    expect(f.state.connection.status).toBe("inactive");
    expect(f.probe).not.toHaveBeenCalled();
  });
});


describe("restoring the exact persisted operator pause", () => {
  async function resumed() {
    const f = fixture();
    const original = await pauseLocalProvider({ providerId: "local", actorId: "original-operator", duration: { value: 1, unit: "hours" } }, f.deps);
    await resumeLocalProvider({ providerId: "local", actorId: "window-operator" }, { ...f.deps, now: new Date("2026-10-12T02:01:00Z") });
    const input = { providerId: "local", connectionId: "provider-default-local", expectedOperationId: original.operationId, actorId: "restoring-operator" };
    return { ...f, input, restoreDeps: { ...f.deps, now: new Date("2026-10-12T02:10:00Z") } };
  }
  it("restores the original exact expiry with a new attributable generation", async () => {
    const f = await resumed();
    const result = await restoreOperatorProviderPause(f.input, f.restoreDeps);
    expect(result).toMatchObject({ outcome: "restored", resumeAt: "2026-10-12T03:00:00.000Z" });
    expect(result.operationId).not.toBe(f.input.expectedOperationId);
    expect(f.state.job).toMatchObject({ lastStatus: "paused", nextRunAt: new Date("2026-10-12T03:00:00Z"), metadata: { restoredFromOperationId: f.input.expectedOperationId, actorId: "restoring-operator", priorProviderStatus: "active", priorConnectionStatus: "active" } });
    expect(f.state.provider.status).toBe("inactive");
    expect(f.state.connection.status).toBe("paused");
    expect(f.state.audit.at(-1)).toMatchObject({ userId: "restoring-operator", parameters: { action: "restore-pause", restoredFromOperationId: f.input.expectedOperationId } });
    expect(f.send).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ operationId: result.operationId, resumeAt: result.resumeAt }) }));
  });
  it("observes a duplicate restoration without another effect, audit, timer or probe", async () => {
    const f = await resumed();
    const first = await restoreOperatorProviderPause(f.input, f.restoreDeps);
    const counts = [f.state.audit.length, f.send.mock.calls.length, f.probe.mock.calls.length];
    expect(await restoreOperatorProviderPause(f.input, f.restoreDeps)).toMatchObject({ outcome: "already-restored", operationId: first.operationId, resumeAt: first.resumeAt });
    expect([f.state.audit.length, f.send.mock.calls.length, f.probe.mock.calls.length]).toEqual(counts);
  });
  it("does not allow an old timer to expire the restored generation", async () => {
    const f = await resumed();
    await restoreOperatorProviderPause(f.input, f.restoreDeps);
    expect(await resumeLocalProvider({ providerId: "local", automatic: true, operationId: f.input.expectedOperationId }, { ...f.deps, now: new Date("2026-10-12T03:01:00Z") })).toMatchObject({ outcome: "superseded" });
    expect(f.state.connection.status).toBe("paused");
  });
  it("preserves a newer independent provider veto", async () => {
    const f = await resumed();
    f.state.provider.status = "disabled";
    await restoreOperatorProviderPause(f.input, f.restoreDeps);
    expect(f.state.provider.status).toBe("disabled");
    expect(f.state.connection.status).toBe("paused");
  });
  it("refuses a concurrent operator generation observed after acquiring the lock", async () => {
    const f = await resumed();
    f.tx.$queryRaw.mockImplementationOnce(async () => { (f.state.job!.metadata as Record<string, unknown>).operationId = "newer-operation"; return []; });
    await expect(restoreOperatorProviderPause(f.input, f.restoreDeps)).rejects.toThrow(/source.*changed|superseded/i);
    expect(f.state.connection.status).toBe("active");
    expect(f.state.audit).toHaveLength(2);
  });
  it("refuses to overwrite a later operator pause", async () => {
    const f = await resumed();
    await pauseLocalProvider({ providerId: "local", actorId: "new-operator" }, f.restoreDeps);
    await expect(restoreOperatorProviderPause(f.input, f.restoreDeps)).rejects.toThrow(/source.*changed|superseded/i);
    expect(f.state.job?.metadata).toMatchObject({ actorId: "new-operator", resumeAt: null });
  });
  it.each([
    { operationId: "different" }, { providerId: "ollama" }, { kind: "different" },
    { resumeAt: null }, { resumeAt: "invalid" }, { resumeAt: "2026-10-12T02:05:00Z" },
    { resumedAt: undefined }, { resumedAt: "invalid" }, { resumedAt: "2026-10-12T03:00:00Z" },
  ])("refuses invalid or expired persisted source without effects: %j", async change => {
    const f = await resumed();
    Object.assign(f.state.job!.metadata as Record<string, unknown>, change);
    await expect(restoreOperatorProviderPause(f.input, f.restoreDeps)).rejects.toThrow(/source|expiry|superseded/i);
    expect(f.state.connection.status).toBe("active");
    expect(f.state.audit).toHaveLength(2);
  });
  it.each(["inactive", "disabled", "unconfigured", "error", "paused"])("preserves an independent current account restriction %s", async status => {
    const f = await resumed(); f.state.connection.status = status;
    await expect(restoreOperatorProviderPause(f.input, f.restoreDeps)).rejects.toThrow(/source|account|superseded/i);
    expect(f.state.connection.status).toBe(status);
  });
  it("rechecks DEV purpose under the transaction lock before restoring", async () => {
    const f = await resumed();
    f.tx.$queryRaw.mockImplementationOnce(async () => { restorationStance.read.mockResolvedValue({ environmentClass: "production", primaryPurpose: "evolve-dpf" }); return []; });
    await expect(restoreOperatorProviderPause(f.input, f.restoreDeps)).rejects.toThrow(/development|DEV|eligibility/i);
    expect(f.state.connection.status).toBe("active");
    expect(f.state.audit).toHaveLength(2);
  });
  it("does not restore a deadline that expires while waiting for its lock", async () => {
    const f = await resumed();
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-12T02:10:00Z"));
      f.tx.$queryRaw.mockImplementationOnce(async () => { vi.setSystemTime(new Date("2026-10-12T03:01:00Z")); return []; });
      await expect(restoreOperatorProviderPause(f.input, { ...f.deps, now: undefined })).rejects.toThrow(/source|expired/i);
      expect(f.state.connection.status).toBe("active");
    } finally { vi.useRealTimers(); }
  });
  it("binds the selected account before opening a restoration transaction", async () => {
    const f = await resumed(); f.db.$transaction.mockClear();
    await expect(restoreOperatorProviderPause({ ...f.input, connectionId: "additional-local-account" }, f.restoreDeps)).rejects.toThrow(/account|identity/i);
    expect(f.db.$transaction).not.toHaveBeenCalled();
    expect(f.state.connection.status).toBe("active");
  });
  it("requires a trusted actor before any transaction", async () => {
    const f = await resumed(); f.db.$transaction.mockClear();
    await expect(restoreOperatorProviderPause({ ...f.input, actorId: "" }, f.restoreDeps)).rejects.toThrow(/identity/i);
    expect(f.db.$transaction).not.toHaveBeenCalled();
  });
  it("rolls back restoration when its attributable audit cannot persist", async () => {
    const f = await resumed(); f.tx.adminActivity.create.mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(restoreOperatorProviderPause(f.input, f.restoreDeps)).rejects.toThrow("audit unavailable");
    // Read through the DB mock: rollback replaces its state object.
    expect(await f.tx.aiProviderConnection.findUnique()).toMatchObject({ status: "active" });
  });
  it("keeps the exact durable timer if event delivery fails", async () => {
    const f = await resumed(); f.send.mockRejectedValueOnce(new Error("queue unavailable"));
    expect(await restoreOperatorProviderPause(f.input, f.restoreDeps)).toMatchObject({ outcome: "restored", deliveryPending: true, resumeAt: "2026-10-12T03:00:00.000Z" });
    expect(f.state.job?.nextRunAt).toEqual(new Date("2026-10-12T03:00:00Z"));
    expect(f.state.connection.status).toBe("paused");
  });
});
