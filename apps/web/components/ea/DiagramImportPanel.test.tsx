// Diagram import review panel (BI-4C17BF51).
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/ea-diagram-import", () => ({ importEaDiagram: vi.fn() }));
vi.mock("@/lib/actions/ea", () => ({ reviewReferenceProposal: vi.fn() }));

import { DiagramImportPanel } from "./DiagramImportPanel";

const IMPORT = {
  id: "imp-1",
  fileName: "Order platform.vsdx",
  importedAt: "2026-09-25T10:00:00.000Z",
  previewDataUri: "data:image/svg+xml;base64,PHN2Zy8+",
  unattachedConnectors: 1,
  truncated: false,
  elements: [
    { id: "c1", status: "proposed", label: "Customer Portal", page: "Page-1", suggestedLayer: null },
    { id: "c2", status: "approved", label: "Order Service", page: "Page-1", suggestedLayer: "application" },
  ],
  relationships: [{ id: "c3", status: "proposed", fromLabel: "Customer Portal", toLabel: "Order Service", label: "calls", page: "Page-1" }],
};

describe("DiagramImportPanel", () => {
  it("shows the picture, each candidate with its review status, and the review controls to an editor", () => {
    const html = renderToStaticMarkup(<DiagramImportPanel imports={[IMPORT]} canManage />);
    expect(html).toContain("Import diagram");
    expect(html).toContain('accept=".vsd,.vsdx,.odg"');
    expect(html).toContain('alt="Preview of Order platform.vsdx"');
    expect(html).toContain("Customer Portal");
    expect(html).toContain("To review");
    expect(html).toContain("Accepted");
    expect(html).toContain("application layer");
    expect(html).toContain("Customer Portal → Order Service");
    expect(html).toContain("1 connectors did not join two shapes");
    expect(html.match(/>Accept</g)).toHaveLength(3);
  });

  it("shows candidates read-only to a viewer who cannot edit the model", () => {
    const html = renderToStaticMarkup(<DiagramImportPanel imports={[IMPORT]} canManage={false} />);
    expect(html).toContain("Customer Portal");
    expect(html).not.toContain("Import diagram");
    expect(html).not.toContain(">Accept<");
  });

  it("explains the section even before anything is imported", () => {
    const html = renderToStaticMarkup(<DiagramImportPanel imports={[]} canManage />);
    expect(html).toContain("Nothing is added to the model.");
  });
});
