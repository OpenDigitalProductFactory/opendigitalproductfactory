import { describe, expect, it, vi } from "vitest";

import {
  persistBootstrapDiscoveryRun,
  summarizeDiscoveryPersistence,
} from "./discovery-sync";
import { heapIntegrityRaw } from "../test/discovery-sync-test-support";

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
    const upsertedEntityPayloads: Array<Record<string, unknown>> = [];
    const createdSoftwareEvidence: Array<Record<string, unknown>> = [];
    const qualityIssues: Array<Record<string, unknown>> = [];
    const persistenceEvents: string[] = [];
    const relationshipFindMany = vi.fn().mockResolvedValue([]);

    const db = {
      $transaction: async <T>(fn: (tx: any) => Promise<T>): Promise<T> => fn({
        ...heapIntegrityRaw(persistenceEvents),
        discoveryRun: {
          create: async () => ({ id: "run-1" }),
        },
        inventoryEntity: {
          findMany: async () => [],
          upsert: async ({ where, create, update }: { where: { entityKey: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
            persistenceEvents.push("upsert");
            upsertedEntityPayloads.push({ where, create, update });
            return ({
            id: `entity:${where.entityKey}`,
            entityKey: where.entityKey,
            });
          },
          updateMany: async () => ({ count: 0 }),
        },
        discoveredItem: {
          create: async ({ data }: { data: { observedKey: string } }) => ({
            id: `discovered:${data.observedKey}`,
          }),
        },
        discoveredSoftwareEvidence: {
          upsert: async ({ create }: { create: Record<string, unknown> }) => {
            createdSoftwareEvidence.push(create);
            return {};
          },
        },
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
          updateMany: async () => ({ count: 0 }),
        },
        discoveredRelationship: {
          create: async () => ({}),
        },
        portfolioQualityIssue: {
          findMany: async () => [],
          upsert: async ({ create }: { create: Record<string, unknown> }) => {
            qualityIssues.push(create);
            return {};
          },
          updateMany: async () => ({ count: 0 }),
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
            taxonomyNodeId: "foundational/compute/servers",
            attributionStatus: "attributed",
            attributionMethod: "rule",
            attributionConfidence: 0.98,
            attributionEvidence: { ruleId: "foundational_host_servers" },
            providerView: "foundational",
            properties: {},
          },
          {
            entityKey: "runtime:socket:/var/run/docker.sock",
            entityType: "runtime",
            name: "Docker",
            discoveredKey: "dpf_bootstrap:docker_runtime:docker_runtime:/var/run/docker.sock",
            portfolioSlug: "foundational",
            taxonomyNodeId: "foundational/platform_services/container_platform",
            attributionStatus: "attributed",
            attributionMethod: "rule",
            attributionConfidence: 0.98,
            attributionEvidence: { ruleId: "container_platform_runtime" },
            providerView: "foundational",
            properties: {},
          },
          {
            entityKey: "service:mystery-engine",
            entityType: "service",
            name: "Mystery Engine",
            discoveredKey: "dpf_bootstrap:application_service:service:mystery-engine",
            portfolioSlug: null,
            taxonomyNodeId: null,
            attributionStatus: "needs_review",
            attributionMethod: "heuristic",
            attributionConfidence: 0.32,
            attributionEvidence: { descriptor: "mystery engine" },
            candidateTaxonomy: [
              {
                nodeId: "for_employees/employee_services",
                name: "Employee Services",
                portfolioSlug: "for_employees",
                score: 0.32,
                evidence: ["fallback_candidate"],
              },
            ],
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
        softwareEvidence: [
          {
            evidenceKey: "host:hostname:dpf-dev:host_packages:postgresql-16",
            inventoryEntityKey: "host:hostname:dpf-dev",
            evidenceSource: "host_packages",
            rawPackageName: "postgresql-16",
            rawVersion: "16.3-1",
            normalizationStatus: "normalized",
            normalizationMethod: "rule",
            normalizationConfidence: 0.99,
            softwareIdentityId: "identity-postgres",
            normalizedVendor: "PostgreSQL Global Development Group",
            normalizedProductName: "PostgreSQL",
            canonicalVersion: "16.3",
            candidateIdentities: [
              {
                id: "identity-postgres",
                score: 0.99,
                normalizedProductName: "PostgreSQL",
              },
            ],
          },
        ],
      },
      { runKey: "run-1", sourceSlug: "dpf_bootstrap" },
      { projectInventoryEntity, projectInventoryRelationship },
    );

    expect(projectInventoryEntity).toHaveBeenCalledTimes(3);
    expect(projectInventoryRelationship).toHaveBeenCalledTimes(1);
    expect(persistenceEvents.indexOf("lock")).toBeGreaterThanOrEqual(0);
    expect(persistenceEvents.indexOf("lock")).toBeLessThan(
      persistenceEvents.indexOf("upsert"),
    );
    expect(relationshipFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        mergedIntoId: null,
        status: { not: "superseded" },
      }),
    }));
    expect(upsertedEntityPayloads[0]?.create).toMatchObject({
      taxonomyNode: { connect: { nodeId: "foundational/compute/servers" } },
      attributionMethod: "rule",
      attributionConfidence: 0.98,
    });
    expect(createdSoftwareEvidence[0]).toMatchObject({
      evidenceKey: "host:hostname:dpf-dev:host_packages:postgresql-16",
      softwareIdentityId: "identity-postgres",
    });
    expect(upsertedEntityPayloads[0]?.create).toMatchObject({
      manufacturer: "PostgreSQL Global Development Group",
      productModel: "PostgreSQL",
      observedVersion: "16.3-1",
      normalizedVersion: "16.3",
      supportStatus: "supported",
    });
    expect(qualityIssues.map((issue) => issue.issueType)).toContain(
      "taxonomy_attribution_low_confidence",
    );
    expect(qualityIssues.map((issue) => issue.issueType)).toEqual(
      expect.arrayContaining([
        "lifecycle_unverified",
        "catalog_match_ambiguous",
      ]),
    );
    // Retargeted from `host:hostname:dpf-dev`, which no longer raises either
    // issue and SHOULD NOT: this fixture gives it postgres software evidence, so
    // enrichment identifies it as PostgreSQL 16.3 and sets supportStatus
    // "supported" on the persisted row. The quality evaluator used to score the
    // raw evidence snapshot instead of the enriched values, so it raised "still
    // needs support lifecycle verification" against an entity it had just
    // identified — precisely the false nagging inventory-enrichment.ts exists to
    // stop ("if we know who made it, we know enough to stop nagging the
    // operator"). This assertion had codified that blindness; the taxonomyNode
    // linkage it actually guards is checked here on an issue that still warrants
    // raising.
    expect(
      qualityIssues.find(
        (issue) =>
          issue.issueKey === "inventory_entity:runtime:socket:/var/run/docker.sock:lifecycle_unverified",
      ),
    ).toMatchObject({
      taxonomyNode: { connect: { nodeId: "foundational/platform_services/container_platform" } },
    });
  });

  it("deduplicates repeated discovered items within a single run", async () => {
    const createdObservedKeys: string[] = [];

    const db = {
      $transaction: async <T>(fn: (tx: any) => Promise<T>): Promise<T> => fn({
        ...heapIntegrityRaw(),
        discoveryRun: {
          create: async () => ({ id: "run-2" }),
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
          create: async ({ data }: { data: { observedKey: string } }) => {
            createdObservedKeys.push(data.observedKey);
            return { id: `discovered:${data.observedKey}` };
          },
        },
        discoveredSoftwareEvidence: {
          upsert: async () => ({}),
        },
        inventoryRelationship: {
          findMany: async () => [],
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
          updateMany: async () => ({ count: 0 }),
        },
        discoveredRelationship: {
          create: async () => ({}),
        },
        portfolioQualityIssue: {
          findMany: async () => [],
          upsert: async () => ({}),
          updateMany: async () => ({ count: 0 }),
        },
      }),
    };

    await persistBootstrapDiscoveryRun(
      db,
      {
        discoveredItems: [
          {
            discoveredKey: "duplicate:item",
            sourceKind: "dpf_bootstrap",
            itemType: "router",
            name: "Main Gateway",
            externalRef: "gateway:main",
            attributes: { source: "collector-a" },
          },
          {
            discoveredKey: "duplicate:item",
            sourceKind: "dpf_bootstrap",
            itemType: "router",
            name: "Main Gateway",
            externalRef: "gateway:main",
            attributes: { source: "collector-b" },
          },
        ],
        inventoryEntities: [
          {
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
          },
        ],
        inventoryRelationships: [],
        softwareEvidence: [],
      },
      { runKey: "run-2", sourceSlug: "dpf_bootstrap" },
      {
        projectInventoryEntity: async () => undefined,
        projectInventoryRelationship: async () => undefined,
      },
    );

    expect(createdObservedKeys).toEqual(["duplicate:item"]);
  });

  it("upserts one InventoryRelationship per resolved tuple when distinct keys collapse (BI-PIR-7d69a445)", async () => {
    // Two inventory entities share the SAME entityKey ("host:shared") but arrive
    // under DIFFERENT discovered keys ("dk:a" / "dk:b"), so entity resolution
    // maps both discovered keys onto the same persisted entity id. Two
    // relationships with DISTINCT relationshipKeys ("rel:k1" / "rel:k2") therefore
    // collapse onto the same (fromEntityId, toEntityId, relationshipType) tuple.
    // Before the fix the second one took the create path and violated the compound
    // @@unique (P2002, aborting the whole $transaction). The dedup must upsert the
    // InventoryRelationship exactly once, while EACH relationship still records its
    // own DiscoveredRelationship provenance row linked to the shared row.
    const relationshipUpsertKeys: string[] = [];
    const discoveredRelationshipCreates: Array<{ relationshipKey: string; connectId: string }> = [];

    const db = {
      $transaction: async <T>(fn: (tx: any) => Promise<T>): Promise<T> => fn({
        ...heapIntegrityRaw(),
        discoveryRun: { create: async () => ({ id: "run-3" }) },
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
        discoveredSoftwareEvidence: { upsert: async () => ({}) },
        inventoryRelationship: {
          findMany: async () => [],
          upsert: async ({ where, create }: {
            where: { fromEntityId_toEntityId_relationshipType: { fromEntityId: string; toEntityId: string; relationshipType: string } };
            create: { relationshipKey: string };
          }) => {
            // The upsert conflict target is the tuple; record the source key it
            // carried so the assertion can prove the single upsert used rel:k1.
            relationshipUpsertKeys.push(create.relationshipKey);
            const { fromEntityId, toEntityId, relationshipType } = where.fromEntityId_toEntityId_relationshipType;
            return {
              id: `relationship:${fromEntityId}|${toEntityId}|${relationshipType}`,
              relationshipKey: create.relationshipKey,
            };
          },
          updateMany: async () => ({ count: 0 }),
        },
        discoveredRelationship: {
          create: async ({ data }: { data: { relationshipKey: string; inventoryRelationship: { connect: { id: string } } } }) => {
            discoveredRelationshipCreates.push({
              relationshipKey: data.relationshipKey,
              connectId: data.inventoryRelationship.connect.id,
            });
            return {};
          },
        },
        portfolioQualityIssue: { findMany: async () => [], upsert: async () => ({}), updateMany: async () => ({ count: 0 }) },
      }),
    };

    const entity = (discoveredKey: string, entityKey: string) => ({
      entityKey,
      entityType: "host",
      name: entityKey,
      discoveredKey,
      portfolioSlug: "foundational",
      taxonomyNodeId: "foundational/compute/servers",
      attributionStatus: "attributed" as const,
      attributionMethod: "rule" as const,
      attributionConfidence: 0.98,
      providerView: "foundational",
      properties: {},
    });
    const item = (discoveredKey: string) => ({
      discoveredKey,
      sourceKind: "dpf_bootstrap",
      itemType: "host",
      name: discoveredKey,
      externalRef: discoveredKey,
      attributes: {},
    });

    await persistBootstrapDiscoveryRun(
      db,
      {
        discoveredItems: [item("dk:a"), item("dk:b"), item("dk:c")],
        inventoryEntities: [
          entity("dk:a", "host:shared"),
          entity("dk:b", "host:shared"),
          entity("dk:c", "runtime:target"),
        ],
        inventoryRelationships: [
          {
            relationshipKey: "rel:k1",
            relationshipType: "hosts",
            fromDiscoveredKey: "dk:a",
            toDiscoveredKey: "dk:c",
            properties: {},
          },
          {
            relationshipKey: "rel:k2",
            relationshipType: "hosts",
            fromDiscoveredKey: "dk:b",
            toDiscoveredKey: "dk:c",
            properties: {},
          },
        ],
        softwareEvidence: [],
      },
      { runKey: "run-3", sourceSlug: "dpf_bootstrap" },
      {
        projectInventoryEntity: async () => undefined,
        projectInventoryRelationship: async () => undefined,
      },
    );

    // The colliding tuple was upserted exactly once (the second relationship
    // reused it instead of taking the crashing create path)...
    expect(relationshipUpsertKeys).toEqual(["rel:k1"]);
    // ...but BOTH relationships kept their own provenance row, linked to the one
    // shared InventoryRelationship (identified by its resolved tuple, since the
    // upsert now keys on the tuple, not relationshipKey).
    const sharedTupleId = "relationship:entity:host:shared|entity:runtime:target|hosts";
    expect(discoveredRelationshipCreates).toEqual([
      { relationshipKey: "rel:k1", connectId: sharedTupleId },
      { relationshipKey: "rel:k2", connectId: sharedTupleId },
    ]);
  });

  it("UPDATES a tuple persisted by a PRIOR run under a different relationshipKey — no cross-run P2002 (BI-PIR-7d69a445 part 2)", async () => {
    // Part 2 cross-run repro. A PRIOR run persisted the (from, to, "hosts") tuple
    // under relationshipKey "rel:k1" (returned here by findMany as an existing
    // row). This NEW run presents the SAME tuple under a DIFFERENT relationshipKey
    // "rel:k2". With relationshipKey as the upsert conflict target, the create path
    // would fire and violate the compound @@unique (the cross-run P2002). With the
    // tuple as the conflict target, the upsert UPDATES the existing row instead:
    // exactly one upsert, counted as UPDATED (not created), and the new run still
    // records its own DiscoveredRelationship provenance under "rel:k2".
    const fromEntityId = "entity:host:shared";
    const toEntityId = "entity:runtime:target";
    const relationshipType = "hosts";
    const tupleId = "prior-run-relationship-id";

    const upsertCalls: Array<{
      where: { fromEntityId_toEntityId_relationshipType: { fromEntityId: string; toEntityId: string; relationshipType: string } };
      create: { relationshipKey: string };
      update: { relationshipKey: string };
    }> = [];
    const discoveredRelationshipCreates: Array<{ relationshipKey: string; connectId: string }> = [];

    const db = {
      $transaction: async <T>(fn: (tx: any) => Promise<T>): Promise<T> => fn({
        ...heapIntegrityRaw(),
        discoveryRun: { create: async () => ({ id: "run-cross" }) },
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
        discoveredSoftwareEvidence: { upsert: async () => ({}) },
        inventoryRelationship: {
          // The prior run's row for this tuple, under the OLD relationshipKey.
          findMany: async () => [
            { id: tupleId, relationshipKey: "rel:k1", fromEntityId, toEntityId, relationshipType },
          ],
          upsert: async (args: {
            where: { fromEntityId_toEntityId_relationshipType: { fromEntityId: string; toEntityId: string; relationshipType: string } };
            create: { relationshipKey: string };
            update: { relationshipKey: string };
          }) => {
            upsertCalls.push(args);
            // A tuple-keyed upsert against an existing tuple returns that same row.
            return { id: tupleId, relationshipKey: args.create.relationshipKey };
          },
          updateMany: async () => ({ count: 0 }),
        },
        discoveredRelationship: {
          create: async ({ data }: { data: { relationshipKey: string; inventoryRelationship: { connect: { id: string } } } }) => {
            discoveredRelationshipCreates.push({
              relationshipKey: data.relationshipKey,
              connectId: data.inventoryRelationship.connect.id,
            });
            return {};
          },
        },
        portfolioQualityIssue: { findMany: async () => [], upsert: async () => ({}), updateMany: async () => ({ count: 0 }) },
      }),
    };

    const entity = (discoveredKey: string, entityKey: string) => ({
      entityKey,
      entityType: "host",
      name: entityKey,
      discoveredKey,
      portfolioSlug: "foundational",
      taxonomyNodeId: "foundational/compute/servers",
      attributionStatus: "attributed" as const,
      attributionMethod: "rule" as const,
      attributionConfidence: 0.98,
      providerView: "foundational",
      properties: {},
    });
    const item = (discoveredKey: string) => ({
      discoveredKey,
      sourceKind: "dpf_bootstrap",
      itemType: "host",
      name: discoveredKey,
      externalRef: discoveredKey,
      attributes: {},
    });

    const summary = await persistBootstrapDiscoveryRun(
      db,
      {
        discoveredItems: [item("dk:from"), item("dk:to")],
        inventoryEntities: [
          entity("dk:from", "host:shared"),
          entity("dk:to", "runtime:target"),
        ],
        inventoryRelationships: [
          {
            // Same tuple as the prior run, but a NEW relationshipKey.
            relationshipKey: "rel:k2",
            relationshipType,
            fromDiscoveredKey: "dk:from",
            toDiscoveredKey: "dk:to",
            properties: {},
          },
        ],
        softwareEvidence: [],
      },
      { runKey: "run-cross", sourceSlug: "dpf_bootstrap" },
      {
        projectInventoryEntity: async () => undefined,
        projectInventoryRelationship: async () => undefined,
      },
    );

    // Exactly one upsert, and its conflict target is the tuple (not relationshipKey).
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0]?.where).toEqual({
      fromEntityId_toEntityId_relationshipType: { fromEntityId, toEntityId, relationshipType },
    });
    // The upsert's update block refreshes relationshipKey to the new run's key.
    expect(upsertCalls[0]?.update.relationshipKey).toBe("rel:k2");
    // The prior tuple existed, so it counts as UPDATED, not created — and it is
    // NOT swept stale (its tuple was re-observed this run).
    expect(summary.updatedRelationships).toBe(1);
    expect(summary.createdRelationships).toBe(0);
    expect(summary.staleRelationships).toBe(0);
    // The new run still records its own provenance row under rel:k2, linked to the
    // one shared canonical InventoryRelationship.
    expect(discoveredRelationshipCreates).toEqual([
      { relationshipKey: "rel:k2", connectId: tupleId },
    ]);
  });

  describe("IdentityResolutionLog audit (spec §4.1)", () => {
    // A rule-resolved entity fixture: the fingerprint pipeline attributed it to a
    // CatalogIdentity, so discovery-sync must record the resolution lineage.
    const ruleResolvedRun = {
      discoveredItems: [
        {
          discoveredKey: "dpf_bootstrap:database:database:pg-primary",
          sourceKind: "dpf_bootstrap",
          itemType: "database",
          name: "pg-primary",
          externalRef: "database:pg-primary",
          attributes: {},
        },
      ],
      inventoryEntities: [
        {
          entityKey: "database:instance:pg-primary",
          entityType: "database",
          name: "pg-primary",
          discoveredKey: "dpf_bootstrap:database:database:pg-primary",
          portfolioSlug: "foundational",
          taxonomyNodeId: "foundational/data/relational_database",
          attributionStatus: "attributed" as const,
          attributionMethod: "rule" as const,
          attributionConfidence: 0.98,
          attributionEvidence: {
            source: "discovery-fingerprint",
            ruleId: "rule-postgres",
            ruleKey: "postgres_server",
          },
          catalogIdentityId: "ci-postgres",
          identityStatus: "rule_resolved",
          identityConfidence: 0.98,
          fingerprintRuleId: "rule-postgres",
          providerView: "foundational",
          properties: {},
        },
      ],
      inventoryRelationships: [],
      softwareEvidence: [],
    };

    function buildDb(
      findFirst: () => Promise<{ id: string } | null>,
      resolutionLogCreates: Array<Record<string, unknown>>,
    ) {
      return {
        $transaction: async <T>(fn: (tx: any) => Promise<T>): Promise<T> => fn({
          ...heapIntegrityRaw(),
          discoveryRun: { create: async () => ({ id: "run-res" }) },
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
          discoveredSoftwareEvidence: { upsert: async () => ({}) },
          inventoryRelationship: {
            findMany: async () => [],
            upsert: async () => ({ id: "rel", relationshipKey: "rel" }),
            updateMany: async () => ({ count: 0 }),
          },
          discoveredRelationship: { create: async () => ({}) },
          portfolioQualityIssue: { findMany: async () => [], upsert: async () => ({}), updateMany: async () => ({ count: 0 }) },
          identityResolutionLog: {
            findFirst,
            create: async ({ data }: { data: Record<string, unknown> }) => {
              resolutionLogCreates.push(data);
              return {};
            },
          },
        }),
      };
    }

    it("writes a rule resolution-log row on a first-time rule-resolved match", async () => {
      const resolutionLogCreates: Array<Record<string, unknown>> = [];
      const db = buildDb(async () => null, resolutionLogCreates);

      await persistBootstrapDiscoveryRun(db, ruleResolvedRun, {
        runKey: "run-res",
        sourceSlug: "dpf_bootstrap",
      }, {
        projectInventoryEntity: async () => undefined,
        projectInventoryRelationship: async () => undefined,
      });

      expect(resolutionLogCreates).toHaveLength(1);
      expect(resolutionLogCreates[0]).toMatchObject({
        inventoryEntityId: "entity:database:instance:pg-primary",
        catalogIdentityId: "ci-postgres",
        fingerprintRuleId: "rule-postgres",
        resolutionType: "rule",
        confidence: 0.98,
        discoveryRunId: "run-res",
      });
    });

    it("does not append a duplicate row when the same resolution already exists", async () => {
      const resolutionLogCreates: Array<Record<string, unknown>> = [];
      const db = buildDb(async () => ({ id: "existing-log" }), resolutionLogCreates);

      await persistBootstrapDiscoveryRun(db, ruleResolvedRun, {
        runKey: "run-res",
        sourceSlug: "dpf_bootstrap",
      }, {
        projectInventoryEntity: async () => undefined,
        projectInventoryRelationship: async () => undefined,
      });

      expect(resolutionLogCreates).toHaveLength(0);
    });

    it("writes no resolution-log row for a heuristic entity with no catalog identity", async () => {
      const resolutionLogCreates: Array<Record<string, unknown>> = [];
      const db = buildDb(async () => null, resolutionLogCreates);

      await persistBootstrapDiscoveryRun(db, {
        ...ruleResolvedRun,
        inventoryEntities: [
          {
            ...ruleResolvedRun.inventoryEntities[0]!,
            attributionStatus: "needs_review" as const,
            attributionMethod: "heuristic" as const,
            catalogIdentityId: null,
            identityStatus: null,
            identityConfidence: null,
            fingerprintRuleId: null,
          },
        ],
      }, {
        runKey: "run-res",
        sourceSlug: "dpf_bootstrap",
      }, {
        projectInventoryEntity: async () => undefined,
        projectInventoryRelationship: async () => undefined,
      });

      expect(resolutionLogCreates).toHaveLength(0);
    });
  });
});
