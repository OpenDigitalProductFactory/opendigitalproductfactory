import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveOwnerVocabulary } from "@/lib/owner-first/vocabulary";

const mocks = vi.hoisted(() => ({
  opportunities: vi.fn(), accounts: vi.fn(), count: vi.fn(), groupBy: vi.fn(),
  context: vi.fn(), cookies: vi.fn(), tabs: vi.fn(),
}));
vi.mock("@dpf/db", () => ({ prisma: {
  customerAccount: { findMany: mocks.accounts },
  opportunity: { findMany: mocks.opportunities, count: mocks.count, groupBy: mocks.groupBy },
  engagement: { groupBy: mocks.groupBy }, quote: { groupBy: mocks.groupBy },
  salesOrder: { groupBy: mocks.groupBy },
  marketingCampaignBrief: { count: mocks.count }, marketingAssetTask: { count: mocks.count },
  marketingAutomationCandidate: { count: mocks.count }, subscription: { count: mocks.count },
  invoice: { count: mocks.count }, storefrontBooking: { count: mocks.count },
  storefrontInquiry: { count: mocks.count }, storefrontOrder: { count: mocks.count },
  orgSettings: { findFirst: async () => ({ baseCurrency: "USD" }) },
} }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/owner-first/context", () => ({ loadOwnerFirstContext: mocks.context }));
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { platformRole: "HR-000", isSuperuser: true } }) }));
vi.mock("@/lib/permissions", () => ({ can: () => true, getAccessibleSectionNavEntries: mocks.tabs }));
vi.mock("@/lib/crm/retain-data", () => ({ getWorkspaceRetainMetrics: async () => ({ mrr: 0, arr: 0, churnRiskOutreachCount: 0 }) }));
vi.mock("@/components/customer/NewCustomerButton", () => ({ NewCustomerButton: () => null }));
vi.mock("@/components/customer/DuplicateAccountsPanel", () => ({ DuplicateAccountsPanel: () => null }));
vi.mock("@/components/customer/RevenueCockpit", () => ({ RevenueCockpit: () => null }));
vi.mock("@/components/customer/map/CustomerMapView", () => ({ CustomerMapView: () => null }));
vi.mock("@/components/customer/map/GeocodingAdminPanel", () => ({ GeocodingAdminPanel: () => null }));
vi.mock("@/lib/crm/customer-map.server", () => ({ loadCustomerMap: vi.fn() }));
vi.mock("@/lib/geocoding/backfill.server", () => ({ readGeocodingSettings: vi.fn() }));
vi.mock("@/lib/twin/map-region-recommendation.server", () => ({ loadMapRegionRecommendation: vi.fn() }));
vi.mock("@/lib/i18n/locale-context.server", () => ({ getLocaleContext: async () => ({ language: "en-US" }) }));
vi.mock("@/lib/i18n/t.server", () => ({ getT: async () => (key: string) => key }));
vi.mock("@/components/workbooks/PlatformGridSection", () => ({
  PlatformGridSection: () => null, parseSurfaceDataScope: () => undefined, parseSurfaceView: () => undefined,
}));

import CustomerPage from "./page";

describe("Customer primary follow-up", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accounts.mockResolvedValue([]);
    mocks.opportunities.mockResolvedValue([{ id: "deal-1", title: "Prospect review", stage: "qualification", nextActivityAt: null, account: { name: "Example business" } }]);
    mocks.count.mockResolvedValue(0);
    mocks.groupBy.mockResolvedValue([]);
    mocks.context.mockResolvedValue({ archetypeId: "software-platform", vocab: resolveOwnerVocabulary("software-platform") });
    mocks.cookies.mockResolvedValue({ get: () => ({ value: "full" }) });
    mocks.tabs.mockReturnValue([{ label: "Pipeline", href: "/customer/opportunities" }]);
  });

  it.each(["full", "simple"])("shows the deal before CRM disclosure in %s mode without inbound replies", async (mode) => {
    mocks.cookies.mockResolvedValue({ get: () => ({ value: mode }) });
    const html = renderToStaticMarkup(await CustomerPage({}));
    expect(html).toContain("Prospect review");
    expect(html).toContain('href="/customer/opportunities?opportunity=deal-1"');
    expect(html).toContain("Set next step");
    expect(html).not.toContain("No customers are waiting on a reply");
    const disclosure = html.indexOf("data-owner-first-detail");
    if (mode === "full") expect(html.indexOf("Prospect review")).toBeLessThan(disclosure);
    else expect(disclosure).toBe(-1);
  });

  it("shows a truthful clear state when the sales read returns no work", async () => {
    mocks.opportunities.mockResolvedValue([]);
    const html = renderToStaticMarkup(await CustomerPage({}));
    expect(html).toContain("No replies are waiting.");
    expect(html).toContain("No recorded sales next steps are overdue or missing.");
    expect(html).not.toContain("Set next step");
  });

  it("retains rescue relationship policy and never loads commercial follow-ups", async () => {
    mocks.context.mockResolvedValue({ archetypeId: "pet-rescue", vocab: resolveOwnerVocabulary("nonprofit-community", "pet-rescue") });
    const html = renderToStaticMarkup(await CustomerPage({}));
    expect(mocks.opportunities).not.toHaveBeenCalled();
    expect(html).toContain("Adoption follow-up");
    expect(html).not.toContain("Prospect review");
    expect(html).not.toContain("recorded sales next steps");
  });

  it("does not load or link sales work without a permitted pipeline destination", async () => {
    mocks.tabs.mockReturnValue([{ label: "Marketing", href: "/customer/marketing" }]);
    const html = renderToStaticMarkup(await CustomerPage({}));
    expect(mocks.opportunities).not.toHaveBeenCalled();
    expect(html).not.toContain("Prospect review");
    expect(html).not.toContain("recorded sales next steps");
  });
});
