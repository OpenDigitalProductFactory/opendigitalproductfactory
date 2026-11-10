import { describe, expect, it, vi } from "vitest";

import {
  createConnectorCredentialStore,
  createPrismaConnectorCredentialRepository,
  type ConnectorCredentialRow,
  type ConnectorCredentialTransaction,
  type PrismaConnectorCredentialClient,
} from "./credential-store";

function row(overrides: Partial<ConnectorCredentialRow> = {}): ConnectorCredentialRow {
  return {
    integrationId: "acme",
    provider: "acme-provider",
    status: "connected",
    fieldsEnc: "encrypted:old-fields",
    tokenCacheEnc: "encrypted:old-token",
    lastTestedAt: new Date("2026-07-16T10:00:00.000Z"),
    lastErrorAt: null,
    lastErrorMsg: null,
    ...overrides,
  };
}

function repository(initial?: ConnectorCredentialRow) {
  let stored = initial;
  const transactions: string[] = [];
  const findUnique: ConnectorCredentialTransaction["findUnique"] = async ({ integrationId }) =>
    stored?.integrationId === integrationId ? { ...stored } : null;
  const upsert: ConnectorCredentialTransaction["upsert"] = async ({ create, update }) => {
    stored = stored ? { ...stored, ...update } : { ...create };
    return { ...stored };
  };
  const update: ConnectorCredentialTransaction["update"] = async ({ integrationId, data }) => {
    if (!stored || stored.integrationId !== integrationId) throw new Error("missing row");
    stored = { ...stored, ...data };
    return { ...stored };
  };
  const remove: ConnectorCredentialTransaction["delete"] = async ({ integrationId }) => {
    if (stored?.integrationId === integrationId) stored = undefined;
  };
  const tx: ConnectorCredentialTransaction = {
    findUnique: vi.fn(findUnique),
    upsert: vi.fn(upsert),
    update: vi.fn(update),
    delete: vi.fn(remove),
  };
  return {
    repo: {
      findUnique: tx.findUnique,
      transaction: async <T>(operation: (
        transaction: ConnectorCredentialTransaction,
        context: ConnectorCredentialTransaction,
      ) => Promise<T>) => {
        const snapshot = stored ? { ...stored } : undefined;
        transactions.push("begin");
        try {
          const result = await operation(tx, tx);
          transactions.push("commit");
          return result;
        } catch (error) {
          stored = snapshot;
          transactions.push("rollback");
          throw error;
        }
      },
    },
    tx,
    transactions,
    current: () => stored,
  };
}

function crypto() {
  return {
    assertReadyForWrite: vi.fn(async () => undefined),
    encryptJson: vi.fn((value: unknown) => `encrypted:${JSON.stringify(value)}`),
    decryptJson: vi.fn((stored: string) => {
      if (!stored.startsWith("encrypted:")) return null;
      try {
        return JSON.parse(stored.slice("encrypted:".length)) as unknown;
      } catch {
        return null;
      }
    }),
  };
}

describe("connector credential store", () => {
  it("checks production encryption readiness before encryption or persistence", async () => {
    const database = repository();
    const crypt = crypto();
    crypt.assertReadyForWrite.mockRejectedValue(new Error("encryption unavailable"));
    const store = createConnectorCredentialStore({ repository: database.repo, crypto: crypt });

    await expect(store.recordSuccessfulConnect({
      integrationId: "acme",
      provider: "acme-provider",
      reconnectFields: {},
      secretFields: { password: "secret" },
      tokenEnvelope: {},
      safeProjection: {},
    })).rejects.toThrow("encryption unavailable");
    expect(crypt.encryptJson).not.toHaveBeenCalled();
    expect(database.transactions).toEqual([]);
  });

  it("atomically replaces every encrypted section and clears previous errors on success", async () => {
    const database = repository(row({ lastErrorMsg: "old failure", lastErrorAt: new Date() }));
    const crypt = crypto();
    const now = new Date("2026-07-17T12:00:00.000Z");
    const store = createConnectorCredentialStore({ repository: database.repo, crypto: crypt, now: () => now });

    await store.recordSuccessfulConnect({
      integrationId: "acme",
      provider: "acme-provider",
      reconnectFields: { tenant: "north" },
      secretFields: { clientSecret: "secret" },
      tokenEnvelope: { accessToken: "token" },
      safeProjection: { accountName: "North Division" },
    });

    expect(database.transactions).toEqual(["begin", "commit"]);
    expect(crypt.encryptJson).toHaveBeenNthCalledWith(1, {
      schemaVersion: 1,
      reconnectFields: { tenant: "north" },
      secretFields: { clientSecret: "secret" },
      safeProjection: { accountName: "North Division" },
    });
    expect(crypt.encryptJson).toHaveBeenNthCalledWith(2, {
      schemaVersion: 1,
      tokenEnvelope: { accessToken: "token" },
    });
    expect(database.current()).toMatchObject({
      status: "connected",
      lastErrorAt: null,
      lastErrorMsg: null,
      lastTestedAt: now,
    });
  });

  it("retains a prior connected credential while recording sanitized replacement failure metadata", async () => {
    const prior = row();
    const database = repository(prior);
    const crypt = crypto();
    const now = new Date("2026-07-17T12:00:00.000Z");
    const store = createConnectorCredentialStore({ repository: database.repo, crypto: crypt, now: () => now });

    await store.recordFailedConnect({
      integrationId: "acme",
      provider: "acme-provider",
      reconnectFields: { tenant: "replacement" },
      reconnectFieldsReusable: true,
      secretFields: { password: "rejected" },
      tokenEnvelope: { accessToken: "rejected" },
      error: { kind: "authentication", safeMessage: "  invalid\n credentials \u0000 " },
    });

    expect(crypt.encryptJson).not.toHaveBeenCalled();
    expect(database.current()).toEqual({
      ...prior,
      lastErrorAt: now,
      lastErrorMsg: "invalid credentials",
    });
  });

  it("stores only explicitly reusable reconnect fields on a first failed connect", async () => {
    const database = repository();
    const crypt = crypto();
    const store = createConnectorCredentialStore({ repository: database.repo, crypto: crypt });

    await store.recordFailedConnect({
      integrationId: "acme",
      provider: "acme-provider",
      reconnectFields: { tenant: "north" },
      reconnectFieldsReusable: true,
      secretFields: { password: "rejected" },
      tokenEnvelope: { accessToken: "rejected" },
      error: { kind: "authentication", safeMessage: "authentication rejected" },
    });

    expect(crypt.encryptJson).toHaveBeenCalledOnce();
    expect(crypt.encryptJson).toHaveBeenCalledWith({
      schemaVersion: 1,
      reconnectFields: { tenant: "north" },
      secretFields: {},
      safeProjection: {},
    });
    expect(database.current()).toMatchObject({ status: "error", tokenCacheEnc: null });
  });

  it("can preserve an absent last-tested timestamp on first failure", async () => {
    const failedAt = new Date("2026-07-17T12:00:00.000Z");
    const database = repository();
    const store = createConnectorCredentialStore({
      repository: database.repo,
      crypto: crypto(),
      now: () => failedAt,
    });

    await store.recordFailedConnect({
      integrationId: "acme",
      provider: "acme-provider",
      reconnectFields: { tenant: "north" },
      reconnectFieldsReusable: true,
      secretFields: { password: "secret-value" },
      tokenEnvelope: {},
      lastTestedAtPolicy: "preserve",
      error: { kind: "authentication", safeMessage: "authentication failed" },
    });

    expect(database.current()).toMatchObject({
      lastTestedAt: null,
      lastErrorAt: failedAt,
      lastErrorMsg: "authentication failed",
    });
  });

  it("stores no submitted fields when reconnect fields are not reusable", async () => {
    const database = repository();
    const crypt = crypto();
    const store = createConnectorCredentialStore({ repository: database.repo, crypto: crypt });

    await store.recordFailedConnect({
      integrationId: "acme",
      provider: "acme-provider",
      reconnectFields: { tenant: "north" },
      reconnectFieldsReusable: false,
      secretFields: { password: "rejected" },
      tokenEnvelope: { accessToken: "rejected" },
      error: { kind: "authentication", safeMessage: "rejected" },
    });

    expect(crypt.encryptJson).toHaveBeenCalledWith({
      schemaVersion: 1,
      reconnectFields: {},
      secretFields: {},
      safeProjection: {},
    });
  });

  it("disconnects by integration id inside a transaction", async () => {
    const database = repository(row());
    const store = createConnectorCredentialStore({ repository: database.repo, crypto: crypto() });
    await store.disconnect("acme");
    expect(database.tx.delete).toHaveBeenCalledWith({ integrationId: "acme" });
    expect(database.current()).toBeUndefined();
    expect(database.transactions).toEqual(["begin", "commit"]);
  });

  it("records health evidence without exposing provider-local row mutation", async () => {
    const now = new Date("2026-08-22T06:00:00.000Z");
    const database = repository(row({ lastErrorAt: new Date(), lastErrorMsg: "old" }));
    const store = createConnectorCredentialStore({ repository: database.repo, crypto: crypto(), now: () => now });

    await store.recordHealthProbe("acme", { succeeded: true });

    expect(database.tx.update).toHaveBeenCalledWith({
      integrationId: "acme",
      data: { status: "connected", lastTestedAt: now, lastErrorAt: null, lastErrorMsg: null },
    });
  });

  it("atomically records successful health and a bounded safe-projection patch", async () => {
    const now = new Date("2026-08-22T06:00:00.000Z");
    const fields = {
      schemaVersion: 1,
      reconnectFields: { tenant: "north" },
      secretFields: { password: "secret" },
      safeProjection: { accountName: "Old", publicPublicationEnabled: true },
    };
    const database = repository(row({
      fieldsEnc: `encrypted:${JSON.stringify(fields)}`,
      tokenCacheEnc: `encrypted:${JSON.stringify({ schemaVersion: 1, tokenEnvelope: {} })}`,
      lastErrorAt: new Date("2026-08-22T05:00:00.000Z"),
      lastErrorMsg: "old failure",
    }));
    const crypt = crypto();
    const store = createConnectorCredentialStore({ repository: database.repo, crypto: crypt, now: () => now });

    await store.recordHealthProbe("acme", {
      succeeded: true,
      safeProjectionPatch: { accountName: "Current", canCreateDrafts: true },
    });

    expect(database.tx.update).toHaveBeenCalledOnce();
    expect(database.current()).toMatchObject({
      status: "connected",
      lastTestedAt: now,
      lastErrorAt: null,
      lastErrorMsg: null,
    });
    expect(crypt.assertReadyForWrite).toHaveBeenCalledOnce();
    expect(crypt.encryptJson).toHaveBeenCalledWith({
      ...fields,
      safeProjection: {
        accountName: "Current",
        publicPublicationEnabled: true,
        canCreateDrafts: true,
      },
    });
  });

  it("rejects a successful-probe patch that contains a stored credential secret", async () => {
    const fields = {
      schemaVersion: 1,
      reconnectFields: {},
      secretFields: { password: "secret-value" },
      safeProjection: { accountName: "Old" },
    };
    const database = repository(row({
      fieldsEnc: `encrypted:${JSON.stringify(fields)}`,
      tokenCacheEnc: null,
    }));
    const store = createConnectorCredentialStore({ repository: database.repo, crypto: crypto() });

    await expect(store.recordHealthProbe("acme", {
      succeeded: true,
      safeProjectionPatch: { accountName: "secret-value" },
    })).rejects.toThrow(/cannot contain credential secrets/i);

    expect(database.tx.update).not.toHaveBeenCalled();
  });

  it("updates only the encrypted safe projection while preserving secrets and lifecycle timestamps", async () => {
    const fields = {
      schemaVersion: 1,
      reconnectFields: { tenant: "north" },
      secretFields: { password: "secret" },
      safeProjection: { accountName: "North", publicPublicationEnabled: false },
    };
    const prior = row({
      fieldsEnc: `encrypted:${JSON.stringify(fields)}`,
      tokenCacheEnc: `encrypted:${JSON.stringify({ schemaVersion: 1, tokenEnvelope: {} })}`,
    });
    const database = repository(prior);
    const crypt = crypto();
    const store = createConnectorCredentialStore({ repository: database.repo, crypto: crypt });

    await store.updateSafeProjection("acme", (projection) => ({ ...projection, publicPublicationEnabled: true }));

    expect(database.current()).toMatchObject({
      status: prior.status,
      lastTestedAt: prior.lastTestedAt,
      lastErrorAt: prior.lastErrorAt,
      lastErrorMsg: prior.lastErrorMsg,
    });
    expect(crypt.encryptJson).toHaveBeenCalledWith({ ...fields, safeProjection: { accountName: "North", publicPublicationEnabled: true } });
  });

  it("returns only safe setup state and derives degraded without persisting it", async () => {
    const database = repository(row({
      fieldsEnc: `encrypted:${JSON.stringify({
        schemaVersion: 1,
        reconnectFields: { tenant: "secret-ish" },
        secretFields: { password: "secret" },
        safeProjection: { accountName: "North Division" },
      })}`,
      tokenCacheEnc: `encrypted:${JSON.stringify({ schemaVersion: 1, tokenEnvelope: { accessToken: "token" } })}`,
    }));
    const store = createConnectorCredentialStore({ repository: database.repo, crypto: crypto() });

    const state = await store.readSetupState("acme", { latestProbeFailed: true });

    expect(state).toEqual({
      integrationId: "acme",
      provider: "acme-provider",
      status: "degraded",
      safeProjection: { accountName: "North Division" },
      lastErrorMsg: null,
      lastTestedAt: new Date("2026-07-16T10:00:00.000Z"),
    });
    expect(JSON.stringify(state)).not.toContain("secret");
    expect(database.tx.update).not.toHaveBeenCalled();
  });

  it("derives degraded from persisted probe ordering and recovers after a later success", async () => {
    const database = repository(row({
      fieldsEnc: `encrypted:${JSON.stringify({
        schemaVersion: 1,
        reconnectFields: {},
        secretFields: {},
        safeProjection: { accountName: "North Division" },
      })}`,
      tokenCacheEnc: null,
      lastTestedAt: new Date("2026-08-22T05:00:00.000Z"),
      lastErrorAt: new Date("2026-08-22T05:01:00.000Z"),
      lastErrorMsg: "Provider unavailable.",
    }));
    const store = createConnectorCredentialStore({
      repository: database.repo,
      crypto: crypto(),
      now: () => new Date("2026-08-22T06:00:00.000Z"),
    });

    await expect(store.readSetupState("acme")).resolves.toMatchObject({
      status: "degraded",
      lastErrorMsg: "Provider unavailable.",
    });

    await store.recordHealthProbe("acme", { succeeded: true });
    await expect(store.readSetupState("acme")).resolves.toMatchObject({
      status: "connected",
      lastErrorMsg: null,
    });
  });

  it("returns unconfigured for an absent credential", async () => {
    const store = createConnectorCredentialStore({ repository: repository().repo, crypto: crypto() });
    await expect(store.readSetupState("missing")).resolves.toEqual({
      integrationId: "missing",
      provider: null,
      status: "unconfigured",
      safeProjection: {},
      lastErrorMsg: null,
      lastTestedAt: null,
    });
  });

  it("fails closed when decrypted field envelopes are malformed", async () => {
    const crypt = crypto();
    crypt.decryptJson.mockReturnValue({ reconnectFields: {}, secretFields: {}, safeProjection: { leaked: "value" } });
    const store = createConnectorCredentialStore({ repository: repository(row()).repo, crypto: crypt });

    await expect(store.readSetupState("acme")).resolves.toEqual({
      integrationId: "acme",
      provider: "acme-provider",
      status: "error",
      safeProjection: {},
      lastErrorMsg: "Stored connector credential could not be read safely.",
      lastTestedAt: new Date("2026-07-16T10:00:00.000Z"),
    });
  });

  it("fails closed when a present decrypted token envelope is malformed", async () => {
    const crypt = crypto();
    crypt.decryptJson
      .mockReturnValueOnce({ schemaVersion: 1, reconnectFields: {}, secretFields: {}, safeProjection: {} })
      .mockReturnValueOnce({ tokenEnvelope: { accessToken: "unsafe" } });
    const store = createConnectorCredentialStore({ repository: repository(row()).repo, crypto: crypt });

    await expect(store.readSetupState("acme")).resolves.toMatchObject({
      status: "error",
      safeProjection: {},
      lastErrorMsg: "Stored connector credential could not be read safely.",
    });
  });

  it("supports a caller-owned transaction for atomic credential and audit composition", async () => {
    const database = repository();
    const crypt = crypto();
    const store = createConnectorCredentialStore({ repository: database.repo, crypto: crypt });

    await store.withTransaction(database.tx).recordSuccessfulConnect({
      integrationId: "acme",
      provider: "acme-provider",
      reconnectFields: {},
      secretFields: {},
      tokenEnvelope: {},
      safeProjection: {},
    });

    expect(database.transactions).toEqual([]);
    expect(database.tx.upsert).toHaveBeenCalledOnce();
  });

  it("composes credential and audit writes on the same underlying transaction and rolls both back", async () => {
    let persistedCredential: ConnectorCredentialRow | undefined;
    const persistedAudit: Array<{ integrationId: string; operation: string }> = [];
    const credentialDelegate = {
      findUnique: vi.fn(async () => persistedCredential ?? null),
      upsert: vi.fn(async ({ create }: { create: ConnectorCredentialRow }) => {
        persistedCredential = create;
        return create;
      }),
      update: vi.fn(async () => {
        if (!persistedCredential) throw new Error("missing credential");
        return persistedCredential;
      }),
      delete: vi.fn(async () => {
        if (!persistedCredential) throw new Error("missing credential");
        const deleted = persistedCredential;
        persistedCredential = undefined;
        return deleted;
      }),
    };
    const auditDelegate = {
      create: vi.fn(async ({ data }: { data: { integrationId: string; operation: string } }) => {
        persistedAudit.push(data);
        return data;
      }),
    };
    const prisma = {
      integrationCredential: credentialDelegate,
      integrationToolCallLog: auditDelegate,
      $transaction: async <T>(
        operation: (transaction: {
          integrationCredential: typeof credentialDelegate;
          integrationToolCallLog: typeof auditDelegate;
        }) => Promise<T>,
        _options: { isolationLevel: "Serializable" },
      ): Promise<T> => {
        const credentialSnapshot = persistedCredential;
        const auditSnapshot = [...persistedAudit];
        try {
          return await operation({
            integrationCredential: credentialDelegate,
            integrationToolCallLog: auditDelegate,
          });
        } catch (error) {
          persistedCredential = credentialSnapshot;
          persistedAudit.splice(0, persistedAudit.length, ...auditSnapshot);
          throw error;
        }
      },
    };
    const repository = createPrismaConnectorCredentialRepository(prisma);
    const store = createConnectorCredentialStore({ repository, crypto: crypto() });

    await expect(store.composeInTransaction(async ({ credentials, transaction }) => {
      expect(transaction).not.toHaveProperty("integrationCredential");
      await credentials.recordSuccessfulConnect({
        integrationId: "acme",
        provider: "acme-provider",
        reconnectFields: {},
        secretFields: {},
        tokenEnvelope: {},
        safeProjection: {},
      });
      await transaction.integrationToolCallLog.create({
        data: { integrationId: "acme", operation: "connect" },
      });
      throw new Error("audit composition rejected");
    })).rejects.toThrow("audit composition rejected");

    expect(credentialDelegate.upsert).toHaveBeenCalledOnce();
    expect(auditDelegate.create).toHaveBeenCalledOnce();
    expect(persistedCredential).toBeUndefined();
    expect(persistedAudit).toEqual([]);
  });

  it("maps the production repository to exact Prisma where and data arguments", async () => {
    const prismaRow = row();
    const delegate = {
      findUnique: vi.fn(async () => prismaRow),
      upsert: vi.fn(async () => prismaRow),
      update: vi.fn(async () => prismaRow),
      delete: vi.fn(async () => prismaRow),
    };
    const transactionOptions: { isolationLevel: "Serializable" }[] = [];
    const prisma: PrismaConnectorCredentialClient = {
      integrationCredential: delegate,
      $transaction: async (operation, options) => {
        transactionOptions.push(options);
        return operation({ integrationCredential: delegate });
      },
    };
    const repo = createPrismaConnectorCredentialRepository(prisma);

    await repo.findUnique({ integrationId: "acme" });
    await repo.transaction(async (tx) => {
      await tx.update({ integrationId: "acme", data: { status: "error" } });
      await tx.delete({ integrationId: "acme" });
    });

    expect(delegate.findUnique).toHaveBeenCalledWith({ where: { integrationId: "acme" } });
    expect(delegate.update).toHaveBeenCalledWith({
      where: { integrationId: "acme" },
      data: { status: "error" },
    });
    expect(delegate.delete).toHaveBeenCalledWith({ where: { integrationId: "acme" } });
    expect(transactionOptions).toEqual([{ isolationLevel: "Serializable" }]);
  });

  it.each(["P2034", "P2002"])(
    "retries %s conflicts so a concurrent success cannot be overwritten by failure",
    async (conflictCode) => {
    let stored: ConnectorCredentialRow | undefined;
    let attempt = 0;
    const base = repository();
    const repo = {
      findUnique: base.repo.findUnique,
      transaction: async <T>(operation: (
        tx: ConnectorCredentialTransaction,
        context: ConnectorCredentialTransaction,
      ) => Promise<T>) => {
        attempt += 1;
        if (attempt === 1) {
          await operation(base.tx, base.tx);
          stored = row({ fieldsEnc: "encrypted:winning", tokenCacheEnc: "encrypted:winning-token" });
          const conflict = new Error("serialization conflict") as Error & { code: string };
          conflict.code = conflictCode;
          throw conflict;
        }
        const winnerRepo = repository(stored);
        const result = await operation(winnerRepo.tx, winnerRepo.tx);
        stored = winnerRepo.current();
        return result;
      },
    };
    const store = createConnectorCredentialStore({ repository: repo, crypto: crypto() });

    await store.recordFailedConnect({
      integrationId: "acme",
      provider: "acme-provider",
      reconnectFields: { tenant: "loser" },
      reconnectFieldsReusable: true,
      secretFields: { password: "loser-secret" },
      tokenEnvelope: { accessToken: "loser-token" },
      error: { kind: "authentication", safeMessage: "failed" },
    });

    expect(attempt).toBe(2);
    expect(stored).toMatchObject({
      status: "connected",
      fieldsEnc: "encrypted:winning",
      tokenCacheEnc: "encrypted:winning-token",
      lastErrorMsg: "failed",
    });
    },
  );

  it("redacts submitted secret, token, header, and URL values from safe storage and reads", async () => {
    const database = repository();
    const crypt = crypto();
    const store = createConnectorCredentialStore({ repository: database.repo, crypto: crypt });
    await store.recordSuccessfulConnect({
      integrationId: "acme",
      provider: "acme-provider",
      reconnectFields: {},
      secretFields: { password: "top-secret" },
      tokenEnvelope: { accessToken: "token-123" },
      safeProjection: {
        leaked: "top-secret",
        header: "Authorization: Bearer token-123",
        url: "https://user:top-secret@example.test/path?access_token=token-123&view=safe",
      },
    });

    const encryptedFields = vi.mocked(crypt.encryptJson).mock.calls[0]![0];
    expect(JSON.stringify(encryptedFields)).not.toContain('"leaked":"top-secret"');
    const state = await store.readSetupState("acme");
    expect(JSON.stringify(state.safeProjection)).not.toContain("top-secret");
    expect(JSON.stringify(state.safeProjection)).not.toContain("token-123");
  });

  it("rolls back a failed fake transaction instead of exposing partial mutation", async () => {
    let stored = row();
    const tx = {
      ...repository(stored).tx,
      update: async ({ data }: { integrationId: string; data: Partial<ConnectorCredentialRow> }) => {
        stored = { ...stored, ...data };
        return stored;
      },
    } satisfies ConnectorCredentialTransaction;
    const repo = {
      findUnique: async () => stored,
      transaction: async <T>(operation: (
        transaction: ConnectorCredentialTransaction,
        context: ConnectorCredentialTransaction,
      ) => Promise<T>) => {
        const snapshot = { ...stored };
        try {
          const result = await operation(tx, tx);
          throw new Error(`audit failed after ${String(result)}`);
        } catch (error) {
          stored = snapshot;
          throw error;
        }
      },
    };
    const store = createConnectorCredentialStore({ repository: repo, crypto: crypto() });

    await expect(store.recordFailedConnect({
      integrationId: "acme",
      provider: "acme-provider",
      reconnectFields: {},
      reconnectFieldsReusable: false,
      secretFields: {},
      tokenEnvelope: {},
      error: { kind: "authentication", safeMessage: "new failure" },
    })).rejects.toThrow("audit failed");
    expect(stored.lastErrorMsg).toBeNull();
  });
});
