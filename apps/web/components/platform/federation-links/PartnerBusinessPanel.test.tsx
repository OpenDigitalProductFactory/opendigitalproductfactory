import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/federation-links", () => ({
  enrollChannelPartnerAction: vi.fn(),
  updateChannelPartnerStandingAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { PartnerBusinessPanel } from "./PartnerBusinessPanel";

describe("PartnerBusinessPanel", () => {
  it("keeps business, demand, and Hive authority visibly independent", () => {
    const html = renderToStaticMarkup(<PartnerBusinessPanel
      eligibleLinks={[{ linkId: "FL-1", displayName: "Reseller One" }]}
      partners={[{
        partnerId: "PARTNER-1",
        displayName: "Reseller One",
        standing: "active",
        tier: "authorized",
        linkName: "Reseller One",
        agreementReference: "AGR-2026-01",
        agreementCount: 1,
        entitlementCount: 2,
        supportRouteCount: 1,
        recognitionCount: 3,
      }]}
    />);

    expect(html).toContain("Founder Hub reseller network");
    expect(html).toContain("Arcamanus owns reseller enrollment");
    expect(html).toContain("separate from demand sharing and Hive result intake");
    expect(html).toContain("Enroll reseller");
    expect(html).toContain("2 entitlements");
    expect(html).toContain("3 recognitions");
  });
});
