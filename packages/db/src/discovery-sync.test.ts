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
    const upsertedEntityPayloads: Array<Record<string, unknown>> = [];
    const createdSoftwareEvidence: Array<Record<string, unknown>> = [];
    const qualityIssues: Array<Record<string, unknown>> = [];

    const db = {
      $transaction: async <T>(fn: (tx: any) => Promise<T>): Promise<T> => fn({
        discoveryRun: {
          create: async () => ({ id: "run-1" }),
        },
        inventoryEntity: {
          findMany: async () => [],
          upsert: async ({ where, create, update }: { where: { entityKey: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
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
          upsert: async ({ create }: { create: Record<string, unknown> }) => {
            qualityIssues.push(create);
            return {};
          },
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
    expect(upsertedEntityPayloads[0]?.create).toMatchObject({
      taxonomyNode: { connect: { nodeId: "foundational/compute/servers" } },
      attributionMethod: "rule",
      attributionConfidence: 0.98,
    });
    expect(createdSoftwareEvidence[0]).toMatchObject({
      evidenceKey: "host:hostname:dpf-dev:host_packages:postgresql-16",
      softwareIdentityId: "identity-postgres",
    });
    expect(qualityIssues.map((issue) => issue.issueType)).toContain(
      "taxonomy_attribution_low_confidence",
    );
  });
});
