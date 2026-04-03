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
  };

  beforeEach(() => {
    vi.clearAllMocks();
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

  it("skips entity already linked to a DigitalProduct", async () => {
    mockPrisma.inventoryEntity.findMany.mockResolvedValue([{
      id: "ent-1",
      entityKey: "database:postgres",
      entityType: "database",
      name: "PostgreSQL",
      attributionStatus: "attributed",
      attributionConfidence: 0.98,
      taxonomyNodeId: "tn-1",
      digitalProductId: "already-linked",
      properties: {},
    }]);

    const result = await promoteInventoryEntities(mockPrisma as never);

    expect(result.promoted).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("skips entity with confidence below threshold", async () => {
    mockPrisma.inventoryEntity.findMany.mockResolvedValue([{
      id: "ent-1",
      entityKey: "service:unknown",
      entityType: "service",
      name: "unknown-thing",
      attributionStatus: "needs_review",
      attributionConfidence: 0.5,
      taxonomyNodeId: null,
      digitalProductId: null,
      properties: {},
    }]);

    const result = await promoteInventoryEntities(mockPrisma as never);

    expect(result.promoted).toBe(0);
  });

  it("skips entity with no taxonomyNodeId", async () => {
    mockPrisma.inventoryEntity.findMany.mockResolvedValue([{
      id: "ent-1",
      entityKey: "database:some-db",
      entityType: "database",
      name: "SomeDB",
      attributionStatus: "attributed",
      attributionConfidence: 0.98,
      taxonomyNodeId: null,
      digitalProductId: null,
      properties: {},
    }]);

    const result = await promoteInventoryEntities(mockPrisma as never);

    expect(result.promoted).toBe(0);
    expect(result.skipped).toBe(1);
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
