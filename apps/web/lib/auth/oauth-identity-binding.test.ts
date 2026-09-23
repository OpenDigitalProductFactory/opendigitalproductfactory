import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ create: vi.fn().mockResolvedValue({}) }));
const identityDb = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  agent: { findMany: vi.fn() },
  authorityBinding: { findUnique: vi.fn() },
  mcpApiToken: { findFirst: vi.fn() },
}));
vi.mock("@dpf/db", () => ({ prisma: { oAuthAuthorizationCode: db, ...identityDb } }));

import { eligibleOAuthCoworkers, resolveOAuthConsent } from "./oauth-identity-binding";
import { createAuthorizationCode, isCurrentOAuthExecutionAuthority } from "./oauth-tokens";

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

describe("current OAuth execution authority", () => {
  const token = { kind: "oauth_access", revokedAt: null, expiresAt: new Date(Date.now() + 60_000),
    userId: "human", agentId: "AGT-EXT-CODEX", authorityBindingId: "binding", oauthClientId: "client",
    resource: "https://dpf.example/api/mcp/v1", publicScopes: ["dpf.work"],
    oauthClient: { revokedAt: null, registrationKind: "dcr" as const } };
  beforeEach(() => {
    vi.clearAllMocks();
    identityDb.user.findUnique.mockResolvedValue({ isActive: true, isSuperuser: true, groups: [] });
    identityDb.agent.findMany.mockResolvedValue([{ id: "agent-row", agentId: token.agentId }]);
    identityDb.authorityBinding.findUnique.mockResolvedValue({ oauthPurpose: "consent", status: "active",
      oauthUserId: token.userId, oauthClientId: token.oauthClientId, resourceRef: token.resource,
      appliedAgentId: "agent-row", appliedAgent: { id: "agent-row", agentId: token.agentId, status: "active", archived: false },
      grants: [{ grantKey: "dpf.work", mode: "allow" }] });
  });
  it("permits still-approved queued work", async () => {
    expect(await isCurrentOAuthExecutionAuthority(token)).toBe(true);
  });
  it("lets a permitted builder approve only the server's external development roles without administrator setup", async () => {
    identityDb.user.findUnique.mockResolvedValue({ isActive: true, isSuperuser: false,
      groups: [{ platformRole: { roleId: "HR-300" } }] });
    await eligibleOAuthCoworkers("human", "client", token.resource);
    expect(identityDb.agent.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      OR: expect.arrayContaining([{ agentId: { in: ["AGT-EXT-CLAUDE", "AGT-EXT-CODEX", "AGT-EXT-GROK"] } }]),
    }) }));
  });
  it("does not offer the development role to a human without build permission", async () => {
    identityDb.user.findUnique.mockResolvedValue({ isActive: true, isSuperuser: false,
      groups: [{ platformRole: { roleId: "HR-600" } }] });
    await eligibleOAuthCoworkers("human", "client", token.resource);
    const query = identityDb.agent.findMany.mock.calls[0][0];
    expect(JSON.stringify(query.where)).not.toContain("AGT-EXT-CODEX");
    expect(JSON.stringify(query.where)).toContain("delegation");
  });
  it("continues queued work after refresh using a current successor in the same consent family", async () => {
    identityDb.mcpApiToken.findFirst.mockResolvedValue({ ...token, oauthFamilyKey: "family" });
    expect(await isCurrentOAuthExecutionAuthority({ ...token, oauthFamilyKey: "family", expiresAt: new Date(0) })).toBe(true);
    expect(identityDb.mcpApiToken.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      oauthFamilyKey: "family", userId: token.userId, authorityBindingId: "binding",
      oauthClientId: "client", agentId: token.agentId, resource: token.resource,
      publicScopes: { hasEvery: token.publicScopes }, revokedAt: null,
    }) }));
  });
  it("refuses expired queued authority when no equally scoped successor exists", async () => {
    identityDb.mcpApiToken.findFirst.mockResolvedValue(null);
    expect(await isCurrentOAuthExecutionAuthority({ ...token, oauthFamilyKey: "family", expiresAt: new Date(0) })).toBe(false);
  });
  it.each(["revoked-consent", "disabled-human", "missing-binding", "wrong-agent", "removed-delegation"])("rejects %s before queued execution", async state => {
    const current = { ...token };
    if (state === "revoked-consent") identityDb.authorityBinding.findUnique.mockResolvedValue(null);
    if (state === "disabled-human") identityDb.user.findUnique.mockResolvedValue({ isActive: false });
    if (state === "missing-binding") current.authorityBindingId = "";
    if (state === "wrong-agent") current.agentId = "AGT-OTHER";
    if (state === "removed-delegation") identityDb.agent.findMany.mockResolvedValue([]);
    expect(await isCurrentOAuthExecutionAuthority(current)).toBe(false);
  });
});
