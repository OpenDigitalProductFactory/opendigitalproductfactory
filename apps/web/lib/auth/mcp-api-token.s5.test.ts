import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@dpf/db";
import {
  acknowledgeMcpTokenRefresh,
  addScopesToMcpApiToken,
  copyMcpApiTokenPlaintext,
  resolveMcpApiToken,
  rotateMcpApiToken,
} from "./mcp-api-token";

vi.mock("@dpf/db", () => ({
  prisma: { mcpApiToken: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() } },
}));

const tokenFindUnique = vi.mocked(prisma.mcpApiToken.findUnique);
const tokenCreate = vi.mocked(prisma.mcpApiToken.create);
const tokenUpdate = vi.mocked(prisma.mcpApiToken.update);

beforeEach(() => vi.resetAllMocks());

describe("S5 credentials are never PATs", () => {
  it("refuses to rotate, copy, add grants, resolve or refresh a scoped Workroom row", async () => {
    tokenFindUnique.mockResolvedValue({ id: "token-a", userId: "user-a", name: "Fixture room credential", kind: "workroom_session_scoped", scope: "read",
      capability: "read", revokedAt: null, expiresAt: null, scopes: ["work_capsule_read"], secretEnc: "not-a-copyable-secret" } as never);
    expect(await rotateMcpApiToken({ tokenId: "token-a", userId: "user-a" })).toMatchObject({ ok: false });
    expect(await copyMcpApiTokenPlaintext("token-a")).toEqual({ ok: false, error: "not_found" });
    expect(await addScopesToMcpApiToken("token-a", ["file_read"])).toMatchObject({ ok: false });
    expect(await resolveMcpApiToken("dpfmcp_fixture")).toBeNull();
    expect(await acknowledgeMcpTokenRefresh("dpfmcp_fixture")).toMatchObject({ ok: false });
    expect(tokenCreate).not.toHaveBeenCalled();
    expect(tokenUpdate).not.toHaveBeenCalled();
  });
});
