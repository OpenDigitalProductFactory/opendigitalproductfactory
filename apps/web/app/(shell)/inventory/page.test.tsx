import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useTransition: () => [false, (callback: () => void) => callback()] as const,
  };
});
vi.mock("@/components/inventory/DiscoveryOperationsPage", () => ({
  DiscoveryOperationsPage: ({ isLegacyAlias = false }: { isLegacyAlias?: boolean }) => (
    <div data-page="discovery-operations" data-legacy-alias={String(isLegacyAlias)} />
  ),
}));
vi.mock("@/lib/actions/discovery", () => ({
  triggerBootstrapDiscovery: vi.fn(),
}));
import { DiscoveryRunSummary } from "@/components/inventory/DiscoveryRunSummary";
import { InventoryEntityPanel } from "@/components/inventory/InventoryEntityPanel";

describe("InventoryPage", () => {
  it("renders the discovery operations alias in legacy mode", async () => {
    const { default: InventoryPage } = await import("./page");
    const html = renderToStaticMarkup(await InventoryPage());

    expect(html).toContain('data-page="discovery-operations"');
    expect(html).toContain('data-legacy-alias="true"');
  });
});

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
