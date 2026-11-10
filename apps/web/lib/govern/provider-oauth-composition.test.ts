import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { db } = vi.hoisted(() => ({ db: {
  modelProvider: { findUnique: vi.fn() }, aiProviderConnection: { findUnique: vi.fn(), update: vi.fn() },
  credentialEntry: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() }, $queryRaw: vi.fn(), $transaction: vi.fn(),
} }));
vi.mock("@dpf/db", () => ({ prisma: db }));
vi.mock("@/lib/credential-crypto", () => ({ encryptSecret: (value: string) => `enc:${value}`, decryptSecret: (value: string | null) => value?.replace(/^enc:/, "") ?? null }));
vi.mock("@/lib/govern/activate-provider", () => ({ activateProvider: vi.fn() }));
vi.mock("@/lib/portal-url", () => ({ getStablePortalUrl: () => "https://localhost" }));
vi.mock("@/lib/inference/provider-account-management", () => ({ ACCOUNT_ACCESS_RESET: {}, invalidateProviderAccountProofs: vi.fn() }));
import { isConfirmedReauthenticationRequired, refreshOAuthToken } from "./provider-oauth";
import type { ActiveAccountSnapshot } from "@/lib/inference/active-provider-account-verification";
import { getActiveAccountBearerToken } from "@/lib/inference/active-provider-account-verification";

const jwt = (identity: string, exp?: number) => `header.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: identity }, ...(exp === undefined ? {} : { exp }) })).toString("base64url")}.signature`;
const revision = () => ({ updatedAt: new Date("2026-10-01"), cachedToken: `enc:${jwt("shared")}`, refreshToken: "enc:shared-refresh" });
const credential = (providerId: string) => ({ id: `credential-${providerId}`, providerId, ...revision(), status: "ok", tokenExpiresAt: new Date("2099-01-01") });
const connection = (providerId: string) => ({ id: `connection-${providerId}`, connectionId: `provider-default-${providerId}`, providerId, organizationId: null, credentialEntryId: `credential-${providerId}`, authMethod: "oauth", status: "active", updatedAt: new Date("2026-10-01"), credentialEntry: credential(providerId) });
type Credential = Omit<ReturnType<typeof credential>, "cachedToken" | "refreshToken"> & { cachedToken: string | null; refreshToken: string | null };
type Row = Omit<ReturnType<typeof connection>, "organizationId" | "credentialEntry"> & { organizationId: string | null; credentialEntry: Credential };
let rows: Record<string, Row>;
function snapshot(providerId = "codex"): ActiveAccountSnapshot {
  const row = rows[providerId]!;
  return { connectionId: row.connectionId, providerId, credentialEntryId: row.credentialEntryId, updatedAt: new Date(row.updatedAt), credentialRevision: {
    updatedAt: new Date(row.credentialEntry.updatedAt), cachedToken: row.credentialEntry.cachedToken, refreshToken: row.credentialEntry.refreshToken,
  } };
}
function guard(providerId = "codex", controller = new AbortController()) {
  const row = rows[providerId]!;
  return { signal: controller.signal, connection: { ...row, updatedAt: new Date(row.updatedAt) }, credential: { ...row.credentialEntry, updatedAt: new Date(row.credentialEntry.updatedAt) }, validateAccessToken: vi.fn() };
}
const response = (identity = "shared") => ({ ok: true, json: async () => ({ access_token: jwt(identity), refresh_token: "rotated", expires_in: 3600 }) }) as Response;

describe("active and scoped OAuth renewal composition", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    rows = { codex: connection("codex"), chatgpt: connection("chatgpt") };
    db.modelProvider.findUnique.mockResolvedValue({ tokenUrl: "https://auth.openai.com/oauth/token", oauthClientId: "test" });
    db.aiProviderConnection.findUnique.mockImplementation(async ({ where, include }) => {
      const row = Object.values(rows).find(row => row.connectionId === where.connectionId);
      return row ? { ...row, ...(include?.credentialEntry ? { credentialEntry: { ...row.credentialEntry } } : {}) } : null;
    });
    db.$queryRaw.mockImplementation(async (_parts, id) => [{ id: Object.values(rows).find(row => row.connectionId === id)?.id }]);
    db.credentialEntry.findUnique.mockImplementation(async ({ where }) => Object.values(rows).find(row => row.credentialEntry.id === where.id || row.providerId === where.providerId)?.credentialEntry ?? null);
    db.$transaction.mockImplementation(async run => run(db));
    db.credentialEntry.updateMany.mockResolvedValue({ count: 1 });
    vi.stubGlobal("fetch", vi.fn(async () => response()));
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each(["codex", "chatgpt"])("renews proven shared defaults from third-only %s snapshot", async providerId => {
    const active = snapshot(providerId);
    expect(await refreshOAuthToken(providerId, active.connectionId, active)).toEqual({ token: jwt("shared") });
    expect(db.credentialEntry.updateMany).toHaveBeenCalledTimes(2);
    expect(db.$queryRaw.mock.calls.map(([, id]) => id)).toEqual(["provider-default-chatgpt", "provider-default-codex"]);
    const selected = db.credentialEntry.updateMany.mock.calls.find(([args]) => JSON.stringify(args.where).includes(active.credentialEntryId))![0];
    expect(active.credentialRevision).toEqual(expect.objectContaining({ cachedToken: selected.data.cachedToken, refreshToken: selected.data.refreshToken, updatedAt: selected.data.updatedAt }));
    expect(db.aiProviderConnection.update).not.toHaveBeenCalled();
  });

  it("requires both the third active snapshot and fourth cancellation guard", async () => {
    const active = snapshot(), controller = new AbortController(), scoped = guard("codex", controller);
    controller.abort();
    expect(await refreshOAuthToken("codex", active.connectionId, active, scoped)).toEqual({ error: expect.any(String) });
    expect(fetch).not.toHaveBeenCalled();
    expect(db.credentialEntry.updateMany).not.toHaveBeenCalled();
  });

  it.each(["rejected-status", "expired-jwt"])("does not reuse a %s token despite future stored expiry", async reason => {
    if (reason === "rejected-status") rows.codex!.credentialEntry.status = "expired";
    else rows.codex!.credentialEntry.cachedToken = `enc:${jwt("shared", Math.floor(Date.now() / 1000) - 60)}`;
    const active = snapshot();
    expect(await getActiveAccountBearerToken(active)).toEqual({ token: jwt("shared") });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(db.credentialEntry.updateMany).toHaveBeenCalledTimes(2);
  });

  it.each(["oauth", "oauth2_authorization_code"])("preserves proven pairing with captured %s authentication", async authMethod => {
    rows.codex!.authMethod = authMethod; rows.chatgpt!.authMethod = authMethod;
    const active = snapshot();
    expect(await refreshOAuthToken("codex", active.connectionId, active)).toEqual({ token: jwt("shared") });
    expect(db.credentialEntry.updateMany).toHaveBeenCalledTimes(2);
  });

  it("expires only the captured active credential when its refresh token is absent", async () => {
    rows.codex!.credentialEntry.refreshToken = null;
    rows.codex!.credentialEntry.tokenExpiresAt = new Date("2020-01-01");
    const active = snapshot();
    expect(await refreshOAuthToken("codex", active.connectionId, active)).toEqual({ error: "Re-authentication required" });
    expect(fetch).not.toHaveBeenCalled();
    expect(db.$queryRaw.mock.calls.map(([, id]) => id)).toEqual([active.connectionId]);
    expect(db.credentialEntry.updateMany).toHaveBeenCalledExactlyOnceWith({ where: expect.objectContaining({ id: active.credentialEntryId,
      cachedToken: active.credentialRevision.cachedToken, refreshToken: null, providerConnection: { is: expect.objectContaining({ status: "active", organizationId: null }) } }), data: { status: "expired" } });
  });

  it("cannot expire a credential after Disable while refresh failure is pending", async () => {
    const active = snapshot();
    vi.mocked(fetch).mockImplementation(async () => { rows.codex!.status = "disabled"; return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 401 }); });
    expect(await refreshOAuthToken("codex", active.connectionId, active)).toEqual({ error: expect.stringContaining("changed") });
    expect(db.credentialEntry.updateMany).not.toHaveBeenCalled();
  });

  it.each([429, 500, 503])("does not expire the active grant or request reauthentication for HTTP %s", async status => {
    const active = snapshot();
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: "temporarily_unavailable" }), { status }));
    const result = await refreshOAuthToken("codex", active.connectionId, active);
    expect(result).toEqual({ error: expect.stringContaining("unavailable") });
    expect(JSON.stringify(result)).not.toContain("re-authentication");
    expect(db.credentialEntry.updateMany).not.toHaveBeenCalled();
    expect(db.credentialEntry.update).not.toHaveBeenCalled();
  });

  it.each([401, 403, 400])("preserves a genuine grant refusal for HTTP %s", async status => {
    const active = snapshot();
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: "invalid_grant" }), { status }));
    expect(await refreshOAuthToken("codex", active.connectionId, active)).toEqual({ error: "Selected account re-authentication required" });
    expect(db.credentialEntry.updateMany).toHaveBeenCalledExactlyOnceWith({ where: expect.objectContaining({ id: active.credentialEntryId }), data: { status: "expired" } });
  });

  // BI-A53C594E: a 401/403 without an RFC 6749 invalid_grant code is not proof the
  // grant is dead. On 2026-10-21 one such refusal took anthropic-sub dark for six
  // days; the same refresh token renewed on its first later attempt.
  it.each([401, 403])("treats a bare HTTP %s as a retryable renewal failure, not a refused grant", async status => {
    const active = snapshot();
    vi.mocked(fetch).mockResolvedValue(new Response("<html>blocked</html>", { status }));
    const result = await refreshOAuthToken("codex", active.connectionId, active);
    expect(result).toEqual({ error: `OAuth token renewal failed (HTTP ${status})` });
    expect(isConfirmedReauthenticationRequired("error" in result ? result.error : "")).toBe(false);
    expect(db.credentialEntry.updateMany).not.toHaveBeenCalled();
  });

  it("records the refusal status and OAuth error code, never token values", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const active = snapshot();
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
    await refreshOAuthToken("codex", active.connectionId, active);
    const logged = warn.mock.calls.map(args => args.join(" ")).join("\n");
    expect(logged).toContain("HTTP 400");
    expect(logged).toContain("invalid_grant");
    expect(logged).not.toContain("shared-refresh");
    warn.mockRestore();
  });

  it("treats a legacy unscoped bare 401 as retryable without expiring the stored credential", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("nope", { status: 401 }));
    expect(await refreshOAuthToken("codex")).toEqual({ error: "OAuth token renewal failed (HTTP 401)" });
    expect(db.credentialEntry.update).not.toHaveBeenCalled();
  });

  it.each([
    ["Selected account re-authentication required", true],
    ["OAuth token expired — admin must re-authenticate", true],
    ["Re-authentication required", true],
    ["OAuth token renewal failed (HTTP 401)", false],
    ["OAuth token renewal unavailable (HTTP 503)", false],
    ["Token refresh network error", false],
  ])("classifies %j as confirmed sign-in loss: %s", (error, confirmed) => {
    expect(isConfirmedReauthenticationRequired(error)).toBe(confirmed);
  });

  it("keeps an unknown OAuth 400 distinct from invalid credentials", async () => {
    const active = snapshot();
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: "invalid_client" }), { status: 400 }));
    expect(await refreshOAuthToken("codex", active.connectionId, active)).toEqual({ error: expect.stringContaining("failed") });
    expect(db.credentialEntry.updateMany).not.toHaveBeenCalled();
  });

  it("rechecks the selected owner immediately before HTTP after provider resolution", async () => {
    const scoped = guard();
    db.modelProvider.findUnique.mockImplementation(async () => { rows.codex!.status = "disabled"; return { tokenUrl: "https://auth.openai.com/oauth/token", oauthClientId: "test" }; });
    expect(await refreshOAuthToken("codex", scoped.connection.connectionId, undefined, scoped)).toEqual({ error: expect.any(String) });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses a same-timestamp ciphertext replacement before HTTP", async () => {
    const scoped = guard();
    db.modelProvider.findUnique.mockImplementation(async () => { rows.codex!.credentialEntry.cachedToken = "enc:replacement"; return { tokenUrl: "https://auth.openai.com/oauth/token", oauthClientId: "test" }; });
    expect(await refreshOAuthToken("codex", scoped.connection.connectionId, undefined, scoped)).toEqual({ error: expect.any(String) });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not consume a grant if a captured sibling changes before HTTP", async () => {
    const active = snapshot(), read = db.aiProviderConnection.findUnique.getMockImplementation()!;
    let pairCaptured = false;
    db.aiProviderConnection.findUnique.mockImplementation(async args => {
      const current = await read(args);
      if (args.where.connectionId === "provider-default-chatgpt") pairCaptured = true;
      else if (pairCaptured) rows.chatgpt!.status = "disabled";
      return current;
    });
    expect(await refreshOAuthToken("codex", active.connectionId, active)).toEqual({ error: expect.any(String) });
    expect(fetch).not.toHaveBeenCalled();
    expect(db.credentialEntry.updateMany).not.toHaveBeenCalled();
  });

  it("does not accept plaintext in the encrypted revision fields", async () => {
    const scoped = guard(); scoped.credential.cachedToken = jwt("shared"); scoped.credential.refreshToken = "shared-refresh";
    expect(await refreshOAuthToken("codex", scoped.connection.connectionId, undefined, scoped)).toEqual({ error: expect.any(String) });
    expect(fetch).not.toHaveBeenCalled();
    expect(db.credentialEntry.updateMany).not.toHaveBeenCalled();
  });

  it.each(["status", "owner", "revision", "organization"])("refuses all pair writes when captured sibling %s changes", async kind => {
    const active = snapshot();
    vi.mocked(fetch).mockImplementation(async () => {
      if (kind === "status") rows.chatgpt!.status = "disabled";
      if (kind === "owner") rows.chatgpt!.credentialEntryId = "foreign";
      if (kind === "revision") rows.chatgpt!.updatedAt = new Date("2026-10-02");
      if (kind === "organization") rows.chatgpt!.organizationId = "peer";
      return response();
    });
    expect(await refreshOAuthToken("codex", active.connectionId, active)).toEqual({ error: expect.any(String) });
    expect(db.credentialEntry.updateMany).not.toHaveBeenCalled();
  });

  it("does not advance caller revision when the second participant CAS loses", async () => {
    const active = snapshot(), before = structuredClone(active.credentialRevision);
    db.credentialEntry.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    expect(await refreshOAuthToken("codex", active.connectionId, active)).toEqual({ error: expect.any(String) });
    expect(active.credentialRevision).toEqual(before);
    // Real rollback is separately exercised on PostgreSQL.
  });

  it.each(["identity", "refresh", "peer-owner"])("keeps an unproven %s pair selected-only", async kind => {
    if (kind === "identity") rows.chatgpt!.credentialEntry.cachedToken = `enc:${jwt("other")}`;
    if (kind === "refresh") rows.chatgpt!.credentialEntry.refreshToken = "enc:other";
    if (kind === "peer-owner") rows.chatgpt!.organizationId = "peer";
    const active = snapshot();
    expect(await refreshOAuthToken("codex", active.connectionId, active)).toEqual({ token: jwt("shared") });
    expect(db.credentialEntry.updateMany).toHaveBeenCalledTimes(1);
  });

  it("rejects a different returned default identity before persistence", async () => {
    const active = snapshot();
    vi.mocked(fetch).mockResolvedValue(response("foreign"));
    expect(await refreshOAuthToken("codex", active.connectionId, active)).toEqual({ error: expect.any(String) });
    expect(db.credentialEntry.updateMany).not.toHaveBeenCalled();
  });

  it("validates selected identity even when a third-only default has unproven pairing", async () => {
    rows.chatgpt!.credentialEntry.refreshToken = "enc:other";
    const active = snapshot(); vi.mocked(fetch).mockResolvedValue(response("foreign"));
    expect(await refreshOAuthToken("codex", active.connectionId, active)).toEqual({ error: expect.any(String) });
    expect(db.credentialEntry.updateMany).not.toHaveBeenCalled();
  });

  it("keeps a fourth-only additional account isolated without reading either default", async () => {
    rows.codex!.connectionId = "additional-account";
    const scoped = guard();
    expect(await refreshOAuthToken("codex", scoped.connection.connectionId, undefined, scoped)).toEqual({ token: jwt("shared") });
    expect(db.credentialEntry.updateMany).toHaveBeenCalledTimes(1);
    for (const [args] of db.aiProviderConnection.findUnique.mock.calls) expect(args.where.connectionId).toBe("additional-account");
  });

  it("captures authorization before caller mutation while HTTP is pending", async () => {
    const active = snapshot(), scoped = guard();
    vi.mocked(fetch).mockImplementation(async () => {
      active.credentialRevision.cachedToken = "enc:caller-mutated";
      active.updatedAt.setUTCFullYear(2099);
      scoped.connection.updatedAt.setUTCFullYear(2099);
      scoped.credential.refreshToken = "enc:caller-mutated";
      return response();
    });
    expect(await refreshOAuthToken("codex", active.connectionId, active, scoped)).toEqual({ token: jwt("shared") });
    for (const [args] of db.credentialEntry.updateMany.mock.calls) {
      expect(JSON.stringify(args.where)).not.toContain("caller-mutated");
      expect(JSON.stringify(args.where)).not.toContain("2099");
    }
  });
});
