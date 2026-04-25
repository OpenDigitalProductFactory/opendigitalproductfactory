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

vi.mock("@/lib/integrate/google-marketing-intelligence/preview", () => ({
  loadGoogleMarketingPreview: mockLoadPreview,
}));

vi.mock("@/components/integrations/GoogleMarketingIntelligenceConnectPanel", () => ({
  GoogleMarketingIntelligenceConnectPanel: ({
    initialState,
  }: {
    initialState: {
      status: string;
      ga4PropertyId: string | null;
      searchConsoleSiteUrl: string | null;
      lastErrorMsg: string | null;
      lastTestedAt: string | null;
    };
  }) => (
    <div
      data-component="google-marketing-connect-panel"
      data-status={initialState.status}
      data-property-id={initialState.ga4PropertyId ?? ""}
      data-site-url={initialState.searchConsoleSiteUrl ?? ""}
      data-last-tested={initialState.lastTestedAt ?? ""}
    />
  ),
}));

describe("GoogleMarketingIntelligencePage", () => {
  it("renders live Google marketing preview data and refreshes the connection state", async () => {
    mockAuth.mockResolvedValue({
      user: { platformRole: "superadmin", isSuperuser: true },
    });
    mockCan.mockReturnValue(true);
    mockFindUnique.mockResolvedValue({
      integrationId: "google-marketing-intelligence",
      status: "connected",
      lastErrorMsg: null,
      lastTestedAt: new Date("2026-04-24T10:00:00.000Z"),
      fieldsEnc: JSON.stringify({
        ga4PropertyId: "123456",
        searchConsoleSiteUrl: "sc-domain:example.com",
      }),
    });
    mockLoadPreview.mockResolvedValue({
      state: "available",
      preview: {
        analyticsSummary: {
          sessions: 1200,
          totalUsers: 840,
          conversions: 48,
        },
        searchConsoleRows: [
          { keys: ["/managed-services", "managed it services"], clicks: 82, impressions: 1300, ctr: 0.063, position: 7.4 },
          { keys: ["/cybersecurity", "cybersecurity support"], clicks: 49, impressions: 910, ctr: 0.053, position: 9.2 },
        ],
        loadedAt: "2026-04-24T10:30:00.000Z",
      },
    });

    const { default: GoogleMarketingIntelligencePage } = await import("./page");
    const html = renderToStaticMarkup(await GoogleMarketingIntelligencePage());

    expect(mockLoadPreview).toHaveBeenCalledTimes(1);
    expect(html).toContain('data-component="google-marketing-connect-panel"');
    expect(html).toContain('data-property-id="123456"');
    expect(html).toContain('data-status="connected"');
    expect(html).toContain("Live marketing intelligence preview");
    expect(html).toContain("1200");
    expect(html).toContain("/managed-services");
    expect(html).toContain("managed it services");
  });
});
