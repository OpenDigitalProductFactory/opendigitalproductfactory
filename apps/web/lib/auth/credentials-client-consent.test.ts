// BI-79D26E39 — a credentials client the operator bound to an approved
// assistant carries a consent binding, so its routine writes are steered like
// a consented OAuth connection instead of parking on a human approval.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  findMany: vi.fn(),
  resolve: vi.fn(),
  create: vi.fn(),
  log: vi.fn(),
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
      oauthPurpose: "consent", status: "active", oauthUserId: "human-1", oauthClientId: "client-row-1",
      resourceRef: input.resource, appliedAgent: { agentId: "AGT-EXT-GROK" },
    }) }));
  });

  it("does not reuse a binding that no longer verifies (revoked eligibility, narrower grants)", async () => {
    mock.findMany.mockResolvedValue([{ id: "binding-stale" }]);
    mock.resolve.mockResolvedValue(null);
    expect(await credentialsClientConsentBindingId(input, db)).toBe("binding-new");
  });

  it("an unexpected failure is not swallowed into a silent unbound token", async () => {
    mock.create.mockRejectedValue(new Error("connection reset"));
    await expect(credentialsClientConsentBindingId(input, db)).rejects.toThrow(/connection reset/);
  });
});
