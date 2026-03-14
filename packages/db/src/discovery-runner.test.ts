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
      { items: [{ itemType: "host", name: "dpf-dev" }], relationships: [] },
      { items: [{ itemType: "docker_runtime", name: "docker" }], relationships: [{ relationshipType: "hosts" }] },
    ]);

    expect(result.items).toHaveLength(2);
    expect(result.relationships).toHaveLength(1);
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
      },
    );

    expect(result.items[0]?.itemType).toBe("host");
    expect(result.items[0]?.name).toBe("dpf-dev");
  });
});

describe("collectDockerDiscovery", () => {
  it("returns an empty output rather than throwing when Docker is unavailable", async () => {
    const result = await collectDockerDiscovery(
      { sourceKind: "dpf_bootstrap" },
      { socketPaths: ["/missing.sock"], existsSync: () => false },
    );

    expect(result.items).toEqual([]);
    expect(result.warnings).toContain("docker_unavailable");
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
    });

    expect(persist).toHaveBeenCalledOnce();
    expect(summary).toMatchObject({
      runId: "run-1",
      createdEntities: 1,
    });
  });
});
