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

// BI-25C6219E: sessions of one client sharing a stored refresh token race.
describe("refresh reuse grace window", () => {
  const secondsAgo = (s: number) => new Date(Date.now() - s * 1000);
  const liveSuccessor = () => ({ ...refreshRow(), id: "successor" });
  /** The presented token was rotated `consumedSecondsAgo` seconds ago to `successor`. */
  function rotated(consumedSecondsAgo: number, successor: object | null = liveSuccessor()) {
    const parent = { ...refreshRow(), consumedAt: secondsAgo(consumedSecondsAgo), rotatedToId: "successor" };
    mocks.db.oAuthRefreshToken.findUnique.mockReset().mockImplementation(({ where }) =>
      Promise.resolve(where.tokenHash ? (where.tokenHash === createHash("sha256").update(refreshRequest.token).digest("hex")
        ? parent : { id: "sibling" }) : where.id === "successor" ? successor : parent));
  }
  const familyRevoked = () => expect(mocks.db.oAuthRefreshToken.updateMany).toHaveBeenCalledWith({
    where: { oauthFamilyKey: "family-a", revokedAt: null },
    data: { revokedAt: expect.any(Date), revokedReason: "refresh_token_replayed" },
  });

  it("issues a sibling in the same family, without revoking, when the same client reuses inside the window", async () => {
    rotated(1);
    const result = await rotateOAuthRefreshToken(refreshRequest);
    expect(result.accepted).toBe(true);
    expect(mocks.db.oAuthRefreshToken.updateMany).not.toHaveBeenCalled();
    expect(mocks.db.mcpApiToken.updateMany).not.toHaveBeenCalled();
    expect(mocks.db.oAuthRefreshToken.create).toHaveBeenCalledWith({ data: expect.objectContaining({ oauthFamilyKey: "family-a", userId: "human" }) });
    expect(mocks.db.mcpApiToken.create).toHaveBeenCalledWith({ data: expect.objectContaining({ oauthFamilyKey: "family-a" }) });
    // The presented token keeps its one successor link; the sibling does not overwrite it.
    expect(mocks.db.oAuthRefreshToken.update).not.toHaveBeenCalled();
  });

  it("still re-checks consent inside the window", async () => {
    rotated(1);
    mocks.resolve.mockResolvedValue(null);
    expect((await rotateOAuthRefreshToken(refreshRequest)).accepted).toBe(false);
    expect(mocks.db.oAuthRefreshToken.create).not.toHaveBeenCalled();
  });

  it("revokes the family when the same client reuses after the window", async () => {
    rotated(61);
    expect((await rotateOAuthRefreshToken(refreshRequest)).accepted).toBe(false);
    familyRevoked();
    expect(mocks.db.oAuthRefreshToken.create).not.toHaveBeenCalled();
  });

  it("honours an operator-set window, and 0 disables grace", async () => {
    vi.stubEnv("DPF_OAUTH_REFRESH_REUSE_GRACE_SECONDS", "0");
    try {
      rotated(1);
      expect((await rotateOAuthRefreshToken(refreshRequest)).accepted).toBe(false);
      familyRevoked();
    } finally { vi.unstubAllEnvs(); }
  });

  it("revokes the family when a different client reuses inside the window", async () => {
    rotated(1);
    expect((await rotateOAuthRefreshToken({ ...refreshRequest, clientId: "foreign" })).accepted).toBe(false);
    familyRevoked();
    expect(mocks.db.oAuthRefreshToken.create).not.toHaveBeenCalled();
  });

  it.each([
    ["revoked", { revokedAt: secondsAgo(0) }],
    ["already consumed", { consumedAt: secondsAgo(0) }],
    ["in another family", { oauthFamilyKey: "family-b" }],
  ])("revokes the family when the successor is %s", async (_label, change) => {
    rotated(1, { ...liveSuccessor(), ...change });
    expect((await rotateOAuthRefreshToken(refreshRequest)).accepted).toBe(false);
    familyRevoked();
    expect(mocks.db.oAuthRefreshToken.create).not.toHaveBeenCalled();
  });

  it("revokes the family when the successor is missing", async () => {
    rotated(1, null);
    expect((await rotateOAuthRefreshToken(refreshRequest)).accepted).toBe(false);
    familyRevoked();
  });

  it("gives an in-flight race loser a sibling once the winner has committed", async () => {
    const fresh = refreshRow();
    const committed = { ...fresh, consumedAt: secondsAgo(0), rotatedToId: "successor" };
    mocks.db.oAuthRefreshToken.findUnique.mockReset()
      .mockResolvedValueOnce(fresh) // our read, before the winner committed
      .mockImplementation(({ where }) => Promise.resolve(where.id === "refresh-parent" ? committed
        : where.id === "successor" ? liveSuccessor() : { id: "sibling" }));
    mocks.db.oAuthRefreshToken.updateMany.mockResolvedValueOnce({ count: 0 });
    expect((await rotateOAuthRefreshToken(refreshRequest)).accepted).toBe(true);
    expect(mocks.db.mcpApiToken.updateMany).not.toHaveBeenCalled();
    expect(mocks.db.oAuthRefreshToken.update).not.toHaveBeenCalled();
  });
});
