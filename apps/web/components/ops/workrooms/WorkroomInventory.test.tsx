import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WorkroomInventory } from "./WorkroomInventory";

describe("WorkroomInventory", () => {
  it("separates live work from history and drills into the canonical activity view", () => {
    const html = renderToStaticMarkup(<WorkroomInventory
      summary={{ scanned: 3, live: 1, history: 2, reapable: 1, byLiveness: {} }}
      workrooms={[
        { capsuleId: "WC-LIVE", title: "Live rescue intake", status: "working", source: "manual", executorKind: "human", portfolioRole: "manufactureAndDeliver", headBranch: null, pullRequestUrl: null, updatedAt: "2026-08-24T18:00:00.000Z", liveness: "live", isLive: true, isReapable: false, livenessReason: "Lease valid.", trueLivenessAt: "2026-08-24T19:00:00.000Z" },
        { capsuleId: "WC-OLD", title: "Expired review", status: "working", source: "external-adoption", executorKind: "codex-desktop", portfolioRole: "foundational", headBranch: "fix/old", pullRequestUrl: null, updatedAt: "2026-08-20T18:00:00.000Z", liveness: "lease-expired", isLive: false, isReapable: true, livenessReason: "Lease expired.", trueLivenessAt: "2026-08-20T19:00:00.000Z" },
      ]}
    />);

    expect(html).toContain("Live now");
    expect(html).toContain("History and cleanup");
    expect(html).toContain("1 live");
    expect(html).toContain("2 inactive");
    expect(html).toContain('href="/workspace/cases/WC-LIVE"');
    expect(html).toContain("Manufacture &amp; Deliver");
    expect(html).not.toContain("3 active");
  });
});
