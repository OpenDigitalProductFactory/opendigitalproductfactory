import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  principalAlias: { findFirst: vi.fn() },
}));
vi.mock("@dpf/db", () => ({ prisma: db }));
import { loadAuthenticatedAccount } from "./authenticated-account";

beforeEach(() => vi.clearAllMocks());

describe("authenticated account projection", () => {
  it("binds both reads to the authenticated user and uses canonical display identity", async () => {
    db.user.findUnique.mockResolvedValue({ email: "alex@example.com", isSuperuser: false, groups: [{ platformRole: { roleId: "HR-100", name: "Administrator" } }] });
    db.principalAlias.findFirst.mockResolvedValue({ principal: { principalId: "PRN-ALEX", displayName: "Alex Morgan", kind: "human" } });
    expect(await loadAuthenticatedAccount("authenticated-user")).toEqual({
      userId: "authenticated-user", principalId: "PRN-ALEX", kind: "human", displayName: "Alex Morgan", email: "alex@example.com", platformRole: "HR-100", roleName: "Administrator", isSuperuser: false,
    });
    expect(db.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "authenticated-user" } }));
    expect(db.principalAlias.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { aliasType: "user", aliasValue: "authenticated-user", issuer: "" } }));
  });

  it("uses the full email when the canonical display name is unavailable", async () => {
    db.user.findUnique.mockResolvedValue({ email: "alex@example.com", isSuperuser: true, groups: [] });
    db.principalAlias.findFirst.mockResolvedValue(null);
    expect(await loadAuthenticatedAccount("u1")).toMatchObject({ displayName: "alex@example.com", principalId: null, kind: null, platformRole: null, roleName: null });
  });

  it("shows the assigned platform role when a preceding group has no role", async () => {
    db.user.findUnique.mockResolvedValue({ email: "alex@example.com", isSuperuser: false,
      groups: [{ platformRole: null }, { platformRole: { roleId: "HR-200", name: "Contributor" } }] });
    db.principalAlias.findFirst.mockResolvedValue(null);
    expect(await loadAuthenticatedAccount("u1")).toMatchObject({ platformRole: "HR-200", roleName: "Contributor" });
  });

  it("returns an explicit missing account instead of inventing a person", async () => {
    db.user.findUnique.mockResolvedValue(null);
    db.principalAlias.findFirst.mockResolvedValue(null);
    expect(await loadAuthenticatedAccount("missing")).toBeNull();
  });
});
