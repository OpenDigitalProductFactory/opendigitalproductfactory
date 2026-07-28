import { describe, expect, it, vi } from "vitest";

import { persistBootstrapDiscoveryRun } from "./discovery-sync";
import { heapIntegrityRaw } from "../test/discovery-sync-test-support";

describe("persistBootstrapDiscoveryRun integrity boundaries", () => {
  it("aborts before dependent discovery evidence when a heap duplicate is visible", async () => {
    const discoveredItemCreate = vi.fn();
    const relationshipUpsert = vi.fn();
    const projectInventoryEntity = vi.fn();

    const db = {
      $transaction: async <T>(fn: (tx: any) => Promise<T>): Promise<T> => fn({
        $executeRawUnsafe: async () => 0,
        $queryRawUnsafe: async (query: string) => {
          if (query.includes("pg_advisory_xact_lock")) return [];
          if (query.includes("current_setting")) {
            return [{
              enableIndexscan: "on",
              enableIndexonlyscan: "on",
              enableBitmapscan: "on",
            }];
          }
          return [{ entityKey: "router:main", heapCount: 2 }];
        },
        discoveryRun: { create: async () => ({ id: "run-integrity" }) },
        inventoryEntity: {
          findMany: async () => [],
          upsert: async () => ({ id: "entity:router:main", entityKey: "router:main" }),
          updateMany: async () => ({ count: 0 }),
        },
        inventoryRelationship: {
          findMany: async () => [],
          upsert: relationshipUpsert,
          updateMany: async () => ({ count: 0 }),
        },
        portfolioQualityIssue: {
          findMany: async () => [],
          upsert: async () => ({}),
          updateMany: async () => ({ count: 0 }),
        },
        identityResolutionLog: {
          findFirst: async () => null,
          create: async () => ({}),
        },
        discoveredItem: { create: discoveredItemCreate },
        discoveredSoftwareEvidence: { upsert: async () => ({}) },
        discoveredRelationship: { create: async () => ({}) },
      }),
    };

    await expect(persistBootstrapDiscoveryRun(
      db,
      {
        discoveredItems: [{
          discoveredKey: "duplicate:item",
          sourceKind: "dpf_bootstrap",
          itemType: "router",
          name: "Main Gateway",
          externalRef: "gateway:main",
          attributes: {},
        }],
        inventoryEntities: [{
          entityKey: "router:main",
          entityType: "router",
          name: "Main Gateway",
          discoveredKey: "duplicate:item",
          portfolioSlug: "foundational",
          taxonomyNodeId: "foundational/network_management/network_connectivity",
          attributionStatus: "attributed",
          attributionMethod: "rule",
          attributionConfidence: 0.98,
          providerView: "foundational",
          properties: {},
        }],
        inventoryRelationships: [],
        softwareEvidence: [],
      },
      { runKey: "run-integrity", sourceSlug: "dpf_bootstrap" },
      {
        projectInventoryEntity,
        projectInventoryRelationship: async () => undefined,
      },
    )).rejects.toMatchObject({
      name: "InventoryEntityIntegrityError",
      code: "INVENTORY_ENTITY_HEAP_INTEGRITY",
    });

    expect(discoveredItemCreate).not.toHaveBeenCalled();
    expect(relationshipUpsert).not.toHaveBeenCalled();
    expect(projectInventoryEntity).not.toHaveBeenCalled();
  });

  it("cannot sweep a superseded relationship tombstone back into canonical state", async () => {
    const relationshipUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = {
      $transaction: async <T>(fn: (tx: any) => Promise<T>): Promise<T> => fn({
        ...heapIntegrityRaw(),
        discoveryRun: { create: async () => ({ id: "run-tombstone-sweep" }) },
        inventoryEntity: {
          findMany: async () => [],
          upsert: vi.fn(),
          updateMany: async () => ({ count: 0 }),
        },
        inventoryRelationship: {
          findMany: async () => [{
            id: "relationship-canonical",
            relationshipKey: "relationship:canonical",
            fromEntityId: "entity-a",
            toEntityId: "entity-b",
            relationshipType: "CONNECTS",
          }],
          upsert: vi.fn(),
          updateMany: relationshipUpdateMany,
        },
        portfolioQualityIssue: {
          findMany: async () => [],
          upsert: async () => ({}),
          updateMany: async () => ({ count: 0 }),
        },
        identityResolutionLog: {
          findFirst: async () => null,
          create: async () => ({}),
        },
        discoveredItem: { create: vi.fn() },
        discoveredSoftwareEvidence: { upsert: vi.fn() },
        discoveredRelationship: { create: vi.fn() },
      }),
    };

    await persistBootstrapDiscoveryRun(
      db,
      {
        discoveredItems: [],
        inventoryEntities: [],
        inventoryRelationships: [],
        softwareEvidence: [],
      },
      { runKey: "run-tombstone-sweep", sourceSlug: "integration_test" },
      {
        projectInventoryEntity: async () => undefined,
        projectInventoryRelationship: async () => undefined,
      },
    );

    expect(relationshipUpdateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["relationship-canonical"] },
        mergedIntoId: null,
        status: { not: "superseded" },
      },
      data: {
        status: "stale",
        lastSeenAt: expect.any(Date),
      },
    });
  });
});
