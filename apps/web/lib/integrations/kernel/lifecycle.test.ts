import { describe, expect, it, vi } from "vitest";

import { ConnectorError } from "./error";
import {
  composeConnectorLifecyclePersistence,
  createConnectorLifecycle,
  recordConnectorAuditInTransaction,
  runConnectorSync,
  type LifecyclePersistence,
} from "./lifecycle";
import { defaultConnectorSleep, retryConnectorOperation } from "./retry";
import { createSingleFlight } from "./single-flight";

function persistence(): LifecyclePersistence<{ token?: string; checkpoint?: string }> & {
  state: { token?: string; checkpoint?: string };
} {
  const target = { state: {} as { token?: string; checkpoint?: string } };
  return Object.assign(target, {
    async transact<T>(operation: (draft: { token?: string; checkpoint?: string }) => Promise<T>) {
      const draft = structuredClone(target.state);
      const result = await operation(draft);
      target.state = draft;
      return result;
    },
  });
}

describe("connector lifecycle", () => {
  it("composes credential writes and the Task 4 audit sink in the same caller-owned transaction", async () => {
    const events: string[] = [];
    const store = {
      async composeInTransaction<T>(operation: (context: { credentials: { save(): Promise<void> }; transaction: { integrationToolCallLog: { create(args: unknown): Promise<void> } } }) => Promise<T>) {
        const staged: string[] = [];
        const result = await operation({
          credentials: { save: async () => { staged.push("credential"); } },
          transaction: { integrationToolCallLog: { create: async (_args?: unknown) => { staged.push("audit"); } } },
        });
        events.push(...staged);
        return result;
      },
    };
    const composed = composeConnectorLifecyclePersistence(store);
    await composed.transact(async ({ credentials, transaction }) => {
      await credentials.save();
      await recordConnectorAuditInTransaction(transaction.integrationToolCallLog, {
        connectorId: "fixture", actor: { coworkerId: "worker", userId: null }, operation: "connect",
        redactedInput: {}, responseKind: "success", durationMs: 1,
      }, () => new Date(0));
    });
    expect(events).toEqual(["credential", "audit"]);
  });

  it("projects the complete setup/health transition table", async () => {
    const lifecycle = createConnectorLifecycle({ persistence: persistence() });
    expect(lifecycle.projectHealth(null)).toEqual({ state: "unconfigured" });
    expect(lifecycle.projectHealth({ connected: false, error: "bad configuration" })).toEqual({
      state: "error", error: "bad configuration",
    });
    expect(lifecycle.projectHealth({ connected: true, probe: { ok: true } })).toEqual({ state: "connected" });
    expect(lifecycle.projectHealth({ connected: true, probe: { ok: false, error: "offline" } })).toEqual({
      state: "degraded", error: "offline",
    });
  });

  it("persists connect and its audit atomically after network work", async () => {
    const db = persistence();
    let networkFinished = false;
    const lifecycle = createConnectorLifecycle<typeof db.state, { token: string }>({ persistence: db });
    await lifecycle.connect({
      exchange: async () => { networkFinished = true; return { token: "new" }; },
      persist: async (draft, session) => { expect(networkFinished).toBe(true); draft.token = session.token; },
      audit: async () => undefined,
      onFailure: async () => undefined,
    });
    expect(db.state.token).toBe("new");
  });

  it("records an initial connect error and a successful recovery clears it", async () => {
    type RecoveryDraft = { token?: string; checkpoint?: string; error?: string; audited?: boolean };
    const db = persistence() as ReturnType<typeof persistence> & { state: RecoveryDraft };
    const lifecycle = createConnectorLifecycle<RecoveryDraft>({
      persistence: db as unknown as LifecyclePersistence<RecoveryDraft>,
    });
    await expect(lifecycle.connect({
      exchange: async () => { throw new ConnectorError("authentication", "rejected"); },
      persist: async () => undefined,
      audit: async () => undefined,
      onFailure: async (draft, error) => { draft.error = (error as Error).message; draft.audited = true; },
    })).rejects.toThrow("rejected");
    expect(db.state).toMatchObject({ error: "rejected", audited: true });
    await lifecycle.connect({
      exchange: async () => ({ token: "working" }),
      persist: async (draft, result) => { draft.token = result.token; delete draft.error; delete draft.audited; },
      audit: async () => undefined,
      onFailure: async () => undefined,
    });
    expect(db.state).toEqual({ token: "working" });
  });

  it("rolls back initial failed-connect error state when its required audit fails", async () => {
    const committed: string[] = [];
    const persistence = composeConnectorLifecyclePersistence({
      async composeInTransaction<T>(callback: (context: { credentials: { mark(value: string): void }; transaction: { integrationToolCallLog: { create(args: unknown): Promise<void> } } }) => Promise<T>) {
        const staged: string[] = [];
        const result = await callback({
          credentials: { mark: (value) => staged.push(value) },
          transaction: { integrationToolCallLog: { create: async () => { throw new Error("audit unavailable"); } } },
        });
        committed.push(...staged);
        return result;
      },
    });
    const lifecycle = createConnectorLifecycle({ persistence });
    await expect(lifecycle.connect({
      exchange: async () => { throw new ConnectorError("authentication", "rejected"); },
      persist: async () => undefined,
      audit: async () => undefined,
      onFailure: async (draft) => {
        draft.credentials.mark("error");
        await recordConnectorAuditInTransaction(draft.transaction.integrationToolCallLog, {
          connectorId: "fixture", actor: { coworkerId: "worker", userId: null }, operation: "connect",
          redactedInput: {}, responseKind: "authentication", durationMs: 1,
        });
      },
    })).rejects.toThrow("Connector audit persistence failed");
    expect(committed).toEqual([]);
  });

  it.each(["connect", "disconnect", "refresh"] as const)("rolls back %s when audit fails", async (operation) => {
    const db = persistence();
    db.state = { token: "valid" };
    const lifecycle = createConnectorLifecycle<typeof db.state, { token: string }>({ persistence: db });
    const audit = async () => { throw new Error("audit unavailable"); };
    await expect(operation === "connect"
      ? lifecycle.connect({ exchange: async () => ({ token: "replacement" }), persist: async (d, s) => { d.token = s.token; }, audit, onFailure: async () => undefined })
      : operation === "disconnect"
        ? lifecycle.disconnect({ persist: async (d) => { delete d.token; }, audit })
        : lifecycle.refresh({ connectorId: "one", refresh: async () => ({ token: "rotated" }), persist: async (d, s) => { d.token = s.token; }, audit }))
      .rejects.toThrow("audit unavailable");
    expect(db.state.token).toBe("valid");
  });

  it.each(["connect", "disconnect", "refresh", "sync"] as const)("passes one composed transaction context through %s persistence and audit", async (operation) => {
    const committed: string[] = [];
    const store = {
      async composeInTransaction<T>(callback: (context: { credentials: { mark(value: string): void }; transaction: { integrationToolCallLog: { create(args: unknown): Promise<void> } } }) => Promise<T>) {
        const staged: string[] = [];
        const result = await callback({
          credentials: { mark: (value) => staged.push(value) },
          transaction: { integrationToolCallLog: { create: async () => { staged.push("audit"); } } },
        });
        committed.push(...staged);
        return result;
      },
    };
    const persistence = composeConnectorLifecyclePersistence(store);
    const audit = async (draft: Awaited<Parameters<Parameters<typeof persistence.transact>[0]>[0]>) => {
      await recordConnectorAuditInTransaction(draft.transaction.integrationToolCallLog, {
        connectorId: "fixture", actor: { coworkerId: "worker", userId: null }, operation: operation === "sync" ? "sync" : operation,
        redactedInput: {}, responseKind: "success", durationMs: 1,
      });
    };
    const lifecycle = createConnectorLifecycle({ persistence });
    if (operation === "connect") await lifecycle.connect({ exchange: async () => "connect", persist: async (d) => d.credentials.mark("connect"), audit, onFailure: async () => undefined });
    if (operation === "disconnect") await lifecycle.disconnect({ persist: async (d) => d.credentials.mark("disconnect"), audit });
    if (operation === "refresh") await lifecycle.refresh({ connectorId: "credential-row-id", refresh: async () => "refresh", persist: async (d) => d.credentials.mark("refresh"), audit });
    if (operation === "sync") await runConnectorSync({ request: { idempotencyKey: "sync-id" }, persistence, retry: { maxAttempts: 1, initialDelayMs: 0, maxDelayMs: 0 }, sync: async () => ({ resultCount: 1, checkpoint: "sync" }), persist: async (d) => d.credentials.mark("sync"), audit });
    expect(committed).toEqual([operation, "audit"]);
  });

  it.each(["connect", "disconnect", "refresh", "sync"] as const)("rolls back composed %s state when its transaction-scoped audit fails", async (operation) => {
    const committed: string[] = [];
    const store = {
      async composeInTransaction<T>(callback: (context: { credentials: { mark(value: string): void }; transaction: { integrationToolCallLog: { create(args: unknown): Promise<void> } } }) => Promise<T>) {
        const staged: string[] = [];
        const result = await callback({
          credentials: { mark: (value) => staged.push(value) },
          transaction: { integrationToolCallLog: { create: async (_args?: unknown) => { throw new Error("audit unavailable"); } } },
        });
        committed.push(...staged);
        return result;
      },
    };
    const persistence = composeConnectorLifecyclePersistence(store);
    const audit = async (draft: Awaited<Parameters<Parameters<typeof persistence.transact>[0]>[0]>) => {
      await recordConnectorAuditInTransaction(draft.transaction.integrationToolCallLog, {
        connectorId: "fixture", actor: { coworkerId: "worker", userId: null }, operation: operation === "sync" ? "sync" : operation,
        redactedInput: {}, responseKind: "success", durationMs: 1,
      });
    };
    const lifecycle = createConnectorLifecycle({ persistence });
    const execution = operation === "connect"
      ? lifecycle.connect({ exchange: async () => "connect", persist: async (d) => d.credentials.mark("connect"), audit, onFailure: async () => undefined })
      : operation === "disconnect"
        ? lifecycle.disconnect({ persist: async (d) => d.credentials.mark("disconnect"), audit })
        : operation === "refresh"
          ? lifecycle.refresh({ connectorId: "credential-row-id", refresh: async () => "refresh", persist: async (d) => d.credentials.mark("refresh"), audit })
          : runConnectorSync({ request: { idempotencyKey: "sync-id" }, persistence, retry: { maxAttempts: 1, initialDelayMs: 0, maxDelayMs: 0 }, sync: async () => ({ resultCount: 1, checkpoint: "sync" }), persist: async (d) => d.credentials.mark("sync"), audit });
    await expect(execution).rejects.toThrow("Connector audit persistence failed");
    expect(committed).toEqual([]);
  });

  it("single-flights refresh-token rotation and retains the last token on failure", async () => {
    const db = persistence(); db.state = { token: "old" };
    const lifecycle = createConnectorLifecycle<typeof db.state, { token: string }>({ persistence: db });
    const refresh = vi.fn(async () => ({ token: "new" }));
    const persist = vi.fn(async (d: typeof db.state, s: { token: string }) => { d.token = s.token; });
    const audit = vi.fn(async () => undefined);
    const results = await Promise.all([1, 2, 3].map(() => lifecycle.refresh({
      connectorId: "credential-row-id", refresh, persist, audit,
    })));
    expect(results).toEqual([{ token: "new" }, { token: "new" }, { token: "new" }]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledTimes(1);
    expect(db.state.token).toBe("new");
    await expect(lifecycle.refresh({ connectorId: "failed", refresh: async () => { throw new Error("nope"); }, persist: async () => undefined, audit: async () => undefined })).rejects.toThrow("nope");
    expect(db.state.token).toBe("new");
  });

  it("re-exchanges expired client credentials without sharing refresh state", async () => {
    const db = persistence();
    const lifecycle = createConnectorLifecycle({ persistence: db });
    const exchange = vi.fn(async () => ({ token: "fresh" }));
    await lifecycle.ensureClientCredential({ expired: true, exchange, persist: async (d, s) => { d.token = s.token; }, audit: async () => undefined });
    expect(exchange).toHaveBeenCalledOnce();
    expect(db.state.token).toBe("fresh");
  });
});

describe("retry and sync", () => {
  it("honors capped Retry-After and deterministic backoff while preserving the idempotency key", async () => {
    const sleeps: number[] = [];
    const keys: string[] = [];
    let attempt = 0;
    const result = await retryConnectorOperation({ maxAttempts: 3, initialDelayMs: 100, maxDelayMs: 500 }, {
      idempotencyKey: "same-key", sleep: async (ms) => { sleeps.push(ms); }, jitter: (delay) => delay,
      operation: async (key) => {
        keys.push(key!); attempt += 1;
        if (attempt === 1) throw new ConnectorError("rate_limited", "later", { retryAfterMs: 10_000 });
        if (attempt === 2) throw new ConnectorError("upstream_unavailable", "down");
        return "ok";
      },
    });
    expect(result).toBe("ok");
    expect(sleeps).toEqual([500, 200]);
    expect(keys).toEqual(["same-key", "same-key", "same-key"]);
  });

  it("does not retry unsafe work, terminal errors, or cancellation", async () => {
    const unsafe = vi.fn(async () => { throw new ConnectorError("upstream_unavailable", "down"); });
    await expect(retryConnectorOperation({ maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 2 }, { operation: unsafe })).rejects.toThrow();
    expect(unsafe).toHaveBeenCalledOnce();
    const terminal = vi.fn(async () => { throw new ConnectorError("authentication", "bad"); });
    await expect(retryConnectorOperation({ maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 2 }, { idempotencyKey: "k", operation: terminal })).rejects.toThrow();
    expect(terminal).toHaveBeenCalledOnce();
    const controller = new AbortController(); controller.abort();
    const cancelled = vi.fn();
    await expect(retryConnectorOperation({ maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 2 }, { idempotencyKey: "k", signal: controller.signal, operation: cancelled })).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelled).not.toHaveBeenCalled();
  });

  it("persists sync checkpoint and audit atomically after retry", async () => {
    const db = persistence(); let calls = 0;
    await runConnectorSync({
      request: { cursor: "c0", idempotencyKey: "sync-key" }, persistence: db,
      retry: { maxAttempts: 2, initialDelayMs: 0, maxDelayMs: 0 },
      sync: async (request) => { calls += 1; if (calls === 1) throw new ConnectorError("upstream_unavailable", "down"); return { nextCursor: "c1", resultCount: 2, checkpoint: "p1" }; },
      persist: async (draft, result) => { draft.checkpoint = result.checkpoint; }, audit: async () => undefined,
    });
    expect(db.state.checkpoint).toBe("p1");
    expect(calls).toBe(2);
    await expect(runConnectorSync({
      request: { cursor: "c1", idempotencyKey: "sync-key" }, persistence: db,
      retry: { maxAttempts: 1, initialDelayMs: 0, maxDelayMs: 0 },
      sync: async () => ({ nextCursor: "c2", resultCount: 1, checkpoint: "p2" }),
      persist: async (draft, result) => { draft.checkpoint = result.checkpoint; }, audit: async () => { throw new Error("audit"); },
    })).rejects.toThrow("audit");
    expect(db.state.checkpoint).toBe("p1");
  });

  it("provides a reusable keyed single-flight primitive", async () => {
    const flight = createSingleFlight<number>(); const work = vi.fn(async () => 7);
    expect(await Promise.all([flight.run("a", work), flight.run("a", work)])).toEqual([7, 7]);
    expect(work).toHaveBeenCalledOnce();
    // The key is the unique IntegrationCredential.integrationId, never a provider slug.
    // @ts-expect-error One flight instance cannot mix result types for the same credential identity.
    if (false) void flight.run("credential-row-id", async () => "wrong result type");
  });

  it("cleans the default sleep abort listener after resolve and abort", async () => {
    vi.useFakeTimers();
    const first = new AbortController();
    const removeResolved = vi.spyOn(first.signal, "removeEventListener");
    const resolved = defaultConnectorSleep(10, first.signal);
    await vi.advanceTimersByTimeAsync(10);
    await resolved;
    expect(removeResolved).toHaveBeenCalledWith("abort", expect.any(Function));

    const second = new AbortController();
    const removeAborted = vi.spyOn(second.signal, "removeEventListener");
    const aborted = defaultConnectorSleep(10, second.signal);
    second.abort();
    await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
    expect(removeAborted).toHaveBeenCalledWith("abort", expect.any(Function));
    vi.useRealTimers();
  });
});
