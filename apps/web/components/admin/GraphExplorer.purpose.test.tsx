import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/inventory/RelationshipGraph", () => ({
  RelationshipGraph: () => <div>Graph canvas</div>,
}));

vi.mock("@/lib/actions/graph-explorer", () => ({
  findGraphNodes: vi.fn(),
  loadGraphNeighbourhood: vi.fn(),
  loadGraphNodeDetail: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/graph-explorer",
}));

import { GraphExplorer } from "./GraphExplorer";

describe("GraphExplorer purpose evidence", () => {
  it("exposes an honest empty-corpus recovery contract", () => {
    const html = renderToStaticMarkup(
      <GraphExplorer census={{ labels: [], relTypes: [], nodeTotal: 0, edgeTotal: 0 }} />,
    );

    expect(html).toContain('data-dpf-purpose-route="/admin/graph-explorer"');
    expect(html).toContain('data-dpf-purpose-state="empty-corpus"');
    expect(html).toContain('data-dpf-purpose-key="corpus-census"');
    expect(html).toContain('data-dpf-purpose-message-key="graph-explorer.empty-corpus"');
    expect(html).toContain('data-dpf-purpose-action-key="open-platform-development"');
    expect(html).toContain('data-dpf-purpose-recovery-action="true"');
    expect(html).toContain('data-dpf-purpose-completion-signal-key="graph-corpus-empty"');
    expect(html).toContain('data-dpf-purpose-correction-signal-key="graph-population-recovery"');
  });

  it("exposes the search command and reset recovery for a populated corpus", () => {
    const html = renderToStaticMarkup(
      <GraphExplorer
        census={{
          labels: [{ label: "DataModel", count: 3 }],
          relTypes: [{ relType: "USES", count: 2 }],
          nodeTotal: 3,
          edgeTotal: 2,
        }}
      />,
    );

    expect(html).toContain('data-dpf-purpose-state="no-starting-point"');
    expect(html).toContain('data-dpf-purpose-key="search-field"');
    expect(html).toContain('data-dpf-purpose-action-key="search-graph"');
    expect(
      html.match(/<button[^>]*data-dpf-purpose-action-key="search-graph"[^>]*>/)?.[0],
    ).not.toContain('disabled=""');
    expect(html).toContain('data-dpf-purpose-action-key="reset-explorer"');
    expect(html).toContain('data-dpf-purpose-recovery-signal="true"');
  });
});
