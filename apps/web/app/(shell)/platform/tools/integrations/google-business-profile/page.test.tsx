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

vi.mock("@/lib/integrations/google-business-profile/preview", () => ({
  loadGoogleBusinessProfilePreview: mockLoadPreview,
}));

vi.mock("@/components/integrations/GoogleBusinessProfileConnectPanel", () => ({
  GoogleBusinessProfileConnectPanel: ({
    initialState,
  }: {
    initialState: {
      status: string;
      accountId: string | null;
      locationId: string | null;
      locationTitle: string | null;
      lastErrorMsg: string | null;
      lastTestedAt: string | null;
    };
  }) => (
    <div
      data-component="google-business-profile-connect-panel"
      data-status={initialState.status}
      data-account-id={initialState.accountId ?? ""}
      data-location-id={initialState.locationId ?? ""}
      data-location-title={initialState.locationTitle ?? ""}
    />
  ),
}));

describe("GoogleBusinessProfileIntegrationPage", () => {
  it("describes local posts as part of the unconfigured local presence capability", async () => {
    mockAuth.mockResolvedValue({
      user: { platformRole: "superadmin", isSuperuser: true },
    });
    mockCan.mockReturnValue(true);
    mockFindUnique.mockResolvedValue(null);

    const { default: GoogleBusinessProfileIntegrationPage } = await import("./page");
    const html = renderToStaticMarkup(await GoogleBusinessProfileIntegrationPage());

    expect(html).toContain("recent reviews, local posts, and profile media");
  });

  it("renders the local profile preview with live Google Business Profile media", async () => {
    mockAuth.mockResolvedValue({
      user: { platformRole: "superadmin", isSuperuser: true },
    });
    mockCan.mockReturnValue(true);
    mockFindUnique.mockResolvedValue({
      integrationId: "google-business-profile",
      status: "connected",
      lastErrorMsg: null,
      lastTestedAt: new Date("2026-04-24T11:00:00.000Z"),
      fieldsEnc: JSON.stringify({
        accountId: "123",
        locationId: "456",
        locationTitle: "Acme MSP - Austin",
      }),
    });
    mockLoadPreview.mockResolvedValue({
      state: "available",
      preview: {
        account: {
          name: "accounts/123",
          accountName: "Acme Managed Services",
        },
        location: {
          name: "accounts/123/locations/456",
          title: "Acme MSP - Austin",
          websiteUri: "https://acme.example.com",
        },
        reviews: [
          {
            reviewId: "review-1",
            comment: "Fast response and great local support.",
            reviewer: {
              displayName: "Taylor",
            },
            starRating: "FIVE",
          },
        ],
        localPosts: [
          {
            name: "accounts/123/locations/456/localPosts/post-1",
            summary: "Free network review for Austin businesses this Friday.",
            topicType: "STANDARD",
            state: "LIVE",
            searchUrl: "https://posts.gle/acme",
            callToAction: {
              actionType: "LEARN_MORE",
              url: "https://acme.example.com/austin-review",
            },
          },
        ],
        media: {
          totalMediaItemCount: 8,
          items: [
            {
              name: "accounts/123/locations/456/media/photo-1",
              mediaFormat: "PHOTO",
              thumbnailUrl: "https://lh3.googleusercontent.com/photo-1",
              googleUrl: "https://maps.google.com/photo-1",
              createTime: "2026-04-29T15:00:00Z",
              locationAssociation: {
                category: "EXTERIOR",
              },
              dimensions: {
                widthPixels: 1600,
                heightPixels: 900,
              },
              insights: {
                viewCount: "3421",
              },
              attribution: {
                profileName: "Acme Managed Services",
              },
            },
          ],
        },
        loadedAt: "2026-04-24T11:30:00.000Z",
      },
    });

    const { default: GoogleBusinessProfileIntegrationPage } = await import("./page");
    const html = renderToStaticMarkup(await GoogleBusinessProfileIntegrationPage());

    expect(mockLoadPreview).toHaveBeenCalledTimes(1);
    expect(html).toContain('data-component="google-business-profile-connect-panel"');
    expect(html).toContain("Live local profile preview");
    expect(html).toContain("Acme MSP - Austin");
    expect(html).toContain("Fast response and great local support.");
    expect(html).toContain("Recent local posts");
    expect(html).toContain("Free network review for Austin businesses this Friday.");
    expect(html).toContain("LEARN_MORE");
    expect(html).toContain("Local profile media");
    expect(html).toContain("8 media items");
    expect(html).toContain("EXTERIOR");
    expect(html).toContain("3,421 views");
  });
});
