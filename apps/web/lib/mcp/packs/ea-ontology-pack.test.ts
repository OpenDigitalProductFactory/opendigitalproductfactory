import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  prisma: {
    eaNotation: { findUnique: vi.fn() },
    eaElementType: { findUnique: vi.fn(), findMany: vi.fn() },
    eaElement: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    eaRelationshipType: { findUnique: vi.fn() },
    eaRelationshipRule: { findFirst: vi.fn() },
    eaRelationship: { upsert: vi.fn() },
  },
}));
vi.mock("@dpf/db", () => db);

const traversal = vi.hoisted(() => ({ runTraversalPattern: vi.fn() }));
vi.mock("@/lib/ea/traversal-executor", () => traversal);

const eaData = vi.hoisted(() => ({ getEaView: vi.fn() }));
vi.mock("@/lib/ea-data", () => eaData);

const archimate = vi.hoisted(() => ({ importArchimateFile: vi.fn(), exportArchimateFile: vi.fn() }));
vi.mock("@/lib/actions/ea-archimate", () => archimate);

import { eaOntologyPack } from "./ea-ontology-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

const EXPECTED_TOOLS = [
  "create_ea_element",
  "create_ea_relationship",
  "classify_ea_element",
  "query_ontology_graph",
  "run_traversal_pattern",
  "import_archimate",
  "export_archimate",
  "describe_ea_view",
];

const WRITE_TOOLS = ["create_ea_element", "create_ea_relationship", "classify_ea_element", "import_archimate"];
const READ_TOOLS = ["query_ontology_graph", "run_traversal_pattern", "export_archimate", "describe_ea_view"];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ea-ontology pack — registration", () => {
  it("exposes exactly the eight EA / ontology tools", () => {
    expect(eaOntologyPack.definitions.map((d) => d.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(Object.keys(eaOntologyPack.handlers).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("descriptions are provenance-free (no BI/Phase/EP/path leakage)", () => {
    for (const d of eaOntologyPack.definitions) {
      expect(d.description).not.toMatch(/\bBI-|Phase \d|EP-|apps\/web\//);
    }
  });

  it("grants mirror agent-grants: writers need ea_graph_write, readers need ea_graph_read", () => {
    for (const t of WRITE_TOOLS) {
      expect(eaOntologyPack.grants[t]).toEqual(["ea_graph_write"]);
      expect(isToolAllowedByGrants(t, ["ea_graph_write"])).toBe(true);
    }
    for (const t of READ_TOOLS) {
      expect(eaOntologyPack.grants[t]).toEqual(["ea_graph_read"]);
      expect(isToolAllowedByGrants(t, ["ea_graph_read"])).toBe(true);
    }
  });
});

describe("ea-ontology pack — handler behavior (delegation preserved)", () => {
  it("create_ea_element creates an element under the seeded ArchiMate notation", async () => {
    db.prisma.eaNotation.findUnique.mockResolvedValue({ id: "not-1", slug: "archimate4" });
    db.prisma.eaElementType.findUnique.mockResolvedValue({ id: "et-1", name: "Application Component" });
    db.prisma.eaElement.create.mockResolvedValue({ id: "el-1", refinementLevel: "conceptual" });
    const res = await eaOntologyPack.handlers.create_ea_element(
      { name: "Billing", elementTypeSlug: "application_component" },
      "user-42",
    );
    expect(res.success).toBe(true);
    expect(res.entityId).toBe("el-1");
    const createArg = db.prisma.eaElement.create.mock.calls[0][0];
    expect(createArg.data.createdById).toBe("user-42");
    expect(createArg.data.name).toBe("Billing");
    expect(createArg.data.refinementLevel).toBe("conceptual");
  });

  it("create_ea_element fails when the notation is not seeded", async () => {
    db.prisma.eaNotation.findUnique.mockResolvedValue(null);
    const res = await eaOntologyPack.handlers.create_ea_element({ name: "X", elementTypeSlug: "y" }, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("Notation not found");
  });

  it("create_ea_relationship blocks a relationship with no permitting rule", async () => {
    db.prisma.eaNotation.findUnique.mockResolvedValue({ id: "not-1" });
    db.prisma.eaRelationshipType.findUnique.mockResolvedValue({ id: "rt-1" });
    db.prisma.eaElement.findUnique
      .mockResolvedValueOnce({ elementTypeId: "et-a", name: "A" })
      .mockResolvedValueOnce({ elementTypeId: "et-b", name: "B" });
    db.prisma.eaRelationshipRule.findFirst.mockResolvedValue(null);
    const res = await eaOntologyPack.handlers.create_ea_relationship(
      { fromElementId: "a", toElementId: "b", relationshipTypeSlug: "serves" },
      "u1",
    );
    expect(res.success).toBe(false);
    expect((res.data as { validationResult: string }).validationResult).toBe("blocked");
    expect(db.prisma.eaRelationship.upsert).not.toHaveBeenCalled();
  });

  it("create_ea_relationship upserts when a rule permits it", async () => {
    db.prisma.eaNotation.findUnique.mockResolvedValue({ id: "not-1" });
    db.prisma.eaRelationshipType.findUnique.mockResolvedValue({ id: "rt-1" });
    db.prisma.eaElement.findUnique
      .mockResolvedValueOnce({ elementTypeId: "et-a", name: "A" })
      .mockResolvedValueOnce({ elementTypeId: "et-b", name: "B" });
    db.prisma.eaRelationshipRule.findFirst.mockResolvedValue({ id: "rule-1" });
    db.prisma.eaRelationship.upsert.mockResolvedValue({ id: "rel-1" });
    const res = await eaOntologyPack.handlers.create_ea_relationship(
      { fromElementId: "a", toElementId: "b", relationshipTypeSlug: "serves" },
      "u1",
    );
    expect(res.success).toBe(true);
    expect(res.entityId).toBe("rel-1");
    expect((res.data as { validationResult: string }).validationResult).toBe("allowed");
  });

  it("classify_ea_element rejects an empty classification", async () => {
    const res = await eaOntologyPack.handlers.classify_ea_element({ elementId: "el-1" }, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("Nothing to update");
    expect(db.prisma.eaElement.update).not.toHaveBeenCalled();
  });

  it("classify_ea_element updates the supplied classification fields", async () => {
    db.prisma.eaElement.update.mockResolvedValue({ id: "el-1", refinementLevel: "logical", itValueStream: "deploy" });
    const res = await eaOntologyPack.handlers.classify_ea_element(
      { elementId: "el-1", refinementLevel: "logical", itValueStream: "deploy" },
      "u1",
    );
    expect(res.success).toBe(true);
    expect(res.entityId).toBe("el-1");
  });

  it("query_ontology_graph returns elements with a total count", async () => {
    db.prisma.eaNotation.findUnique.mockResolvedValue({ id: "not-1" });
    db.prisma.eaElement.findMany.mockResolvedValue([
      { id: "el-1", name: "Billing", elementType: { name: "Application Component" }, refinementLevel: "conceptual", itValueStream: null, ontologyRole: null },
    ]);
    db.prisma.eaElement.count.mockResolvedValue(1);
    const res = await eaOntologyPack.handlers.query_ontology_graph({ nameContains: "Bill" }, "u1");
    expect(res.success).toBe(true);
    expect(res.message).toContain("Found 1 elements (1 total)");
    expect((res.data as { totalCount: number }).totalCount).toBe(1);
  });

  it("run_traversal_pattern delegates to the traversal executor", async () => {
    traversal.runTraversalPattern.mockResolvedValue({ ok: true, data: { summary: { nodesTraversed: 3 } } });
    const res = await eaOntologyPack.handlers.run_traversal_pattern(
      { patternSlug: "blast_radius", startElementIds: ["el-1"] },
      "u1",
    );
    expect(res.success).toBe(true);
    expect(res.message).toContain("3 nodes");
    expect(traversal.runTraversalPattern).toHaveBeenCalledWith({
      patternSlug: "blast_radius",
      startElementIds: ["el-1"],
      maxDepth: 6,
    });
  });

  it("describe_ea_view summarizes an EA view's structure", async () => {
    eaData.getEaView.mockResolvedValue({
      name: "Context",
      viewpoint: null,
      elements: [
        { viewElementId: "v1", elementType: { name: "App", slug: "app" }, element: { name: "A" } },
        { viewElementId: "v2", elementType: { name: "App", slug: "app" }, element: { name: "B" } },
      ],
      edges: [
        { fromViewElementId: "v1", toViewElementId: "v2", relationshipType: { name: "Serves", slug: "serves" } },
      ],
    });
    const res = await eaOntologyPack.handlers.describe_ea_view({ viewId: "view-1" }, "u1");
    expect(res.success).toBe(true);
    expect((res.data as { elementCount: number }).elementCount).toBe(2);
    expect((res.data as { relationshipCount: number }).relationshipCount).toBe(1);
    expect((res.data as { connectedComponents: number }).connectedComponents).toBe(1);
  });

  it("describe_ea_view reports a missing view", async () => {
    eaData.getEaView.mockResolvedValue(null);
    const res = await eaOntologyPack.handlers.describe_ea_view({ viewId: "nope" }, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("ViewNotFound");
  });

  it("import_archimate delegates to the import action and passes the acting user", async () => {
    archimate.importArchimateFile.mockResolvedValue({ ok: true, data: { elementsCreated: 5, relationshipsCreated: 2 } });
    const res = await eaOntologyPack.handlers.import_archimate(
      { fileContentBase64: "YWJj", fileName: "model.archimate" },
      "user-9",
    );
    expect(res.success).toBe(true);
    expect(res.message).toContain("Imported 5 elements, 2 relationships");
    expect(archimate.importArchimateFile).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-9", fileName: "model.archimate" }),
    );
  });

  it("export_archimate delegates to the export action", async () => {
    archimate.exportArchimateFile.mockResolvedValue({ ok: true, data: { elementCount: 7, fileName: "out.archimate" } });
    const res = await eaOntologyPack.handlers.export_archimate(
      { scopeType: "portfolio", scopeRef: "pf-1" },
      "user-9",
    );
    expect(res.success).toBe(true);
    expect(res.message).toContain("Exported 7 elements to out.archimate");
    expect(archimate.exportArchimateFile).toHaveBeenCalledWith(
      expect.objectContaining({ scopeType: "portfolio", scopeRef: "pf-1", userId: "user-9" }),
    );
  });
});
