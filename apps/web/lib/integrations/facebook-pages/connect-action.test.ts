import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUpsert, mockProbeFacebookPages } = vi.hoisted(() => ({
  mockUpsert: vi.fn(),
  mockProbeFacebookPages: vi.fn(),
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
  FacebookPagesApiError: class FacebookPagesApiError extends Error {},
  probeFacebookPages: mockProbeFacebookPages,
}));

import { connectFacebookPages } from "./connect-action";

describe("connectFacebookPages", () => {
  beforeEach(() => {
    mockUpsert.mockReset();
    mockProbeFacebookPages.mockReset();
    mockUpsert.mockResolvedValue({});
  });

  it("persists encrypted credentials and returns page summary on success", async () => {
    mockProbeFacebookPages.mockResolvedValue({
      page: {
        id: "123456789",
        name: "Acme Managed Services",
        category: "Business service",
        link: "https://www.facebook.com/acme",
        fanCount: 284,
      },
      recentPosts: [],
      recentComments: [],
    });

    const result = await connectFacebookPages({
      accessToken: "meta-token",
      pageId: "123456789",
    });

    expect(result.ok).toBe(true);
    expect(result).toMatchObject({
      status: "connected",
      pageId: "123456789",
      pageName: "Acme Managed Services",
    });
    const call = mockUpsert.mock.calls[0][0];
    expect(call.where.integrationId).toBe("facebook-pages");
    expect(call.create.provider).toBe("facebook");
    expect(call.create.status).toBe("connected");
  });

  it("stores error state when probing fails", async () => {
    mockProbeFacebookPages.mockRejectedValue(new Error("invalid Meta page access"));

    const result = await connectFacebookPages({
      accessToken: "meta-token",
      pageId: "123456789",
    });

    expect(result).toEqual({
      ok: false,
      status: "error",
      error: "invalid Meta page access",
      statusCode: 400,
    });
    expect(mockUpsert.mock.calls[0][0].create.status).toBe("error");
  });

  it("rejects invalid input before persistence", async () => {
    const result = await connectFacebookPages({
      accessToken: "",
      pageId: "",
    });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      status: "error",
      statusCode: 400,
    });
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});
