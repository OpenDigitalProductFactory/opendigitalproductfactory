import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./mcp-api-token", () => ({
  issueMcpApiToken: vi.fn(),
  revokeEphemeralShipTokensForBuild: vi.fn(),
}));

import {
  issueMcpApiToken,
  revokeEphemeralShipTokensForBuild,
} from "./mcp-api-token";
import {
  EPHEMERAL_SHIP_TOKEN_EXPIRY_DAYS,
  EPHEMERAL_SHIP_TOKEN_SCOPES,
  manageEphemeralShipTokensForTransition,
} from "./ephemeral-ship-tokens";

const issueMock = issueMcpApiToken as unknown as ReturnType<typeof vi.fn>;
const revokeMock = revokeEphemeralShipTokensForBuild as unknown as ReturnType<
  typeof vi.fn
>;

beforeEach(() => {
  vi.resetAllMocks();
});

describe("manageEphemeralShipTokensForTransition", () => {
  const baseInput = {
    buildId: "FB-1234567890ABCDEF",
    userId: "user_owner",
    buildTitle: "Add MCP token lifecycle UX",
  };

  describe("review → ship (entry)", () => {
    it("issues a write-tier ephemeral_ship token bound to the build", async () => {
      issueMock.mockResolvedValue({
        ok: true,
        tokenId: "tok_new",
        plaintext: "dpfmcp_PLAINTEXT",
        prefix: "dpfmcp_PLAIN",
        tokenSuffix: "TEXT",
        expiresAt: null,
      });

      const result = await manageEphemeralShipTokensForTransition({
        ...baseInput,
        currentPhase: "review",
        targetPhase: "ship",
      });

      expect(result).toEqual({
        kind: "issued",
        tokenId: "tok_new",
        plaintext: "dpfmcp_PLAINTEXT",
        prefix: "dpfmcp_PLAIN",
      });
      expect(issueMock).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user_owner",
          kind: "ephemeral_ship",
          buildId: "FB-1234567890ABCDEF",
          scope: "write",
          expiresInDays: EPHEMERAL_SHIP_TOKEN_EXPIRY_DAYS,
          scopes: expect.arrayContaining([
            "iac_execute",
            "sandbox_execute",
            "backlog_write",
          ]),
        }),
      );
      // Revoke must not fire on ship entry.
      expect(revokeMock).not.toHaveBeenCalled();
    });

    it("forms an identifiable name from the build's short id + title", async () => {
      issueMock.mockResolvedValue({
        ok: true,
        tokenId: "tok_x",
        plaintext: "x",
        prefix: "x",
        tokenSuffix: "x",
        expiresAt: null,
      });
      await manageEphemeralShipTokensForTransition({
        ...baseInput,
        currentPhase: "review",
        targetPhase: "ship",
      });
      const passed = issueMock.mock.calls[0]![0] as { name: string };
      expect(passed.name).toContain("ship:");
      // Short id should be the last 8 chars of the buildId.
      expect(passed.name).toContain("ABCDEF");
      expect(passed.name).toContain("Add MCP token lifecycle UX");
    });

    it("returns null (non-fatal) when underlying issue fails", async () => {
      issueMock.mockResolvedValue({
        ok: false,
        error: "missing_name",
        message: "name is required",
      });
      const result = await manageEphemeralShipTokensForTransition({
        ...baseInput,
        currentPhase: "review",
        targetPhase: "ship",
      });
      expect(result).toBeNull();
    });

    it("scope set never includes admin_write or admin_read (blast radius)", () => {
      expect(EPHEMERAL_SHIP_TOKEN_SCOPES).not.toContain("admin_write");
      expect(EPHEMERAL_SHIP_TOKEN_SCOPES).not.toContain("admin_read");
    });
  });

  describe("ship → exit (revoke)", () => {
    it("revokes all active ephemeral_ship tokens for the build on ship→complete", async () => {
      revokeMock.mockResolvedValue({ revokedCount: 2 });

      const result = await manageEphemeralShipTokensForTransition({
        ...baseInput,
        currentPhase: "ship",
        targetPhase: "complete",
      });

      expect(result).toEqual({ kind: "revoked", revokedCount: 2 });
      expect(revokeMock).toHaveBeenCalledWith(
        "FB-1234567890ABCDEF",
        expect.stringContaining("ship phase exited"),
      );
      expect(issueMock).not.toHaveBeenCalled();
    });

    it("also revokes on ship → failed and ship → review (rollback paths)", async () => {
      revokeMock.mockResolvedValue({ revokedCount: 1 });

      const failedResult = await manageEphemeralShipTokensForTransition({
        ...baseInput,
        currentPhase: "ship",
        targetPhase: "failed",
      });
      expect(failedResult?.kind).toBe("revoked");

      revokeMock.mockResolvedValue({ revokedCount: 1 });
      const rollbackResult = await manageEphemeralShipTokensForTransition({
        ...baseInput,
        currentPhase: "ship",
        targetPhase: "review",
      });
      expect(rollbackResult?.kind).toBe("revoked");

      expect(revokeMock).toHaveBeenCalledTimes(2);
    });

    it("idempotent — reports revokedCount=0 when no active ephemeral tokens exist", async () => {
      revokeMock.mockResolvedValue({ revokedCount: 0 });
      const result = await manageEphemeralShipTokensForTransition({
        ...baseInput,
        currentPhase: "ship",
        targetPhase: "complete",
      });
      expect(result).toEqual({ kind: "revoked", revokedCount: 0 });
    });
  });

  describe("unrelated transitions", () => {
    it("returns null and touches neither helper on ideate → plan", async () => {
      const result = await manageEphemeralShipTokensForTransition({
        ...baseInput,
        currentPhase: "ideate",
        targetPhase: "plan",
      });
      expect(result).toBeNull();
      expect(issueMock).not.toHaveBeenCalled();
      expect(revokeMock).not.toHaveBeenCalled();
    });

    it("returns null on a same-phase no-op (ship → ship)", async () => {
      const result = await manageEphemeralShipTokensForTransition({
        ...baseInput,
        currentPhase: "ship",
        targetPhase: "ship",
      });
      expect(result).toBeNull();
      expect(issueMock).not.toHaveBeenCalled();
      expect(revokeMock).not.toHaveBeenCalled();
    });

    it("returns null on plan → build (token lifecycle untouched)", async () => {
      const result = await manageEphemeralShipTokensForTransition({
        ...baseInput,
        currentPhase: "plan",
        targetPhase: "build",
      });
      expect(result).toBeNull();
    });
  });
});
