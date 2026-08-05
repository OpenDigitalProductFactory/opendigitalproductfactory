import { describe, expect, it, vi } from "vitest";

import { persistBootstrapDiscoveryRun } from "../src/discovery-sync";
import { heapIntegrityRaw } from "./discovery-sync-test-support";

function buildStubDb() {
  const entityFindMany = vi.fn().mockResolvedValue([
    { entityKey: "customer:cust_a:site:site_austin:host:arp:192.168.1.99" },
  ]);
  const entityUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const relationshipFindMany = vi.fn().mockResolvedValue([]);
  const relationshipUpdateMany = vi.fn().mockResolvedValue({ count: 0 });

  const upsertedEntities: Array<{ where: { entityKey: string }; create: any }> = [];

  const db = {
    $transaction: async <T>(fn: (tx: any) => Promise<T>): Promise<T> =>
      fn({
        ...heapIntegrityRaw(),
        discoveryRun: {
          create: async () => ({ id: "run-a" }),
        },
        inventoryEntity: {
          findMany: entityFindMany,
          upsert: async (args: { where: { entityKey: string }; create: any }) => {
            upsertedEntities.push(args);
            return { id: `entity:${args.where.entityKey}`, entityKey: args.where.entityKey };
          },
          updateMany: entityUpdateMany,
        },
        discoveredItem: {
          create: async ({ data }: { data: { observedKey: string } }) => ({
            id: `discovered:${data.observedKey}`,
          }),
        },
        discoveredSoftwareEvidence: { upsert: async () => ({}) },
        inventoryRelationship: {
          findMany: relationshipFindMany,
          upsert: async ({ where, create }: {
            where: { fromEntityId_toEntityId_relationshipType: { fromEntityId: string; toEntityId: string; relationshipType: string } };
            create: { relationshipKey: string };
          }) => {
            const { fromEntityId, toEntityId, relationshipType } = where.fromEntityId_toEntityId_relationshipType;
            return {
              id: `relationship:${fromEntityId}|${toEntityId}|${relationshipType}`,
              relationshipKey: create.relationshipKey,
            };
          },
          updateMany: relationshipUpdateMany,
        },
        discoveredRelationship: { create: async () => ({}) },
        portfolioQualityIssue: {
          findMany: async () => [],
          upsert: async () => ({}),
          updateMany: async () => ({ count: 0 }),
        },
      }),
  };

  return {
    db,
    entityFindMany,
    entityUpdateMany,
    relationshipFindMany,
    relationshipUpdateMany,
    upsertedEntities,
  };
}

describe("persistBootstrapDiscoveryRun customer-scope isolation", () => {
  it("scopes find/update queries and entity upserts to the customer scope key", async () => {
    const { db, entityFindMany, entityUpdateMany, relationshipFindMany, upsertedEntities } =
      buildStubDb();

    await persistBootstrapDiscoveryRun(
      db,
      {
        discoveredItems: [],
        inventoryEntities: [
          {
            entityKey: "customer:cust_a:site:site_austin:host:arp:192.168.1.22",
            entityType: "host",
            name: "Customer A workstation",
            discoveredKey: "edge_node:host:arp:192.168.1.22",
            attributionStatus: "attributed",
            providerView: "foundational",
            properties: {
              scopeKey: "customer:cust_a:site:site_austin",
              customerAccountId: "cust_a",
              customerSiteId: "site_austin",
            },
          },
        ],
        inventoryRelationships: [],
        softwareEvidence: [],
      },
      {
        runKey: "run-a",
        sourceSlug: "edge-node:node-a",
        trigger: "edge_node",
        status: "completed",
        edgeNodeId: "edge-a",
        customerAccountId: "cust_a",
        customerSiteId: "site_austin",
      },
      {
        projectInventoryEntity: vi.fn().mockResolvedValue(undefined),
        projectInventoryRelationship: vi.fn().mockResolvedValue(undefined),
      },
    );

    expect(entityFindMany).toHaveBeenCalledWith({
      where: {
        mergedIntoId: null,
        scopeKey: "customer:cust_a:site:site_austin",
        lastConfirmedRun: { sourceSlug: "edge-node:node-a" },
      },
      // Identity columns ride along with the key set so the stale branch can
      // judge on the persisted row; the scope `where` above is the subject here.
      select: {
        entityKey: true,
        entityType: true,
        manufacturer: true,
        observedVersion: true,
        normalizedVersion: true,
        supportStatus: true,
      },
    });

    expect(relationshipFindMany).toHaveBeenCalledWith({
      where: {
        mergedIntoId: null,
        status: { not: "superseded" },
        scopeKey: "customer:cust_a:site:site_austin",
        lastConfirmedRun: { sourceSlug: "edge-node:node-a" },
      },
      // BI-PIR-7d69a445 (part 2): existing relationships are read by their
      // canonical tuple columns (+ id for the stale sweep, + relationshipKey).
      select: {
        id: true,
        relationshipKey: true,
        fromEntityId: true,
        toEntityId: true,
        relationshipType: true,
      },
    });

    // Stale detection only marks entities in the same scope stale.
    expect(entityUpdateMany).toHaveBeenCalledWith({
      where: {
        scopeKey: "customer:cust_a:site:site_austin",
        entityKey: { in: ["customer:cust_a:site:site_austin:host:arp:192.168.1.99"] },
      },
      data: expect.objectContaining({ status: "stale" }),
    });

    // Upsert payload carries scope + customer connect ops.
    const upsert = upsertedEntities[0];
    expect(upsert?.create).toMatchObject({
      scopeKey: "customer:cust_a:site:site_austin",
      customerAccount: { connect: { id: "cust_a" } },
      customerSite: { connect: { id: "site_austin" } },
    });
  });

  it("falls back to organization-internal scope when no customer ids are supplied", async () => {
    const { db, entityFindMany, upsertedEntities } = buildStubDb();

    await persistBootstrapDiscoveryRun(
      db,
      {
        discoveredItems: [],
        inventoryEntities: [
          {
            entityKey: "host:arp:10.0.0.5",
            entityType: "host",
            name: "Internal host",
            discoveredKey: "bootstrap:host:arp:10.0.0.5",
            attributionStatus: "attributed",
            providerView: "foundational",
            properties: {},
          },
        ],
        inventoryRelationships: [],
        softwareEvidence: [],
      },
      {
        runKey: "run-internal",
        sourceSlug: "dpf-bootstrap",
        trigger: "bootstrap",
        status: "completed",
      },
      {
        projectInventoryEntity: vi.fn().mockResolvedValue(undefined),
        projectInventoryRelationship: vi.fn().mockResolvedValue(undefined),
      },
    );


    expect(upsertedEntities[0]?.create).toMatchObject({
      scopeKey: "organization:internal",
    });
    // No customer connect when there's no customer scope.
    expect(upsertedEntities[0]?.create.customerAccount).toBeUndefined();
    expect(upsertedEntities[0]?.create.customerSite).toBeUndefined();
  });
});
