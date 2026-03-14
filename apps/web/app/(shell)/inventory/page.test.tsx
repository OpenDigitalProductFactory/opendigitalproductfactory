import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { DiscoveryRunSummary } from "@/components/inventory/DiscoveryRunSummary";

describe("DiscoveryRunSummary", () => {
  it("renders latest discovery run counts", () => {
    const html = renderToStaticMarkup(
      <DiscoveryRunSummary
        run={{
          runKey: "DISC-001",
          status: "completed",
          trigger: "bootstrap",
          itemCount: 7,
          relationshipCount: 3,
          startedAt: new Date("2026-03-13T12:00:00Z"),
          completedAt: new Date("2026-03-13T12:01:00Z"),
        }}
        health={{ totalEntities: 12, staleEntities: 2, openIssues: 3 }}
      />,
    );

    expect(html).toContain("DISC-001");
    expect(html).toContain("12");
    expect(html).toContain("Stale");
  });
});
