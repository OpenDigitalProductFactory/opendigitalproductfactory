import { describe, expect, it } from "vitest";

import { normalizeDiscoveredFacts } from "../src/discovery-normalize";
import type { DiscoveryScopeContext } from "../src/discovery-scope";

const customerA: DiscoveryScopeContext = {
  mode: "customer-site",
  customerAccountId: "cust_a",
  customerSiteId: "site_austin",
};

const customerB: DiscoveryScopeContext = {
  mode: "customer-site",
  customerAccountId: "cust_b",
  customerSiteId: "site_round_rock",
};

describe("normalizeDiscoveredFacts with discovery scope", () => {
  it("uses customer scope when normalizing inventory entity keys", () => {
    const normalized = normalizeDiscoveredFacts(
      {
        items: [
          {
            sourceKind: "edge_node",
            itemType: "host",
            name: "Default Gateway",
            externalRef: "arp:192.168.1.1",
            attributes: { ip: "192.168.1.1" },
          },
        ],
        relationships: [],
        warnings: [],
      },
      { discoveryScope: customerA },
    );

    expect(normalized.inventoryEntities[0]?.entityKey).toBe(
      "customer:cust_a:site:site_austin:host:arp:192.168.1.1",
    );
    expect(normalized.inventoryEntities[0]?.properties).toMatchObject({
      scopeKey: "customer:cust_a:site:site_austin",
      customerAccountId: "cust_a",
      customerSiteId: "site_austin",
      ip: "192.168.1.1",
    });
  });

  it("keeps two customers with the same private IP distinct", () => {
    const facts = {
      items: [
        {
          sourceKind: "edge_node",
          itemType: "host",
          name: "Default Gateway",
          externalRef: "arp:192.168.1.1",
          attributes: { ip: "192.168.1.1" },
        },
      ],
      relationships: [],
      warnings: [],
    } as const;

    const a = normalizeDiscoveredFacts(facts, { discoveryScope: customerA });
    const b = normalizeDiscoveredFacts(facts, { discoveryScope: customerB });

    expect(a.inventoryEntities[0]?.entityKey).not.toBe(b.inventoryEntities[0]?.entityKey);
    expect(a.inventoryEntities[0]?.entityKey).toBe(
      "customer:cust_a:site:site_austin:host:arp:192.168.1.1",
    );
    expect(b.inventoryEntities[0]?.entityKey).toBe(
      "customer:cust_b:site:site_round_rock:host:arp:192.168.1.1",
    );
  });

  it("scopes relationship keys alongside entity keys", () => {
    const facts = {
      items: [
        {
          sourceKind: "edge_node",
          itemType: "host",
          name: "Workstation",
          externalRef: "arp:192.168.1.22",
          naturalKey: "arp:192.168.1.22",
          attributes: {},
        },
        {
          sourceKind: "edge_node",
          itemType: "gateway",
          name: "Gateway",
          externalRef: "arp:192.168.1.1",
          naturalKey: "arp:192.168.1.1",
          attributes: {},
        },
      ],
      relationships: [
        {
          sourceKind: "edge_node",
          relationshipType: "ROUTES_THROUGH",
          fromExternalRef: "arp:192.168.1.22",
          toExternalRef: "arp:192.168.1.1",
          attributes: {},
        },
      ],
      warnings: [],
    } as const;

    const a = normalizeDiscoveredFacts(facts, { discoveryScope: customerA });
    const b = normalizeDiscoveredFacts(facts, { discoveryScope: customerB });

    expect(a.inventoryRelationships[0]?.relationshipKey).toContain("customer:cust_a:site:site_austin");
    expect(b.inventoryRelationships[0]?.relationshipKey).toContain("customer:cust_b:site:site_round_rock");
    expect(a.inventoryRelationships[0]?.relationshipKey).not.toBe(
      b.inventoryRelationships[0]?.relationshipKey,
    );
    expect(a.inventoryRelationships[0]?.properties).toMatchObject({
      scopeKey: "customer:cust_a:site:site_austin",
      customerAccountId: "cust_a",
      customerSiteId: "site_austin",
    });
  });

  it("stays backward compatible when no discoveryScope is supplied", () => {
    const normalized = normalizeDiscoveredFacts(
      {
        items: [
          {
            sourceKind: "edge_node",
            itemType: "host",
            name: "Internal host",
            externalRef: "arp:10.0.0.5",
            attributes: {},
          },
        ],
        relationships: [],
        warnings: [],
      },
      {},
    );

    expect(normalized.inventoryEntities[0]?.entityKey).toBe("host:arp:10.0.0.5");
    expect(normalized.inventoryEntities[0]?.properties).not.toHaveProperty("scopeKey");
  });
});
