import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { mockFindUnique, mockLoadPreview, mockAuth, mockCan } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockLoadPreview: vi.fn(),
  mockAuth: vi.fn(),
  mockCan: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    integrationCredential: {
      findUnique: mockFindUnique,
    },
  },
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((target: string) => {
    throw new Error(`redirect:${target}`);
  }),
}));

vi.mock("@/lib/auth", () => ({
  auth: mockAuth,
}));

vi.mock("@/lib/permissions", () => ({
  can: mockCan,
}));

vi.mock("@/lib/govern/credential-crypto", () => ({
  decryptJson: vi.fn((value: string) => JSON.parse(value)),
}));

vi.mock("@/lib/integrations/facebook-pages/preview", () => ({
  loadFacebookPagesPreview: mockLoadPreview,
}));

vi.mock("@/components/integrations/FacebookPagesConnectPanel", () => ({
  FacebookPagesConnectPanel: ({
    initialState,
  }: {
    initialState: {
      status: string;
      pageId: string | null;
      pageName: string | null;
      lastErrorMsg: string | null;
      lastTestedAt: string | null;
    };
  }) => (
    <div
      data-component="facebook-pages-connect-panel"
      data-status={initialState.status}
      data-page-id={initialState.pageId ?? ""}
      data-page-name={initialState.pageName ?? ""}
    />
  ),
}));

describe("FacebookPagesPage", () => {
  it("renders page, posts, and comments from the live preview", async () => {
    mockAuth.mockResolvedValue({
      user: { platformRole: "superadmin", isSuperuser: true },
    });
    mockCan.mockReturnValue(true);
    mockFindUnique.mockResolvedValue({
      integrationId: "facebook-pages",
      status: "connected",
      lastErrorMsg: null,
      lastTestedAt: new Date("2026-04-30T11:00:00.000Z"),
      fieldsEnc: JSON.stringify({
        pageId: "123456789",
        pageName: "Acme Managed Services",
      }),
    });
    mockLoadPreview.mockResolvedValue({
      state: "available",
      preview: {
        page: {
          id: "123456789",
          name: "Acme Managed Services",
          category: "Business service",
          link: "https://www.facebook.com/acme",
          fanCount: 284,
        },
        recentPosts: [
          {
            id: "post-1",
            message: "Free onsite network review this Thursday.",
            createdTime: "2026-04-30T11:15:00.000Z",
            permalinkUrl: "https://facebook.com/post-1",
          },
        ],
        recentComments: [
          {
            id: "comment-1",
            message: "Do you cover Round Rock?",
            createdTime: "2026-04-30T11:30:00.000Z",
            fromName: "Taylor",
          },
        ],
        loadedAt: "2026-04-30T11:45:00.000Z",
      },
    });

    const { default: FacebookPagesPage } = await import("./page");
    const html = renderToStaticMarkup(await FacebookPagesPage());

    expect(mockLoadPreview).toHaveBeenCalledTimes(1);
    expect(html).toContain('data-component="facebook-pages-connect-panel"');
    expect(html).toContain("Live page preview");
    expect(html).toContain("Free onsite network review this Thursday.");
    expect(html).toContain("Do you cover Round Rock?");
    expect(html).toContain("Taylor");
  });
});
