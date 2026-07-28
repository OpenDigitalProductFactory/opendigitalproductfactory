import { describe, expect, it, vi } from "vitest";

import { persistBootstrapDiscoveryRun } from "../src/discovery-sync";
import { heapIntegrityRaw } from "./discovery-sync-test-support";

// Source attribution: a sweep from one source must not mark another
// source's entities or relationships stale, even when they share the
// same scopeKey. The implementation routes that invariant through
// InventoryEntity.lastConfirmedRun.sourceSlug (and the same on
// InventoryRelationship) — `findMany` only returns rows confirmed by
// the current sweep's source, so the stale set is naturally limited to
// rows this source owns.
//
// The previous PR #1009 attempt did this via an entityKey prefix check,
// which was a no-op (entity keys never start with sourceSlug). These
// tests pin the column-based invariant to prevent regression.

type FindManyArgs = {
  where?: {
    mergedIntoId?: null;
    scopeKey?: string;
    lastConfirmedRun?: { sourceSlug?: string };
  };
  select: {
    entityKey?: true;
    id?: true;
    relationshipKey?: true;
    fromEntityId?: true;
    toEntityId?: true;
    relationshipType?: true;
  };
};

function buildStubDb(opts: {
  // What the DB would return for each source-scoped findMany call.
  // The stub reads opts.entitiesBySource[sourceSlug] when the findMany
  // includes a sourceSlug filter — that's how we prove cross-source
  // isolation without spinning up Postgres.
  entitiesBySource: Record<string, string[]>;
  relationshipsBySource?: Record<string, string[]>;
}) {
  const entityFindMany = vi.fn(async (args: FindManyArgs) => {
    const sourceSlug = args.where?.lastConfirmedRun?.sourceSlug ?? "__unknown__";
    return (opts.entitiesBySource[sourceSlug] ?? []).map((entityKey) => ({ entityKey }));
  });
  const entityUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
  const relationshipFindMany = vi.fn(async (args: FindManyArgs) => {
    const sourceSlug = args.where?.lastConfirmedRun?.sourceSlug ?? "__unknown__";
    // BI-PIR-7d69a445 (part 2): existing relationships are keyed by tuple now, so
    // the stub synthesizes a distinct tuple + id per relationshipKey. The stale
    // sweep marks rows by id, so `id` maps 1:1 back to the source relationshipKey.
    return (opts.relationshipsBySource?.[sourceSlug] ?? []).map((relationshipKey) => ({
      id: `relationship:${relationshipKey}`,
      relationshipKey,
      fromEntityId: `from:${relationshipKey}`,
      toEntityId: `to:${relationshipKey}`,
      relationshipType: "hosts",
    }));
  });
  const relationshipUpdateMany = vi.fn().mockResolvedValue({ count: 0 });

  const db = {
    $transaction: async <T>(fn: (tx: any) => Promise<T>): Promise<T> =>
      fn({
        ...heapIntegrityRaw(),
        discoveryRun: { create: async () => ({ id: "run-id" }) },
        inventoryEntity: {
          findMany: entityFindMany,
          upsert: async ({ where }: { where: { entityKey: string } }) => ({
            id: `entity:${where.entityKey}`,
            entityKey: where.entityKey,
          }),
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

  return { db, entityFindMany, entityUpdateMany, relationshipFindMany, relationshipUpdateMany };
}

describe("persistBootstrapDiscoveryRun source attribution", () => {
  it("a unifi sweep does NOT mark dpf_bootstrap-attributed entities stale", async () => {
    const { db, entityFindMany, entityUpdateMany } = buildStubDb({
      entitiesBySource: {
        // dpf_bootstrap previously confirmed two infra entities.
        dpf_bootstrap: ["host:hostname:dpf-dev", "runtime:socket:/var/run/docker.sock"],
        // unifi sweep has previously confirmed one device.
        unifi: ["host:arp:192.168.1.50"],
      },
    });

    await persistBootstrapDiscoveryRun(
      db,
      {
        discoveredItems: [],
        // Unifi sweep observes nothing this time (e.g. controller offline).
        inventoryEntities: [],
        inventoryRelationships: [],
        softwareEvidence: [],
      },
      {
        runKey: "unifi-run-2",
        sourceSlug: "unifi",
        trigger: "scheduled",
        status: "completed",
      },
      {
        projectInventoryEntity: vi.fn().mockResolvedValue(undefined),
        projectInventoryRelationship: vi.fn().mockResolvedValue(undefined),
      },
    );

    // The findMany must filter by unifi's sourceSlug — the implementation
    // never sees dpf_bootstrap-owned rows.
    expect(entityFindMany).toHaveBeenCalledWith({
      where: {
        mergedIntoId: null,
        scopeKey: "organization:internal",
        lastConfirmedRun: { sourceSlug: "unifi" },
      },
      select: { entityKey: true },
    });

    // Only unifi's own row was a candidate for staleness — and it WAS
    // missing from this sweep, so updateMany targets exactly that key.
    expect(entityUpdateMany).toHaveBeenCalledWith({
      where: {
        scopeKey: "organization:internal",
        entityKey: { in: ["host:arp:192.168.1.50"] },
      },
      data: expect.objectContaining({ status: "stale" }),
    });
    // Critically, the dpf_bootstrap-confirmed keys are NOT in the update set.
    const updateCallArgs = entityUpdateMany.mock.calls[0]?.[0];
    expect(updateCallArgs?.where.entityKey.in).not.toContain("host:hostname:dpf-dev");
    expect(updateCallArgs?.where.entityKey.in).not.toContain(
      "runtime:socket:/var/run/docker.sock",
    );
  });

  it("edge-node-A sweep does NOT mark edge-node-B's entities stale within the same scope", async () => {
    const scopeKey = "customer:cust_a:site:site_austin";
    const { db, entityFindMany, entityUpdateMany } = buildStubDb({
      entitiesBySource: {
        "edge-node:node-a": [`${scopeKey}:host:arp:10.0.0.10`],
        "edge-node:node-b": [`${scopeKey}:host:arp:10.0.0.20`],
      },
    });

    await persistBootstrapDiscoveryRun(
      db,
      {
        discoveredItems: [],
        inventoryEntities: [],
        inventoryRelationships: [],
        softwareEvidence: [],
      },
      {
        runKey: "node-a-run-1",
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
        scopeKey,
        lastConfirmedRun: { sourceSlug: "edge-node:node-a" },
      },
      select: { entityKey: true },
    });

    // Only node-a's key is in the stale candidate set; node-b's row is
    // never even read by node-a's sweep.
    const updateCallArgs = entityUpdateMany.mock.calls[0]?.[0];
    expect(updateCallArgs?.where.entityKey.in).toEqual([`${scopeKey}:host:arp:10.0.0.10`]);
    expect(updateCallArgs?.where.entityKey.in).not.toContain(`${scopeKey}:host:arp:10.0.0.20`);
  });

  it("source-attribution filter composes with scope filter for relationship staleness", async () => {
    const scopeKey = "customer:cust_a:site:site_austin";
    const { db, relationshipFindMany, relationshipUpdateMany } = buildStubDb({
      entitiesBySource: {},
      relationshipsBySource: {
        unifi: [`${scopeKey}:unifi:hosts:r1->r2`],
        // edge-node sweep would normally own a different relationship key,
        // but unifi's findMany must never see it.
        "edge-node:node-a": [`${scopeKey}:edge:hosts:r3->r4`],
      },
    });

    await persistBootstrapDiscoveryRun(
      db,
      {
        discoveredItems: [],
        inventoryEntities: [],
        inventoryRelationships: [],
        softwareEvidence: [],
      },
      {
        runKey: "unifi-run-3",
        sourceSlug: "unifi",
        trigger: "scheduled",
        status: "completed",
        customerAccountId: "cust_a",
        customerSiteId: "site_austin",
      },
      {
        projectInventoryEntity: vi.fn().mockResolvedValue(undefined),
        projectInventoryRelationship: vi.fn().mockResolvedValue(undefined),
      },
    );

    expect(relationshipFindMany).toHaveBeenCalledWith({
      where: {
        mergedIntoId: null,
        status: { not: "superseded" },
        scopeKey,
        lastConfirmedRun: { sourceSlug: "unifi" },
      },
      // BI-PIR-7d69a445 (part 2): read by canonical tuple columns (+ id, + key).
      select: {
        id: true,
        relationshipKey: true,
        fromEntityId: true,
        toEntityId: true,
        relationshipType: true,
      },
    });

    // Only unifi's relationship is a stale candidate — the stale sweep now targets
    // rows by id (the tuple's row), and unifi's row id maps back to its own key.
    // edge-node:node-a's row was never even read by unifi's sweep.
    const updateCallArgs = relationshipUpdateMany.mock.calls[0]?.[0];
    expect(updateCallArgs?.where.id.in).toEqual([
      `relationship:${scopeKey}:unifi:hosts:r1->r2`,
    ]);
    expect(updateCallArgs?.where.id.in).not.toContain(
      `relationship:${scopeKey}:edge:hosts:r3->r4`,
    );
  });
});
