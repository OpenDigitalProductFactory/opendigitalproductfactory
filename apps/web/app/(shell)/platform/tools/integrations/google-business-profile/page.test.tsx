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

vi.mock("@/lib/integrate/google-business-profile/preview", () => ({
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
  it("renders the local profile preview from live Google Business Profile data", async () => {
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
  });
});
