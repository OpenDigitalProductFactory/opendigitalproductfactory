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

  // cross_layer_impact: from a data-model element, follow `traces` INBOUND to the actual
  // operational/network/integration elements that realize it (the Parity Engine
  // cross-layer edges). Mirrors the live RuntimeTarget → running-instances case.
  const CROSS_LAYER_STEPS = [
    { elementTypeSlugs: ["part_usage", "part_definition"], refinementLevel: null, relationshipTypeSlugs: ["traces"], direction: "inbound" },
    { elementTypeSlugs: ["part_usage", "part_definition"], refinementLevel: null, relationshipTypeSlugs: [], direction: "terminal" },
  ];

  it("cross_layer_impact traces a data model inbound to the actual elements that realize it", async () => {
    vi.mocked(prisma.eaNotation.findUnique).mockResolvedValue({ id: "n-1" } as never);
    vi.mocked(prisma.eaTraversalPattern.findUnique).mockResolvedValue({ steps: CROSS_LAYER_STEPS, forbiddenShortcuts: [] } as never);
    vi.mocked(prisma.eaElement.findUnique).mockResolvedValue({
      id: "model", name: "RuntimeTarget", refinementLevel: null, elementType: { slug: "data_object" },
    } as never);
    vi.mocked(prisma.eaRelationship.findMany).mockResolvedValue([
      { fromElement: { id: "inst1", name: "portal · RT-ROOT-PORTAL", refinementLevel: null, elementType: { slug: "part_usage" } }, toElement: { id: "model", elementType: { slug: "data_object" } }, relationshipType: { slug: "traces" } },
      { fromElement: { id: "inst2", name: "build-sandbox · RT-X", refinementLevel: null, elementType: { slug: "part_usage" } }, toElement: { id: "model", elementType: { slug: "data_object" } }, relationshipType: { slug: "traces" } },
      // wrong element type AND wrong relationship type → must be filtered out
      { fromElement: { id: "other", name: "Component", refinementLevel: null, elementType: { slug: "application_component" } }, toElement: { id: "model", elementType: { slug: "data_object" } }, relationshipType: { slug: "depends_on" } },
    ] as never);

    const result = await runTraversalPattern({ patternSlug: "cross_layer_impact", startElementIds: ["model"] });
    expect(result.ok).toBe(true);
    const path = result.data!.paths[0];
    expect(path.complete).toBe(true);
    expect(path.terminationReason).toBe("terminal_step_reached");
    expect(path.steps.map((s) => s.elementId)).toEqual(["model", "inst1", "inst2"]);
    expect(path.steps[1].relationshipType).toBe("traces");
    expect(path.steps[1].direction).toBe("inbound");
  });

  it("cross_layer_impact returns no_matching_elements when the model has no cross-layer edges yet", async () => {
    vi.mocked(prisma.eaNotation.findUnique).mockResolvedValue({ id: "n-1" } as never);
    vi.mocked(prisma.eaTraversalPattern.findUnique).mockResolvedValue({ steps: CROSS_LAYER_STEPS, forbiddenShortcuts: [] } as never);
    vi.mocked(prisma.eaElement.findUnique).mockResolvedValue({
      id: "model", name: "RuntimeTarget", refinementLevel: null, elementType: { slug: "data_object" },
    } as never);
    vi.mocked(prisma.eaRelationship.findMany).mockResolvedValue([] as never); // not yet reconciled

    const result = await runTraversalPattern({ patternSlug: "cross_layer_impact", startElementIds: ["model"] });
    const path = result.data!.paths[0];
    expect(path.terminationReason).toBe("no_matching_elements");
    expect(path.steps.map((s) => s.elementId)).toEqual(["model"]);
  });
});
