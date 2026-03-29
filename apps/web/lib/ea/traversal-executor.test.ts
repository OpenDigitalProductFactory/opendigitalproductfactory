import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    eaNotation: { findUnique: vi.fn() },
    eaTraversalPattern: { findUnique: vi.fn() },
    eaElement: { findUnique: vi.fn() },
    eaRelationship: { findMany: vi.fn() },
  },
}));

import { prisma } from "@dpf/db";
import { runTraversalPattern } from "./traversal-executor";

describe("runTraversalPattern", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns error when notation not found", async () => {
    vi.mocked(prisma.eaNotation.findUnique).mockResolvedValue(null);
    const result = await runTraversalPattern({ patternSlug: "blast_radius", startElementIds: ["e-1"] });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/notation/i);
  });

  it("returns error when pattern not found", async () => {
    vi.mocked(prisma.eaNotation.findUnique).mockResolvedValue({ id: "n-1" } as never);
    vi.mocked(prisma.eaTraversalPattern.findUnique).mockResolvedValue(null);
    const result = await runTraversalPattern({ patternSlug: "unknown", startElementIds: ["e-1"], notationSlug: "archimate4" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/pattern/i);
  });

  it("returns empty paths when start element not found", async () => {
    vi.mocked(prisma.eaNotation.findUnique).mockResolvedValue({ id: "n-1" } as never);
    vi.mocked(prisma.eaTraversalPattern.findUnique).mockResolvedValue({
      steps: [{ elementTypeSlugs: ["business_actor"], refinementLevel: null, relationshipTypeSlugs: [], direction: "terminal" }],
      forbiddenShortcuts: [],
    } as never);
    vi.mocked(prisma.eaElement.findUnique).mockResolvedValue(null);
    const result = await runTraversalPattern({ patternSlug: "blast_radius", startElementIds: ["missing"], notationSlug: "archimate4" });
    expect(result.ok).toBe(true);
    expect(result.data?.paths).toHaveLength(0);
  });

  it("records refinement gap when expected level differs", async () => {
    vi.mocked(prisma.eaNotation.findUnique).mockResolvedValue({ id: "n-1" } as never);
    vi.mocked(prisma.eaTraversalPattern.findUnique).mockResolvedValue({
      steps: [
        { elementTypeSlugs: ["application_component"], refinementLevel: "actual", relationshipTypeSlugs: ["depends_on"], direction: "outbound" },
        { elementTypeSlugs: ["digital_product"], refinementLevel: null, relationshipTypeSlugs: [], direction: "terminal" },
      ],
      forbiddenShortcuts: [],
    } as never);
    vi.mocked(prisma.eaElement.findUnique).mockResolvedValue({
      id: "start-1", name: "Vuln Package", refinementLevel: "conceptual",
      elementType: { slug: "artifact" },
    } as never);
    vi.mocked(prisma.eaRelationship.findMany).mockResolvedValue([{
      fromElement: { id: "comp-1", name: "Portal", refinementLevel: "logical", elementType: { slug: "application_component" } },
      toElement:   { id: "comp-1", name: "Portal", refinementLevel: "logical", elementType: { slug: "application_component" } },
      relationshipType: { slug: "depends_on" },
    }] as never);

    const result = await runTraversalPattern({ patternSlug: "blast_radius", startElementIds: ["start-1"] });
    expect(result.ok).toBe(true);
    expect(result.data?.summary.refinementGaps).toHaveLength(1);
    expect(result.data?.summary.refinementGaps[0]).toContain("actual");
  });
});
