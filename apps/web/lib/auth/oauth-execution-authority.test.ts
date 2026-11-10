import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("./oauth-identity-binding", () => ({
  currentOAuthHuman: vi.fn(), resolveOAuthConsent: vi.fn(), OAUTH_SETUP_REQUIRED: "setup",
}));
import { currentOAuthHuman, resolveOAuthConsent } from "./oauth-identity-binding";
import { inspectOAuthExecutionAuthority, isCurrentOAuthExecutionAuthority } from "./oauth-tokens";

function fixture() {
  const row = { kind: "oauth_access", revokedAt: null as Date | null,
    expiresAt: new Date(Date.now() + 60_000), userId: "private-human", agentId: "private-agent",
    authorityBindingId: "private-consent" as string | null, oauthClientId: "private-client" as string | null,
    resource: "https://private.example/api/mcp/v1" as string | null, publicScopes: ["dpf.work"],
    oauthFamilyKey: "private-family" as string | null,
    oauthClient: { revokedAt: null as Date | null, registrationKind: "dcr" } as
      { revokedAt: Date | null; registrationKind: string } | null };
  const db = { mcpApiToken: { findFirst: vi.fn().mockResolvedValue(null) },
    oAuthRefreshToken: { findFirst: vi.fn().mockResolvedValue(null) } };
  return { row, db };
}
beforeEach(() => {
  vi.mocked(currentOAuthHuman).mockReset().mockResolvedValue({ id: "private-human" } as never);
  vi.mocked(resolveOAuthConsent).mockReset().mockResolvedValue({ agentId: "private-agent", agentRecordId: "private-record" });
});

describe("shared OAuth execution diagnosis", () => {
  it.each([
    "token-kind-invalid", "token-revoked", "client-missing", "client-revoked", "human-unavailable",
    "continuity-envelope-missing", "continuity-evidence-missing", "consent-binding-missing",
    "consent-envelope-missing", "consent-invalid",
  ])("returns only the current fixed %s refusal and preserves false", async (detail) => {
    const { row, db } = fixture();
    if (detail === "token-kind-invalid") row.kind = "pat";
    if (detail === "token-revoked") row.revokedAt = new Date();
    if (detail === "client-missing") row.oauthClient = null;
    if (detail === "client-revoked") row.oauthClient!.revokedAt = new Date();
    if (detail === "human-unavailable") vi.mocked(currentOAuthHuman).mockResolvedValue(null);
    if (detail.startsWith("continuity-")) row.expiresAt = new Date(0);
    if (detail === "continuity-envelope-missing") row.oauthFamilyKey = null;
    if (detail === "consent-binding-missing") row.authorityBindingId = null;
    if (detail === "consent-envelope-missing") row.resource = null;
    if (detail === "consent-invalid") vi.mocked(resolveOAuthConsent).mockResolvedValue(null);
    expect(await inspectOAuthExecutionAuthority(row as never, db as never)).toEqual({ allowed: false, detail });
    expect(await isCurrentOAuthExecutionAuthority(row as never, db as never)).toBe(false);
  });
  it.each(["current", "successor", "refresh", "credentials", "legacy-credentials-successor"])("preserves eligible %s authority", async (mode) => {
    const { row, db } = fixture();
    if (mode.includes("credentials")) { row.authorityBindingId = null; row.oauthClient!.registrationKind = "credentials"; }
    if (["successor", "refresh", "legacy-credentials-successor"].includes(mode)) {
      row.expiresAt = new Date(0);
      if (mode === "refresh") db.oAuthRefreshToken.findFirst.mockResolvedValue({ id: "private-refresh" });
      else db.mcpApiToken.findFirst.mockResolvedValue({ ...row, expiresAt: new Date(Date.now() + 60_000) });
    }
    if (mode === "legacy-credentials-successor") delete (row as { oauthFamilyKey?: string | null }).oauthFamilyKey;
    expect(await inspectOAuthExecutionAuthority(row as never, db as never)).toEqual({ allowed: true });
    expect(await isCurrentOAuthExecutionAuthority(row as never, db as never)).toBe(true);
    if (mode === "successor") expect(db.oAuthRefreshToken.findFirst).not.toHaveBeenCalled();
    if (mode === "refresh") expect(db.oAuthRefreshToken.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ oauthFamilyKey: "private-family", authorityBindingId: "private-consent",
        userId: "private-human", oauthClientId: "private-client", agentId: "private-agent",
        consumedAt: null, rotatedToId: null, revokedAt: null }),
    }));
  });
  it("does not query human, successors or consent after a missing client", async () => {
    const { row, db } = fixture(); row.oauthClient = null;
    expect(await inspectOAuthExecutionAuthority(row as never, db as never)).toEqual({ allowed: false, detail: "client-missing" });
    expect(currentOAuthHuman).not.toHaveBeenCalled();
    expect(db.mcpApiToken.findFirst).not.toHaveBeenCalled();
    expect(resolveOAuthConsent).not.toHaveBeenCalled();
  });
  it("does not treat an assistant mismatch as valid consent", async () => {
    const { row, db } = fixture();
    vi.mocked(resolveOAuthConsent).mockResolvedValue({ agentId: "other", agentRecordId: "other" });
    expect(await inspectOAuthExecutionAuthority(row as never, db as never)).toEqual({ allowed: false, detail: "consent-invalid" });
    expect(await isCurrentOAuthExecutionAuthority(row as never, db as never)).toBe(false);
  });
  it.each(["human", "successor", "refresh", "consent"])("preserves thrown %s observation failures", async (where) => {
    const { row, db } = fixture(); const error = new Error("private database detail");
    if (where === "human") vi.mocked(currentOAuthHuman).mockRejectedValue(error);
    if (where === "consent") vi.mocked(resolveOAuthConsent).mockRejectedValue(error);
    if (where === "successor" || where === "refresh") row.expiresAt = new Date(0);
    if (where === "successor") db.mcpApiToken.findFirst.mockRejectedValue(error);
    if (where === "refresh") db.oAuthRefreshToken.findFirst.mockRejectedValue(error);
    await expect(inspectOAuthExecutionAuthority(row as never, db as never)).rejects.toBe(error);
    await expect(isCurrentOAuthExecutionAuthority(row as never, db as never)).rejects.toBe(error);
  });
});
