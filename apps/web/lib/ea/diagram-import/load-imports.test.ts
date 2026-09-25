// Diagram import review read model (BI-4C17BF51).
import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));

import { MAX_INLINE_PREVIEW_BYTES, loadDiagramImports } from "./load-imports";

const at = new Date("2026-09-25T10:00:00Z");
const header = {
  id: "imp-1",
  proposalType: "diagram_import",
  status: "proposed",
  createdAt: at,
  payload: {
    fileName: "Order platform.vsdx",
    svgBlob: { id: "b1", sha256: "abc", storageKey: "documents/sha256/ab/abc" },
    pages: [{ name: "Page-1", unattachedConnectors: 2 }],
    truncated: false,
  },
};
const candidates = [
  { id: "c1", proposalType: "diagram_import_element", status: "proposed", createdAt: at, payload: { importId: "imp-1", page: "Page-1", key: "p1-e1", label: "Customer Portal", suggestedLayer: null } },
  { id: "c2", proposalType: "diagram_import_element", status: "approved", createdAt: at, payload: { importId: "imp-1", page: "Page-1", key: "p1-e2", label: "Order Service", suggestedLayer: "application" } },
  { id: "c3", proposalType: "diagram_import_relationship", status: "rejected", createdAt: at, payload: { importId: "imp-1", page: "Page-1", fromKey: "p1-e1", toKey: "p1-e2", label: "calls", fromLabel: "Customer Portal", toLabel: "Order Service" } },
  { id: "x9", proposalType: "diagram_import_element", status: "proposed", createdAt: at, payload: { importId: "other", label: "Elsewhere" } },
];

describe("loadDiagramImports", () => {
  it("returns each import with its candidates, their review status and an inline SVG picture", async () => {
    const readBlob = vi.fn(async () => Buffer.from("<svg/>"));
    const [view] = await loadDiagramImports(5, { findImports: async () => [header], findCandidates: async () => candidates, readBlob });
    expect(readBlob).toHaveBeenCalledWith({ storageKey: "documents/sha256/ab/abc", sha256: "abc" });
    expect(view).toEqual({
      id: "imp-1",
      fileName: "Order platform.vsdx",
      importedAt: at,
      previewDataUri: `data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}`,
      unattachedConnectors: 2,
      truncated: false,
      elements: [
        { id: "c1", status: "proposed", label: "Customer Portal", page: "Page-1", suggestedLayer: null },
        { id: "c2", status: "approved", label: "Order Service", page: "Page-1", suggestedLayer: "application" },
      ],
      relationships: [{ id: "c3", status: "rejected", fromLabel: "Customer Portal", toLabel: "Order Service", label: "calls", page: "Page-1" }],
    });
  });

  it("keeps the candidates when the picture is missing or too large to inline", async () => {
    const missing = await loadDiagramImports(5, {
      findImports: async () => [header],
      findCandidates: async () => candidates,
      readBlob: async () => {
        throw new Error("gone");
      },
    });
    expect(missing[0]!.previewDataUri).toBeNull();
    expect(missing[0]!.elements).toHaveLength(2);
    const huge = await loadDiagramImports(5, {
      findImports: async () => [header],
      findCandidates: async () => candidates,
      readBlob: async () => Buffer.alloc(MAX_INLINE_PREVIEW_BYTES + 1),
    });
    expect(huge[0]!.previewDataUri).toBeNull();
  });

  it("returns nothing, without a second query, when there are no imports", async () => {
    const findCandidates = vi.fn();
    expect(await loadDiagramImports(5, { findImports: async () => [], findCandidates })).toEqual([]);
    expect(findCandidates).not.toHaveBeenCalled();
  });
});
