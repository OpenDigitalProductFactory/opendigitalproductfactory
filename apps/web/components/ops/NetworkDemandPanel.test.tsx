import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/federated-demand", () => ({
  adoptFederatedDemandAction: vi.fn(),
  setFederatedDemandFollowAction: vi.fn(),
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
    }]} />);

    expect(html).toContain("Shared by connected installations");
    expect(html).toContain("Follow");
    expect(html).toContain("Adopt into our backlog");
    expect(html).toContain("Your local backlog stays authoritative");
    expect(html).not.toContain("fdm_private");
  });
});
