import { describe, it, expect, vi, beforeEach } from "vitest";
import { promoteInventoryEntities, generateProductId, AUTO_PROMOTE_THRESHOLD, PROMOTABLE_TYPES } from "./discovery-promotion";

describe("generateProductId", () => {
  it("generates slug from name with infra- prefix", () => {
    expect(generateProductId("database", "PostgreSQL")).toBe("infra-postgresql");
  });

  it("strips non-alphanumeric characters", () => {
    expect(generateProductId("database", "Neo4j Graph Core")).toBe("infra-neo4j-graph-core");
  });

  it("uses host- prefix for host entities", () => {
    expect(generateProductId("host", "dpf-build-server")).toBe("host-dpf-build-server");
  });

  it("truncates long names to 40 chars", () => {
    const longName = "A".repeat(60);
    const id = generateProductId("database", longName);
    expect(id.length).toBeLessThanOrEqual(46); // infra- prefix (6) + 40 char slug
  });
});

describe("promoteInventoryEntities", () => {
  const mockPrisma = {
    inventoryEntity: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    taxonomyNode: {
      findUnique: vi.fn(),
    },
    portfolio: {
      findUnique: vi.fn(),
    },
    digitalProduct: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    portfolioQualityIssue: {
      upsert: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Default the quality issue writer to a happy-path stub so tests that
    // exercise the skip paths don't have to wire it explicitly.
    mockPrisma.portfolioQualityIssue.upsert.mockResolvedValue({
      id: "qi-stub",
      issueKey: "stub",
      status: "open",
    });
  });

  it("promotes entity with confidence >= threshold and taxonomyNodeId", async () => {
    mockPrisma.inventoryEntity.findMany.mockResolvedValue([{
      id: "ent-1",
      entityKey: "database:postgres",
      entityType: "database",
      name: "PostgreSQL",
      attributionStatus: "attributed",
      attributionConfidence: 0.98,
      taxonomyNodeId: "tn-1",
      digitalProductId: null,
      properties: {},
    }]);
    mockPrisma.taxonomyNode.findUnique.mockResolvedValue({
      id: "tn-1",
      nodeId: "foundational/data_and_storage_management/database",
      governance: null,
    });
    mockPrisma.portfolio.findUnique.mockResolvedValue({ id: "port-1" });
    mockPrisma.digitalProduct.findUnique.mockResolvedValue(null);
    mockPrisma.digitalProduct.upsert.mockResolvedValue({ id: "dp-1", productId: "infra-postgresql" });
    mockPrisma.inventoryEntity.update.mockResolvedValue({});

    const result = await promoteInventoryEntities(mockPrisma as never);

    expect(result.promoted).toBe(1);
    expect(mockPrisma.digitalProduct.upsert).toHaveBeenCalledTimes(1);
    expect(mockPrisma.inventoryEntity.update).toHaveBeenCalledWith({
      where: { id: "ent-1" },
      data: { digitalProductId: "dp-1" },
    });
  });

  it("does not create duplicate product if productId already exists", async () => {
    mockPrisma.inventoryEntity.findMany.mockResolvedValue([{
      id: "ent-1",
      entityKey: "database:postgres",
      entityType: "database",
      name: "PostgreSQL",
      attributionStatus: "attributed",
      attributionConfidence: 0.98,
      taxonomyNodeId: "tn-1",
      digitalProductId: null,
      properties: {},
    }]);
    mockPrisma.taxonomyNode.findUnique.mockResolvedValue({
      id: "tn-1",
      nodeId: "foundational/data_and_storage_management/database",
      governance: null,
    });
    mockPrisma.portfolio.findUnique.mockResolvedValue({ id: "port-1" });
    // Existing product with same productId
    mockPrisma.digitalProduct.findUnique.mockResolvedValue({ id: "dp-existing" });
    mockPrisma.digitalProduct.upsert.mockResolvedValue({ id: "dp-existing", productId: "infra-postgresql" });
    mockPrisma.inventoryEntity.update.mockResolvedValue({});

    const result = await promoteInventoryEntities(mockPrisma as never);

    // Should still link via upsert (update path) and link entity
    expect(result.promoted).toBe(1);
    expect(mockPrisma.digitalProduct.upsert).toHaveBeenCalled();
  });

  it("returns zero counts when no entities are eligible", async () => {
    mockPrisma.inventoryEntity.findMany.mockResolvedValue([]);

    const result = await promoteInventoryEntities(mockPrisma as never);

    expect(result.promoted).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);
  });

  // --- Task 2.1 new behaviors ---

  it("skips network_client (no governance.promotion) with type_not_promotable + writes quality issue", async () => {
    mockPrisma.inventoryEntity.findMany.mockResolvedValue([{
      id: "ent_nc",
      entityKey: "network_client:1",
      entityType: "network_client",
      name: "LAN Host",
      attributionStatus: "attributed",
      attributionConfidence: 0.98,
      taxonomyNodeId: "tn_net",
      digitalProductId: null,
      properties: {},
    }]);
    mockPrisma.taxonomyNode.findUnique.mockResolvedValue({
      id: "tn_net",
      nodeId: "foundational/network_management/network_connectivity",
      governance: null,
    });
    mockPrisma.portfolio.findUnique.mockResolvedValue({ id: "port_1" });

    const result = await promoteInventoryEntities(mockPrisma as never);

    expect(result.promoted).toBe(0);
    expect(result.skipped).toBe(1);
    expect(mockPrisma.digitalProduct.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.portfolioQualityIssue.upsert).toHaveBeenCalledTimes(1);
    const upsertArgs = mockPrisma.portfolioQualityIssue.upsert.mock.calls[0][0];
    expect(upsertArgs.where.issueKey).toContain("type_not_promotable");
    expect(upsertArgs.create.issueType).toBe("type_not_promotable");
  });

  it("promotes network_client with governance.promotion + writes classifyAs into observationConfig", async () => {
    mockPrisma.inventoryEntity.findMany.mockResolvedValue([{
      id: "ent_nc2",
      entityKey: "network_client:2",
      entityType: "network_client",
      name: "AP-1",
      attributionStatus: "attributed",
      attributionConfidence: 0.98,
      taxonomyNodeId: "tn_ap",
      digitalProductId: null,
      properties: {},
    }]);
    mockPrisma.taxonomyNode.findUnique.mockResolvedValue({
      id: "tn_ap",
      nodeId: "foundational/network_management/network_connectivity",
      governance: { promotion: { mode: "auto", classifyAs: "infrastructure_endpoint" } },
    });
    mockPrisma.portfolio.findUnique.mockResolvedValue({ id: "port_1" });
    mockPrisma.digitalProduct.upsert.mockResolvedValue({ id: "dp_ap", productId: "infra-ap-1" });
    mockPrisma.inventoryEntity.update.mockResolvedValue({});

    const result = await promoteInventoryEntities(mockPrisma as never);

    expect(result.promoted).toBe(1);
    const upsertArgs = mockPrisma.digitalProduct.upsert.mock.calls[0][0];
    expect(upsertArgs.create.observationConfig).toEqual({ classifyAs: "infrastructure_endpoint" });
    expect(upsertArgs.update.observationConfig).toEqual({ classifyAs: "infrastructure_endpoint" });
  });

  it("skips low-confidence entity with low_confidence_promotion + writes quality issue", async () => {
    // Note: in production the SQL filter excludes confidence < AUTO_PROMOTE_THRESHOLD,
    // but the resolver is the source of truth for the reason. This test simulates an
    // entity escaping the SQL filter (e.g. race/edge case) and asserts the resolver
    // catches it.
    mockPrisma.inventoryEntity.findMany.mockResolvedValue([{
      id: "ent_low",
      entityKey: "database:weak",
      entityType: "database",
      name: "Weak",
      attributionStatus: "attributed",
      attributionConfidence: 0.5,
      taxonomyNodeId: "tn_1",
      digitalProductId: null,
      properties: {},
    }]);
    mockPrisma.taxonomyNode.findUnique.mockResolvedValue({
      id: "tn_1",
      nodeId: "foundational/data_and_storage_management/database",
      governance: null,
    });
    mockPrisma.portfolio.findUnique.mockResolvedValue({ id: "port_1" });

    const result = await promoteInventoryEntities(mockPrisma as never);
    expect(result.skipped).toBe(1);
    expect(mockPrisma.portfolioQualityIssue.upsert.mock.calls[0][0].create.issueType).toBe("low_confidence_promotion");
  });

  it("skips when portfolio root does not exist + writes quality issue", async () => {
    mockPrisma.inventoryEntity.findMany.mockResolvedValue([{
      id: "ent_orphan",
      entityKey: "database:orphan",
      entityType: "database",
      name: "Orphan",
      attributionStatus: "attributed",
      attributionConfidence: 0.98,
      taxonomyNodeId: "tn_orphan",
      digitalProductId: null,
      properties: {},
    }]);
    mockPrisma.taxonomyNode.findUnique.mockResolvedValue({
      id: "tn_orphan",
      nodeId: "made_up_root/whatever",
      governance: null,
    });
    mockPrisma.portfolio.findUnique.mockResolvedValue(null);

    const result = await promoteInventoryEntities(mockPrisma as never);
    expect(result.skipped).toBe(1);
    expect(mockPrisma.portfolioQualityIssue.upsert.mock.calls[0][0].create.issueType).toBe("no_portfolio_root");
  });

  it("skips when taxonomy node row is missing + writes no_taxonomy quality issue", async () => {
    // Edge case: SQL filter requires taxonomyNodeId not null, but the FK target
    // could be missing (e.g. taxonomy reseed mid-flight). Resolver must catch.
    mockPrisma.inventoryEntity.findMany.mockResolvedValue([{
      id: "ent_missing_tn",
      entityKey: "database:dangling",
      entityType: "database",
      name: "Dangling",
      attributionStatus: "attributed",
      attributionConfidence: 0.98,
      taxonomyNodeId: "tn_does_not_exist",
      digitalProductId: null,
      properties: {},
    }]);
    mockPrisma.taxonomyNode.findUnique.mockResolvedValue(null);

    const result = await promoteInventoryEntities(mockPrisma as never);
    expect(result.skipped).toBe(1);
    expect(mockPrisma.portfolioQualityIssue.upsert.mock.calls[0][0].create.issueType).toBe("no_taxonomy");
  });

  it("widens findMany filter — does NOT constrain entityType to PROMOTABLE_TYPES", async () => {
    mockPrisma.inventoryEntity.findMany.mockResolvedValue([]);
    await promoteInventoryEntities(mockPrisma as never);
    const findManyArgs = mockPrisma.inventoryEntity.findMany.mock.calls[0][0];
    expect(findManyArgs.where.entityType).toBeUndefined();
    expect(findManyArgs.where.attributionStatus).toBe("attributed");
    expect(findManyArgs.where.attributionConfidence).toEqual({ gte: AUTO_PROMOTE_THRESHOLD });
    expect(findManyArgs.where.digitalProductId).toBeNull();
    expect(findManyArgs.where.taxonomyNodeId).toEqual({ not: null });
  });

  it("widens taxonomyNode.findUnique select to include governance", async () => {
    mockPrisma.inventoryEntity.findMany.mockResolvedValue([{
      id: "ent_x",
      entityKey: "database:x",
      entityType: "database",
      name: "X",
      attributionStatus: "attributed",
      attributionConfidence: 0.98,
      taxonomyNodeId: "tn_x",
      digitalProductId: null,
      properties: {},
    }]);
    mockPrisma.taxonomyNode.findUnique.mockResolvedValue({
      id: "tn_x",
      nodeId: "foundational/data_and_storage_management/database",
      governance: null,
    });
    mockPrisma.portfolio.findUnique.mockResolvedValue({ id: "port_1" });
    mockPrisma.digitalProduct.upsert.mockResolvedValue({ id: "dp_x", productId: "infra-x" });
    mockPrisma.inventoryEntity.update.mockResolvedValue({});

    await promoteInventoryEntities(mockPrisma as never);
    const tnArgs = mockPrisma.taxonomyNode.findUnique.mock.calls[0][0];
    expect(tnArgs.select).toEqual({ id: true, nodeId: true, governance: true });
  });

  it("does not set observationConfig when policy is legacy-list (no classifyAs)", async () => {
    mockPrisma.inventoryEntity.findMany.mockResolvedValue([{
      id: "ent_legacy",
      entityKey: "database:legacy",
      entityType: "database",
      name: "LegacyDB",
      attributionStatus: "attributed",
      attributionConfidence: 0.98,
      taxonomyNodeId: "tn_legacy",
      digitalProductId: null,
      properties: {},
    }]);
    mockPrisma.taxonomyNode.findUnique.mockResolvedValue({
      id: "tn_legacy",
      nodeId: "foundational/data_and_storage_management/database",
      governance: null,
    });
    mockPrisma.portfolio.findUnique.mockResolvedValue({ id: "port_1" });
    mockPrisma.digitalProduct.upsert.mockResolvedValue({ id: "dp_legacy", productId: "infra-legacydb" });
    mockPrisma.inventoryEntity.update.mockResolvedValue({});

    const result = await promoteInventoryEntities(mockPrisma as never);
    expect(result.promoted).toBe(1);
    const upsertArgs = mockPrisma.digitalProduct.upsert.mock.calls[0][0];
    expect(upsertArgs.create.observationConfig).toBeUndefined();
    expect(upsertArgs.update.observationConfig).toBeUndefined();
  });
});

describe("constants", () => {
  it("threshold is 0.90", () => {
    expect(AUTO_PROMOTE_THRESHOLD).toBe(0.90);
  });

  it("promotable types include key infrastructure types", () => {
    expect(PROMOTABLE_TYPES).toContain("database");
    expect(PROMOTABLE_TYPES).toContain("runtime");
    expect(PROMOTABLE_TYPES).toContain("monitoring_service");
    expect(PROMOTABLE_TYPES).toContain("ai_service");
    expect(PROMOTABLE_TYPES).toContain("application");
  });
});
