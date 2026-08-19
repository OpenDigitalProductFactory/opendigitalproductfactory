import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUpsert, mockProbeFacebookLeadAds } = vi.hoisted(() => ({
  mockUpsert: vi.fn(),
  mockProbeFacebookLeadAds: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    integrationCredential: {
      upsert: mockUpsert,
    },
  },
}));

vi.mock("@/lib/govern/credential-crypto", () => ({
  encryptJson: vi.fn((value: unknown) => JSON.stringify(value)),
}));

vi.mock("./client", () => ({
  FacebookLeadAdsApiError: class FacebookLeadAdsApiError extends Error {},
  probeFacebookLeadAds: mockProbeFacebookLeadAds,
}));

import { connectFacebookLeadAds } from "./connect-action";

describe("connectFacebookLeadAds", () => {
  beforeEach(() => {
    mockUpsert.mockReset();
    mockProbeFacebookLeadAds.mockReset();
    mockUpsert.mockResolvedValue({});
  });

  it("persists encrypted credentials and returns page summary on success", async () => {
    mockProbeFacebookLeadAds.mockResolvedValue({
      page: {
        id: "123456789",
        name: "Acme Managed Services",
        category: "Business Service",
      },
      forms: [],
      recentLeads: [],
    });

    const result = await connectFacebookLeadAds({
      accessToken: "meta-token",
      pageId: "123456789",
    });

    expect(result.ok).toBe(true);
    expect(result).toMatchObject({
      status: "connected",
      pageId: "123456789",
      pageName: "Acme Managed Services",
    });
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const call = mockUpsert.mock.calls[0][0];
    expect(call.where.integrationId).toBe("facebook-lead-ads");
    expect(call.create.provider).toBe("facebook");
    expect(call.create.status).toBe("connected");
    expect(call.update.lastErrorMsg).toBeNull();
  });

  it("stores error state when probing fails", async () => {
    mockProbeFacebookLeadAds.mockRejectedValue(new Error("invalid Meta page access"));

    const result = await connectFacebookLeadAds({
      accessToken: "meta-token",
      pageId: "123456789",
    });

    expect(result).toEqual({
      ok: false,
      status: "error",
      error: "invalid Meta page access",
      statusCode: 400,
    });
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert.mock.calls[0][0].create.status).toBe("error");
  });

  it("rejects invalid input before persistence", async () => {
    const result = await connectFacebookLeadAds({
      accessToken: "",
      pageId: "",
    });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      status: "error",
      statusCode: 400,
    });
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockProbeFacebookLeadAds).not.toHaveBeenCalled();
  });
});
