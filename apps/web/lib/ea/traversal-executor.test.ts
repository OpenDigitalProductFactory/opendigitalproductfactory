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
      fromElementId: "start-1", toElementId: "comp-1",
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
      { fromElementId: "inst1", toElementId: "model", fromElement: { id: "inst1", name: "portal · RT-ROOT-PORTAL", refinementLevel: null, elementType: { slug: "part_usage" } }, toElement: { id: "model", elementType: { slug: "data_object" } }, relationshipType: { slug: "traces" } },
      { fromElementId: "inst2", toElementId: "model", fromElement: { id: "inst2", name: "build-sandbox · RT-X", refinementLevel: null, elementType: { slug: "part_usage" } }, toElement: { id: "model", elementType: { slug: "data_object" } }, relationshipType: { slug: "traces" } },
      // wrong element type AND wrong relationship type → must be filtered out
      { fromElementId: "other", toElementId: "model", fromElement: { id: "other", name: "Component", refinementLevel: null, elementType: { slug: "application_component" } }, toElement: { id: "model", elementType: { slug: "data_object" } }, relationshipType: { slug: "depends_on" } },
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

  // BI-OPT-DB-HOTPATH: the depth loop was changed from one findMany PER NODE to
  // ONE batched findMany({ where: { fromElementId: { in: currentIds } } }) per
  // depth step, with the rows grouped back by their originating node in JS. These
  // tests pin the byte-identical traversal semantics that change must preserve:
  // exactly one query per depth step, and per-node grouping/ordering unchanged.

  const OUTBOUND_TWO_STEPS = [
    { elementTypeSlugs: [], refinementLevel: null, relationshipTypeSlugs: [], direction: "outbound" },
    { elementTypeSlugs: [], refinementLevel: null, relationshipTypeSlugs: [], direction: "outbound" },
  ];

  it("issues ONE batched eaRelationship.findMany per depth step (not one per node)", async () => {
    vi.mocked(prisma.eaNotation.findUnique).mockResolvedValue({ id: "n-1" } as never);
    vi.mocked(prisma.eaTraversalPattern.findUnique).mockResolvedValue({ steps: OUTBOUND_TWO_STEPS, forbiddenShortcuts: [] } as never);
    vi.mocked(prisma.eaElement.findUnique).mockResolvedValue({
      id: "root", name: "Root", refinementLevel: null, elementType: { slug: "node" },
    } as never);
    // Step 0: root → a, b. Step 1: two current nodes (a, b) — the old code would
    // have fired TWO queries here; the batched code fires ONE.
    vi.mocked(prisma.eaRelationship.findMany)
      .mockResolvedValueOnce([
        { fromElementId: "root", toElementId: "a", fromElement: { id: "root", name: "Root", refinementLevel: null, elementType: { slug: "node" } }, toElement: { id: "a", name: "A", refinementLevel: null, elementType: { slug: "node" } }, relationshipType: { slug: "rel" } },
        { fromElementId: "root", toElementId: "b", fromElement: { id: "root", name: "Root", refinementLevel: null, elementType: { slug: "node" } }, toElement: { id: "b", name: "B", refinementLevel: null, elementType: { slug: "node" } }, relationshipType: { slug: "rel" } },
      ] as never)
      .mockResolvedValueOnce([
        { fromElementId: "a", toElementId: "a1", fromElement: { id: "a", name: "A", refinementLevel: null, elementType: { slug: "node" } }, toElement: { id: "a1", name: "A1", refinementLevel: null, elementType: { slug: "node" } }, relationshipType: { slug: "rel" } },
        { fromElementId: "b", toElementId: "b1", fromElement: { id: "b", name: "B", refinementLevel: null, elementType: { slug: "node" } }, toElement: { id: "b1", name: "B1", refinementLevel: null, elementType: { slug: "node" } }, relationshipType: { slug: "rel" } },
      ] as never);

    const result = await runTraversalPattern({ patternSlug: "p", startElementIds: ["root"] });
    expect(result.ok).toBe(true);
    // One findMany per depth step (2 steps), NOT one per node (which would be 1 + 2 = 3).
    expect(vi.mocked(prisma.eaRelationship.findMany)).toHaveBeenCalledTimes(2);
    // Step 1 query is batched over both current nodes.
    expect(vi.mocked(prisma.eaRelationship.findMany).mock.calls[1][0]).toMatchObject({
      where: { fromElementId: { in: ["a", "b"] } },
    });
    // Full path preserved: root → a → b → a1 → b1 (per-node order: a's children
    // before b's children at each step, exactly as the per-node loop produced).
    expect(result.data!.paths[0].steps.map((s) => s.elementId)).toEqual(["root", "a", "b", "a1", "b1"]);
  });

  it("groups batched rows back to the correct originating node and preserves per-node order", async () => {
    vi.mocked(prisma.eaNotation.findUnique).mockResolvedValue({ id: "n-1" } as never);
    vi.mocked(prisma.eaTraversalPattern.findUnique).mockResolvedValue({
      steps: [{ elementTypeSlugs: [], refinementLevel: null, relationshipTypeSlugs: [], direction: "outbound" }],
      forbiddenShortcuts: [],
    } as never);
    // Two start nodes share the first depth step's currentIds = [s1, s2].
    vi.mocked(prisma.eaElement.findUnique).mockImplementation((async (args: { where: { id: string } }) => {
      const id = args.where.id;
      return { id, name: id.toUpperCase(), refinementLevel: null, elementType: { slug: "node" } };
    }) as never);
    // Batched rows for { fromElementId: { in: [s1] } } and { in: [s2] } — each
    // start element is its own path, so the loop runs once per start with a
    // single-node currentIds. Rows are returned interleaved to prove grouping
    // keys on fromElementId, not on row position.
    vi.mocked(prisma.eaRelationship.findMany)
      .mockResolvedValueOnce([
        { fromElementId: "s1", toElementId: "x", fromElement: { id: "s1", name: "S1", refinementLevel: null, elementType: { slug: "node" } }, toElement: { id: "x", name: "X", refinementLevel: null, elementType: { slug: "node" } }, relationshipType: { slug: "rel" } },
        { fromElementId: "s1", toElementId: "y", fromElement: { id: "s1", name: "S1", refinementLevel: null, elementType: { slug: "node" } }, toElement: { id: "y", name: "Y", refinementLevel: null, elementType: { slug: "node" } }, relationshipType: { slug: "rel" } },
      ] as never)
      .mockResolvedValueOnce([
        { fromElementId: "s2", toElementId: "z", fromElement: { id: "s2", name: "S2", refinementLevel: null, elementType: { slug: "node" } }, toElement: { id: "z", name: "Z", refinementLevel: null, elementType: { slug: "node" } }, relationshipType: { slug: "rel" } },
      ] as never);

    const result = await runTraversalPattern({ patternSlug: "p", startElementIds: ["s1", "s2"] });
    expect(result.ok).toBe(true);
    expect(result.data!.paths[0].steps.map((s) => s.elementId)).toEqual(["s1", "x", "y"]);
    expect(result.data!.paths[1].steps.map((s) => s.elementId)).toEqual(["s2", "z"]);
  });

  it("either-direction: a single row matching two current nodes is bucketed under both (OR-per-node parity)", async () => {
    vi.mocked(prisma.eaNotation.findUnique).mockResolvedValue({ id: "n-1" } as never);
    vi.mocked(prisma.eaTraversalPattern.findUnique).mockResolvedValue({
      steps: [
        { elementTypeSlugs: [], refinementLevel: null, relationshipTypeSlugs: [], direction: "outbound" },
        { elementTypeSlugs: [], refinementLevel: null, relationshipTypeSlugs: [], direction: "either" },
      ],
      forbiddenShortcuts: [],
    } as never);
    vi.mocked(prisma.eaElement.findUnique).mockResolvedValue({
      id: "root", name: "Root", refinementLevel: null, elementType: { slug: "node" },
    } as never);
    // Step 0 (outbound): root → p, q  ⇒ currentIds = [p, q].
    // Step 1 (either): one row p→q. Under the OLD OR-per-node code this row is
    // returned for BOTH p (via fromElementId=p) and q (via toElementId=q); for
    // "either" nextEl is always toElement, so p yields q and q yields q.
    vi.mocked(prisma.eaRelationship.findMany)
      .mockResolvedValueOnce([
        { fromElementId: "root", toElementId: "p", fromElement: { id: "root", name: "Root", refinementLevel: null, elementType: { slug: "node" } }, toElement: { id: "p", name: "P", refinementLevel: null, elementType: { slug: "node" } }, relationshipType: { slug: "rel" } },
        { fromElementId: "root", toElementId: "q", fromElement: { id: "root", name: "Root", refinementLevel: null, elementType: { slug: "node" } }, toElement: { id: "q", name: "Q", refinementLevel: null, elementType: { slug: "node" } }, relationshipType: { slug: "rel" } },
      ] as never)
      .mockResolvedValueOnce([
        { fromElementId: "p", toElementId: "q", fromElement: { id: "p", name: "P", refinementLevel: null, elementType: { slug: "node" } }, toElement: { id: "q", name: "Q", refinementLevel: null, elementType: { slug: "node" } }, relationshipType: { slug: "rel" } },
      ] as never);

    const result = await runTraversalPattern({ patternSlug: "p", startElementIds: ["root"] });
    expect(result.ok).toBe(true);
    // p contributes q (via from-match), q contributes q (via to-match): both
    // surface, in currentIds order [p, q] → two q steps appended after root,p,q.
    expect(result.data!.paths[0].steps.map((s) => s.elementId)).toEqual(["root", "p", "q", "q", "q"]);
  });
});
