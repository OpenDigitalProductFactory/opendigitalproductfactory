import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/federated-demand", () => ({
  adoptFederatedDemandAction: vi.fn(),
  forwardFederatedDemandAction: vi.fn(),
  respondToFederatedDemandAction: vi.fn(),
  shareLocalDemandWithLinkAction: vi.fn(),
  setFederatedDemandFollowAction: vi.fn(),
  stopSharingLocalDemandWithLinkAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { NetworkDemandPanel } from "./NetworkDemandPanel";

describe("NetworkDemandPanel", () => {
  it("keeps the connection recovery path visible when no demand is shared", () => {
    const html = renderToStaticMarkup(<NetworkDemandPanel items={[]} />);

    expect(html).toContain("No shared demand yet");
    expect(html).toContain("/platform/federation-links");
  });

  it("explains local authority and offers follow or adopt without exposing origin identifiers", () => {
    const html = renderToStaticMarkup(<NetworkDemandPanel items={[{
      mirrorId: "fdm_private",
      title: "Shared scheduling improvement",
      summary: "Several installations need the same workflow.",
      workType: "feature",
      attribution: "pseudonymous",
      occurrenceCount: 3,
      affectedOrganizations: 2,
      disposition: "observed",
      syncStatus: "synced",
      originVersion: 1,
      updatedAt: "2026-07-20T05:10:00.000Z",
      localItemId: null,
      forwardingToFounderPermitted: false,
      forwardingExpiresAt: null,
    }]} />);

    expect(html).toContain("Shared by connected installations");
    expect(html).toContain("Same-company connections keep share-safe platform demand visible in both directions");
    expect(html).toContain("and so does every source backlog");
    expect(html).toContain("Follow");
    expect(html).toContain("I&#x27;m interested");
    expect(html).toContain("Offer help");
    expect(html).toContain("Adopt into our backlog");
    expect(html).toContain("Your local backlog stays authoritative");
    expect(html).not.toContain("fdm_private");
  });

  it("shows explicit per-connection sharing and consented founder forwarding", () => {
    const html = renderToStaticMarkup(<NetworkDemandPanel
      items={[{
        mirrorId: "fdm_private",
        title: "Customer-approved improvement",
        summary: "A minimized customer need.",
        workType: "feature",
        attribution: "pseudonymous",
        occurrenceCount: 2,
        affectedOrganizations: 1,
        disposition: "observed",
        syncStatus: "synced",
        originVersion: 1,
        updatedAt: "2026-07-20T05:10:00.000Z",
        localItemId: null,
        forwardingToFounderPermitted: true,
        forwardingExpiresAt: "2026-08-01T00:00:00.000Z",
      }]}
      shareContext={{
        localItems: [{ itemId: "BI-LOCAL", title: "Local improvement", status: "open" }],
        targets: [{ linkId: "FL-DISTRIBUTOR", displayName: "Reseller One", role: "managed-by", destinationKind: "distributor", sharedItemIds: [] }],
        founderTargets: [{ linkId: "FL-FOUNDER", displayName: "Arcamanus" }],
        responses: [{
          responseId: "rsp_opaque",
          sourceName: "Reseller One",
          responseKind: "help-offer",
          message: "We can validate this.",
          receivedAt: "2026-07-20T06:00:00.000Z",
        }],
        dispositions: [{
          noticeId: "notice_opaque",
          decision: "accepted",
          message: "Included in the shared platform portfolio.",
          releaseApplicability: { releaseRef: "release_opaque", applicability: "Available in the next compatible release." },
          receivedAt: "2026-07-20T06:30:00.000Z",
        }],
      }}
    />);

    expect(html).toContain("Share local demand");
    expect(html).toContain("Across companies: End company → distributor → Founder Hub");
    expect(html).toContain("Reseller One — Distributor");
    expect(html).toContain("Share with Reseller One");
    expect(html).toContain("Only the minimized title, summary, applicability, signal count");
    expect(html).toContain("90 days");
    expect(html).toContain("Forward to Arcamanus");
    expect(html).toContain("Reseller One");
    expect(html).toContain("offered help");
    expect(html).toContain("Founder decisions");
    expect(html).toContain("Available in the next compatible release");
    expect(html).not.toContain("inst_customer");
  });

  it("labels a direct Founder Hub destination without offering transitive consent", () => {
    const html = renderToStaticMarkup(<NetworkDemandPanel
      items={[]}
      shareContext={{
        localItems: [{ itemId: "BI-DISTRIBUTOR", title: "Distributor improvement", status: "open" }],
        targets: [{ linkId: "FL-FOUNDER", displayName: "Arcamanus", role: "channel-downstream", destinationKind: "founder-hub", sharedItemIds: [] }],
        founderTargets: [{ linkId: "FL-FOUNDER", displayName: "Arcamanus" }],
        responses: [],
        dispositions: [],
      }}
    />);

    expect(html).toContain("Arcamanus — Founder Hub");
    expect(html).toContain("Share with Arcamanus");
    expect(html).not.toContain("for 90 days");
  });
});
