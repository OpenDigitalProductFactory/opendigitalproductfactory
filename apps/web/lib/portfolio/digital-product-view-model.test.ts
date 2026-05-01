import { describe, expect, it } from "vitest";
import { toDigitalProductViewModel } from "./digital-product-view-model";

const baseProduct = {
  id: "dp_1",
  productId: "host-postgres",
  name: "PostgreSQL",
  description: "Primary relational database",
  version: "16.0",
  lifecycleStage: "production",
  lifecycleStatus: "active",
  observationConfig: { classifyAs: "infrastructure_endpoint" },
  portfolio: { id: "p_1", slug: "foundational", name: "Foundational" },
  taxonomyNode: { nodeId: "foundational/data_and_storage_management/database", name: "Database" },
};

describe("toDigitalProductViewModel", () => {
  it("projects basic product fields", () => {
    const vm = toDigitalProductViewModel({
      product: baseProduct,
      taxonomyAncestors: [
        { nodeId: "foundational", name: "Foundational" },
        { nodeId: "foundational/data_and_storage_management", name: "Data and Storage Management" },
      ],
      inventoryEntities: [],
      qualityIssues: [],
    });
    expect(vm.id).toBe("dp_1");
    expect(vm.productId).toBe("host-postgres");
    expect(vm.name).toBe("PostgreSQL");
    expect(vm.description).toBe("Primary relational database");
    expect(vm.lifecycleStage).toBe("production");
  });

  it("builds taxonomy lineage root -> leaf", () => {
    const vm = toDigitalProductViewModel({
      product: baseProduct,
      taxonomyAncestors: [
        { nodeId: "foundational", name: "Foundational" },
        { nodeId: "foundational/data_and_storage_management", name: "Data and Storage Management" },
      ],
      inventoryEntities: [],
      qualityIssues: [],
    });
    expect(vm.taxonomyLineage).toEqual([
      { nodeId: "foundational", name: "Foundational" },
      { nodeId: "foundational/data_and_storage_management", name: "Data and Storage Management" },
      { nodeId: "foundational/data_and_storage_management/database", name: "Database" },
    ]);
  });

  it("returns ancestors only when product has no taxonomyNode", () => {
    const vm = toDigitalProductViewModel({
      product: { ...baseProduct, taxonomyNode: null },
      taxonomyAncestors: [{ nodeId: "foundational", name: "Foundational" }],
      inventoryEntities: [],
      qualityIssues: [],
    });
    expect(vm.taxonomyLineage).toEqual([{ nodeId: "foundational", name: "Foundational" }]);
  });

  it("surfaces observationConfig.classifyAs when present", () => {
    const vm = toDigitalProductViewModel({
      product: baseProduct,
      taxonomyAncestors: [],
      inventoryEntities: [],
      qualityIssues: [],
    });
    expect(vm.observationConfig).toEqual({ classifyAs: "infrastructure_endpoint" });
  });

  it("returns null observationConfig when absent or malformed", () => {
    const vm1 = toDigitalProductViewModel({
      product: { ...baseProduct, observationConfig: null },
      taxonomyAncestors: [],
      inventoryEntities: [],
      qualityIssues: [],
    });
    expect(vm1.observationConfig).toBeNull();
    const vm2 = toDigitalProductViewModel({
      product: { ...baseProduct, observationConfig: "not-an-object" },
      taxonomyAncestors: [],
      inventoryEntities: [],
      qualityIssues: [],
    });
    expect(vm2.observationConfig).toBeNull();
  });

  it("picks primaryEntity from first inventory entity", () => {
    const vm = toDigitalProductViewModel({
      product: baseProduct,
      taxonomyAncestors: [],
      inventoryEntities: [
        {
          id: "ent_1",
          name: "PostgreSQL Container",
          entityKey: "container:dpf-postgres-1",
          entityType: "container",
          manufacturer: "PostgreSQL Global Development Group",
          productModel: "PostgreSQL",
          technicalClass: "relational_database",
          iconKey: "postgres",
          observedVersion: "16.0",
          normalizedVersion: "16.0.0",
          attributionConfidence: 0.98,
          lastSeenAt: new Date("2026-04-30"),
        },
        {
          id: "ent_2",
          name: "Other",
          entityKey: "container:other",
          entityType: "container",
          manufacturer: null,
          productModel: null,
          technicalClass: null,
          iconKey: null,
          observedVersion: null,
          normalizedVersion: null,
          attributionConfidence: null,
          lastSeenAt: new Date(),
        },
      ],
      qualityIssues: [],
    });
    expect(vm.primaryEntity?.id).toBe("ent_1");
    expect(vm.primaryEntity?.manufacturer).toBe("PostgreSQL Global Development Group");
    expect(vm.linkedEntityCount).toBe(2);
  });

  it("primaryEntity is null when no entities are linked", () => {
    const vm = toDigitalProductViewModel({
      product: baseProduct,
      taxonomyAncestors: [],
      inventoryEntities: [],
      qualityIssues: [],
    });
    expect(vm.primaryEntity).toBeNull();
    expect(vm.linkedEntityCount).toBe(0);
  });

  it("filters quality issues to status='open' and sorts desc by lastDetectedAt", () => {
    const vm = toDigitalProductViewModel({
      product: baseProduct,
      taxonomyAncestors: [],
      inventoryEntities: [],
      qualityIssues: [
        { id: "q1", issueType: "incomplete_detail", severity: "warn", summary: "old", lastDetectedAt: new Date("2026-04-01"), status: "open" },
        { id: "q2", issueType: "incomplete_detail", severity: "warn", summary: "resolved", lastDetectedAt: new Date("2026-04-15"), status: "resolved" },
        { id: "q3", issueType: "type_not_promotable", severity: "error", summary: "newer", lastDetectedAt: new Date("2026-04-30"), status: "open" },
      ],
    });
    expect(vm.openQualityIssues).toHaveLength(2);
    expect(vm.openQualityIssues[0].id).toBe("q3"); // newest first
    expect(vm.openQualityIssues[1].id).toBe("q1");
  });

  it("caps openQualityIssues at 10", () => {
    const issues = Array.from({ length: 15 }).map((_, i) => ({
      id: `q${i}`,
      issueType: "incomplete_detail",
      severity: "warn",
      summary: `issue ${i}`,
      lastDetectedAt: new Date(2026, 3, i + 1),
      status: "open",
    }));
    const vm = toDigitalProductViewModel({
      product: baseProduct,
      taxonomyAncestors: [],
      inventoryEntities: [],
      qualityIssues: issues,
    });
    expect(vm.openQualityIssues).toHaveLength(10);
  });

  it("Chunk 4 fields default to null when not passed", () => {
    const vm = toDigitalProductViewModel({
      product: baseProduct,
      taxonomyAncestors: [],
      inventoryEntities: [],
      qualityIssues: [],
    });
    expect(vm.freshness).toBeNull();
    expect(vm.enrichmentStatus).toBeNull();
    expect(vm.lastEnrichedAt).toBeNull();
  });

  it("passes Chunk 4 fields through when provided (forward-compat)", () => {
    const enrichedAt = new Date("2026-04-30");
    const vm = toDigitalProductViewModel({
      product: baseProduct,
      taxonomyAncestors: [],
      inventoryEntities: [],
      qualityIssues: [],
      freshness: "stale",
      enrichmentStatus: "enriched",
      lastEnrichedAt: enrichedAt,
    });
    expect(vm.freshness).toBe("stale");
    expect(vm.enrichmentStatus).toBe("enriched");
    expect(vm.lastEnrichedAt).toBe(enrichedAt);
  });
});
