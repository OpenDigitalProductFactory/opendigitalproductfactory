import { describe, expect, it } from "vitest";
import {
  buildNetworkTopologyModel,
  NETWORK_PACKAGE_KEY,
  NETWORK_HOSTS_KEY,
  NETWORK_DEVICES_KEY,
  type EdgeNodeFact,
  type InventoryEntityFact,
  type InventoryRelFact,
} from "./network-bridge-extract";

const edgeNodes: EdgeNodeFact[] = [
  { nodeId: "n1", platform: "linux", installMode: "native", version: "1", status: "active", trustState: "trusted", lastSeenAt: null },
];
const entities: InventoryEntityFact[] = [
  { entityKey: "e1", entityType: "host", name: "Router", technicalClass: null, manufacturer: "Ubiquiti", productModel: "UDM", status: "active" },
  { entityKey: "e2", entityType: "service", name: "DNS", technicalClass: null, manufacturer: null, productModel: null, status: "active" },
];
const relationships: InventoryRelFact[] = [
  { fromEntityKey: "e1", toEntityKey: "e2", relationshipType: "depends_on" },
  { fromEntityKey: "e1", toEntityKey: "missing", relationshipType: "depends_on" }, // dropped (unknown target)
  { fromEntityKey: "e1", toEntityKey: "e2", relationshipType: "x" }, // deduped (same pair)
  { fromEntityKey: "e1", toEntityKey: "e1", relationshipType: "self" }, // dropped (self)
];

describe("buildNetworkTopologyModel", () => {
  const model = buildNetworkTopologyModel({ edgeNodes, entities, relationships });
  const byKey = new Map(model.elements.map((e) => [e.sysmlKey, e]));

  it("projects edge hosts and discovered entities under grouped part definitions", () => {
    expect(byKey.get(NETWORK_PACKAGE_KEY)?.typeSlug).toBe("package");
    expect(byKey.get(NETWORK_HOSTS_KEY)?.typeSlug).toBe("part_definition");
    expect(byKey.get(NETWORK_DEVICES_KEY)?.typeSlug).toBe("part_definition");
    expect(byKey.get("network:host:n1")?.typeSlug).toBe("part_usage");
    expect(byKey.get("network:entity:e1")?.typeSlug).toBe("part_usage");
    expect(byKey.get("network:entity:e1")?.properties?.refinementLevel).toBe("actual");
    expect(model.elements).toHaveLength(6); // pkg + 2 groups + 1 host + 2 entities
  });

  it("connects inventory entities only for known, deduped, non-self relationships", () => {
    const connects = model.relationships.filter((r) => r.relSlug === "connects");
    expect(connects).toEqual([{ fromKey: "network:entity:e1", toKey: "network:entity:e2", relSlug: "connects" }]);
  });

  it("contains hosts and devices under their groups", () => {
    const contains = model.relationships.filter((r) => r.relSlug === "contains");
    expect(contains).toHaveLength(5); // pkg→hosts, pkg→devices, hosts→n1, devices→e1, devices→e2
  });

  it("declares rule-valid types and a soft-remove prefix", () => {
    expect(model.elementTypeSlugs).toEqual(["package", "part_definition", "part_usage"]);
    expect(model.relTypeSlugs).toEqual(["contains", "connects", "traces"]);
    expect(model.softRemovePrefix).toBe("network:");
  });

  it("traces each host/entity to its data-model element (cross-layer)", () => {
    expect(model.crossLayerRelationships).toEqual([
      { fromKey: "network:host:n1", toKey: "prisma:model:EdgeNode", relSlug: "traces" },
      { fromKey: "network:entity:e1", toKey: "prisma:model:InventoryEntity", relSlug: "traces" },
      { fromKey: "network:entity:e2", toKey: "prisma:model:InventoryEntity", relSlug: "traces" },
    ]);
  });
});
