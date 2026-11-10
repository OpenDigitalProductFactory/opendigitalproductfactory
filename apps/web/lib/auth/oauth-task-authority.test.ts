import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), valid: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { mcpApiToken: { findUnique: mocks.findUnique } } }));
vi.mock("./oauth-tokens", () => ({ OAUTH_EXECUTION_AUTHORITY_SELECT: {}, isCurrentOAuthExecutionAuthority: mocks.valid }));
import { resolveMcpTaskAuthorityKey } from "./oauth-task-authority";
beforeEach(() => { vi.resetAllMocks(); mocks.valid.mockResolvedValue(true); });
describe("task ownership across OAuth refresh", () => {
  it("keeps the same task namespace when the access credential rotates", async () => {
    mocks.findUnique.mockResolvedValue({ userId: "human", authorityBindingId: "consent", oauthFamilyKey: "family" });
    const before = await resolveMcpTaskAuthorityKey({ tokenId: "access-before", userId: "human", source: "oauth" });
    const after = await resolveMcpTaskAuthorityKey({ tokenId: "access-after", userId: "human", source: "oauth" });
    expect(before).toBe("oauth-family:family");
    expect(after).toBe(before);
  });
  it("does not merge another connection into the same task namespace", async () => {
    mocks.findUnique.mockResolvedValueOnce({ userId: "human", authorityBindingId: "consent-a", oauthFamilyKey: "a" })
      .mockResolvedValueOnce({ userId: "human", authorityBindingId: "consent-b", oauthFamilyKey: "b" });
    expect(await resolveMcpTaskAuthorityKey({ tokenId: "one", userId: "human", source: "oauth" }))
      .not.toBe(await resolveMcpTaskAuthorityKey({ tokenId: "two", userId: "human", source: "oauth" }));
  });
  it.each([
    { userId: "other", authorityBindingId: "consent", oauthFamilyKey: "family" },
    { userId: "human", authorityBindingId: null, oauthFamilyKey: "family" },
  ])("refuses foreign or identity-less authority", async (row) => {
    mocks.findUnique.mockResolvedValue(row);
    expect(await resolveMcpTaskAuthorityKey({ tokenId: "access", userId: "human", source: "oauth" })).toBeNull();
  });
  it("refuses revoked authorization instead of asking for another task login", async () => {
    mocks.findUnique.mockResolvedValue({ userId: "human", authorityBindingId: "consent", oauthFamilyKey: "family" });
    mocks.valid.mockResolvedValue(false);
    expect(await resolveMcpTaskAuthorityKey({ tokenId: "access", userId: "human", source: "oauth" })).toBeNull();
  });
});
