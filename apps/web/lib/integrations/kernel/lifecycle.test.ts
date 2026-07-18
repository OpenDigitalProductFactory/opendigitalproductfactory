import { describe, expect, expectTypeOf, it, vi } from "vitest";

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

function durableAttemptFixture(initial: { token?: string; checkpoint?: string } = {}) {
  type State = { token?: string; checkpoint?: string };
  type Draft = {
    state: State;
    transaction: { integrationToolCallLog: { create(args: { data: unknown }): Promise<void> } };
  };
  let state = structuredClone(initial);
  const auditRows: unknown[] = [];
  const persistence: LifecyclePersistence<Draft> = {
    async transact<T>(operation: (draft: Draft) => Promise<T>) {
      const nextState = structuredClone(state);
      const stagedAudit: unknown[] = [];
      const result = await operation({
        state: nextState,
        transaction: { integrationToolCallLog: { create: async ({ data }) => { stagedAudit.push(data); } } },
      });
      state = nextState;
      auditRows.push(...stagedAudit);
      return result;
    },
  };
  const durableAudit = (operation: "disconnect" | "health" | "refresh" | "sync", responseKind: string) =>
    async (draft: Draft, failure?: { kind: string; safeMessage: string }) => {
      await recordConnectorAuditInTransaction(draft.transaction.integrationToolCallLog, {
        connectorId: "fixture", actor: { coworkerId: "worker", userId: null }, operation,
        redactedInput: {}, responseKind, durationMs: 1,
        error: failure ? { kind: failure.kind === "cancelled" ? "internal" : failure.kind as never, safeMessage: failure.safeMessage } : null,
      }, () => new Date(0));
    };
  return { persistence, auditRows, durableAudit, state: () => state };
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
      persistFailure: async () => undefined,
      auditFailure: async () => undefined,
    });
    expect(db.state.token).toBe("new");
  });

  it("records an initial connect error and a successful recovery clears it", async () => {
    type RecoveryDraft = { token?: string; checkpoint?: string; error?: string };
    const failureAudits: string[] = [];
    const db = persistence() as ReturnType<typeof persistence> & { state: RecoveryDraft };
    const lifecycle = createConnectorLifecycle<RecoveryDraft>({
      persistence: db as unknown as LifecyclePersistence<RecoveryDraft>,
    });
    await expect(lifecycle.connect({
      exchange: async () => { throw new ConnectorError("authentication", "rejected"); },
      persist: async () => undefined,
      audit: async () => undefined,
      persistFailure: async (draft, failure) => { draft.error = failure.safeMessage; },
      auditFailure: async (_draft, failure) => { failureAudits.push(`${failure.kind}:${failure.safeMessage}`); },
    })).rejects.toThrow("Connector authentication failed.");
    expect(db.state).toMatchObject({ error: "Connector authentication failed." });
    expect(failureAudits).toEqual(["authentication:Connector authentication failed."]);
    await lifecycle.connect({
      exchange: async () => ({ token: "working" }),
      persist: async (draft, result) => { draft.token = result.token; delete draft.error; },
      audit: async () => undefined,
      persistFailure: async () => undefined,
      auditFailure: async () => undefined,
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
      persistFailure: async (draft) => { draft.credentials.mark("error"); },
      auditFailure: async (draft) => {
        await recordConnectorAuditInTransaction(draft.transaction.integrationToolCallLog, {
          connectorId: "fixture", actor: { coworkerId: "worker", userId: null }, operation: "connect",
          redactedInput: {}, responseKind: "authentication", durationMs: 1,
        });
      },
    })).rejects.toMatchObject({ failure: { kind: "internal", safeMessage: "Connector operation failed." } });
    expect(committed).toEqual([]);
  });

  it("commits failed-connect error state with its actual durable audit row", async () => {
    const committed: unknown[] = [];
    const persistence = composeConnectorLifecyclePersistence({
      async composeInTransaction<T>(callback: (context: { credentials: { mark(value: string): void }; transaction: { integrationToolCallLog: { create(args: unknown): Promise<void> } } }) => Promise<T>) {
        const staged: unknown[] = [];
        const result = await callback({
          credentials: { mark: (value) => staged.push(value) },
          transaction: { integrationToolCallLog: { create: async (args) => { staged.push(args); } } },
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
      persistFailure: async (draft) => { draft.credentials.mark("error"); },
      auditFailure: async (draft) => {
        await recordConnectorAuditInTransaction(draft.transaction.integrationToolCallLog, {
          connectorId: "fixture", actor: { coworkerId: "worker", userId: null }, operation: "connect",
          redactedInput: {}, responseKind: "authentication", durationMs: 1,
          error: { kind: "authentication", safeMessage: "Connector authentication failed." },
        }, () => new Date(0));
      },
    })).rejects.toThrow("Connector authentication failed.");
    expect(committed[0]).toBe("error");
    expect(committed[1]).toMatchObject({ data: {
      integration: "fixture", toolName: "connect", responseKind: "authentication",
      errorCode: "authentication", errorMessage: "Connector authentication failed.",
    } });
  });

  it("durably audits a connect persistence failure without committing credential state", async () => {
    const fixture = durableAttemptFixture({ token: "old" });
    const lifecycle = createConnectorLifecycle({ persistence: fixture.persistence });
    await expect(lifecycle.connect({
      exchange: async () => ({ token: "new" }),
      persist: async () => { throw new Error("credential write failed"); },
      audit: async () => undefined,
      persistFailure: async () => undefined,
      auditFailure: async (draft) => {
        await recordConnectorAuditInTransaction(draft.transaction.integrationToolCallLog, {
          connectorId: "fixture", actor: { coworkerId: "worker", userId: null }, operation: "connect",
          redactedInput: {}, responseKind: "failed", durationMs: 1,
          error: { kind: "internal", safeMessage: "Connector credential persistence failed." },
        });
      },
    })).rejects.toThrow("Connector operation failed.");
    expect(fixture.state().token).toBe("old");
    expect(fixture.auditRows).toHaveLength(1);
  });

  it.each(["connect", "disconnect", "refresh"] as const)("rolls back %s when audit fails", async (operation) => {
    const db = persistence();
    db.state = { token: "valid" };
    const lifecycle = createConnectorLifecycle<typeof db.state, { token: string }>({ persistence: db });
    const audit = async () => { throw new Error("audit unavailable"); };
    await expect(operation === "connect"
      ? lifecycle.connect({ exchange: async () => ({ token: "replacement" }), persist: async (d, s) => { d.token = s.token; }, audit, persistFailure: async () => undefined, auditFailure: async () => undefined })
      : operation === "disconnect"
        ? lifecycle.disconnect({ persist: async (d) => { delete d.token; }, audit, auditFailure: async () => undefined })
        : lifecycle.refresh({ connectorId: "one", refresh: async () => ({ token: "rotated" }), persist: async (d, s) => { d.token = s.token; }, audit, auditFailure: async () => undefined }))
      .rejects.toMatchObject({ failure: { kind: "internal", safeMessage: "Connector operation failed." } });
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
    if (operation === "connect") await lifecycle.connect({ exchange: async () => "connect", persist: async (d) => d.credentials.mark("connect"), audit, persistFailure: async () => undefined, auditFailure: async () => undefined });
    if (operation === "disconnect") await lifecycle.disconnect({ persist: async (d) => d.credentials.mark("disconnect"), audit, auditFailure: async () => undefined });
    if (operation === "refresh") await lifecycle.refresh({ connectorId: "credential-row-id", refresh: async () => "refresh", persist: async (d) => d.credentials.mark("refresh"), audit, auditFailure: async () => undefined });
    if (operation === "sync") await runConnectorSync({ request: { idempotencyKey: "sync-id" }, persistence, retry: { maxAttempts: 1, initialDelayMs: 0, maxDelayMs: 0 }, sync: async () => ({ resultCount: 1, checkpoint: "sync" }), persist: async (d) => d.credentials.mark("sync"), audit, auditFailure: async () => undefined });
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
      ? lifecycle.connect({ exchange: async () => "connect", persist: async (d) => d.credentials.mark("connect"), audit, persistFailure: async () => undefined, auditFailure: async () => undefined })
      : operation === "disconnect"
        ? lifecycle.disconnect({ persist: async (d) => d.credentials.mark("disconnect"), audit, auditFailure: audit })
        : operation === "refresh"
          ? lifecycle.refresh({ connectorId: "credential-row-id", refresh: async () => "refresh", persist: async (d) => d.credentials.mark("refresh"), audit, auditFailure: audit })
          : runConnectorSync({ request: { idempotencyKey: "sync-id" }, persistence, retry: { maxAttempts: 1, initialDelayMs: 0, maxDelayMs: 0 }, sync: async () => ({ resultCount: 1, checkpoint: "sync" }), persist: async (d) => d.credentials.mark("sync"), audit, auditFailure: audit });
    await expect(execution).rejects.toMatchObject({ failure: { kind: "internal", safeMessage: "Connector operation failed." } });
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
      auditFailure: async () => undefined,
    })));
    expect(results).toEqual([{ token: "new" }, { token: "new" }, { token: "new" }]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledTimes(1);
    expect(db.state.token).toBe("new");
    await expect(lifecycle.refresh({ connectorId: "failed", refresh: async () => { throw new Error("raw refresh secret"); }, persist: async () => undefined, audit: async () => undefined, auditFailure: async () => undefined })).rejects.toMatchObject({
      failure: { kind: "internal", safeMessage: "Connector operation failed." },
    });
    expect(db.state.token).toBe("new");
  });

  it("re-exchanges expired client credentials without sharing refresh state", async () => {
    const db = persistence();
    const lifecycle = createConnectorLifecycle({ persistence: db });
    type ConnectInput = Parameters<typeof lifecycle.connect>[0];
    type MissingAuditFailure = Omit<ConnectInput, "auditFailure">;
    expectTypeOf<MissingAuditFailure>().not.toMatchTypeOf<ConnectInput>();
    const exchange = vi.fn(async () => ({ token: "fresh" }));
    await lifecycle.ensureClientCredential({ expired: true, exchange, persist: async (d, s) => { d.token = s.token; }, audit: async () => undefined, auditFailure: async () => undefined });
    expect(exchange).toHaveBeenCalledOnce();
    expect(db.state.token).toBe("fresh");
  });
});

describe("retry and sync", () => {
  it("orchestrates health network work and durably audits success and safe failure once", async () => {
    const success = durableAttemptFixture();
    const lifecycle = createConnectorLifecycle({ persistence: success.persistence });
    await expect(lifecycle.health({
      probe: async () => ({ ok: true }),
      audit: async (draft) => success.durableAudit("health", "success")(draft),
      auditFailure: success.durableAudit("health", "failed"),
    })).resolves.toEqual({ state: "connected" });
    expect(success.auditRows).toHaveLength(1);

    const failed = durableAttemptFixture();
    const failedLifecycle = createConnectorLifecycle({ persistence: failed.persistence });
    await expect(failedLifecycle.health({
      probe: async () => { throw new ConnectorError("upstream_unavailable", "secret upstream detail"); },
      audit: async (draft) => failed.durableAudit("health", "success")(draft),
      auditFailure: failed.durableAudit("health", "failed"),
    })).resolves.toEqual({ state: "degraded", error: "Connector provider is unavailable." });
    expect(failed.auditRows).toHaveLength(1);
    expect(JSON.stringify(failed.auditRows)).not.toContain("secret upstream detail");
  });

  it("fails closed on a health success-audit outage without mislabeling provider health", async () => {
    const auditFailure = vi.fn();
    const lifecycle = createConnectorLifecycle({
      persistence: { transact: async <T>(operation: (draft: {}) => Promise<T>) => operation({}) },
    });
    await expect(lifecycle.health({
      probe: async () => ({ ok: true }),
      audit: async () => { throw new Error("audit store unavailable"); },
      auditFailure,
    })).rejects.toMatchObject({ failure: { kind: "internal", safeMessage: "Connector operation failed." } });
    expect(auditFailure).not.toHaveBeenCalled();
  });

  it("fails closed with a typed safe error when both health probe and failure audit fail", async () => {
    const lifecycle = createConnectorLifecycle({
      persistence: { transact: async <T>(operation: (draft: {}) => Promise<T>) => operation({}) },
    });
    const execution = lifecycle.health({
      probe: async () => { throw new ConnectorError("upstream_unavailable", "raw provider token"); },
      audit: async () => undefined,
      auditFailure: async () => { throw new Error("raw database password"); },
    });
    await expect(execution).rejects.toMatchObject({
      failure: { status: "failed", kind: "internal", safeMessage: "Connector operation failed." },
    });
    try {
      await execution;
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain("provider token");
      expect((error as Error).message).not.toContain("database password");
      expect((error as Error & { cause?: unknown }).cause).toBeInstanceOf(AggregateError);
      expect((error as Error & { cause: AggregateError }).cause.errors).toHaveLength(2);
    }
  });

  it("audits refresh and client-credential exchange failures without rotating the last token", async () => {
    const refreshFixture = durableAttemptFixture({ token: "last-valid" });
    const lifecycle = createConnectorLifecycle<Parameters<typeof refreshFixture.persistence.transact>[0] extends (draft: infer D) => unknown ? D : never, { token: string }>({ persistence: refreshFixture.persistence });
    await expect(lifecycle.refresh({
      connectorId: "credential-row-id",
      refresh: async () => { throw new ConnectorError("authentication", "raw refresh token secret"); },
      persist: async (draft, result) => { draft.state.token = result.token; },
      audit: refreshFixture.durableAudit("refresh", "success"),
      auditFailure: refreshFixture.durableAudit("refresh", "failed"),
    })).rejects.toMatchObject({ failure: { kind: "authentication", safeMessage: "Connector authentication failed." } });
    expect(refreshFixture.state().token).toBe("last-valid");
    expect(refreshFixture.auditRows).toHaveLength(1);
    expect(JSON.stringify(refreshFixture.auditRows)).not.toContain("raw refresh token secret");

    const clientFixture = durableAttemptFixture({ token: "last-valid" });
    const clientLifecycle = createConnectorLifecycle({ persistence: clientFixture.persistence });
    await expect(clientLifecycle.ensureClientCredential({
      expired: true,
      exchange: async () => { throw new ConnectorError("upstream_unavailable", "raw client secret"); },
      persist: async () => undefined,
      audit: clientFixture.durableAudit("refresh", "success"),
      auditFailure: clientFixture.durableAudit("refresh", "failed"),
    })).rejects.toMatchObject({ failure: { kind: "upstream_unavailable", safeMessage: "Connector provider is unavailable." } });
    expect(clientFixture.state().token).toBe("last-valid");
    expect(clientFixture.auditRows).toHaveLength(1);
    expect(JSON.stringify(clientFixture.auditRows)).not.toContain("raw client secret");
  });

  it.each([
    { name: "retry exhaustion", idempotencyKey: "safe-key", abort: false, expectedCalls: 2 },
    { name: "cancellation", idempotencyKey: "safe-key", abort: true, expectedCalls: 0 },
    { name: "non-idempotent", idempotencyKey: "", abort: false, expectedCalls: 1 },
  ])("audits sync $name once without advancing its checkpoint", async ({ idempotencyKey, abort, expectedCalls }) => {
    const fixture = durableAttemptFixture({ checkpoint: "old" });
    const controller = new AbortController();
    if (abort) controller.abort();
    let calls = 0;
    await expect(runConnectorSync({
      request: { idempotencyKey, signal: controller.signal }, persistence: fixture.persistence,
      retry: { maxAttempts: 2, initialDelayMs: 0, maxDelayMs: 0 },
      sync: async () => { calls += 1; throw new ConnectorError("upstream_unavailable", "raw provider secret"); },
      persist: async (draft, result) => { draft.state.checkpoint = result.checkpoint as string; },
      audit: fixture.durableAudit("sync", "success"),
      auditFailure: fixture.durableAudit("sync", "failed"),
    })).rejects.toMatchObject({ failure: {
      kind: abort ? "cancelled" : "upstream_unavailable",
      safeMessage: abort ? "Connector operation was cancelled." : "Connector provider is unavailable.",
    } });
    expect(calls).toBe(expectedCalls);
    expect(fixture.state().checkpoint).toBe("old");
    expect(fixture.auditRows).toHaveLength(1);
    expect(JSON.stringify(fixture.auditRows)).not.toContain("raw provider secret");
  });

  it("audits a disconnect persistence failure once; audit-store outage remains fail-closed", async () => {
    const fixture = durableAttemptFixture({ token: "valid" });
    const lifecycle = createConnectorLifecycle({ persistence: fixture.persistence });
    await expect(lifecycle.disconnect({
      persist: async () => { throw new Error("delete failed"); },
      audit: fixture.durableAudit("disconnect", "success"),
      auditFailure: fixture.durableAudit("disconnect", "failed"),
    })).rejects.toMatchObject({ failure: { kind: "internal", safeMessage: "Connector operation failed." } });
    expect(fixture.state().token).toBe("valid");
    expect(fixture.auditRows).toHaveLength(1);

    const outage = createConnectorLifecycle({
      persistence: { transact: async <T>(operation: (draft: {}) => Promise<T>) => operation({}) },
    });
    await expect(outage.disconnect({
      persist: async () => { throw new Error("delete failed"); },
      audit: async () => undefined,
      auditFailure: async () => { throw new Error("audit unavailable"); },
    })).rejects.toMatchObject({ failure: { kind: "internal", safeMessage: "Connector operation failed." } });
  });

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
      auditFailure: async () => undefined,
    });
    expect(db.state.checkpoint).toBe("p1");
    expect(calls).toBe(2);
    await expect(runConnectorSync({
      request: { cursor: "c1", idempotencyKey: "sync-key" }, persistence: db,
      retry: { maxAttempts: 1, initialDelayMs: 0, maxDelayMs: 0 },
      sync: async () => ({ nextCursor: "c2", resultCount: 1, checkpoint: "p2" }),
      persist: async (draft, result) => { draft.checkpoint = result.checkpoint; }, audit: async () => { throw new Error("audit"); },
      auditFailure: async () => { throw new Error("audit"); },
    })).rejects.toMatchObject({ failure: { kind: "internal", safeMessage: "Connector operation failed." } });
    expect(db.state.checkpoint).toBe("p1");
  });

  it("provides a reusable keyed single-flight primitive", async () => {
    const flight = createSingleFlight<number>(); const work = vi.fn(async () => 7);
    expect(await Promise.all([flight.run("a", work), flight.run("a", work)])).toEqual([7, 7]);
    expect(work).toHaveBeenCalledOnce();
    // The key is the unique IntegrationCredential.integrationId, never a provider slug.
    type FlightWork = Parameters<typeof flight.run>[1];
    expectTypeOf<() => Promise<string>>().not.toMatchTypeOf<FlightWork>();
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
