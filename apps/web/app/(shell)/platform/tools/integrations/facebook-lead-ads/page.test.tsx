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

vi.mock("@/lib/integrate/facebook-lead-ads/preview", () => ({
  loadFacebookLeadAdsPreview: mockLoadPreview,
}));

vi.mock("@/components/integrations/FacebookLeadAdsConnectPanel", () => ({
  FacebookLeadAdsConnectPanel: ({
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
      data-component="facebook-lead-ads-connect-panel"
      data-status={initialState.status}
      data-page-id={initialState.pageId ?? ""}
      data-page-name={initialState.pageName ?? ""}
      data-last-tested={initialState.lastTestedAt ?? ""}
    />
  ),
}));

describe("FacebookLeadAdsPage", () => {
  it("renders lead forms and recent leads from the live preview", async () => {
    mockAuth.mockResolvedValue({
      user: { platformRole: "superadmin", isSuperuser: true },
    });
    mockCan.mockReturnValue(true);
    mockFindUnique.mockResolvedValue({
      integrationId: "facebook-lead-ads",
      status: "connected",
      lastErrorMsg: null,
      lastTestedAt: new Date("2026-04-24T11:00:00.000Z"),
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
          category: "Business Service",
        },
        forms: [
          {
            id: "form-1",
            name: "Downtown Managed IT Consult",
            status: "ACTIVE",
            locale: "en_US",
            createdTime: "2026-04-20T15:00:00.000Z",
          },
        ],
        recentLeads: [
          {
            id: "lead-1",
            createdTime: "2026-04-24T15:00:00.000Z",
            adId: "ad-100",
            formId: "form-1",
          },
        ],
        loadedAt: "2026-04-24T11:30:00.000Z",
      },
    });

    const { default: FacebookLeadAdsPage } = await import("./page");
    const html = renderToStaticMarkup(await FacebookLeadAdsPage());

    expect(mockLoadPreview).toHaveBeenCalledTimes(1);
    expect(html).toContain('data-component="facebook-lead-ads-connect-panel"');
    expect(html).toContain('data-page-id="123456789"');
    expect(html).toContain("Live lead preview");
    expect(html).toContain("Downtown Managed IT Consult");
    expect(html).toContain("lead-1");
  });
});
