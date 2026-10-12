import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  modelProvider: { update: vi.fn() },
  aiProviderConnection: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@dpf/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@dpf/db")>(), prisma: db,
  setProviderStatusWithDefaultConnection: (await import("../../../../packages/db/src/provider-connection")).setProviderStatusWithDefaultConnection,
}));
import { setProviderAccountEnabled } from "./provider-account-management";
import { reconcileProviderConnectionState } from "./provider-connection-reconcile";

describe("local account operator intent", () => {
  let providerId: string;
  let connectionId: string;
  let providerStatus: string;
  let connectionStatus: string;

  beforeEach(() => {
    vi.resetAllMocks();
    providerId = "local";
    connectionId = "provider-default-local";
    providerStatus = connectionStatus = "active";
    db.aiProviderConnection.findUnique.mockImplementation(async () => ({ connectionId, providerId, status: connectionStatus, credentialEntry: null }));
    db.modelProvider.update.mockImplementation(async ({ data }) => { providerStatus = data.status; });
    db.aiProviderConnection.update.mockImplementation(async ({ data }) => { connectionStatus = data.status; });
    db.aiProviderConnection.updateMany.mockImplementation(async ({ where, data }) => {
      const matches = connectionStatus === where.status && connectionId.startsWith(where.connectionId.startsWith)
        && providerStatus === where.provider.status;
      if (matches) connectionStatus = data.status;
      return { count: matches ? 1 : 0 };
    });
    db.$transaction.mockImplementation(async (run) => run(db));
  });

  it.each(["local", "ollama"])("keeps an operator-disabled %s default account stopped through boot reconciliation", async (id) => {
    providerId = id;
    connectionId = `provider-default-${id}`;
    expect(await setProviderAccountEnabled(connectionId, false)).toEqual({ ok: true });
    await reconcileProviderConnectionState();
    expect(providerStatus).toBe("inactive");
    expect(connectionStatus).toBe("inactive");
  });

  it("allows explicit resumption of a default local runtime without a credential", async () => {
    providerStatus = connectionStatus = "inactive";
    expect(await setProviderAccountEnabled(connectionId, true)).toEqual({ ok: true });
    expect(providerStatus).toBe("active");
    expect(connectionStatus).toBe("active");
  });

  it("disables a separate account without disabling its whole provider", async () => {
    connectionId = "provider-account-secondary";
    expect(await setProviderAccountEnabled(connectionId, false)).toEqual({ ok: true });
    await reconcileProviderConnectionState();
    expect(connectionStatus).toBe("disabled");
    expect(providerStatus).toBe("active");
  });
});
