import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ capability: vi.fn(), execute: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/actions/shared/guards", () => ({ requireCapability: vi.fn(), requireCapabilityContext: mocks.capability }));
vi.mock("@/lib/mcp-governed-execute", () => ({ governedExecuteTool: mocks.execute }));
vi.mock("@/lib/portfolio/accountable-owner", () => ({ setPortfolioOwner: vi.fn() }));
vi.mock("@/lib/portfolio/epic-portfolio-attribution", () => ({ confirmEpicPortfolios: vi.fn() }));
vi.mock("@/lib/portfolio/portfolio-budget", () => ({ setPortfolioBudget: vi.fn() }));
vi.mock("@/lib/i18n/t.server", () => ({ getT: async () => (key: string) => key }));

import * as actions from "./portfolio-budget";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.capability.mockResolvedValue({ userId: "signed-in-owner", userContext: { userId: "signed-in-owner" } });
});

describe("platform ownership portal actions", () => {
  it("reads through the same governed tool with authenticated platform capability", async () => {
    const data = { status: "available", organizations: [], nextCursor: null };
    mocks.execute.mockResolvedValue({ success: true, data });
    expect(await actions.loadPlatformFundingSetupAction("next-owned-organization")).toEqual({ ok: true, data });
    expect(mocks.capability).toHaveBeenCalledWith("manage_platform");
    expect(mocks.execute).toHaveBeenCalledWith({
      toolName: "read_platform_funding_setup", rawParams: { afterOrganizationId: "next-owned-organization" },
      userId: "signed-in-owner", userContext: { userId: "signed-in-owner" },
      context: { routeContext: "/ops/demand" }, source: "rest",
    });
  });

  it("confirms through trusted REST provenance without a caller-supplied owner identity", async () => {
    const input = { organizationId: "owned-organization", expectedDigest: "fresh-state", attestation: true as const, reason: "This is my platform allocation." };
    const data = { status: "confirmed", principalId: "authenticated-principal" };
    mocks.execute.mockResolvedValue({ success: true, data });
    expect(await actions.confirmPlatformFundingOwnerAction(input)).toEqual({ ok: true, data });
    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({
      toolName: "confirm_platform_funding_owner", rawParams: input, userId: "signed-in-owner", source: "rest",
      context: { routeContext: "/ops/demand" },
    }));
    expect(mocks.revalidate).toHaveBeenCalledWith("/ops/demand");
  });

  it("never presents a pending approval or missing result as completed ownership", async () => {
    mocks.execute.mockResolvedValue({ success: true, message: "Owner decision required.", disposition: { kind: "waiting" } });
    const result = await actions.confirmPlatformFundingOwnerAction({ organizationId: "owned", expectedDigest: "state", attestation: true, reason: "My ownership." });
    expect(result).toEqual({ ok: false, error: "Owner decision required." });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("stops before invoking the writer when current platform capability is refused", async () => {
    mocks.capability.mockRejectedValue(new Error("forbidden"));
    await expect(actions.confirmPlatformFundingOwnerAction({ organizationId: "owned", expectedDigest: "state", attestation: true, reason: "My ownership." })).rejects.toThrow("forbidden");
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
