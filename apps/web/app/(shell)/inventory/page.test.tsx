import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { DiscoveryRunSummary } from "@/components/inventory/DiscoveryRunSummary";
import { InventoryEntityPanel } from "@/components/inventory/InventoryEntityPanel";

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

describe("InventoryEntityPanel", () => {
  it("renders taxonomy attribution confidence and review state", () => {
    const html = renderToStaticMarkup(
      <InventoryEntityPanel
        entities={[
          {
            id: "entity-1",
            entityKey: "host:hostname:dpf-dev",
            name: "dpf-dev",
            entityType: "host",
            status: "active",
            attributionStatus: "attributed",
            attributionMethod: "rule",
            attributionConfidence: 0.98,
            portfolio: { slug: "foundational", name: "Foundational" },
            taxonomyNode: {
              nodeId: "foundational/compute/servers",
              name: "Servers",
            },
            digitalProduct: null,
          },
          {
            id: "entity-2",
            entityKey: "service:mystery-engine",
            name: "Mystery Engine",
            entityType: "service",
            status: "active",
            attributionStatus: "needs_review",
            attributionMethod: "heuristic",
            attributionConfidence: 0.32,
            portfolio: null,
            taxonomyNode: null,
            digitalProduct: null,
          },
        ]}
      />,
    );

    expect(html).toContain("foundational / compute / servers");
    expect(html).toContain("rule");
    expect(html).toContain("98%");
    expect(html).toContain("Review needed");
    expect(html).toContain("32% confidence");
  });
});
