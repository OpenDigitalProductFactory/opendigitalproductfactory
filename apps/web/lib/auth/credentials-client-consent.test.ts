// BI-79D26E39 — a credentials client the operator bound to an approved
// assistant carries a consent binding, so its routine writes are steered like
// a consented OAuth connection instead of parking on a human approval.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  findMany: vi.fn(),
  resolve: vi.fn(),
  create: vi.fn(),
  log: vi.fn(),
  lock: vi.fn(),
}));

vi.mock("./oauth-identity-binding", () => ({
  OAUTH_SETUP_REQUIRED: "Reconnect to approve an assistant role before starting work.",
  resolveOAuthConsent: mock.resolve,
  createOAuthConsentBinding: mock.create,
}));

import { connectionDelegationFor } from "@/lib/mcp/connection-delegation";
import { credentialsClientConsentBindingId } from "./credentials-client-consent";

const db = {
  authorityBinding: { findMany: mock.findMany },
  authorizationDecisionLog: { create: mock.log },
  $queryRaw: mock.lock,
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
} as never;

const input = {
  userId: "human-1",
  clientRowId: "client-row-1",
  publicClientId: "dpfoc_grok",
  resource: "https://localhost/api/mcp/v1",
  agentId: "AGT-EXT-GROK",
  scopes: ["dpf.read", "dpf.work", "dpf.build"] as never,
};

beforeEach(() => {
  vi.clearAllMocks();
  mock.findMany.mockResolvedValue([]);
  mock.resolve.mockResolvedValue(null);
  mock.create.mockResolvedValue({ id: "binding-new", bindingId: "AB-OAUTH-new" });
  mock.log.mockResolvedValue({});
  mock.lock.mockResolvedValue([{ id: "client-row-1" }]);
});

describe("credentialsClientConsentBindingId", () => {
  it("AC-1: binds an eligible approved assistant, records why, and the token is then steered", async () => {
    const id = await credentialsClientConsentBindingId(input, db);
    expect(id).toBe("binding-new");
    expect(mock.create).toHaveBeenCalledWith(
      { userId: "human-1", clientId: "client-row-1", resource: input.resource, agentId: "AGT-EXT-GROK", scopes: input.scopes },
      db,
    );
    expect(mock.log).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      authorityBindingId: "binding-new", actionKey: "oauth_client_credentials_consent", agentContextRef: "AGT-EXT-GROK",
    }) }));
    expect(connectionDelegationFor({ source: "oauth", agentId: "AGT-EXT-GROK", authorityBindingId: id })).toEqual({
      connectionDelegation: { authorityBindingId: "binding-new", agentId: "AGT-EXT-GROK" },
    });
  });

  it("AC-2: an owner or assistant the consent rules reject gets no binding", async () => {
    mock.create.mockRejectedValue(new Error("Reconnect to approve an assistant role before starting work."));
    expect(await credentialsClientConsentBindingId(input, db)).toBeNull();
    expect(mock.log).not.toHaveBeenCalled();
  });

  it("AC-2: a client with no assistant gets no binding and touches nothing", async () => {
    expect(await credentialsClientConsentBindingId({ ...input, agentId: null }, db)).toBeNull();
    expect(mock.findMany).not.toHaveBeenCalled();
    expect(mock.create).not.toHaveBeenCalled();
  });

  it("AC-3: a repeated grant reuses the binding that still verifies, without creating another", async () => {
    mock.findMany.mockResolvedValue([{ id: "binding-old" }]);
    mock.resolve.mockResolvedValue({ agentId: "AGT-EXT-GROK", agentRecordId: "agent-grok" });
    expect(await credentialsClientConsentBindingId(input, db)).toBe("binding-old");
    expect(mock.create).not.toHaveBeenCalled();
    expect(mock.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      oauthPurpose: "consent", oauthUserId: "human-1", oauthClientId: "client-row-1",
      resourceRef: input.resource, appliedAgent: { agentId: "AGT-EXT-GROK" },
    }) }));
  });

  it("does not replace a recorded binding whose eligibility or scope no longer verifies", async () => {
    mock.findMany.mockResolvedValue([{ id: "binding-stale" }]);
    mock.resolve.mockResolvedValue(null);
    expect(await credentialsClientConsentBindingId(input, db)).toBeNull();
    expect(mock.create).not.toHaveBeenCalled();
    expect(mock.log).not.toHaveBeenCalled();
  });

  it("does not recreate consent after the operator revokes its recorded binding", async () => {
    const revoked = { id: "binding-revoked", status: "revoked" };
    mock.findMany.mockImplementation(async ({ where }: { where: { status?: string } }) =>
      !where.status || where.status === revoked.status ? [revoked] : []);
    expect(await credentialsClientConsentBindingId(input, db)).toBeNull();
    expect(mock.create).not.toHaveBeenCalled();
    expect(mock.log).not.toHaveBeenCalled();
  });

  it("does not fall back to an older active binding after the newest consent is revoked", async () => {
    mock.findMany.mockResolvedValue([{ id: "binding-revoked" }, { id: "binding-older" }]);
    mock.resolve.mockImplementation(async ({ bindingId }: { bindingId: string }) =>
      bindingId === "binding-older" ? { agentId: input.agentId } : null);
    expect(await credentialsClientConsentBindingId(input, db)).toBeNull();
    expect(mock.create).not.toHaveBeenCalled();
  });

  it("reuses one binding when concurrent first grants race through the transaction", async () => {
    const bindings: Array<{ id: string }> = [];
    let tail = Promise.resolve();
    const concurrentDb = {
      authorityBinding: { findMany: async () => [...bindings] },
      authorizationDecisionLog: { create: mock.log },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const previous = tail;
        let release!: () => void;
        tail = new Promise<void>(resolve => { release = resolve; });
        try {
          return await fn({ ...concurrentDb, $queryRaw: async () => {
            await previous;
            return [{ id: input.clientRowId }];
          } });
        } finally { release(); }
      },
    };
    mock.resolve.mockImplementation(async ({ bindingId }: { bindingId: string }) =>
      bindings.some(row => row.id === bindingId) ? { agentId: input.agentId } : null);
    mock.create.mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
      const binding = { id: `binding-${bindings.length + 1}` };
      bindings.push(binding);
      return { ...binding, bindingId: `AB-${binding.id}` };
    });
    const results = await Promise.all([
      credentialsClientConsentBindingId(input, concurrentDb as never),
      credentialsClientConsentBindingId(input, concurrentDb as never),
    ]);
    expect(results).toEqual(["binding-1", "binding-1"]);
    expect(mock.create).toHaveBeenCalledOnce();
    expect(mock.log).toHaveBeenCalledOnce();
  });

  it("an unexpected failure is not swallowed into a silent unbound token", async () => {
    mock.create.mockRejectedValue(new Error("connection reset"));
    await expect(credentialsClientConsentBindingId(input, db)).rejects.toThrow(/connection reset/);
  });

  it("creates no binding when the configured client disappeared before its transaction", async () => {
    mock.lock.mockResolvedValueOnce([]);
    expect(await credentialsClientConsentBindingId(input, db)).toBeNull();
    expect(mock.create).not.toHaveBeenCalled();
    expect(mock.log).not.toHaveBeenCalled();
  });

  it("does not convert a failed client lock into newly granted consent", async () => {
    mock.lock.mockRejectedValueOnce(new Error("connection reset"));
    await expect(credentialsClientConsentBindingId(input, db)).rejects.toThrow(/connection reset/);
    expect(mock.create).not.toHaveBeenCalled();
  });
});
