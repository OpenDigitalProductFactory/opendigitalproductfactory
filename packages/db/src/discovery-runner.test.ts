import { describe, expect, it, vi } from "vitest";

import { collectDockerDiscovery } from "./discovery-collectors/docker";
import { collectHostDiscovery } from "./discovery-collectors/host";
import { collectKubernetesDiscovery } from "./discovery-collectors/kubernetes";
import {
  executeBootstrapDiscovery,
  mergeCollectorOutputs,
  runBootstrapCollectors,
} from "./discovery-runner";

describe("mergeCollectorOutputs", () => {
  it("combines collector outputs without dropping items or relationships", () => {
    const result = mergeCollectorOutputs([
      { items: [{ itemType: "host", name: "dpf-dev" }], relationships: [], software: [] },
      {
        items: [{ itemType: "docker_runtime", name: "docker" }],
        relationships: [{ relationshipType: "hosts" }],
        software: [{ evidenceSource: "container_packages", rawPackageName: "nginx" }],
      },
    ]);

    expect(result.items).toHaveLength(2);
    expect(result.relationships).toHaveLength(1);
    expect(result.software).toHaveLength(1);
  });
});

describe("collectHostDiscovery", () => {
  it("returns at least one host fact", async () => {
    const result = await collectHostDiscovery(
      { sourceKind: "dpf_bootstrap" },
      {
        hostname: () => "dpf-dev",
        platform: () => "linux",
        release: () => "6.8.0",
        arch: () => "x64",
        cpus: () => [{ model: "x", speed: 1, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } }],
        totalmem: () => 1024,
        networkInterfaces: () => ({
          eth0: [{ address: "127.0.0.1", netmask: "255.0.0.0", family: "IPv4", mac: "00:00:00:00:00:00", internal: false, cidr: "127.0.0.1/8" }],
        }),
        installedSoftware: async () => [],
      },
    );

    expect(result.items[0]?.itemType).toBe("host");
    expect(result.items[0]?.name).toBe("dpf-dev");
  });

  it("captures installed host software as discovery evidence", async () => {
    const result = await collectHostDiscovery(
      { sourceKind: "dpf_bootstrap" },
      {
        hostname: () => "dpf-dev",
        platform: () => "win32",
        release: () => "11",
        arch: () => "x64",
        cpus: () => [{ model: "x", speed: 1, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } }],
        totalmem: () => 1024,
        networkInterfaces: () => ({}),
        installedSoftware: async () => [
          {
            evidenceSource: "installed_software",
            rawProductName: "Docker Desktop Community Edition",
            rawVersion: "4.38.0",
            rawVendor: "Docker",
          },
        ],
      },
    );

    expect(result.software).toHaveLength(1);
    expect(result.software?.[0]).toMatchObject({
      entityExternalRef: "host:dpf-dev",
      evidenceSource: "installed_software",
      rawProductName: "Docker Desktop Community Edition",
    });
  });
});

describe("collectDockerDiscovery", () => {
  it("returns an empty output rather than throwing when Docker is unavailable", async () => {
    const result = await collectDockerDiscovery(
      { sourceKind: "dpf_bootstrap" },
      { socketPaths: ["/missing.sock"], existsSync: () => false, listContainers: async () => [], getDockerInfo: () => null, listNetworks: () => [] },
    );

    expect(result.items).toEqual([]);
    expect(result.warnings).toContain("docker_unavailable");
  });

  it("captures running containers and image evidence when Docker is available", async () => {
    const result = await collectDockerDiscovery(
      { sourceKind: "dpf_bootstrap" },
      {
        socketPaths: ["/var/run/docker.sock"],
        existsSync: () => true,
        listContainers: async () => [
          {
            id: "container-1",
            name: "dpf-web",
            image: "ghcr.io/acme/dpf-web:1.2.3",
          },
        ],
        getDockerInfo: () => null,
        listNetworks: () => [],
      },
    );

    expect(result.items.map((item) => item.itemType)).toContain("container");
    expect(result.software?.[0]).toMatchObject({
      entityExternalRef: "container:container-1",
      evidenceSource: "container_image",
      rawProductName: "ghcr.io/acme/dpf-web:1.2.3",
    });
  });
});

describe("collectKubernetesDiscovery", () => {
  it("returns an empty output rather than throwing when Kubernetes is unavailable", async () => {
    const result = await collectKubernetesDiscovery(
      { sourceKind: "dpf_bootstrap" },
      { env: {} },
    );

    expect(result.items).toEqual([]);
    expect(result.warnings).toContain("kubernetes_unavailable");
  });
});

describe("runBootstrapCollectors", () => {
  it("runs host always and merges opportunistic collector outputs", async () => {
    const result = await runBootstrapCollectors([
      async () => ({ items: [{ itemType: "host", name: "dpf-dev" }], relationships: [] }),
      async () => ({ items: [], relationships: [], warnings: ["docker_unavailable"] }),
    ]);

    expect(result.items).toHaveLength(1);
    expect(result.warnings).toContain("docker_unavailable");
  });
});

describe("executeBootstrapDiscovery", () => {
  it("creates a run through the orchestration path and returns a stable summary", async () => {
    const persist = vi.fn().mockResolvedValue({
      runId: "run-1",
      createdEntities: 1,
      updatedEntities: 0,
      staleEntities: 0,
      createdRelationships: 0,
      updatedRelationships: 0,
      staleRelationships: 0,
      createdIssues: 0,
    });

    const summary = await executeBootstrapDiscovery({} as never, {
      collectors: [
        async () => ({
          items: [{ sourceKind: "dpf_bootstrap", itemType: "host", name: "dpf-dev", externalRef: "host:dpf-dev" }],
          relationships: [],
        }),
      ],
      persist,
      runKey: "DISC-001",
      trigger: "bootstrap",
      taxonomyNodes: [
        {
          nodeId: "foundational/compute/servers",
          name: "Servers",
          portfolioSlug: "foundational",
        },
      ],
    });

    expect(persist).toHaveBeenCalledOnce();
    expect(summary).toMatchObject({
      runId: "run-1",
      createdEntities: 1,
    });
    expect(persist.mock.calls[0]?.[1].inventoryEntities[0]).toMatchObject({
      taxonomyNodeId: "foundational/compute/servers",
      attributionMethod: "rule",
    });
  });

  it("loads taxonomy nodes from the db client when options do not provide them", async () => {
    const persist = vi.fn().mockResolvedValue({
      runId: "run-2",
      createdEntities: 1,
      updatedEntities: 0,
      staleEntities: 0,
      createdRelationships: 0,
      updatedRelationships: 0,
      staleRelationships: 0,
      createdIssues: 0,
    });

    await executeBootstrapDiscovery({
      taxonomyNode: {
        findMany: vi.fn().mockResolvedValue([
          {
            nodeId: "foundational/compute/servers",
            name: "Servers",
          },
        ]),
      },
    } as never, {
      collectors: [
        async () => ({
          items: [{ sourceKind: "dpf_bootstrap", itemType: "host", name: "dpf-dev", externalRef: "host:dpf-dev" }],
          relationships: [],
          software: [],
        }),
      ],
      persist,
      runKey: "DISC-002",
      trigger: "bootstrap",
    });

    expect(persist.mock.calls[0]?.[1].inventoryEntities[0]).toMatchObject({
      taxonomyNodeId: "foundational/compute/servers",
      attributionMethod: "rule",
    });
  });
});
