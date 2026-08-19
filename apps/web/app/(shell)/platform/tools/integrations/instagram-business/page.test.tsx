import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { mockFindUnique, mockLoadPreview, mockAuth, mockCan } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockLoadPreview: vi.fn(),
  mockAuth: vi.fn(),
  mockCan: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: { integrationCredential: { findUnique: mockFindUnique } },
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((target: string) => {
    throw new Error(`redirect:${target}`);
  }),
}));
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/permissions", () => ({ can: mockCan }));
vi.mock("@/lib/govern/credential-crypto", () => ({
  decryptJson: vi.fn((value: string) => JSON.parse(value)),
}));
vi.mock("@/lib/integrations/instagram-business/preview", () => ({
  loadInstagramBusinessPreview: mockLoadPreview,
}));
vi.mock("@/components/integrations/InstagramBusinessConnectPanel", () => ({
  InstagramBusinessConnectPanel: ({ initialState }: { initialState: { status: string; username: string | null } }) => (
    <div data-component="instagram-business-connect-panel" data-status={initialState.status} data-username={initialState.username ?? ""} />
  ),
}));

describe("InstagramBusinessPage", () => {
  it("renders profile, media, and comments from the live preview", async () => {
    mockAuth.mockResolvedValue({ user: { platformRole: "superadmin", isSuperuser: true } });
    mockCan.mockReturnValue(true);
    mockFindUnique.mockResolvedValue({
      integrationId: "instagram-business",
      status: "connected",
      lastErrorMsg: null,
      lastTestedAt: new Date("2026-05-01T11:00:00.000Z"),
      fieldsEnc: JSON.stringify({
        instagramBusinessAccountId: "ig-123",
        username: "acme_austin",
      }),
    });
    mockLoadPreview.mockResolvedValue({
      state: "available",
      preview: {
        profile: {
          id: "ig-123",
          username: "acme_austin",
          name: "Acme Austin",
          followersCount: 1240,
          mediaCount: 84,
        },
        recentMedia: [
          {
            id: "media-1",
            caption: "Austin appointments open this Friday.",
            mediaType: "IMAGE",
            permalink: "https://instagram.com/p/media-1",
            timestamp: "2026-05-01T14:00:00.000Z",
            likeCount: 42,
            commentsCount: 3,
          },
        ],
        recentComments: [
          {
            id: "comment-1",
            text: "Do you cover Round Rock?",
            username: "localbuyer",
            timestamp: "2026-05-01T15:00:00.000Z",
          },
        ],
        loadedAt: "2026-05-01T16:00:00.000Z",
      },
    });

    const { default: InstagramBusinessPage } = await import("./page");
    const html = renderToStaticMarkup(await InstagramBusinessPage());

    expect(mockLoadPreview).toHaveBeenCalledTimes(1);
    expect(html).toContain("Live Instagram preview");
    expect(html).toContain("acme_austin");
    expect(html).toContain("Austin appointments open this Friday.");
    expect(html).toContain("Do you cover Round Rock?");
  });
});
