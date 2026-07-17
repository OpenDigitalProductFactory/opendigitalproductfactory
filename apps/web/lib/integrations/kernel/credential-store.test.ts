import { describe, expect, it, vi } from "vitest";

import {
  createConnectorCredentialStore,
  type ConnectorCredentialRow,
  type ConnectorCredentialTransaction,
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
      transaction: async <T>(operation: (transaction: ConnectorCredentialTransaction) => Promise<T>) => {
        transactions.push("begin");
        const result = await operation(tx);
        transactions.push("commit");
        return result;
      },
    },
    tx,
    transactions,
    current: () => stored,
  };
}

function crypto() {
  return {
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
      errorMessage: "  invalid\n credentials \u0000 ",
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
      errorMessage: "authentication rejected",
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
      errorMessage: "rejected",
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
});
