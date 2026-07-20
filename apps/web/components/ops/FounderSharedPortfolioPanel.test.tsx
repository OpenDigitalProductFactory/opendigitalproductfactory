import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/founder-portfolio", () => ({
  dispositionFounderDemandClusterAction: vi.fn(),
  promoteFounderDemandOriginAction: vi.fn(),
  proposeFounderDemandClusterAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { FounderSharedPortfolioPanel } from "./FounderSharedPortfolioPanel";

describe("FounderSharedPortfolioPanel", () => {
  it("explains deduplicated reach and keeps nonproduction promotion explicit", () => {
    const html = renderToStaticMarkup(<FounderSharedPortfolioPanel
      inbox={[{
        mirrorId: "mirror_private",
        title: "Shared workflow need",
        summary: "A minimized need from a trusted channel.",
        originInstallationId: "origin_private",
        envelopeId: "envelope_private",
        environmentClass: "development",
        routeCount: 2,
        clusterId: null,
      }]}
      clusters={[{
        clusterId: "FDC-PRIVATE",
        title: "Common workflow improvement",
        status: "proposed",
        confidence: null,
        founderDisposition: null,
        canonicalBacklogItemId: null,
        releaseApplicability: null,
        distinctOriginReach: 1,
        routeCount: 2,
        productionEligibleOrigins: 0,
        members: [{
          memberId: "FDM-PRIVATE",
          originInstallationId: "origin_private",
          envelopeId: "envelope_private",
          environmentClass: "development",
          promotedAt: null,
          mirrorRefs: ["direct_private", "reseller_private"],
        }],
      }]}
    />);

    expect(html).toContain("Founder shared portfolio");
    expect(html).toContain("Reach counts distinct originating installations, not reseller hops");
    expect(html).toContain("1 distinct origin");
    expect(html).toContain("2 routes");
    expect(html).toContain("Promote to production portfolio");
    expect(html).toContain("Accept into backlog");
    expect(html).not.toContain("origin_private");
    expect(html).not.toContain("mirror_private");
  });
});
