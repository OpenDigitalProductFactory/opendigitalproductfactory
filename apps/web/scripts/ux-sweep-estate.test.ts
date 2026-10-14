import { describe, expect, it, vi } from "vitest";
import { normalizeDiscoveredFacts } from "../../../packages/db/src/discovery-normalize";
import { isDockerOriginEntityKey } from "../../../packages/db/src/docker-origin";
import { uxSweepEstateFacts } from "./ux-sweep-fixture-core.mjs";
import { flagUnconfiguredGateways } from "../../../packages/db/src/discovery-runner";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PortfolioQualityIssuesPanel } from "@/components/inventory/PortfolioQualityIssuesPanel";
import { resolveMacVendor } from "../../../packages/db/src/mac-oui";
import { deriveInventoryEnrichment } from "../../../packages/db/src/inventory-enrichment";
import { buildQualityEvaluationEntities } from "../../../packages/db/src/discovery-quality-input";
import { evaluateInventoryQuality } from "../../../packages/db/src/discovery-attribution";

const state = vi.hoisted(() => ({ entities: [] as unknown[], relations: [] as unknown[], graph: vi.fn() }));
vi.mock("@dpf/db", () => ({
  prisma: {
    inventoryEntity: { findMany: async () => state.entities },
    inventoryRelationship: { findMany: async () => state.relations },
  },
  INVENTORY_ENTITY_CANONICAL_WHERE: { mergedIntoId: null },
  INVENTORY_RELATIONSHIP_CANONICAL_WHERE: { mergedIntoId: null, status: { not: "superseded" } },
  isDockerOriginEntityKey: (key: string, name: string) => isDockerOriginEntityKey(key, name),
}));
vi.mock("../../../packages/db/src/client", () => ({ prisma: {
  $executeRawUnsafe: state.graph,
  inventoryEntity: { findMany: async () => state.entities },
  inventoryRelationship: { findMany: async () => state.relations },
},
  INVENTORY_ENTITY_CANONICAL_WHERE: { mergedIntoId: null },
  INVENTORY_RELATIONSHIP_CANONICAL_WHERE: { mergedIntoId: null, status: { not: "superseded" } },
  isDockerOriginEntityKey: (key: string, name: string) => isDockerOriginEntityKey(key, name),
}));
import { getInventoryEntitiesGroupedBySubnet } from "@/lib/discovery-data";
import { syncInventoryEntityAsInfraCI } from "../../../packages/db/src/graph-sync";

describe("declared estate uses the actual discovery read-model contract", () => {
  it("derives the known NIC lifecycle from OUI evidence while retaining unknown estate cases", () => {
    const normalized = normalizeDiscoveredFacts(uxSweepEstateFacts(), {
      taxonomyNodes: [
        { nodeId: "foundational/compute/servers", name: "Servers", portfolioSlug: "foundational" },
        { nodeId: "foundational/platform_services/container_platform", name: "Containers", portfolioSlug: "foundational" },
        { nodeId: "foundational/network_management/network_connectivity", name: "Network", portfolioSlug: "foundational" },
      ],
    });
    // Verified against the committed OUI TSV and the seeded MacVendorOui row.
    const vendors = new Map([["000D3A", "Microsoft Corp."]]);
    const enrichments = new Map(normalized.inventoryEntities.map(e => {
      const properties = { ...e.properties };
      const resolution = resolveMacVendor(properties.mac as string | undefined, vendors);
      if (resolution.vendor) properties.vendor = resolution.vendor;
      return [e.entityKey, deriveInventoryEnrichment({
        entityType: e.entityType, name: e.name, properties,
        manufacturer: null, productModel: null, observedVersion: null, normalizedVersion: null,
        iconKey: null, supportStatus: "unknown",
      })];
    }));
    const nic = normalized.inventoryEntities.find(e => e.entityType === "network_interface")!;
    expect(enrichments.get(nic.entityKey)?.manufacturer).toBe("Microsoft");
    const { issues } = evaluateInventoryQuality(buildQualityEvaluationEntities({
      observedEntities: normalized.inventoryEntities, softwareEvidenceByEntityKey: new Map(),
      enrichmentByEntityKey: enrichments, persistedIdentityByEntityKey: new Map(),
      staleEntityKeys: [], existingEntityByKey: new Map(),
    }));
    expect(issues.filter(i => i.issueType === "lifecycle_unverified").map(i => i.inventoryEntityKey).sort()).toEqual([
      "gateway:gateway:10.1.0.1", "host:hostname:ux-sweep-machine",
      "runtime:socket:/var/run/docker.sock", "subnet:subnet:10.1.0.0/24",
    ].sort());
    expect(issues.filter(i => i.issueType === "attribution_missing")).toHaveLength(2);
  });
  it("renders the three uncovered gateway connection actions from normal follow-up", async () => {
    const normalized = normalizeDiscoveredFacts(uxSweepEstateFacts());
    const gateways = normalized.inventoryEntities.filter(e => e.entityType === "gateway")
      .map(e => ({ id: e.entityKey, ...e }));
    type PanelIssue = Parameters<typeof PortfolioQualityIssuesPanel>[0]["issues"][number];
    const issues: PanelIssue[] = [];
    await flagUnconfiguredGateways({
      inventoryEntity: { findMany: async () => gateways },
      discoveryConnection: { findMany: async () => [] },
      portfolioQualityIssue: {
        upsert: async ({ create }) => {
          issues.push({
            id: String(create.issueKey), issueType: String(create.issueType),
            severity: String(create.severity), summary: String(create.summary), details: create.details,
            inventoryEntity: null, portfolio: null, taxonomyNode: null, digitalProduct: null,
          });
        },
        updateMany: async () => ({ count: 0 }),
      },
    });
    const html = renderToStaticMarkup(createElement(PortfolioQualityIssuesPanel, { issues }));
    expect(issues).toHaveLength(3);
    expect(html.match(/>Configure<\/button>/g)).toHaveLength(3);
  });
  it("has physical subnet members, review candidates and graph-mirror nodes", async () => {
    const normalized = normalizeDiscoveredFacts(uxSweepEstateFacts(), {
      taxonomyNodes: [
        { nodeId: "foundational/compute/servers", name: "Servers", portfolioSlug: "foundational" },
        { nodeId: "foundational/platform_services/container_platform", name: "Containers", portfolioSlug: "foundational" },
        { nodeId: "foundational/network_management/network_connectivity", name: "Network", portfolioSlug: "foundational" },
      ],
    });
    state.graph.mockClear();
    state.entities = normalized.inventoryEntities.map(e => ({
      id: e.entityKey, ...e, status: "active",
      portfolio: null, taxonomyNode: null, digitalProduct: null,
    }));
    state.relations = normalized.inventoryRelationships.filter(r => r.relationshipType === "MEMBER_OF")
      .map(r => ({ fromEntityId: r.fromEntityKey, toEntityId: r.toEntityKey }));
    const grouped = await getInventoryEntitiesGroupedBySubnet();
    expect(grouped.physicalSubnets.some(g => g.entities.length > 0)).toBe(true);
    expect(grouped.totalCount).toBeGreaterThan(0);
    expect(normalized.inventoryEntities.some(e => e.attributionStatus === "needs_review" && e.candidateTaxonomy.length > 0)).toBe(true);
    for (const e of normalized.inventoryEntities) {
      await syncInventoryEntityAsInfraCI({ ...e, status: "active" });
    }
    expect(state.graph.mock.calls.filter(c => c[2]?.includes("InfraCI")).length).toBeGreaterThan(0);
  });
});
