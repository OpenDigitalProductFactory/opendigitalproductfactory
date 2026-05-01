import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUpsert, mockProbeInstagramBusiness } = vi.hoisted(() => ({
  mockUpsert: vi.fn(),
  mockProbeInstagramBusiness: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: { integrationCredential: { upsert: mockUpsert } },
}));

vi.mock("@/lib/govern/credential-crypto", () => ({
  encryptJson: vi.fn((value: unknown) => JSON.stringify(value)),
}));

vi.mock("./client", () => ({
  InstagramBusinessApiError: class InstagramBusinessApiError extends Error {},
  probeInstagramBusiness: mockProbeInstagramBusiness,
}));

import { connectInstagramBusiness } from "./connect-action";

describe("connectInstagramBusiness", () => {
  beforeEach(() => {
    mockUpsert.mockReset();
    mockProbeInstagramBusiness.mockReset();
    mockUpsert.mockResolvedValue({});
  });

  it("persists encrypted credentials and profile summary on success", async () => {
    mockProbeInstagramBusiness.mockResolvedValue({
      profile: { id: "ig-123", username: "acme_austin", name: "Acme Austin", followersCount: 1240 },
      recentMedia: [],
      recentComments: [],
    });

    const result = await connectInstagramBusiness({
      accessToken: "meta-token",
      instagramBusinessAccountId: "ig-123",
    });

    expect(result.ok).toBe(true);
    expect(result).toMatchObject({
      status: "connected",
      instagramBusinessAccountId: "ig-123",
      username: "acme_austin",
    });
    const call = mockUpsert.mock.calls[0][0];
    expect(call.where.integrationId).toBe("instagram-business");
    expect(call.create.provider).toBe("facebook");
    expect(call.create.status).toBe("connected");
  });

  it("rejects invalid input before persistence", async () => {
    const result = await connectInstagramBusiness({
      accessToken: "",
      instagramBusinessAccountId: "",
    });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ status: "error", statusCode: 400 });
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});
