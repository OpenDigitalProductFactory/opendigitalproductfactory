import { describe, expect, it, vi } from "vitest";
import { normalizeDiscoveredFacts } from "../../../packages/db/src/discovery-normalize";
import { isDockerOriginEntityKey } from "../../../packages/db/src/docker-origin";
import { uxSweepEstateFacts } from "./ux-sweep-fixture-core.mjs";

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
