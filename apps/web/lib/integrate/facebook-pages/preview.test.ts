import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindUnique, mockUpdate, mockProbeFacebookPages } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn(),
  mockProbeFacebookPages: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    integrationCredential: {
      findUnique: mockFindUnique,
      update: mockUpdate,
    },
  },
}));

vi.mock("@/lib/govern/credential-crypto", () => ({
  decryptJson: vi.fn((value: string) => JSON.parse(value)),
}));

vi.mock("./client", () => ({
  probeFacebookPages: mockProbeFacebookPages,
}));

import { loadFacebookPagesPreview } from "./preview";

describe("loadFacebookPagesPreview", () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
    mockUpdate.mockReset();
    mockProbeFacebookPages.mockReset();
    mockUpdate.mockResolvedValue({});
  });

  it("returns unavailable when no credential exists", async () => {
    mockFindUnique.mockResolvedValue(null);
    await expect(loadFacebookPagesPreview()).resolves.toEqual({ state: "unavailable" });
  });

  it("refreshes preview data and updates the credential state", async () => {
    mockFindUnique.mockResolvedValue({
      integrationId: "facebook-pages",
      fieldsEnc: JSON.stringify({
        accessToken: "meta-token",
        pageId: "123456789",
      }),
    });
    mockProbeFacebookPages.mockResolvedValue({
      page: {
        id: "123456789",
        name: "Acme Managed Services",
        category: "Business service",
        link: "https://www.facebook.com/acme",
        fanCount: 284,
      },
      recentPosts: [{ id: "post-1", message: "Hello local Austin." }],
      recentComments: [{ id: "comment-1", message: "Need help?", fromName: "Taylor" }],
    });

    const result = await loadFacebookPagesPreview();

    expect(result.state).toBe("available");
    if (result.state !== "available") throw new Error("expected available preview");
    expect(result.preview.page.id).toBe("123456789");
    expect(result.preview.recentPosts[0]?.id).toBe("post-1");
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0][0].data.status).toBe("connected");
  });
});
