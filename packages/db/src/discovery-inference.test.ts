import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./neo4j", () => ({
  runCypher: vi.fn().mockResolvedValue([]),
}));

import { runCypher } from "./neo4j";
import {
  inferCrossCollectorRelationships,
  inferProductDependencies,
} from "./discovery-inference";
import type { CollectorOutput } from "./discovery-types";

const mockRunCypher = vi.mocked(runCypher);

// ─── Pass 1: Cross-collector inference ─────────────────────────────────────

describe("inferCrossCollectorRelationships", () => {
  it("creates HOSTS relationships from docker_host to network interfaces", () => {
    const input: CollectorOutput = {
      items: [
        {
          sourceKind: "docker",
          itemType: "docker_host",
          name: "docker-desktop",
          externalRef: "docker-host:docker-desktop",
        },
        {
          sourceKind: "network",
          itemType: "network_interface",
          name: "eth0 (10.0.1.50)",
          externalRef: "net-iface:eth0:10.0.1.50",
        },
        {
          sourceKind: "network",
          itemType: "network_interface",
          name: "wlan0 (192.168.1.100)",
          externalRef: "net-iface:wlan0:192.168.1.100",
        },
      ],
      relationships: [],
    };

    const result = inferCrossCollectorRelationships(input);

    const hostRels = result.relationships.filter(
      (r) =>
        r.relationshipType === "HOSTS" &&
        r.fromExternalRef === "docker-host:docker-desktop",
    );
    expect(hostRels).toHaveLength(2);
    expect(hostRels[0].toExternalRef).toBe("net-iface:eth0:10.0.1.50");
    expect(hostRels[1].toExternalRef).toBe("net-iface:wlan0:192.168.1.100");
    expect(hostRels[0].attributes?.inferred).toBe(true);
  });

  it("creates RUNS_ON from host to docker_host", () => {
    const input: CollectorOutput = {
      items: [
        {
          sourceKind: "host",
          itemType: "host",
          name: "dpf-dev",
          externalRef: "host:dpf-dev",
        },
        {
          sourceKind: "docker",
          itemType: "docker_host",
          name: "docker-desktop",
          externalRef: "docker-host:docker-desktop",
        },
      ],
      relationships: [],
    };

    const result = inferCrossCollectorRelationships(input);

    const runsOn = result.relationships.find(
      (r) => r.relationshipType === "RUNS_ON",
    );
    expect(runsOn).toBeDefined();
    expect(runsOn!.fromExternalRef).toBe("host:dpf-dev");
    expect(runsOn!.toExternalRef).toBe("docker-host:docker-desktop");
  });

  it("correlates Prometheus targets with Docker containers", () => {
    const input: CollectorOutput = {
      items: [
        {
          sourceKind: "prometheus",
          itemType: "application",
          name: "portal",
          externalRef: "prom-target:portal:portal:3000",
          attributes: { job: "portal", instance: "portal:3000" },
        },
        {
          sourceKind: "docker",
          itemType: "container",
          name: "portal",
          externalRef: "container:abc123",
        },
      ],
      relationships: [],
    };

    const result = inferCrossCollectorRelationships(input);

    const runsOn = result.relationships.find(
      (r) =>
        r.relationshipType === "RUNS_ON" &&
        r.attributes?.rule === "prometheus_target_matches_container",
    );
    expect(runsOn).toBeDefined();
    expect(runsOn!.fromExternalRef).toBe("prom-target:portal:portal:3000");
    expect(runsOn!.toExternalRef).toBe("container:abc123");
  });

  it("preserves existing relationships", () => {
    const input: CollectorOutput = {
      items: [],
      relationships: [
        {
          sourceKind: "docker",
          relationshipType: "hosts",
          fromExternalRef: "docker_runtime:sock",
          toExternalRef: "container:abc123",
        },
      ],
    };

    const result = inferCrossCollectorRelationships(input);
    expect(result.relationships).toHaveLength(1);
    expect(result.relationships[0].relationshipType).toBe("hosts");
  });

  it("handles empty input gracefully", () => {
    const result = inferCrossCollectorRelationships({
      items: [],
      relationships: [],
    });
    expect(result.relationships).toHaveLength(0);
  });

  it("creates PEER_OF between UniFi router and network gateway with same IP", () => {
    const input: CollectorOutput = {
      items: [
        {
          sourceKind: "unifi",
          itemType: "router",
          name: "UDM Pro",
          externalRef: "unifi-device:aa:bb:cc:dd:ee:01",
          attributes: { address: "192.168.0.1" },
        },
        {
          sourceKind: "network",
          itemType: "gateway",
          name: "Gateway 192.168.0.1",
          externalRef: "gateway:192.168.0.1",
          attributes: { address: "192.168.0.1" },
        },
      ],
      relationships: [],
    };

    const result = inferCrossCollectorRelationships(input);

    const peerOf = result.relationships.find(
      (r) =>
        r.relationshipType === "PEER_OF" &&
        r.attributes?.rule === "unifi_router_is_network_gateway",
    );
    expect(peerOf).toBeDefined();
    expect(peerOf!.fromExternalRef).toBe("unifi-device:aa:bb:cc:dd:ee:01");
    expect(peerOf!.toExternalRef).toBe("gateway:192.168.0.1");
    expect(peerOf!.confidence).toBe(0.95);
  });

  it("does not create PEER_OF when UniFi router and gateway have different IPs", () => {
    const input: CollectorOutput = {
      items: [
        {
          sourceKind: "unifi",
          itemType: "router",
          name: "UDM Pro",
          externalRef: "unifi-device:aa:bb:cc:dd:ee:01",
          attributes: { address: "10.0.0.1" },
        },
        {
          sourceKind: "network",
          itemType: "gateway",
          name: "Gateway 192.168.0.1",
          externalRef: "gateway:192.168.0.1",
          attributes: { address: "192.168.0.1" },
        },
      ],
      relationships: [],
    };

    const result = inferCrossCollectorRelationships(input);

    const peerOf = result.relationships.find(
      (r) => r.attributes?.rule === "unifi_router_is_network_gateway",
    );
    expect(peerOf).toBeUndefined();
  });
});

// ─── Passes 2 & 3: Product-to-infrastructure inference ────────────────────

describe("inferProductDependencies", () => {
  beforeEach(() => {
    mockRunCypher.mockClear();
  });

  it("creates DEPENDS_ON from promoted product to its InfraCI", async () => {
    const db = {
      inventoryEntity: {
        findMany: vi.fn().mockResolvedValue([
          {
            entityKey: "container:portal-abc123",
            entityType: "container",
            name: "dpf-portal",
            digitalProductId: "cuid-product-1",
            digitalProduct: { productId: "infra-dpf-portal" },
          },
        ]),
      },
      digitalProduct: {
        findMany: vi.fn().mockResolvedValue([
          { productId: "infra-dpf-portal", name: "dpf-portal" },
        ]),
      },
    };

    const result = await inferProductDependencies(db as never);

    expect(result.productToInfraEdges).toBe(1);
    expect(mockRunCypher).toHaveBeenCalledTimes(1);
    const cypher = mockRunCypher.mock.calls[0]![0] as string;
    expect(cypher).toContain("DEPENDS_ON");
    const params = mockRunCypher.mock.calls[0]![1] as Record<string, unknown>;
    expect(params.fromId).toBe("infra-dpf-portal");
    expect(params.toId).toBe("container:portal-abc123");
  });

  it("creates name-matched edges for unlinked products", async () => {
    const db = {
      inventoryEntity: {
        findMany: vi
          .fn()
          // First call: promoted entities (empty — no promotions)
          .mockResolvedValueOnce([])
          // Second call: linkable entities for name matching
          .mockResolvedValueOnce([
            {
              entityKey: "container:postgres-def456",
              entityType: "database",
              name: "dpf-postgres",
              digitalProductId: null,
              digitalProduct: null,
            },
          ]),
      },
      digitalProduct: {
        findMany: vi.fn().mockResolvedValue([
          { productId: "product-postgres-db", name: "PostgreSQL Database" },
        ]),
      },
    };

    const result = await inferProductDependencies(db as never);

    expect(result.nameMatchEdges).toBe(1);
    const params = mockRunCypher.mock.calls[0]![1] as Record<string, unknown>;
    expect(params.fromId).toBe("product-postgres-db");
    expect(params.toId).toBe("container:postgres-def456");
  });

  it("does not create duplicate edges", async () => {
    const db = {
      inventoryEntity: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([
            {
              entityKey: "container:abc",
              entityType: "container",
              name: "portal",
              digitalProductId: "cuid-1",
              digitalProduct: { productId: "infra-portal" },
            },
          ])
          .mockResolvedValueOnce([
            {
              entityKey: "container:abc",
              entityType: "container",
              name: "portal",
              digitalProductId: "cuid-1",
              digitalProduct: { productId: "infra-portal" },
            },
          ]),
      },
      digitalProduct: {
        findMany: vi.fn().mockResolvedValue([
          { productId: "infra-portal", name: "portal" },
        ]),
      },
    };

    const result = await inferProductDependencies(db as never);

    // Should only create 1 edge (promoted), skip the name match since same key
    expect(result.productToInfraEdges).toBe(1);
    expect(result.nameMatchEdges).toBe(0);
    expect(mockRunCypher).toHaveBeenCalledTimes(1);
  });

  it("handles empty database gracefully", async () => {
    const db = {
      inventoryEntity: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      digitalProduct: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    const result = await inferProductDependencies(db as never);
    expect(result.productToInfraEdges).toBe(0);
    expect(result.nameMatchEdges).toBe(0);
    expect(mockRunCypher).not.toHaveBeenCalled();
  });
});
