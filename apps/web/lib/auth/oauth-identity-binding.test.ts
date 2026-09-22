import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ create: vi.fn().mockResolvedValue({}) }));
const identityDb = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  agent: { findMany: vi.fn() },
  authorityBinding: { findUnique: vi.fn() },
}));
vi.mock("@dpf/db", () => ({ prisma: { oAuthAuthorizationCode: db, ...identityDb } }));

import { resolveOAuthConsent } from "./oauth-identity-binding";
import { createAuthorizationCode } from "./oauth-tokens";

describe("OAuth consent identity custody", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps the approved authorization binding on the issued code", async () => {
    // Regression reproduction for BI-B986A18B. Binding is established by the
    // consent service; client metadata is not the identity authority.
    const consent = {
      oauthClientRowId: "client-a",
      userId: "human-a",
      redirectUri: "http://localhost:4567/callback",
      codeChallenge: "challenge",
      resource: "https://dpf.example/api/mcp/v1",
      publicScopes: ["dpf.work" as const],
      authorityBindingId: "approved-connection-a",
    };

    await createAuthorizationCode(consent);

    expect(db.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "human-a",
        oauthClientId: "client-a",
        authorityBindingId: "approved-connection-a",
      }),
    });
  });
});


describe("approved coworker identity", () => {
  const request = { bindingId: "binding", userId: "human", clientId: "client",
    resource: "https://dpf.example/api/mcp/v1", scopes: ["dpf.work"] };
  const agent = { id: "database-agent-row", agentId: "AGT-EXT-CODEX", status: "active", archived: false };
  beforeEach(() => {
    vi.clearAllMocks();
    identityDb.user.findUnique.mockResolvedValue({ isActive: true, isSuperuser: true, groups: [] });
    identityDb.agent.findMany.mockResolvedValue([agent]);
    identityDb.authorityBinding.findUnique.mockResolvedValue({
      oauthPurpose: "consent", status: "active", oauthUserId: "human", oauthClientId: "client",
      resourceRef: request.resource, appliedAgentId: agent.id, appliedAgent: agent,
      grants: [{ grantKey: "dpf.work", mode: "allow" }],
    });
  });
  it("returns the public coworker identity separately from its database foreign key", async () => {
    expect(await resolveOAuthConsent(request)).toEqual({ agentId: "AGT-EXT-CODEX", agentRecordId: "database-agent-row" });
  });
  it.each([
    { userId: "other-human" }, { clientId: "other-client" },
    { resource: "https://other.example/api/mcp/v1" }, { scopes: ["dpf.admin"] },
  ])("rejects consent reuse outside the approved authority: %j", async (change) => {
    expect(await resolveOAuthConsent({ ...request, ...change })).toBeNull();
  });
  it("rejects a disabled human", async () => {
    identityDb.user.findUnique.mockResolvedValue({ isActive: false, isSuperuser: true, groups: [] });
    expect(await resolveOAuthConsent(request)).toBeNull();
  });
  it("rejects a coworker whose current eligibility was removed", async () => {
    identityDb.agent.findMany.mockResolvedValue([]);
    expect(await resolveOAuthConsent(request)).toBeNull();
  });
});
