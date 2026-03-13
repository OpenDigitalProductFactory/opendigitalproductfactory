import { describe, expect, it, vi } from "vitest";

import {
  persistBootstrapDiscoveryRun,
  summarizeDiscoveryPersistence,
} from "./discovery-sync";

describe("summarizeDiscoveryPersistence", () => {
  it("reports created, updated, and stale counts", () => {
    expect(summarizeDiscoveryPersistence({
      createdEntities: 2,
      updatedEntities: 3,
      staleEntities: 1,
      createdIssues: 1,
    })).toMatchObject({
      createdEntities: 2,
      staleEntities: 1,
    });
  });
});

describe("persistBootstrapDiscoveryRun", () => {
  it("projects normalized inventory entities and relationships into Neo4j adapters", async () => {
    const projectInventoryEntity = vi.fn().mockResolvedValue(undefined);
    const projectInventoryRelationship = vi.fn().mockResolvedValue(undefined);

    const db = {
      $transaction: async <T>(fn: (tx: any) => Promise<T>): Promise<T> => fn({
        discoveryRun: {
          create: async () => ({ id: "run-1" }),
        },
        inventoryEntity: {
          findMany: async () => [],
          upsert: async ({ where }: { where: { entityKey: string } }) => ({
            id: `entity:${where.entityKey}`,
            entityKey: where.entityKey,
          }),
          updateMany: async () => ({ count: 0 }),
        },
        discoveredItem: {
          create: async ({ data }: { data: { observedKey: string } }) => ({
            id: `discovered:${data.observedKey}`,
          }),
        },
        inventoryRelationship: {
          findMany: async () => [],
          upsert: async ({ where }: { where: { relationshipKey: string } }) => ({
            id: `relationship:${where.relationshipKey}`,
            relationshipKey: where.relationshipKey,
          }),
          updateMany: async () => ({ count: 0 }),
        },
        discoveredRelationship: {
          create: async () => ({}),
        },
        portfolioQualityIssue: {
          findMany: async () => [],
          upsert: async () => ({}),
        },
      }),
    };

    await persistBootstrapDiscoveryRun(
      db,
      {
        discoveredItems: [
          {
            discoveredKey: "dpf_bootstrap:host:host:dpf-dev",
            sourceKind: "dpf_bootstrap",
            itemType: "host",
            name: "dpf-dev",
            externalRef: "host:dpf-dev",
            attributes: {},
          },
          {
            discoveredKey: "dpf_bootstrap:docker_runtime:docker_runtime:/var/run/docker.sock",
            sourceKind: "dpf_bootstrap",
            itemType: "docker_runtime",
            name: "Docker",
            externalRef: "docker_runtime:/var/run/docker.sock",
            attributes: {},
          },
        ],
        inventoryEntities: [
          {
            entityKey: "host:hostname:dpf-dev",
            entityType: "host",
            name: "dpf-dev",
            discoveredKey: "dpf_bootstrap:host:host:dpf-dev",
            portfolioSlug: "foundational",
            attributionStatus: "attributed",
            providerView: "foundational",
            properties: {},
          },
          {
            entityKey: "runtime:socket:/var/run/docker.sock",
            entityType: "runtime",
            name: "Docker",
            discoveredKey: "dpf_bootstrap:docker_runtime:docker_runtime:/var/run/docker.sock",
            portfolioSlug: "foundational",
            attributionStatus: "attributed",
            providerView: "foundational",
            properties: {},
          },
        ],
        inventoryRelationships: [
          {
            relationshipKey: "dpf_bootstrap:hosts:host:dpf-dev->docker_runtime:/var/run/docker.sock",
            relationshipType: "hosts",
            fromDiscoveredKey: "dpf_bootstrap:host:host:dpf-dev",
            toDiscoveredKey: "dpf_bootstrap:docker_runtime:docker_runtime:/var/run/docker.sock",
            properties: {},
          },
        ],
      },
      { runKey: "run-1", sourceSlug: "dpf_bootstrap" },
      { projectInventoryEntity, projectInventoryRelationship },
    );

    expect(projectInventoryEntity).toHaveBeenCalledTimes(2);
    expect(projectInventoryRelationship).toHaveBeenCalledTimes(1);
  });
});
