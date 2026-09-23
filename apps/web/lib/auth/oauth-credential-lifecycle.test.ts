import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const mocks = vi.hoisted(() => {
  const db = {
    oAuthAuthorizationCode: { findUnique: vi.fn(), updateMany: vi.fn() },
    oAuthRefreshToken: { findUnique: vi.fn(), updateMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    mcpApiToken: { create: vi.fn(), updateMany: vi.fn() },
  };
  return { db, resolve: vi.fn(), transaction: vi.fn() };
});
vi.mock("@dpf/db", () => ({ prisma: { ...mocks.db, $transaction: mocks.transaction } }));
vi.mock("./oauth-identity-binding", () => ({ resolveOAuthConsent: mocks.resolve,
  OAUTH_SETUP_REQUIRED: "Reconnect to approve an assistant role before starting work." }));
import { exchangeOAuthCode, rotateOAuthRefreshToken } from "./oauth-tokens";

const origin = "https://dpf.example";
const resource = `${origin}/api/mcp/v1`;
const verifier = "x".repeat(64);
const codeRequest = { code: "dpfoac_fixture", clientId: "client", clientLabel: "Untrusted app name",
  origin, redirectUri: "http://127.0.0.1/callback", codeVerifier: verifier, resource };
const refreshRequest = { token: "dpfort_fixture", clientId: "client", clientLabel: "Untrusted app name", origin };
const future = () => new Date(Date.now() + 60_000);
const refreshRow = () => ({ id: "refresh-parent", oauthClientId: "client", userId: "human",
  agentId: "agent-row", resource, scopes: ["dpf.read", "dpf.work"], authorityBindingId: "binding",
  oauthFamilyKey: "family-a", expiresAt: future(), revokedAt: null, consumedAt: null, rotatedToId: null });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation((fn) => fn(mocks.db));
  mocks.resolve.mockResolvedValue({ agentId: "AGT-EXT-CODEX", agentRecordId: "agent-row" });
  mocks.db.oAuthAuthorizationCode.findUnique.mockResolvedValue({
    oauthClientId: "client", userId: "human", redirectUri: codeRequest.redirectUri,
    codeChallenge: createHash("sha256").update(verifier).digest("base64url"), resource,
    scopes: ["dpf.read", "dpf.work"], authorityBindingId: "binding", expiresAt: future(), consumedAt: null,
  });
  mocks.db.oAuthAuthorizationCode.updateMany.mockResolvedValue({ count: 1 });
  mocks.db.oAuthRefreshToken.findUnique.mockResolvedValueOnce(refreshRow()).mockResolvedValue({ id: "successor" });
  mocks.db.oAuthRefreshToken.updateMany.mockResolvedValue({ count: 1 });
});

describe("OAuth credential custody", () => {
  it("exchanges consent into an MCP identity and a correctly keyed refresh record", async () => {
    expect((await exchangeOAuthCode(codeRequest)).accepted).toBe(true);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.db.mcpApiToken.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      userId: "human", agentId: "AGT-EXT-CODEX", authorityBindingId: "binding", oauthFamilyKey: expect.any(String),
    }) });
    const access = mocks.db.mcpApiToken.create.mock.calls[0][0].data;
    expect(mocks.db.oAuthRefreshToken.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      agentId: "agent-row", authorityBindingId: "binding", oauthFamilyKey: access.oauthFamilyKey,
    }) });
  });
  it("does not consume another client's intercepted code", async () => {
    expect((await exchangeOAuthCode({ ...codeRequest, clientId: "foreign" })).accepted).toBe(false);
    expect(mocks.db.oAuthAuthorizationCode.updateMany).not.toHaveBeenCalled();
    expect(mocks.db.mcpApiToken.create).not.toHaveBeenCalled();
  });
  it("requires new consent for a pre-upgrade unbound code", async () => {
    mocks.db.oAuthAuthorizationCode.findUnique.mockResolvedValue({
      oauthClientId: "client", userId: "human", redirectUri: codeRequest.redirectUri,
      codeChallenge: createHash("sha256").update(verifier).digest("base64url"), resource,
      scopes: ["dpf.work"], authorityBindingId: null, expiresAt: future(),
    });
    expect(await exchangeOAuthCode(codeRequest)).toMatchObject({ accepted: false, error: "invalid_grant", detail: expect.stringContaining("Reconnect") });
    expect(mocks.db.mcpApiToken.create).not.toHaveBeenCalled();
  });
  it("requires new consent for an existing identity-less refresh connection", async () => {
    mocks.db.oAuthRefreshToken.findUnique.mockReset().mockResolvedValue({ ...refreshRow(), authorityBindingId: null, agentId: null });
    expect(await rotateOAuthRefreshToken(refreshRequest)).toMatchObject({ accepted: false, error: "invalid_grant", detail: expect.stringContaining("Reconnect") });
    expect(mocks.db.mcpApiToken.create).not.toHaveBeenCalled();
  });
  it("preserves approved identity and family while narrowing refresh scope", async () => {
    expect((await rotateOAuthRefreshToken({ ...refreshRequest, requestedScopes: ["dpf.read"] })).accepted).toBe(true);
    expect(mocks.db.mcpApiToken.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      agentId: "AGT-EXT-CODEX", authorityBindingId: "binding", oauthFamilyKey: "family-a", publicScopes: ["dpf.read"],
    }) });
    expect(mocks.db.oAuthRefreshToken.create).toHaveBeenCalledWith({ data: expect.objectContaining({ agentId: "agent-row", scopes: ["dpf.read"] }) });
  });
  it("denies scope expansion without consuming the refresh token", async () => {
    expect(await rotateOAuthRefreshToken({ ...refreshRequest, requestedScopes: ["dpf.admin"] })).toMatchObject({ accepted: false, error: "invalid_scope" });
    expect(mocks.db.oAuthRefreshToken.updateMany).not.toHaveBeenCalled();
  });
  it("denies refresh after permission or consent revocation", async () => {
    mocks.resolve.mockResolvedValue(null);
    expect((await rotateOAuthRefreshToken(refreshRequest)).accepted).toBe(false);
    expect(mocks.db.mcpApiToken.create).not.toHaveBeenCalled();
  });
  it("revokes successors when an expired consumed refresh token is replayed", async () => {
    mocks.db.oAuthRefreshToken.findUnique.mockReset().mockResolvedValue({ ...refreshRow(), consumedAt: new Date(),
      expiresAt: new Date(Date.now() - 1), rotatedToId: "successor" });
    expect((await rotateOAuthRefreshToken(refreshRequest)).accepted).toBe(false);
    expect(mocks.db.mcpApiToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { oauthFamilyKey: "family-a", revokedAt: null } }));
  });
  it("a refresh race loser revokes only its own family, including access tokens", async () => {
    mocks.db.oAuthRefreshToken.updateMany.mockResolvedValueOnce({ count: 0 });
    expect((await rotateOAuthRefreshToken(refreshRequest)).accepted).toBe(false);
    expect(mocks.db.mcpApiToken.updateMany).toHaveBeenCalledWith({
      where: { oauthFamilyKey: "family-a", revokedAt: null },
      data: { revokedAt: expect.any(Date), revokedReason: "refresh_token_replayed" },
    });
    expect(mocks.db.oAuthRefreshToken.create).not.toHaveBeenCalled();
  });
  it.each([{ clientId: "foreign" }, { origin: "https://foreign.example" }])("does not revoke a foreign refresh family: %j", async (change) => {
    expect((await rotateOAuthRefreshToken({ ...refreshRequest, ...change })).accepted).toBe(false);
    expect(mocks.db.oAuthRefreshToken.updateMany).not.toHaveBeenCalled();
    expect(mocks.db.mcpApiToken.updateMany).not.toHaveBeenCalled();
  });
});
